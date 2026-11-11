import { desktopCapturer, screen, clipboard } from 'electron';
import { spawn } from 'node:child_process';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AgentTool,AgentToolOutput } from '@reprocase/core';
const s={type:'string'},n={type:'integer'},nullable={type:['string','null']};
const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
export class ComputerControl {
  private tail:Promise<unknown>=Promise.resolve();
  private captures=new Map<string,{windowId?:string;bounds:{Left:number;Top:number;Right:number;Bottom:number};width:number;height:number;at:number;path:string}>();
  constructor(private root:string,private dataRoot:string){}
  tools():AgentTool[]{return [
    {name:'desktop_windows',description:'List visible native windows with stable window IDs and physical screen bounds; list monitors.',inputSchema:object({})},
    {name:'desktop_screenshot',description:'Capture a selected window or monitor. The returned image coordinates are used with desktop_mouse and screenshotId. Prefer a target window over the full monitor.',inputSchema:object({windowId:nullable,displayId:nullable})},
    {name:'desktop_window',description:'Focus, move, resize, minimize, maximize or restore an existing window.',inputSchema:object({windowId:s,action:{type:'string',enum:['focus','move','resize','minimize','maximize','restore']},x:n,y:n,width:n,height:n},['windowId','action'])},
    {name:'desktop_mouse',description:'Move/click/scroll/drag using coordinates from a recent screenshot. The runtime translates image pixels to physical screen pixels and rejects stale captures.',inputSchema:object({screenshotId:s,action:{type:'string',enum:['move','click','scroll','drag']},x:n,y:n,endX:n,endY:n,button:{type:'string',enum:['left','right','middle']},clicks:{type:'integer',minimum:1,maximum:2},amount:{type:'integer',minimum:-100,maximum:100},horizontal:{type:'boolean'}},['screenshotId','action','x','y'])},
    {name:'desktop_keyboard',description:'Type Unicode text or press a key chord in the specified window. Examples: Ctrl+A, Enter, Alt+Tab, Win+R. Input is rejected if the intended window cannot receive focus.',inputSchema:object({windowId:s,action:{type:'string',enum:['type','press']},text:s})},
    {name:'desktop_clipboard',description:'Read or write the system text clipboard.',inputSchema:object({action:{type:'string',enum:['read','write']},text:s},['action'])},
    {name:'desktop_accessibility',description:'Inspect a window’s accessibility elements, or focus/invoke/setValue/toggle/select a returned element reference. Re-inspect stale elements.',inputSchema:object({windowId:s,action:{type:'string',enum:['snapshot','focus','invoke','setValue','toggle','select']},elementRef:s,value:s},['windowId','action'])},
  ];}
  execute(name:string,input:unknown,signal:AbortSignal):Promise<AgentToolOutput>{const work=this.tail.catch(()=>{}).then(()=>{if(signal.aborted)throw new Error('Computer action cancelled');return this.perform(name,input,signal);});this.tail=work;return work;}
  private async perform(name:string,input:unknown,signal:AbortSignal):Promise<AgentToolOutput>{
    const value=z.record(z.string(),z.unknown()).parse(input);
    if(name==='desktop_windows'){const windows=await this.native({operation:'windows'},signal);return {text:JSON.stringify({...windows,displays:screen.getAllDisplays().map(d=>({id:String(d.id),bounds:d.bounds,scaleFactor:d.scaleFactor}))})};}
    if(name==='desktop_clipboard'){const action=z.enum(['read','write']).parse(value.action);if(action==='write')await clipboard.writeText(z.string().max(200000).parse(value.text));return {text:action==='read'?await clipboard.readText():'Clipboard updated'};}
    if(name==='desktop_screenshot'){
      const windowId=z.string().regex(/^\d+$/).nullable().parse(value.windowId??null),displayId=z.string().nullable().parse(value.displayId??null);
      let bounds:{Left:number;Top:number;Right:number;Bottom:number},sourceId:string;
      const sources=await desktopCapturer.getSources({types:windowId?['window']:['screen'],thumbnailSize:{width:1600,height:1600},fetchWindowIcons:false});
      const source=windowId?sources.find(s=>s.id.split(':')[1]===windowId):sources.find(s=>s.display_id===(displayId??String(screen.getPrimaryDisplay().id)));
      if(!source||source.thumbnail.isEmpty())throw new Error('The selected window/display could not be captured');sourceId=source.id;
      if(windowId)bounds=await this.native({operation:'bounds',windowId},signal);else{const d=screen.getAllDisplays().find(d=>String(d.id)===(displayId??String(screen.getPrimaryDisplay().id)))!;const start=screen.dipToScreenPoint({x:d.bounds.x,y:d.bounds.y});bounds={Left:start.x,Top:start.y,Right:start.x+Math.round(d.size.width*d.scaleFactor),Bottom:start.y+Math.round(d.size.height*d.scaleFactor)};}
      const id=`screen-${randomUUID()}`,path=join(this.dataRoot,'screenshots',id+'.png');await mkdir(join(this.dataRoot,'screenshots'),{recursive:true});const bytes=source.thumbnail.toPNG();await writeFile(path,bytes);const size=source.thumbnail.getSize();
      this.captures.set(id,{windowId:windowId??undefined,bounds,width:size.width,height:size.height,at:Date.now(),path});if(this.captures.size>200)this.captures.delete(this.captures.keys().next().value!);
      return {text:JSON.stringify({screenshotId:id,sourceId,windowId,width:size.width,height:size.height,screenBounds:bounds,coordinateSystem:'Use image pixel coordinates with this screenshotId'}),images:[{data:bytes.toString('base64'),mimeType:'image/png',evidenceId:id}]};
    }
    if(name==='desktop_mouse'){
      const id=z.string().parse(value.screenshotId),capture=this.captures.get(id);if(!capture||Date.now()-capture.at>90000)throw new Error('This screenshot is stale. Capture the window again before sending input');
      if(capture.windowId){const bounds=await this.native({operation:'bounds',windowId:capture.windowId},signal);if(['Left','Top','Right','Bottom'].some(k=>bounds[k]!==capture.bounds[k as keyof typeof capture.bounds]))throw new Error('The window moved or resized. Capture it again before clicking');await this.native({operation:'window',action:'focus',windowId:capture.windowId},signal);}
      const x=z.number().int().min(0).max(capture.width-1).parse(value.x),y=z.number().int().min(0).max(capture.height-1).parse(value.y),action=z.enum(['move','click','scroll','drag']).parse(value.action);
      const mapX=(x:number)=>Math.round(capture.bounds.Left+x*(capture.bounds.Right-capture.bounds.Left)/capture.width),mapY=(y:number)=>Math.round(capture.bounds.Top+y*(capture.bounds.Bottom-capture.bounds.Top)/capture.height);
      const result=await this.native({operation:'mouse',action,x:mapX(x),y:mapY(y),endX:action==='drag'?mapX(z.number().int().min(0).max(capture.width-1).parse(value.endX)):0,endY:action==='drag'?mapY(z.number().int().min(0).max(capture.height-1).parse(value.endY)):0,button:z.enum(['left','right','middle']).parse(value.button??'left'),clicks:z.number().int().min(1).max(2).parse(value.clicks??1),amount:z.number().int().min(-100).max(100).parse(value.amount??0),horizontal:!!value.horizontal},signal);return {text:JSON.stringify(result)};
    }
    const windowId=z.string().regex(/^\d+$/).parse(value.windowId);
    if(name==='desktop_keyboard')return {text:JSON.stringify(await this.native({operation:'keyboard',windowId,action:z.enum(['type','press']).parse(value.action),text:z.string().max(100000).parse(value.text)},signal))};
    if(name==='desktop_window'){const action=z.enum(['focus','move','resize','minimize','maximize','restore']).parse(value.action);return {text:JSON.stringify(await this.native({operation:'window',windowId,action,x:z.number().int().parse(value.x??0),y:z.number().int().parse(value.y??0),width:z.number().int().min(100).max(16000).parse(value.width??800),height:z.number().int().min(100).max(16000).parse(value.height??600)},signal))};}
    if(name==='desktop_accessibility')return {text:JSON.stringify(await this.native({operation:'accessibility',windowId,action:z.enum(['snapshot','focus','invoke','setValue','toggle','select']).parse(value.action),elementRef:z.string().max(300).optional().parse(value.elementRef),value:z.string().max(100000).optional().parse(value.value)},signal))};
    throw new Error('Unknown computer tool');
  }
  async image(id:string){if(!/^screen-[0-9a-f-]{36}$/.test(id))throw new Error('Invalid screenshot identifier');return readFile(join(this.dataRoot,'screenshots',id+'.png'));}
  private async native(payload:unknown,signal:AbortSignal):Promise<any>{
    if(process.platform!=='win32')throw new Error('Native computer control is implemented for Windows in this release');
    if(signal.aborted)throw new Error('Computer action cancelled');
    const source=await readFile(join(this.root,'desktop','native','windows-control.ps1'),'utf8'),encoded=Buffer.from(JSON.stringify(payload)).toString('base64');
    const script=source.replace(/^param[^\n]*\n/,`$Payload='${encoded}'\n`);
    return new Promise((done,fail)=>{let out='',err='',stopped=false;const child=spawn(join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-STA','-Command','-'],{windowsHide:true,stdio:['pipe','pipe','pipe']});const stop=()=>{stopped=true;child.kill();};signal.addEventListener('abort',stop,{once:true});const timer=setTimeout(stop,25000);child.stdout.on('data',d=>{out+=d.toString('utf8');if(out.length>2000000)stop();});child.stderr.on('data',d=>{err+=d.toString('utf8');});child.once('error',fail);child.once('close',async code=>{clearTimeout(timer);signal.removeEventListener('abort',stop);
      const action=payload as any;
      if(stopped&&(action.operation==='mouse'&&action.action==='drag'||action.operation==='keyboard'&&action.action==='press'))await this.native({operation:'release',drag:action.operation==='mouse',chord:action.operation==='keyboard'?action.text:''},new AbortController().signal).catch(()=>{});
      if(stopped||code!==0||err.trim())fail(new Error(signal.aborted?'Computer action cancelled':err.trim().slice(0,2000)||'Native desktop command did not complete'));else{try{done(JSON.parse(out.trim()));}catch{fail(new Error('Native desktop returned no valid result: '+out.slice(0,500)));}}});child.stdin.end(script+'\n\n');});
  }
}
