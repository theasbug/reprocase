import {spawn} from 'node:child_process';import{resolve}from'node:path';
const child=spawn(process.execPath,['node_modules/@playwright/test/cli.js','test',...process.argv.slice(2)],{stdio:'inherit',windowsHide:true,env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:process.env.PLAYWRIGHT_BROWSERS_PATH??resolve('.browsers')}});child.on('exit',code=>{process.exitCode=code??1;});
