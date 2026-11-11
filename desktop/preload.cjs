const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('reprocaseDesktop', Object.freeze({
  platform: process.platform,
  pickTextFile: () => ipcRenderer.invoke('reprocase:pick-text-file'),
  appInfo: () => ipcRenderer.invoke('reprocase:app-info'),
  pickWorkspace: () => ipcRenderer.invoke('reprocase:pick-workspace'),
}));
