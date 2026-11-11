import{it,expect}from'vitest';import{mkdtempSync,writeFileSync}from'node:fs';import{resolve,join}from'node:path';import{pathToFileURL}from'node:url';import{spawn}from'node:child_process';
import{createExampleCase,renderPlaywright}from'@reprocase/core';import{startDemo}from'../apps/server/src/demo.ts';
import{tmpdir}from'node:os';
it.each([['vulnerable','reproduced',0],['secure','not_reproduced',0],['secure','reproduced',1]] as const)('export retains core semantics: %s expected %s',async(mode,expected,exit)=>{
 const demo=await startDemo(mode),project=resolve('.'),dir=mkdtempSync(join(tmpdir(),'reprocase-proof-export-'));try{
  const tokens:string[]=[];for(const account of demo.accounts){const response=await fetch(demo.origin+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:account.email,password:account.password})});tokens.push((await response.json() as any).token);}
  let script=renderPlaywright(createExampleCase(),{api:demo.origin});for(const[name,path]of [['@playwright/test','node_modules/@playwright/test/index.mjs'],['@reprocase/core','packages/core/src/index.ts'],['@reprocase/browser','packages/browser/src/index.ts']])script=script.replace(`'${name}'`,JSON.stringify(pathToFileURL(join(project,path)).href));
  writeFileSync(join(dir,'package.json'),'{"type":"module"}');writeFileSync(join(dir,'proof.spec.ts'),script);writeFileSync(join(dir,'config.mjs'),`export default {testDir:${JSON.stringify(dir)},testMatch:'proof.spec.ts',outputDir:${JSON.stringify(join(dir,'results'))},reporter:'list',workers:1};`);
  const result:any=await new Promise((done,fail)=>{let output='';const child=spawn(process.execPath,[join(project,'node_modules/@playwright/test/cli.js'),'test','-c',join(dir,'config.mjs')],{cwd:dir,windowsHide:true,env:{...process.env,REPROCASE_APPROVE_REVISION:'1',REPROCASE_EXPECT_VERDICT:expected,REPROCASE_TOKEN_OWNER:tokens[0],REPROCASE_TOKEN_RESEARCHER:tokens[1]}});child.on('error',fail);child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('close',code=>done({code,output}));});expect(result.code,result.output).toBe(exit);
 }finally{await demo.close();}
});
