import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHash, randomUUID } from 'node:crypto';
import { mcpConfigSchema, VERSION, createRedactor, type McpConfig, type McpServerState, type AgentTool, type AgentToolOutput } from '@reprocase/core';
import type { SecretVault } from '../../../packages/ai/src/providers.ts';
export class McpManager {
  private records=new Map<string,McpServerState>();private configs=new Map<string,McpConfig>();private clients=new Map<string,Client>();private schemas=new Map<string,AgentTool>();private aliases=new Map<string,{id:string;name:string}>();
  constructor(private options:{desktop:boolean;vault?:SecretVault;save:(records:McpServerState[])=>void}){}
  async restore(records:McpServerState[]){for(const record of records){this.records.set(record.id,{...record,state:'disconnected',tools:[]});if(this.options.vault){try{const saved=await this.options.vault.get(record.id);if(saved)this.configs.set(record.id,mcpConfigSchema.parse(JSON.parse(saved)));}catch{this.records.set(record.id,{...record,state:'error',tools:[],error:'Re-enter the saved MCP configuration'});}}}}
  list(){return [...this.records.values()].map(v=>structuredClone(v));}
  knownSecrets(){return [...this.configs.values()].flatMap(config=>[...Object.values(config.headers??{}),...Object.entries(config.env??{}).filter(([key])=>/key|token|password|secret|authorization/i.test(key)).map(([,value])=>value)]).filter(v=>v.length>3);}
  private clean(value:string){return createRedactor(this.knownSecrets()).text(value);}
  private persist(){this.options.save(this.list().map(v=>({...v,state:'disconnected',tools:[]})));}
  async save(input:unknown){const value=mcpConfigSchema.parse(input);if(value.id&&(this.clients.has(value.id)||this.records.get(value.id)?.state==='connecting'))throw new Error('Disconnect this MCP server before editing it');const id=value.id??`mcp-${randomUUID()}`;
    if(value.transport==='http'){const url=new URL(value.url!);if(url.username||url.password||url.hash||url.search||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Use HTTPS or a loopback HTTP MCP endpoint without URL credentials');}
    const config={...value,id};if(this.options.vault)await this.options.vault.set(id,JSON.stringify(config));this.configs.set(id,config);
    const record:McpServerState={id,name:value.name,transport:value.transport,command:value.command,args:value.args,cwd:value.cwd,url:value.url,hasCredentials:!!Object.keys(value.env??{}).length||!!Object.keys(value.headers??{}).length,state:'disconnected',tools:[]};
    const publicRecord=JSON.parse(this.clean(JSON.stringify(record)));this.records.set(id,publicRecord);this.persist();return publicRecord;
  }
  async connect(id:string){if(this.clients.has(id))return this.records.get(id)!;const record=this.records.get(id),config=this.configs.get(id);if(!record||!config)throw new Error('Re-enter this MCP configuration before connecting');if(record.state==='connecting')throw new Error('This MCP connection is already starting');if(config.transport==='stdio'&&!this.options.desktop)throw new Error('Local MCP process connections are available in the desktop app');
    record.state='connecting';record.error=undefined;
    const client=new Client({name:'reprocase-harness',version:VERSION},{capabilities:{}});
    const transport=config.transport==='stdio'?new StdioClientTransport({command:config.command!,args:config.args,cwd:config.cwd,env:config.env,stderr:'pipe',maxBufferSize:2*1024*1024}):new StreamableHTTPClientTransport(new URL(config.url!),{requestInit:{headers:config.headers,redirect:'error'},reconnectionOptions:{maxRetries:0,maxReconnectionDelay:1000,initialReconnectionDelay:1000,reconnectionDelayGrowFactor:1}});
    if(transport instanceof StdioClientTransport)transport.stderr?.on('data',()=>{});
    try{await client.connect(transport,{timeout:20000});const listed=[];let cursor:string|undefined;for(let i=0;i<20;i++){const page=await client.listTools(cursor?{cursor}:undefined);listed.push(...page.tools);cursor=page.nextCursor;if(!cursor)break;}if(cursor)throw new Error('MCP tool catalog exceeded 20 pages');
      this.clients.set(id,client);record.state='connected';record.tools=listed.map(t=>({name:t.name,description:(t.description??'').slice(0,1000)}));
      for(const tool of listed){const alias=`mcp__${id.slice(4,12)}__${tool.name.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,32)}_${createHash('sha256').update(tool.name).digest('hex').slice(0,8)}`;this.aliases.set(alias,{id,name:tool.name});this.schemas.set(alias,{name:alias,description:`${record.name}: ${tool.description??tool.name}`,inputSchema:tool.inputSchema});}
      client.onclose=()=>{record.state='disconnected';record.tools=[];this.clients.delete(id);this.dropAliases(id);};return structuredClone(record);
    }catch(e){await client.close().catch(()=>{});record.state='error';record.error=this.clean(e instanceof Error?e.message:String(e));throw new Error(record.error);}
  }
  private dropAliases(id:string){for(const [alias,item] of this.aliases)if(item.id===id){this.aliases.delete(alias);this.schemas.delete(alias);}}
  tools():AgentTool[]{return [...this.schemas.values()];}
  async call(alias:string,input:unknown,signal:AbortSignal):Promise<AgentToolOutput>{const target=this.aliases.get(alias),client=target&&this.clients.get(target.id);if(!target||!client)throw new Error('This MCP tool is no longer connected');const result=await client.callTool({name:target.name,arguments:input as Record<string,unknown>},undefined,{signal,timeout:120000});
    const blocks=result.content as any[]??[];const images=blocks.filter(v=>v.type==='image'&&['image/png','image/jpeg','image/webp'].includes(v.mimeType)&&v.data.length<8000000).slice(0,3).map(v=>({data:v.data,mimeType:v.mimeType}));return {text:this.clean(JSON.stringify({isError:result.isError??false,content:blocks.filter(v=>v.type!=='image')}).slice(0,50000)),...(images.length?{images}: {})};}
  async disconnect(id:string){if(this.records.get(id)?.state==='connecting')throw new Error('Wait for this MCP connection to finish starting');const client=this.clients.get(id);if(client)await client.close();this.clients.delete(id);this.dropAliases(id);const record=this.records.get(id);if(record){record.state='disconnected';record.tools=[];}return record;}
  async remove(id:string){await this.disconnect(id);await this.options.vault?.delete(id);this.configs.delete(id);this.records.delete(id);this.persist();}
  async close(){await Promise.allSettled([...this.clients.keys()].map(id=>this.disconnect(id)));}
}
