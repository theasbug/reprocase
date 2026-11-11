import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const exec=promisify(execFile);
const args=process.argv.slice(2);
const flag=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1]??fallback;};
const repo=flag('--repo','theasbug/reprocase');
if(!/^[\w.-]+\/[\w.-]+$/.test(repo))throw new Error('Use owner/repository');
const out=resolve(flag('--output','.cache/campaign'));
const gh=process.env.REPROCASE_GH??'gh';
const get=async path=>{const {stdout}=await exec(gh,['api',path],{windowsHide:true,maxBuffer:4*1024*1024});return JSON.parse(stdout);};
const names=['repository','release','views','clones'];
const requests=await Promise.allSettled([get(`repos/${repo}`),get(`repos/${repo}/releases/tags/v1.1.0-beta.1`),get(`repos/${repo}/traffic/views`),get(`repos/${repo}/traffic/clones`)]);
const data=Object.fromEntries(requests.map((result,i)=>[names[i],result.status==='fulfilled'?result.value:null]));
if(!data.repository)throw new Error('Cannot read repository; check GitHub CLI authentication and repository access.');
const windowsAssets=(data.release?.assets??[]).filter(a=>/Windows-x64\.zip$/.test(a.name));
const snapshot={schemaVersion:1,repository:repo,capturedAt:new Date().toISOString(),
 stars:data.repository.stargazers_count,forks:data.repository.forks_count,openIssues:data.repository.open_issues_count,
 windowsArchiveDownloads:windowsAssets.reduce((n,a)=>n+a.download_count,0),
 assetDownloads:(data.release?.assets??[]).map(a=>({id:a.id,name:a.name,downloads:a.download_count})),
 traffic:{views:data.views,clones:data.clones},
 unavailable:names.filter(n=>data[n]===null),
 notes:['Traffic is the API-returned reporting window, not an all-time total.','Download counters include maintainer checks, repeat downloads and automated fetches.','Downloads and stars do not measure successful installations or active users.','No visitor identities or private messages are collected.'],
};
await mkdir(out,{recursive:true});
let previous;try{previous=JSON.parse(await readFile(join(out,'latest.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(previous?.repository===repo)snapshot.changeSincePrevious={from:previous.capturedAt,stars:snapshot.stars-previous.stars,windowsArchiveDownloads:snapshot.windowsArchiveDownloads-previous.windowsArchiveDownloads};
const name='metrics-'+snapshot.capturedAt.replace(/[:.]/g,'-')+'.json';
await writeFile(join(out,name),JSON.stringify(snapshot,null,2)+'\n');
await writeFile(join(out,'latest.json'),JSON.stringify(snapshot,null,2)+'\n');
console.log(JSON.stringify({snapshot:join(out,name),stars:snapshot.stars,windowsArchiveDownloads:snapshot.windowsArchiveDownloads,unavailable:snapshot.unavailable,changeSincePrevious:snapshot.changeSincePrevious}));
