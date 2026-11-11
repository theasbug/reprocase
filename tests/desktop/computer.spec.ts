import {test,expect,_electron,type ElectronApplication} from '@playwright/test';
import {build} from 'esbuild';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

test('real Windows computer tools: window, screenshot, pointer, Unicode keyboard, clipboard and accessibility',async()=>{
 const root=resolve('.'),work=resolve('../../work');mkdirSync(work,{recursive:true});const data=mkdtempSync(join(work,'computer-test-')),bundle=join(data,'computer.cjs');
 await build({entryPoints:[join(root,'desktop/src/computer.ts')],outfile:bundle,bundle:true,platform:'node',format:'cjs',external:['electron']});
 let app:ElectronApplication|undefined;
 try{
  app=await _electron.launch({executablePath:process.env.REPROCASE_DESKTOP_EXE??join(root,'node_modules/electron/dist/electron.exe'),args:[...(process.env.REPROCASE_DESKTOP_EXE?[]:[root]),'--force-renderer-accessibility'],cwd:root,env:{...Object.fromEntries(Object.entries(process.env).filter(([k,v])=>k!=='ELECTRON_RUN_AS_NODE'&&v!==undefined)) as Record<string,string>,REPROCASE_DESKTOP_WORKSPACE:data,REPROCASE_HEADLESS:'1'}});
  await app.firstWindow();
  const windowId=await app.evaluate(async({BrowserWindow,clipboard,app},{root,data,bundle})=>{
   const {ComputerControl}=(process as any).getBuiltinModule('module').createRequire(bundle)(bundle);(globalThis as any).__computer=new ComputerControl(app.getAppPath(),data);(globalThis as any).__oldClipboard=await clipboard.readText();
   const target=new BrowserWindow({width:760,height:520,x:80,y:80,show:true,title:'ReproCase owned control test',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});(globalThis as any).__target=target;
   await target.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><html><head><title>ReproCase owned control test</title></head><body style="font:20px sans-serif;margin:50px"><h1>ReproCase control test</h1><label>Test input <input aria-label="ReproCase test input" style="font:20px sans-serif;width:420px"/></label><button aria-label="ReproCase test button" onclick="document.body.dataset.clicked=\'yes\'" style="display:block;margin-top:30px;padding:20px">Test button</button><div style="height:2000px">Owned test content</div></body></html>'));
   target.focus();return target.getNativeWindowHandle().readBigUInt64LE().toString();
  },{root,data,bundle});
  const execute=async(name:string,input:unknown)=>app!.evaluate(async(_,{name,input})=>{const r=await (globalThis as any).__computer.execute(name,input,new AbortController().signal);return {text:r.text,images:r.images?.map((i:any)=>({mimeType:i.mimeType,evidenceId:i.evidenceId,bytes:i.data.length}))};},{name,input});
  const windows=JSON.parse((await execute('desktop_windows',{})).text);expect(windows.windows.some((w:any)=>w.id===windowId)).toBe(true);expect(windows.displays.length).toBeGreaterThan(0);
  await execute('desktop_window',{windowId,action:'focus'});
  const shot=await execute('desktop_screenshot',{windowId,displayId:null});expect(shot.images?.[0].bytes).toBeGreaterThan(500);const capture=JSON.parse(shot.text);expect(capture.width).toBeGreaterThan(200);
  const snap=JSON.parse((await execute('desktop_accessibility',{windowId,action:'snapshot'})).text);const input=snap.elements.find((e:any)=>e.name==='ReproCase test input');expect(input).toBeTruthy();
  await execute('desktop_accessibility',{windowId,action:'focus',elementRef:input.ref});
  await execute('desktop_keyboard',{windowId,action:'type',text:'Merhaba Türkçe ğüşİ 🧪'});
  await expect.poll(()=>app!.evaluate(()=>((globalThis as any).__target.webContents.executeJavaScript('document.querySelector("input").value')))).toContain('Merhaba Türkçe ğüşİ 🧪');
  await execute('desktop_keyboard',{windowId,action:'press',text:'Ctrl+A'});await execute('desktop_keyboard',{windowId,action:'type',text:'updated'});
  const snap2=JSON.parse((await execute('desktop_accessibility',{windowId,action:'snapshot'})).text);const button=snap2.elements.find((e:any)=>e.name==='ReproCase test button');expect(button).toBeTruthy();
  await execute('desktop_accessibility',{windowId,action:'invoke',elementRef:button.ref});expect(await app.evaluate(()=>((globalThis as any).__target.webContents.executeJavaScript('document.body.dataset.clicked')))).toBe('yes');
  // Pointer mapping uses a fresh image of this owned window only.
  const fresh=JSON.parse((await execute('desktop_screenshot',{windowId,displayId:null})).text);await execute('desktop_mouse',{screenshotId:fresh.screenshotId,action:'move',x:Math.floor(fresh.width/2),y:Math.floor(fresh.height/2)});
  await execute('desktop_clipboard',{action:'write',text:'reprocase clipboard test'});expect((await execute('desktop_clipboard',{action:'read'})).text).toBe('reprocase clipboard test');
  await execute('desktop_window',{windowId,action:'move',x:120,y:100});await expect(execute('desktop_mouse',{screenshotId:fresh.screenshotId,action:'click',x:20,y:20})).rejects.toThrow('moved or resized');
  await execute('desktop_window',{windowId,action:'resize',width:700,height:450});await execute('desktop_window',{windowId,action:'minimize'});await execute('desktop_window',{windowId,action:'restore'});
 }finally{if(app){await app.evaluate(async({clipboard})=>{if((globalThis as any).__oldClipboard!==undefined)await clipboard.writeText((globalThis as any).__oldClipboard);(globalThis as any).__target?.destroy();}).catch(()=>{});await app.close();}}
});
