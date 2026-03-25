const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codeServerAPI', {
  openFolder: (folderPath) => ipcRenderer.invoke('codeserver:openFolder', folderPath)
});

contextBridge.exposeInMainWorld('reposAPI', {
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  scanDirectory: (dirPath) => ipcRenderer.invoke('repos:scanDirectory', dirPath),
  checkClaudeActive: (wtPath) => ipcRenderer.invoke('repos:claudeActive', wtPath),
  remoteBranches: (barePath) => ipcRenderer.invoke('repos:remoteBranches', barePath),
  gitUser: (barePath) => ipcRenderer.invoke('repos:gitUser', barePath),
  createWorktree: (opts) => ipcRenderer.invoke('repos:createWorktree', opts)
});

contextBridge.exposeInMainWorld('cloneAPI', {
  start: (url, reposDir) => ipcRenderer.invoke('clone:start', { url, reposDir }),
  onData: (cb) => ipcRenderer.on('clone:data', (_, data) => cb(data)),
  onExit: (cb) => ipcRenderer.on('clone:exit', (_, info) => cb(info)),
  resize: (cols, rows) => ipcRenderer.send('clone:resize', { cols, rows }),
  removeListeners: () => {
    ipcRenderer.removeAllListeners('clone:data');
    ipcRenderer.removeAllListeners('clone:exit');
  }
});

contextBridge.exposeInMainWorld('windowAPI', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close')
});
