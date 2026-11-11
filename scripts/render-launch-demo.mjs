import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';

// FFmpeg with libass and libx264 is a maintainer-only prerequisite, not an app dependency.
const input=resolve(process.argv[2]??'.cache/launch-demo');
const output=resolve(process.argv[3]??'.cache/launch-demo/rendered');
mkdirSync(output,{recursive:true});
const meta=JSON.parse(readFileSync(join(input,'recording.json'),'utf8'));
const captions=JSON.parse(readFileSync(join(input,'captions.json'),'utf8'));
const time=(seconds,comma=false)=>{const h=Math.floor(seconds/3600),m=Math.floor(seconds/60)%60,s=Math.floor(seconds)%60,ms=Math.round((seconds%1)*1000);return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}${comma?',':'.'}${String(ms).padStart(3,'0')}`;};
writeFileSync(join(output,'ReproCase-demo.en.srt'),captions.map((c,i)=>`${i+1}\n${time(c.start,true)} --> ${time(c.end,true)}\n${c.text}\n`).join('\n'));
const assTime=s=>time(s).slice(1,-1);
const ass=`[Script Info]\nScriptType: v4.00+\nPlayResX: 1600\nPlayResY: 1040\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Segoe UI,34,&H00F1F1F7,&H00F1F1F7,&H00150D0B,&H00150D0B,0,0,0,0,100,100,0,0,1,0,0,2,40,40,26,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`+captions.map(c=>`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${c.text.replaceAll('\n','\\N')}`).join('\n');
writeFileSync(join(output,'captions.ass'),ass);
const ffmpeg=process.env.REPROCASE_FFMPEG??'ffmpeg';
const run=args=>{const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','warning','-y',...args],{cwd:output,stdio:'inherit',windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw new Error('Video encoding failed');};
const name='ReproCase-demo-56s-en.mp4';
run(['-ss',String(meta.trimSeconds),'-i',join(input,'recording.webm'),'-t','56','-vf','pad=1600:1040:0:0:color=0x0b0d15,ass=captions.ass','-c:v','libx264','-crf','20','-preset','medium','-pix_fmt','yuv420p','-r','30','-an','-movflags','+faststart',name]);
run(['-ss','10','-i',join(output,name),'-frames:v','1','-update','1','demo-preview.png']);
run(['-i',join(output,name),'-vf','fps=1/8,scale=800:-1,tile=2x4','-frames:v','1','-update','1','review-sheet.png']);
copyFileSync(join(input,'verification.json'),join(output,'demo-verification.json'));
const probe=spawnSync(process.env.REPROCASE_FFPROBE??'ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_name,width,height,pix_fmt','-of','json',join(output,name)],{encoding:'utf8',windowsHide:true});
if(probe.status!==0)throw new Error('Video verification failed');
const info=JSON.parse(probe.stdout);if(Number(info.format.duration)<55||Number(info.format.duration)>57)throw new Error('Video must last 56 seconds');
writeFileSync(join(output,'media-info.json'),JSON.stringify(info,null,2)+'\n');
console.log(JSON.stringify({output,file:name,...info}));
