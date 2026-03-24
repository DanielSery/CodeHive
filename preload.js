const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codeServerAPI', {
  getPort: () => ipcRenderer.invoke('codeserver:getPort'),
  openFolder: (folderPath) => ipcRenderer.invoke('codeserver:openFolder', folderPath)
});

contextBridge.exposeInMainWorld('windowAPI', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close')
});
