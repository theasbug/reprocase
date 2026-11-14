import { app, BrowserWindow, dialog, ipcMain, safeStorage, session,net,globalShortcut } from 'electron';
import { dirname, join, basename } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs';
import { createServer } from '../../apps/server/src/server.ts';
import type { SecretVault } from '../../packages/ai/src/providers.ts';
import { VERSION } from '@reprocase/core';
import { setDefaultResultOrder } from 'node:dns';
import { ComputerControl } from './computer.ts';

const appRoot = process.env.REPROCASE_APP_ROOT!;
// Windows stays portable (data next to ReproCase.exe). On macOS the executable lives inside the
// read-only .app bundle, and Linux archives are often unpacked to read-only places, so data goes to
// the per-user application data folder (~/Library/Application Support/ReproCase, ~/.config/ReproCase).
const dataRoot = process.env.REPROCASE_DESKTOP_WORKSPACE ?? (!app.isPackaged ? join(appRoot, 'ReproCase-data') : process.platform === 'win32' ? join(dirname(app.getPath('exe')), 'ReproCase-data') : join(app.getPath('appData'), 'ReproCase'));
mkdirSync(join(dataRoot, 'electron'), { recursive: true });
app.setPath('userData', join(dataRoot, 'electron'));
app.setPath('sessionData', join(dataRoot, 'electron'));
mkdirSync(join(dataRoot, 'logs'), { recursive: true }); app.setAppLogsPath(join(dataRoot, 'logs'));
mkdirSync(join(dataRoot, 'crashes'), { recursive: true }); app.setPath('crashDumps', join(dataRoot, 'crashes'));
if (!app.requestSingleInstanceLock()) app.quit();
else void boot();

/** Provider keys encrypted with the OS store: DPAPI (Windows), Keychain (macOS), libsecret/KWallet (Linux). */
export class OsVault implements SecretVault {
  constructor(private path: string) {}
  private read(): Record<string, string> { return existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : {}; }
  private write(value: Record<string, string>) { const temp = this.path + '.tmp'; writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); renameSync(temp, this.path); }
  async get(id: string) { const value = this.read()[id]; return value ? (await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result : undefined; }
  async set(id: string, value: string) {
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('The system key store is unavailable. The provider key was not saved.');
    // Linux can fall back to an obfuscated plain-text store when no keyring is running. Refuse it.
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') throw new Error('No system keyring (GNOME Keyring or KWallet) is available, so the provider key was not saved. Start a keyring, or use the key for this session only.');
    const stored = this.read(); stored[id] = (await safeStorage.encryptStringAsync(value)).toString('base64'); this.write(stored);
  }
  async delete(id: string) { const stored = this.read(); delete stored[id]; this.write(stored); }
}
async function boot() {
  setDefaultResultOrder('ipv4first');
  await app.whenReady();
  if(app.isPackaged){
    const manifest=JSON.parse(readFileSync(join(appRoot,'desktop/browser-manifest.json'),'utf8'));
    const allowed=/^(?:chrome-win64\/chrome\.exe|chrome-linux(?:64|-arm64)?\/chrome|chrome-mac(?:-arm64|-x64)?\/Chromium\.app\/Contents\/MacOS\/Chromium|chrome-mac(?:-arm64|-x64)?\/Google Chrome for Testing\.app\/Contents\/MacOS\/Google Chrome for Testing)$/;
    if(!/^chromium-\d+$/.test(manifest.resourceDir)||typeof manifest.executable!=='string'||!allowed.test(manifest.executable))throw new Error('Invalid bundled browser manifest');
    const bundledBrowser=join(process.resourcesPath,manifest.resourceDir,manifest.executable);
    if(!existsSync(bundledBrowser))throw new Error('The bundled Chromium is missing. Extract the complete portable ZIP again.');
    process.env.REPROCASE_CHROMIUM_EXECUTABLE=bundledBrowser;
  }
  const workspace = join(dataRoot, 'workspace');
  mkdirSync(workspace, { recursive: true });
  // Native computer control is implemented for Windows only; other platforms don't offer those tools.
  const computer=process.platform==='win32'?new ComputerControl(appRoot,dataRoot):undefined;
  const server = await createServer({ workspace, port: 0, vault: new OsVault(join(dataRoot, 'provider-keys.enc.json')),desktop:true,dataRoot,computer,providerFetch:(input,init)=>net.fetch(input instanceof URL?input.href:input,init as any) });
  const window = new BrowserWindow({ width: 1440, height: 1000, minWidth: 920, minHeight: 680, show: false, title: `ReproCase ${VERSION}`, backgroundColor: '#10121b', autoHideMenuBar: true,
    icon: join(appRoot, 'desktop/assets/reprocase.png'),
    webPreferences: { preload: join(appRoot, 'desktop/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: true },
  });
  const trusted = (event: Electron.IpcMainInvokeEvent) => { if (event.sender.id !== window.webContents.id || !event.senderFrame || new URL(event.senderFrame.url).origin !== server.origin) throw new Error('Untrusted desktop IPC sender'); };
  ipcMain.handle('reprocase:app-info', event => { trusted(event); return { version: VERSION, platform: process.platform, desktop: true }; });
  ipcMain.handle('reprocase:pick-workspace',async event=>{trusted(event);const result=await dialog.showOpenDialog(window,{title:'Select the agent working directory',properties:['openDirectory','createDirectory']});if(result.canceled)return null;return server.service.harness.setRoot(result.filePaths[0]);});
  globalShortcut.register('Control+Alt+Escape',()=>{server.service.chats.cancelAll();server.service.cancelScans();});
  ipcMain.handle('reprocase:pick-text-file', async event => {
    trusted(event);
    const selection = await dialog.showOpenDialog(window, { title: 'Attach a text file to this conversation', properties: ['openFile'], filters: [{ name: 'Text and source files', extensions: ['md', 'txt', 'json', 'yaml', 'yml', 'ts', 'tsx', 'js', 'py', 'log', 'http', 'csv'] }] });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const path = selection.filePaths[0], stats = statSync(path);
    if (!stats.isFile() || stats.size > 500000) throw new Error('Choose a text file smaller than 500 KB');
    const content = readFileSync(path, 'utf8'); if (content.includes('\0')) throw new Error('This file appears to be binary. Choose a text file.');
    return { name: basename(path), content };
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { const target = new URL(url); if (target.origin !== server.origin || target.pathname !== '/') event.preventDefault(); });
  app.on('second-instance', () => { if (window.isMinimized()) window.restore(); window.focus(); });
  window.once('ready-to-show', () => window.show());
  await window.loadURL(server.url);
  let quitting = false;
  app.on('before-quit', event => { if (quitting) return; event.preventDefault(); quitting = true;globalShortcut.unregisterAll(); void server.close().finally(() => app.exit(0)); });
  app.on('window-all-closed', () => app.quit());
}
process.on('uncaughtException', error => { dialog.showErrorBox('ReproCase could not continue', error.message); app.exit(1); });
