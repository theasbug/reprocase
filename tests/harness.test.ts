import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createServer} from '../apps/server/src/server.ts';
import {McpManager} from '../apps/server/src/mcp-client.ts';
import {Permissions} from '../apps/server/src/permissions.ts';
import {agentRound,appendAgentRound,appendAgentResult} from '../packages/ai/src/agent.ts';
import {ProviderRegistry} from '../packages/ai/src/providers.ts';
const json=(v:unknown)=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
const events=(v:any[])=>new Response(v.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
const stop=(content='Finished')=>events([{choices:[{delta:{content},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:8}}]);
const call=(name:string,args:unknown)=>events([{choices:[{delta:{reasoning_content:'I will use the available local tool.',tool_calls:[{index:0,id:'call-1',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:7}}]);
const models={data:[{id:'test',capabilities:{vision:true}}]};
let server:Awaited<ReturnType<typeof createServer>>|undefined;
afterEach(async()=>{await server?.close();server=undefined;});
async function workspace(){await mkdir(resolve('../../work'),{recursive:true});return mkdtemp(resolve('../../work/harness-test-'));}
async function provider(){const p=await server!.service.providers.save({providerId:'custom'});return server!.service.providers.discover(p.id);}
async function finished(id:string){await expect.poll(()=>server!.service.chats.list().find(c=>c.id===id)?.pending,{timeout:5000}).toBe(false);return server!.service.chats.get(id);}

describe('desktop agent runtime',()=>{
 it('really reads/edits files, checks hashes, creates backups and requires outside-folder permission',async()=>{
  const dir=await workspace();server=await createServer({memory:true,port:0,desktop:true,dataRoot:dir});const h=server.service.harness;
  const signal=new AbortController().signal;const run=(name:string,input:unknown)=>h.execute(name,input,'test',signal,()=>{});
  await run('filesystem_write_file',{path:'plan.md',content:'first',expectedSha256:''});const original=JSON.parse(await run('filesystem_read_file',{path:'plan.md'}) as string);
  await expect(run('filesystem_write_file',{path:'plan.md',content:'bad',expectedSha256:'stale'})).rejects.toThrow('changed');
  const result=JSON.parse(await run('filesystem_write_file',{path:'plan.md',content:'second',expectedSha256:original.sha256}) as string);
  expect(await readFile(result.backup,'utf8')).toBe('first');expect(JSON.parse(await run('filesystem_search',{path:'.',query:'second'}) as string).matches.length).toBeGreaterThan(0);
  await writeFile(join(dir,'outside.txt'),'outside');const pending=h.execute('filesystem_read_file',{path:'../outside.txt'},'outside',signal,a=>h.permissions.decide(a.id,'deny'));await expect(pending).rejects.toThrow('declined');
 });
 it('uses the actual mission/environment and completes a real file-tool round with provider reasoning and usage',async()=>{
  const dir=await workspace();const bodies:any[]=[];server=await createServer({memory:true,port:0,desktop:true,dataRoot:dir,providerFetch:async(url,init)=>{if(String(url).endsWith('/models'))return json(models);bodies.push(JSON.parse(String(init?.body)));return bodies.length===1?call('filesystem_write_file',{path:'result.md',content:'real output',expectedSha256:''}):stop();}});
  const p=await provider(),chat=server.service.chats.create();server.service.chats.send(chat.id,{profileId:p.id,modelId:'test',content:'Write the file.'});const result=await finished(chat.id),reply=result.messages.at(-1)!;
  expect(reply.status).toBe('complete');expect(reply.activities?.[0].status).toBe('completed');expect(reply.reasoningText).toContain('available local tool');expect(reply.usage?.output).toBe(15);expect(reply.tokensPerSecond).toBeGreaterThan(0);
  expect(await readFile(join(dir,'projects/result.md'),'utf8')).toBe('real output');expect(bodies[0].messages[0].content).toContain('Actual environment');expect(bodies[0].messages[0].content).toContain('bug bounty');expect(bodies[1].messages.some((v:any)=>v.role==='tool')).toBe(true);
 });
 it('steers with a queued message and skips an action that has not started',async()=>{
  const dir=await workspace();let release!:(r:Response)=>void;const bodies:any[]=[];server=await createServer({memory:true,port:0,desktop:true,dataRoot:dir,providerFetch:async(url,init)=>{if(String(url).endsWith('/models'))return json(models);bodies.push(JSON.parse(String(init?.body)));return bodies.length===1?new Promise<Response>(r=>release=r):stop('Following the new instruction');}});
  const p=await provider(),chat=server.service.chats.create();server.service.chats.send(chat.id,{profileId:p.id,modelId:'test',content:'Write a file'});server.service.chats.send(chat.id,{profileId:p.id,modelId:'test',content:'Do not write. Only explain.'});
  release(call('filesystem_write_file',{path:'skipped.md',content:'bad',expectedSha256:''}));const result=await finished(chat.id);
  expect(result.messages.filter(m=>m.status==='queued')).toHaveLength(0);expect(result.messages.at(-1)?.content).toContain('new instruction');await expect(stat(join(dir,'projects/skipped.md'))).rejects.toThrow();expect(JSON.stringify(bodies[1])).toContain('Do not write');expect(bodies).toHaveLength(2);
 });
 it('runs an approved terminal command once and records its exit code',async()=>{
  const dir=await workspace();server=await createServer({memory:true,port:0,desktop:true,dataRoot:dir});const h=server.service.harness;
  const result=JSON.parse(await h.execute('terminal_run',{command:"echo 'reprocase-native-test'",timeoutSeconds:10},'term',new AbortController().signal,a=>h.permissions.decide(a.id,'once')) as string);
  expect(result.exitCode).toBe(0);expect(result.output).toContain('reprocase-native-test');
 });
 it('enforces permissions independently for chats and cancels pending approvals',async()=>{
  const p=new Permissions(),signal=new AbortController();await p.ask('a','desktop_windows',{},'',signal.signal,a=>p.decide(a.id,'computer'));
  await p.ask('a','desktop_keyboard',{},'',signal.signal,()=>{throw new Error('already trusted');});
  const pending=p.ask('b','desktop_keyboard',{},'',signal.signal,()=>{});expect(p.list()).toHaveLength(1);signal.abort();await expect(pending).rejects.toThrow('cancelled');expect(p.list()).toHaveLength(0);p.close();
 });
 it('protects new management APIs and rejects executable package-style configuration',async()=>{
  server=await createServer({memory:true,port:0});expect((await server.app.inject('/api/agent/state')).statusCode).toBe(401);
  expect((await server.app.inject({method:'POST',url:'/api/mcp/servers',headers:{authorization:`Bearer ${server.token}`},payload:{name:'x',transport:'stdio',command:'x',script:'unrecognized'}})).statusCode).toBe(400);
 });
});
describe('native protocol tool adapters',()=>{
 it.each(['chat','responses','anthropic'] as const)('preserves %s call IDs, provider reasoning and image results',async(protocol)=>{
  const providers=new ProviderRegistry({save:()=>{},fetch:async()=>json(models)});let p=await providers.save({providerId:'custom'});p=await providers.discover(p.id);p={...p,protocol};
  const chunks=protocol==='chat'?[{choices:[{delta:{reasoning_content:'public reasoning',tool_calls:[{index:0,id:'id1',function:{name:'tool',arguments:'{}'}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:3,completion_tokens:4}}]:protocol==='responses'?[{type:'response.reasoning_summary_text.delta',delta:'public reasoning'},{type:'response.output_item.done',output_index:0,item:{type:'function_call',call_id:'id1',name:'tool',arguments:'{}'}},{type:'response.completed',response:{usage:{input_tokens:3,output_tokens:4}}}]:[{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:''}},{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'public reasoning'}},{type:'content_block_start',index:1,content_block:{type:'tool_use',id:'id1',name:'tool',input:{}}},{type:'message_delta',usage:{input_tokens:3,output_tokens:4}},{type:'message_stop'}];
  const round=await agentRound(providers,p,'test','auto','chat','mission',[],[{name:'tool',description:'test',inputSchema:{type:'object'}}],new AbortController().signal,()=>{},async()=>events(chunks));
  expect(round.calls).toEqual([{id:'id1',name:'tool',arguments:'{}'}]);expect(round.reasoning).toBe('public reasoning');expect(round.usage?.output).toBe(4);const history:any[]=[];appendAgentRound(p,history,round);appendAgentResult(p,history,round.calls[0],{text:'done',images:[{data:'aW1hZ2U=',mimeType:'image/png'}]},true);expect(JSON.stringify(history)).toContain('id1');expect(JSON.stringify(history)).toContain('aW1hZ2U=');
 });
 it('marks interrupted tool streams incomplete without retry',async()=>{const p=new ProviderRegistry({save:()=>{}}),profile=await p.save({providerId:'custom'});let attempts=0;await expect(agentRound(p,profile,'test','auto','chat','',[],[],new AbortController().signal,()=>{},async()=>{attempts++;return events([{choices:[{delta:{content:'partial'}}]}]);})).rejects.toThrow('completion');expect(attempts).toBe(1);});
});
describe('real MCP client',()=>{
 it('starts a stdio server explicitly, calls tools, encrypts configuration via the vault, and removes aliases on disconnect',async()=>{
  const secrets=new Map<string,string>();let metadata:any[]=[];const m=new McpManager({desktop:true,vault:{get:async id=>secrets.get(id),set:async(id,key)=>{secrets.set(id,key);},delete:async id=>{secrets.delete(id);}},save:r=>{metadata=r;}});
  try{const saved=await m.save({name:'Echo',transport:'stdio',command:process.execPath,args:[resolve('tests/fixtures/mcp-echo.mjs')],env:{API_KEY:'private-mcp-value'}});expect(saved.state).toBe('disconnected');expect(JSON.stringify(metadata)).not.toContain('private-mcp-value');expect(m.tools()).toHaveLength(0);await m.connect(saved.id);expect(m.tools()).toHaveLength(1);expect(JSON.stringify(m.list())).not.toContain('_schemas');const result=await m.call(m.tools()[0].name,{text:'hello'},new AbortController().signal);expect(result.text).toContain('hello');expect(result.text).not.toContain('private-mcp-value');await m.disconnect(saved.id);expect(m.tools()).toHaveLength(0);await m.remove(saved.id);expect(secrets.size).toBe(0);}finally{await m.close();}
 });
});
