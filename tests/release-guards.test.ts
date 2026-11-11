import {describe,it,expect} from 'vitest';
import {createServer as httpServer} from 'node:http';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {checkScope,bountyProgramSchema,ScanNetwork,RequestLimiter,runSecurityAuditPack,calculateCvss31,renderPlaywright,createExampleCase,auditTrafficSecurity} from '@reprocase/core';
import {Permissions} from '../apps/server/src/permissions.ts';
import {createServer} from '../apps/server/src/server.ts';

describe('release safety regressions',()=>{
 const program=bountyProgramSchema.parse({id:'p',name:'Test',inScope:['https://api.scope.test/v2/*'],maxRps:100});
 it.each(['https://api.scope.test/admin','http://api.scope.test/v2/a','https://api.scope.test:9443/v2/a','https://api.scope.test/v2/%2fadmin','file:///v2/a','https://user:pass@api.scope.test/v2/a'])('blocks target outside exact URL rule: %s',url=>expect(checkScope(url,program).allowed).toBe(false));
 it('keeps path case, exclusion boundaries, wildcard and explicit port semantics',()=>{
  expect(checkScope('https://api.scope.test/v2/a',program).allowed).toBe(true);
  expect(checkScope('https://api.scope.test/V2/a',program).allowed).toBe(false);
  expect(checkScope('https://api.scope.test/public',{inScope:['api.scope.test'],outOfScope:['https://api.scope.test/private/*']}).allowed).toBe(true);
  expect(checkScope('https://x.scope.test/a',{inScope:['*.scope.test'],outOfScope:['x.scope.test']}).allowed).toBe(false);
  expect(checkScope('https://api.scope.test:999/a',{inScope:['api.scope.test:443'],outOfScope:[]}).allowed).toBe(false);
 });
 it('dispatches zero target requests for a path-scoped origin scanner',async()=>{
  let calls=0;const result=await runSecurityAuditPack('https://api.scope.test',program,async()=>{calls++;return new Response('{}');});
  expect(calls).toBe(0);expect(result.state).toBe('inconclusive');expect(result.errors.length).toBeGreaterThan(0);
 });
 it('checks each dispatch and never follows out-of-scope redirects',async()=>{
  let calls=0;const net=new ScanNetwork(async(_url,init)=>{calls++;expect(init?.redirect).toBe('manual');return new Response(null,{status:302,headers:{location:'https://outside.test'}});},{program});
  await net.request('https://api.scope.test/v2/a');await expect(net.request('https://api.scope.test/admin')).rejects.toThrow('Scope');expect(calls).toBe(1);
 });
 it('does not approve pending outside-workspace access when changing to Auto-Edit',async()=>{
  const p=new Permissions();const waiting=p.ask('s','filesystem_read_file',{},'',new AbortController().signal,()=>{},{outsideWorkspace:true});p.setMode('auto_edit');expect(p.list()).toHaveLength(1);p.decide(p.list()[0].id,'deny');await expect(waiting).rejects.toThrow('declined');p.close();
 });
 it('shares rate slots across concurrent scans and aborts a queued request without dispatch',async()=>{
  const times:number[]=[];const limiter=new RequestLimiter();const cfg={...program,inScope:['rate.test'],maxRps:20};const fetcher:typeof fetch=async()=>{times.push(Date.now());return new Response('{}');};
  await Promise.all([new ScanNetwork(fetcher,{program:cfg,limiter}).request('https://rate.test/a'),new ScanNetwork(fetcher,{program:cfg,limiter}).request('https://rate.test/b')]);expect(times[1]-times[0]).toBeGreaterThanOrEqual(45);
  const ctrl=new AbortController();const pending=new ScanNetwork(fetcher,{program:cfg,limiter,signal:ctrl.signal}).request('https://rate.test/c');ctrl.abort();await expect(pending).rejects.toThrow();expect(times).toHaveLength(2);
 });
 it('does not call an aborted scan transport',async()=>{const c=new AbortController();c.abort();let calls=0;await expect(runSecurityAuditPack('https://test.example',undefined,async()=>{calls++;return new Response('{}');},[],{signal:c.signal})).rejects.toThrow();expect(calls).toBe(0);});
 it('stops a real scan after cancellation during its first HTTP request',async()=>{
  const ctrl=new AbortController();let count=0;const fixture=httpServer((_req,res)=>{count++;ctrl.abort();res.writeHead(200);res.end('{}');});await new Promise<void>(r=>fixture.listen(0,'127.0.0.1',r));
  const server=await createServer({memory:true,port:0,desktop:true,dataRoot:mkdtempSync(join(tmpdir(),'reprocase-cancel-scan-'))});try{const h=server.service.harness;await expect(h.execute('recon_probe_origin',{origin:`http://127.0.0.1:${(fixture.address() as any).port}`},'s',ctrl.signal,a=>h.permissions.decide(a.id,'once'))).rejects.toThrow();expect(count).toBe(1);}finally{await server.close();fixture.closeAllConnections();await new Promise<void>(r=>fixture.close(()=>r()));}
 });
 it('rejects unknown programs, protects custom headers and clears credentials explicitly',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'reprocase-release-secrets-'));const server=await createServer({memory:true,port:0,desktop:true,dataRoot:dir});try{
   expect(()=>server.service.checkTargetScope('https://test.example','missing')).toThrow('Unknown');
   const secret='fake-release-canary-secret';const p=server.service.saveProgram({name:'Test',inScope:['test.example'],customHeaders:{'X-Api-Key':secret}});expect(p.customHeaders).toEqual({});expect(p.hasCustomHeaders).toBe(true);expect(JSON.stringify(server.service.store.programs())).not.toContain(secret);expect(server.service.knownSecrets()).toContain(secret);
   const output=await server.service.harness.execute('bounty_program_list',{},'s',new AbortController().signal,()=>{});expect(String(output)).not.toContain(secret);server.service.saveProgram({id:p.id,customHeaders:{}});expect(server.service.store.getProgram(p.id)?.hasCustomHeaders).toBe(false);
  }finally{await server.close();}
 });
 it('reports GraphQL errors and unreachable requests without claiming a clean or enabled result',async()=>{
  const result=await runSecurityAuditPack('https://test.example',undefined,async()=>new Response('{"errors":[{"message":"__schema introspection disabled"}]}'));expect(result.graphqlIntrospectionEnabled).toBe(false);
  const failed=await runSecurityAuditPack('https://test.example',undefined,async()=>{throw new Error('offline');});expect(failed.state).toBe('inconclusive');expect(failed.errors).not.toHaveLength(0);
 });
 it.each(['garbage','CVSS:3.1/AV:N','CVSS:3.1/AV:N/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',{AV:'INVALID'}])('rejects invalid CVSS input: %j',input=>expect(()=>calculateCvss31(input as any)).toThrow());
 it('parses actual HAR response cookies',()=>{const result=auditTrafficSecurity(JSON.stringify({log:{entries:[{response:{headers:[{name:'Set-Cookie',value:'session_id=fake; Path=/'}]}}]}}));expect(result.insecureCookiesCount).toBe(1);});
 it('fails the exported proof when every real HTTP request returns 403',async()=>{
  const fixture=httpServer((_req,res)=>{res.writeHead(403,{'content-type':'application/json'});res.end('{"error":"denied"}');});await new Promise<void>(r=>fixture.listen(0,'127.0.0.1',r));
  const project=resolve('.'),dir=mkdtempSync(join(tmpdir(),'reprocase-release-proof-'));
  try{let script=renderPlaywright(createExampleCase(),{api:`http://127.0.0.1:${(fixture.address() as any).port}`});for(const [name,path]of [['@playwright/test','node_modules/@playwright/test/index.mjs'],['@reprocase/core','packages/core/src/index.ts'],['@reprocase/browser','packages/browser/src/index.ts']])script=script.replace(`'${name}'`,JSON.stringify(pathToFileURL(join(project,path)).href));writeFileSync(join(dir,'package.json'),'{"type":"module"}');writeFileSync(join(dir,'proof.spec.ts'),script);writeFileSync(join(dir,'config.mjs'),`export default {testDir:${JSON.stringify(dir)},testMatch:'proof.spec.ts',outputDir:${JSON.stringify(join(dir,'results'))},workers:1,reporter:'list'};`);
   const result:any=await new Promise(r=>{let output='';const child=spawn(process.execPath,[join(project,'node_modules/@playwright/test/cli.js'),'test','-c',join(dir,'config.mjs')],{cwd:dir,windowsHide:true,env:{...process.env,REPROCASE_APPROVE_REVISION:'1',REPROCASE_TOKEN_OWNER:'fake-owner',REPROCASE_TOKEN_RESEARCHER:'fake-other'}});child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('close',code=>r({code,output}));});expect(result.code).not.toBe(0);expect(result.output).toContain('inconclusive');expect(result.output).not.toContain('Cannot find module');
  }finally{fixture.closeAllConnections();await new Promise<void>(r=>fixture.close(()=>r()));}
 });
});
