import { readFile, writeFile, mkdir, readdir, stat, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, join } from 'node:path';
import { platform, release } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { createRedactor, type AgentRuntime, type AgentTool, type AgentToolOutput, type Approval } from '@reprocase/core';
import { Permissions, type PermissionMode } from './permissions.ts';
import type { McpManager } from './mcp-client.ts';
const obj=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'};
const builtins:AgentTool[]=[
  {name:'filesystem_list_directory',description:'List files/directories in a local directory. Relative paths use the selected working directory.',inputSchema:obj({path:str})},
  {name:'filesystem_read_file',description:'Read a UTF-8 text file and obtain its SHA-256 for a later checked edit.',inputSchema:obj({path:str})},
  {name:'filesystem_write_file',description:'Create or edit a text file. Supply expectedSha256 from a previous read, or an empty string for a new file. Existing content is backed up.',inputSchema:obj({path:str,content:str,expectedSha256:str})},
  {name:'filesystem_rollback',description:'Restore a text file from a backup created by filesystem_write_file.',inputSchema:obj({backupId:str,path:str},['backupId'])},
  {name:'filesystem_search',description:'Search filenames and text in the selected directory. Literal matching, bounded results; skips dependency and git directories.',inputSchema:obj({path:str,query:str})},
  {name:'terminal_run',description:'Run a command using PowerShell on Windows or sh on other systems. The working directory, output and exit code are recorded. Cancellation stops the spawned process tree. Commands are not retried.',inputSchema:obj({command:str,timeoutSeconds:{type:'integer',minimum:1,maximum:600}})},
  {name:'desktop_open_application',description:'Open a native Windows application, for example Notepad or Calculator. This really starts the application.',inputSchema:obj({application:{type:'string',enum:['notepad','calculator']}})},
  {name:'reprocase_list',description:'List the local cases and recorded results available in this workbench.',inputSchema:obj({})},
  {name:'reprocase_validate',description:'Validate a declarative case without target traffic.',inputSchema:obj({caseId:str})},
  {name:'reprocase_plan',description:'Inspect a case and bound account gaps without contacting the target.',inputSchema:obj({caseId:str,targets:{type:'object',additionalProperties:{type:'string'}}})},
  {name:'reprocase_run',description:'Run a reviewed case through the shared runner. The exact current revision and targets are required; the desktop user reviews this action.',inputSchema:obj({caseId:str,approvedRevision:{type:'integer'},targets:{type:'object',additionalProperties:{type:'string'}}})},
  {name:'reprocase_matrix',description:'Run a multi-actor role access matrix evaluation for an approved case.',inputSchema:obj({caseId:str,approvedRevision:{type:'integer'},targets:{type:'object',additionalProperties:{type:'string'}}})},
  {name:'reprocase_browser_snapshot',description:'Read a redacted DOM and form field snapshot from an open actor browser session.',inputSchema:obj({caseId:str,actorId:str})},
  {name:'reprocase_browser_action',description:'Operate an open actor browser session within its bound origin.',inputSchema:obj({caseId:str,actorId:str,type:{type:'string',enum:['navigate','click','fill','press','handoff']},ref:str,url:str,value:str},['caseId','actorId','type'])},
  {name:'reprocase_traffic_draft',description:'Create an unapproved draft case from live recorded traffic across connected actors.',inputSchema:obj({caseId:str})},
  {name:'recon_probe_origin',description:'Probe a target origin for exposed API specifications, security headers, CORS misconfigurations, and ranked IDOR/BOLA/BFLA/Race vulnerability candidates.',inputSchema:obj({origin:str})},
  {name:'recon_extract_endpoints',description:'Extract and rank API routes and vulnerability candidates (IDOR, BOLA, BFLA, Race, SSRF, GraphQL) from JavaScript, HTML, OpenAPI JSON, HAR, or raw HTTP text.',inputSchema:obj({sourceText:str,sourceLabel:str},['sourceText'])},
  {name:'recon_draft_case',description:'Generate and save an unapproved ReproCase specification directly from a discovered recon endpoint candidate.',inputSchema:obj({method:{type:'string',enum:['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']},path:str,categories:{type:'array',items:str},rationale:str,targetOrigin:str},['method','path'])},
  {name:'bounty_program_list',description:'List configured bug bounty programs, their in-scope/out-of-scope rules, and tracked findings.',inputSchema:obj({})},
  {name:'bounty_program_save',description:'Create or update a bug bounty program with in-scope and out-of-scope asset patterns.',inputSchema:obj({id:str,name:str,platform:{type:'string',enum:['hackerone','bugcrowd','intigriti','yeswehack','custom']},inScope:{type:'array',items:str},outOfScope:{type:'array',items:str},notes:str},['name','inScope'])},
  {name:'bounty_scope_check',description:'Check whether a target URL or hostname is allowed by the active or specified bug bounty program scope.',inputSchema:obj({target:str,programId:str},['target'])},
  {name:'bounty_asset_discover',description:'Discover subdomains via Certificate Transparency (crt.sh) and check live HTTP/HTTPS origins within program scope.',inputSchema:obj({domain:str,programId:str},['domain'])},
  {name:'bounty_security_pack',description:'Run the automated bug bounty security check pack (CORS null/arbitrary reflection, HTTP verb enumeration, GraphQL introspection, security headers, and endpoint discovery) against an in-scope target origin.',inputSchema:obj({origin:str,programId:str},['origin'])},
  {name:'bounty_jwt_analyze',description:'Decode and audit a JWT or Bearer token for alg:none, kid/jku risks, expiration issues, and infer ReproCase actor JSON pointers.',inputSchema:obj({token:str})},
  {name:'bounty_traffic_audit',description:'Audit recorded actor traffic (by caseId) or pasted HAR/HTTP text for leaked API keys/secrets, insecure Set-Cookie flags, stack traces, and vulnerability candidates.',inputSchema:obj({caseId:str,trafficText:str},[])},
  {name:'bounty_js_audit',description:'Analyze a JavaScript bundle or HTML source for hidden API routes, GraphQL queries/mutations, client-side role guards, and source maps.',inputSchema:obj({jsSource:str,sourceLabel:str},['jsSource'])},
  {name:'bounty_finding_save',description:'Calculate CVSS v3.1 score and save a tracked bug bounty finding with CWE, status, and optional linked caseId/runId.',inputSchema:obj({id:str,programId:str,title:str,category:str,status:{type:'string',enum:['recon','triaging','verified','reported','resolved']},cvssVector:str,cwe:str,endpoint:str,caseId:str,runId:str,summary:str,impact:str,remediation:str},['title'])},
  {name:'bounty_toolchain_status',description:'Detect installed external CLI security and reconnaissance tools (nuclei, subfinder, httpx, ffuf, nmap, sqlmap, hurl, curl, python, git) on this machine.',inputSchema:obj({})},
  {name:'mcp_list',description:'List configured MCP connections and their exposed tools.',inputSchema:obj({})},
];

function computeLineDiff(beforeText: string, afterText: string) {
  const beforeLines = beforeText ? beforeText.split(/\r?\n/) : [];
  const afterLines = afterText ? afterText.split(/\r?\n/) : [];
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix++;
  let suffix = 0;
  while (suffix < beforeLines.length - prefix && suffix < afterLines.length - prefix && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]) suffix++;
  const removed = beforeLines.slice(prefix, beforeLines.length - suffix);
  const added = afterLines.slice(prefix, afterLines.length - suffix);
  const preview = [
    ...removed.slice(0, 20).map(l => `- ${l}`),
    ...added.slice(0, 20).map(l => `+ ${l}`),
    ...(removed.length > 20 || added.length > 20 ? ['... (diff truncated)'] : []),
  ].join('\n');
  return { addedLines: added.length, removedLines: removed.length, diff: preview };
}
export class Harness implements AgentRuntime {
  readonly permissions: Permissions;
  private root:string;
  constructor(private options:{desktop:boolean;root:string;dataRoot:string;saveRoot:(path:string)=>void;permissionMode?:PermissionMode;savePermissionMode?:(mode:PermissionMode)=>void;secrets:()=>string[];mcp:McpManager;computer?:{tools():AgentTool[];execute(name:string,input:unknown,signal:AbortSignal):Promise<AgentToolOutput>;image(id:string):Promise<Buffer>};caseAction:(name:string,input:any,signal:AbortSignal)=>Promise<unknown>}){
    this.root=resolve(options.root);
    this.permissions=new Permissions(options.permissionMode??'ask',options.savePermissionMode);
  }
  tools(){return [...builtins.filter(t=>this.options.desktop||!t.name.startsWith('filesystem_')&&!t.name.startsWith('desktop_')&&t.name!=='terminal_run'),...(this.options.desktop?this.options.computer?.tools()??[]:[]),...this.options.mcp.tools()];}
  environment(){return {application:'ReproCase',desktop:this.options.desktop,os:platform(),osVersion:release(),shell:platform()==='win32'?'PowerShell':'sh',workingDirectory:this.root,permissionMode:this.permissions.getMode(),tools:this.tools().map(t=>t.name)};}
  async setRoot(path:string){const actual=await realpath(resolve(path));if(!(await stat(actual)).isDirectory())throw new Error('Select a directory');this.root=actual;this.options.saveRoot(actual);return this.environment();}
  private safe(value:unknown){return createRedactor(this.options.secrets()).text(typeof value==='string'?value:JSON.stringify(value,null,2));}
  private async path(input:string,write=false){const target=resolve(this.root,input);let actual=target;let suffix:string[]=[];while(true){try{actual=await realpath(actual);break;}catch(error:any){if(error.code!=='ENOENT'||actual===dirname(actual))throw error;suffix.unshift(actual.slice(dirname(actual).length+1));actual=dirname(actual);}}actual=join(actual,...suffix);const root=await realpath(this.root).catch(()=>this.root);const part=relative(root,actual);return {target:actual,inside:part===''||!part.startsWith('..'+(platform()==='win32'?'\\':'/'))&&part!=='..'&&!isAbsolute(part)};}
  steer(sessionId:string){this.permissions.dismissPending(sessionId);}
  async image(id:string){if(!this.options.computer)throw new Error('Screenshot access is not available');return this.options.computer.image(id);}
  async restoreBackup(backupId: string, explicitPath?: string) {
    if (!/^[0-9a-f-]{36}$/i.test(backupId)) throw new Error('Invalid backup identifier');
    const backupFile = join(this.options.dataRoot, 'backups', `${backupId}.bak`);
    const metaFile = join(this.options.dataRoot, 'backups', `${backupId}.json`);
    const bytes = await readFile(backupFile);
    let targetPath = explicitPath;
    try {
      const meta = JSON.parse(await readFile(metaFile, 'utf8')) as { path: string };
      targetPath = meta.path;
    } catch { /* Fallback to explicitPath if metadata file was not present. */ }
    if (!targetPath) throw new Error('Target path for backup restoration is required');
    const scope = await this.path(targetPath, true);
    if (!scope.inside && this.permissions.getMode() !== 'autonomous') throw new Error('Backup restoration path must be inside the working directory');
    await writeFile(scope.target, bytes);
    return { restored: true, backupId, path: scope.target, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  async execute(name:string,input:unknown,sessionId:string,signal:AbortSignal,approval:(a:Approval)=>void):Promise<string|AgentToolOutput>{
    if(!this.tools().some(t=>t.name===name))throw new Error('Tool is not available in this environment');
    if(name.startsWith('mcp__')){await this.permissions.ask(sessionId,name,input,'Run this connected MCP tool',signal,approval);const result=await this.options.mcp.call(name,input,signal);return {...result,text:this.safe(result.text)};}
    const value=z.record(z.string(),z.unknown()).parse(input);
    const ask=(reason:string,opts?:{outsideWorkspace?:boolean})=>this.permissions.ask(sessionId,name,JSON.parse(this.safe(value)),reason,signal,approval,opts);
    if(this.options.computer?.tools().some(t=>t.name===name)){await ask('Use desktop control; captured screens or clipboard text are sent to the selected model');const result=await this.options.computer.execute(name,value,signal);return {...result,text:this.safe(result.text)};}
    if(name==='mcp_list')return this.safe(this.options.mcp.list());
    if(name.startsWith('reprocase_')||name.startsWith('recon_')||name.startsWith('bounty_')){if(name==='reprocase_run'||name==='reprocase_matrix'||name==='reprocase_browser_action'||name==='recon_probe_origin'||name==='bounty_security_pack'||name==='bounty_asset_discover')await ask('Run this case, recon probe, or browser operation');return this.safe(await this.options.caseAction(name,value,signal));}
    if(name==='filesystem_rollback'){
      const backupId=z.string().min(1).max(100).parse(value.backupId);
      const explicitPath=typeof value.path==='string'?value.path:undefined;
      return this.safe(await this.restoreBackup(backupId,explicitPath));
    }
    if(name==='desktop_open_application'){
      const app=z.enum(['notepad','calculator']).parse(value.application);if(platform()!=='win32')throw new Error('This native application launcher currently supports Windows');
      const executable=join(process.env.SystemRoot??'C:\\Windows','System32',app==='notepad'?'notepad.exe':'calc.exe');
      return await new Promise<string>((done,fail)=>{const child=spawn(executable,[],{detached:true,stdio:'ignore',windowsHide:false});child.once('error',fail);child.once('spawn',()=>{child.unref();done(JSON.stringify({started:true,application:app,pid:child.pid}));});});
    }
    if(name==='terminal_run'){
      const command=z.string().min(1).max(30000).parse(value.command),timeout=z.number().int().min(1).max(600).parse(value.timeoutSeconds??120);
      await ask('Run this command on your computer');return this.safe(await this.command(command,timeout,signal));
    }
    const path=z.string().min(1).max(4000).parse(value.path),scope=await this.path(path,name==='filesystem_write_file');
    if(!scope.inside)await ask('Access a path outside the selected working directory',{outsideWorkspace:true});
    if(signal.aborted)throw new Error('Action cancelled');
    if(name==='filesystem_list_directory'){const entries=await readdir(scope.target,{withFileTypes:true});return this.safe(entries.slice(0,1000).map(e=>({name:e.name,type:e.isDirectory()?'directory':e.isSymbolicLink()?'link':'file'})));}
    if(name==='filesystem_read_file'){const size=(await stat(scope.target)).size;if(size>500000)throw new Error('Read limit is 500 KB per file');const bytes=await readFile(scope.target);if(bytes.includes(0))throw new Error('The selected file is binary');return this.safe({path:scope.target,sha256:createHash('sha256').update(bytes).digest('hex'),content:bytes.toString('utf8')});}
    if(name==='filesystem_write_file'){
      const content=z.string().max(500000).parse(value.content),expected=z.string().parse(value.expectedSha256);let old:Buffer|undefined;
      try{old=await readFile(scope.target);}catch(e:any){if(e.code!=='ENOENT')throw e;}
      if(old&&createHash('sha256').update(old).digest('hex')!==expected)throw new Error('The file changed or was not read before editing. Read it again and use its SHA-256.');
      if(!old&&expected)throw new Error('The expected file no longer exists');
      let backup:string|undefined,backupId:string|undefined;if(old){backupId=randomUUID();backup=join(this.options.dataRoot,'backups',backupId+'.bak');await mkdir(dirname(backup),{recursive:true});await writeFile(backup,old,{mode:0o600});await writeFile(join(this.options.dataRoot,'backups',backupId+'.json'),JSON.stringify({path:scope.target,createdAt:new Date().toISOString()}),{mode:0o600});}
      const diffInfo=computeLineDiff(old?old.toString('utf8'):'',content);
      await mkdir(dirname(scope.target),{recursive:true});await writeFile(scope.target,content,'utf8');return this.safe({written:true,path:scope.target,sha256:createHash('sha256').update(content).digest('hex'),backup,backupId,...diffInfo});
    }
    if(name==='filesystem_search'){
      const query=z.string().min(1).max(500).parse(value.query),found:any[]=[];let visited=0;
      const walk=async(dir:string,depth:number)=>{if(depth>6||visited>2000||found.length>=100||signal.aborted)return;for(const e of await readdir(dir,{withFileTypes:true})){if(++visited>2000||found.length>=100)break;const p=join(dir,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory()){if(!['node_modules','.git','.browsers','ReproCase-data'].includes(e.name))await walk(p,depth+1);}else{if(e.name.toLowerCase().includes(query.toLowerCase()))found.push({path:p});if((await stat(p)).size<100000){const bytes=await readFile(p);if(!bytes.includes(0)){const lines=bytes.toString('utf8').split(/\r?\n/);for(let i=0;i<lines.length&&found.length<100;i++)if(lines[i].toLowerCase().includes(query.toLowerCase()))found.push({path:p,line:i+1,text:lines[i].slice(0,400)});}}}}};
      await walk(scope.target,0);return this.safe({matches:found,visited,limited:visited>2000||found.length>=100});
    }
    throw new Error('Unknown tool');
  }
  private async command(command:string,timeout:number,signal:AbortSignal){
    // PowerShell/.NET also need the standard Windows folder/module variables on clean hosts.
    // Keep an allowlist: provider keys and unrelated application secrets must not be inherited.
    const env=Object.fromEntries(['PATH','Path','SystemRoot','WINDIR','SystemDrive','COMSPEC','PATHEXT','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','ProgramData','ALLUSERSPROFILE','ProgramFiles','ProgramFiles(x86)','ProgramW6432','PSModulePath','HOMEDRIVE','HOMEPATH','OS','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS'].filter(k=>process.env[k]).map(k=>[k,process.env[k]!]));
    const binary=platform()==='win32'?join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'):'/bin/sh';
    const args=platform()==='win32'?['-NoLogo','-NoProfile','-NonInteractive','-Command','-']:['-s'];
    return await new Promise<unknown>((resolve,reject)=>{let output='',settled=false,timedOut=false;const child=spawn(binary,args,{cwd:this.root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});const collect=(data:Buffer)=>{output=(output+data.toString('utf8')).slice(-30000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
      const stop=()=>{if(child.pid&&platform()==='win32'){const kill=spawn('taskkill.exe',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});kill.on('error',()=>child.kill());}else child.kill('SIGTERM');};
      const timer=setTimeout(()=>{timedOut=true;stop();},timeout*1000);signal.addEventListener('abort',stop,{once:true});child.once('error',error=>{clearTimeout(timer);signal.removeEventListener('abort',stop);reject(error);});child.once('close',code=>{clearTimeout(timer);signal.removeEventListener('abort',stop);if(settled)return;settled=true;resolve({exitCode:code,output,timedOut,cancelled:signal.aborted,workingDirectory:this.root});});const script=(platform()==='win32'?"[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)\n":'')+command+'\n\n';child.stdin.end(platform()==='win32'?script.replace(/\r?\n/g,'\r\n'):script);
    });
  }
  close(){this.permissions.close();}
}
