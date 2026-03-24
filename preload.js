const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codeServerAPI', {
  openFolder: (folderPath) => ipcRenderer.invoke('codeserver:openFolder', folderPath)
});

contextBridge.exposeInMainWorld('reposAPI', {
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  scanDirectory: (dirPath) => ipcRenderer.invoke('repos:scanDirectory', dirPath),
  checkClaudeActive: (wtPath) => ipcRenderer.invoke('repos:claudeActive', wtPath)
});

contextBridge.exposeInMainWorld('windowAPI', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close')
});
