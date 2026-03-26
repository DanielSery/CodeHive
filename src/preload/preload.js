const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codeServerAPI', {
  openFolder: (folderPath) => ipcRenderer.invoke('codeserver:openFolder', folderPath)
});

contextBridge.exposeInMainWorld('reposAPI', {
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  scanDirectory: (dirPath) => ipcRenderer.invoke('repos:scanDirectory', dirPath),
  checkClaudeActive: (wtPath) => ipcRenderer.invoke('repos:claudeActive', wtPath),
  cachedBranches: (barePath) => ipcRenderer.invoke('repos:cachedBranches', barePath),
  fetchBranches: (barePath) => ipcRenderer.invoke('repos:fetchBranches', barePath),
  gitUser: (barePath) => ipcRenderer.invoke('repos:gitUser', barePath),
  remoteUrl: (barePath) => ipcRenderer.invoke('repos:remoteUrl', barePath),
  launchConfigs: (wtPath) => ipcRenderer.invoke('repos:launchConfigs', wtPath),
});

contextBridge.exposeInMainWorld('worktreeAPI', {
  start: (opts) => ipcRenderer.invoke('worktree:start', opts),
  ready: () => ipcRenderer.send('worktree:ready'),
  onData: (cb) => ipcRenderer.on('worktree:data', (_, data) => cb(data)),
  onExit: (cb) => ipcRenderer.on('worktree:exit', (_, info) => cb(info)),
  removeListeners: () => {
    ipcRenderer.removeAllListeners('worktree:data');
    ipcRenderer.removeAllListeners('worktree:exit');
  }
});

contextBridge.exposeInMainWorld('cloneAPI', {
  start: (url, reposDir) => ipcRenderer.invoke('clone:start', { url, reposDir }),
  ready: () => ipcRenderer.send('clone:ready'),
  onData: (cb) => ipcRenderer.on('clone:data', (_, data) => cb(data)),
  onExit: (cb) => ipcRenderer.on('clone:exit', (_, info) => cb(info)),
  removeListeners: () => {
    ipcRenderer.removeAllListeners('clone:data');
    ipcRenderer.removeAllListeners('clone:exit');
  }
});

contextBridge.exposeInMainWorld('deleteAPI', {
  start: (repoDir) => ipcRenderer.invoke('delete:start', { repoDir }),
  ready: () => ipcRenderer.send('delete:ready'),
  onData: (cb) => ipcRenderer.on('delete:data', (_, data) => cb(data)),
  onExit: (cb) => ipcRenderer.on('delete:exit', (_, info) => cb(info)),
  removeListeners: () => {
    ipcRenderer.removeAllListeners('delete:data');
    ipcRenderer.removeAllListeners('delete:exit');
  }
});

contextBridge.exposeInMainWorld('worktreeRemoveAPI', {
  start: (opts) => ipcRenderer.invoke('worktreeRemove:start', opts),
  ready: () => ipcRenderer.send('worktreeRemove:ready'),
  onData: (cb) => ipcRenderer.on('worktreeRemove:data', (_, data) => cb(data)),
  onExit: (cb) => ipcRenderer.on('worktreeRemove:exit', (_, info) => cb(info)),
  removeListeners: () => {
    ipcRenderer.removeAllListeners('worktreeRemove:data');
    ipcRenderer.removeAllListeners('worktreeRemove:exit');
  }
});

contextBridge.exposeInMainWorld('worktreeSwitchAPI', {
  start: (opts) => ipcRenderer.invoke('worktreeSwitch:start', opts),
  ready: () => ipcRenderer.send('worktreeSwitch:ready'),
  onData: (cb) => ipcRenderer.on('worktreeSwitch:data', (_, data) => cb(data)),
  onExit: (cb) => ipcRenderer.on('worktreeSwitch:exit', (_, info) => cb(info)),
  removeListeners: () => {
    ipcRenderer.removeAllListeners('worktreeSwitch:data');
    ipcRenderer.removeAllListeners('worktreeSwitch:exit');
  }
});

contextBridge.exposeInMainWorld('commitPushAPI', {
  start: (opts) => ipcRenderer.invoke('commitPush:start', opts),
  ready: () => ipcRenderer.send('commitPush:ready'),
  onData: (cb) => ipcRenderer.on('commitPush:data', (_, data) => cb(data)),
  onExit: (cb) => ipcRenderer.on('commitPush:exit', (_, info) => cb(info)),
  removeListeners: () => {
    ipcRenderer.removeAllListeners('commitPush:data');
    ipcRenderer.removeAllListeners('commitPush:exit');
  }
});

contextBridge.exposeInMainWorld('prCreateAPI', {
  start: (opts) => ipcRenderer.invoke('prCreate:start', opts),
  ready: () => ipcRenderer.send('prCreate:ready'),
  onData: (cb) => ipcRenderer.on('prCreate:data', (_, data) => cb(data)),
  onExit: (cb) => ipcRenderer.on('prCreate:exit', (_, info) => cb(info)),
  removeListeners: () => {
    ipcRenderer.removeAllListeners('prCreate:data');
    ipcRenderer.removeAllListeners('prCreate:exit');
  }
});

contextBridge.exposeInMainWorld('shellAPI', {
  openInExplorer: (folderPath) => ipcRenderer.invoke('shell:openInExplorer', folderPath),
});

contextBridge.exposeInMainWorld('windowAPI', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close')
});

contextBridge.exposeInMainWorld('startupAPI', {
  onStatus: (cb) => ipcRenderer.on('startup:status', (_, msg) => cb(msg)),
  getStatus: () => ipcRenderer.invoke('startup:getStatus'),
});
