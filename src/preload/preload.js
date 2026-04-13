const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codeServerAPI', {
  openFolder: (folderPath) => ipcRenderer.invoke('codeserver:openFolder', folderPath),
  restartServer: () => ipcRenderer.invoke('codeserver:restart')
});

contextBridge.exposeInMainWorld('reposAPI', {
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  scanDirectory: (dirPath) => ipcRenderer.invoke('repos:scanDirectory', dirPath),
  checkClaudeActive: (wtPath) => ipcRenderer.invoke('repos:claudeActive', wtPath),
  watchClaude: (wtPath) => ipcRenderer.send('claude:watch', wtPath),
  unwatchClaude: (wtPath) => ipcRenderer.send('claude:unwatch', wtPath),
  onClaudeStatus: (cb) => ipcRenderer.on('claude:status', (_, wtPath, status) => cb(wtPath, status)),
  cachedBranches: (barePath) => ipcRenderer.invoke('repos:cachedBranches', barePath),
  fetchBranches: (barePath) => ipcRenderer.invoke('repos:fetchBranches', barePath),
  gitUser: (barePath) => ipcRenderer.invoke('repos:gitUser', barePath),
  remoteUrl: (barePath) => ipcRenderer.invoke('repos:remoteUrl', barePath),
  launchConfigs: (wtPath) => ipcRenderer.invoke('repos:launchConfigs', wtPath),
  gitDiffStat: (wtPath) => ipcRenderer.invoke('repos:gitDiffStat', wtPath),
  firstBranchCommit: (wtPath, sourceBranch) => ipcRenderer.invoke('repos:firstBranchCommit', { wtPath, sourceBranch }),
  hasUncommittedChanges: (wtPath) => ipcRenderer.invoke('repos:hasUncommittedChanges', wtPath),
  hasPushedCommits: (wtPath, branch, sourceBranch) => ipcRenderer.invoke('repos:hasPushedCommits', { wtPath, branch, sourceBranch }),
  getSyncStatus: (wtPath, branch, sourceBranch) => ipcRenderer.invoke('repos:getSyncStatus', { wtPath, branch, sourceBranch }),
  getCommitsAhead: (wtPath, branch, sourceBranch) => ipcRenderer.invoke('repos:getCommitsAhead', { wtPath, branch, sourceBranch }),
  getCommitsBehind: (wtPath, branch) => ipcRenderer.invoke('repos:getCommitsBehind', { wtPath, branch }),
  gitRevertFile: (wtPath, filePath, isNew) => ipcRenderer.invoke('repos:gitRevertFile', { wtPath, filePath, isNew }),
  gitFileDiff: (wtPath, filePath, context) => ipcRenderer.invoke('repos:gitFileDiff', { wtPath, filePath, context }),
  gitBranchDiffStat: (wtPath, targetBranch) => ipcRenderer.invoke('repos:gitBranchDiffStat', { wtPath, targetBranch }),
  gitBranchFileDiff: (wtPath, filePath, targetBranch, context) => ipcRenderer.invoke('repos:gitBranchFileDiff', { wtPath, filePath, targetBranch, context }),
  gitRevertLines: (wtPath, filePath, changes) => ipcRenderer.invoke('repos:gitRevertLines', { wtPath, filePath, changes }),
  gitGetFileLines: (wtPath, filePath, startLine, endLine) => ipcRenderer.invoke('repos:gitGetFileLines', { wtPath, filePath, startLine, endLine }),
  rebaseCommits: (wtPath, sourceBranch) => ipcRenderer.invoke('repos:rebaseCommits', { wtPath, sourceBranch }),
  cherryPickCommits: (sourceWtPath, targetBranch) => ipcRenderer.invoke('repos:cherryPickCommits', { sourceWtPath, targetBranch }),
});

// Helper: returns a disposer function. Exit uses `once` (auto-removes); data uses `on` with returned disposer.
function makeApi(dataChannel, exitChannel, startChannel, readyChannel) {
  return {
    start: (opts) => ipcRenderer.invoke(startChannel, opts),
    ready: () => ipcRenderer.send(readyChannel),
    onData: (cb) => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on(dataChannel, handler);
      return () => ipcRenderer.removeListener(dataChannel, handler);
    },
    onExit: (cb) => {
      const handler = (_, info) => cb(info);
      ipcRenderer.once(exitChannel, handler);
      return () => ipcRenderer.removeListener(exitChannel, handler);
    },
    removeListeners: () => {
      ipcRenderer.removeAllListeners(dataChannel);
      ipcRenderer.removeAllListeners(exitChannel);
    },
  };
}

contextBridge.exposeInMainWorld('rebaseAPI', {
  start: (opts) => ipcRenderer.invoke('rebase:start', opts),
  ready: () => ipcRenderer.send('rebase:ready'),
  onData: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('rebase:data', handler);
    return () => ipcRenderer.removeListener('rebase:data', handler);
  },
  onExit: (cb) => {
    const handler = (_, info) => cb(info);
    ipcRenderer.once('rebase:exit', handler);
    return () => ipcRenderer.removeListener('rebase:exit', handler);
  },
  fastForwardStart: (opts) => ipcRenderer.invoke('rebase:fastForwardStart', opts),
  fastForwardReady: () => ipcRenderer.send('rebase:fastForwardReady'),
  onFastForwardData: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('rebase:fastForwardData', handler);
    return () => ipcRenderer.removeListener('rebase:fastForwardData', handler);
  },
  onFastForwardExit: (cb) => {
    const handler = (_, info) => cb(info);
    ipcRenderer.once('rebase:fastForwardExit', handler);
    return () => ipcRenderer.removeListener('rebase:fastForwardExit', handler);
  },
});

contextBridge.exposeInMainWorld('worktreeAPI', {
  ...makeApi('worktree:data', 'worktree:exit', 'worktree:start', 'worktree:ready'),
});

contextBridge.exposeInMainWorld('cherryPickAPI', {
  ...makeApi('cherryPick:data', 'cherryPick:exit', 'cherryPick:start', 'cherryPick:ready'),
});

contextBridge.exposeInMainWorld('pushAPI', {
  start: (opts) => ipcRenderer.invoke('push:start', opts),
  ready: () => ipcRenderer.send('push:ready'),
  onData: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('push:data', handler);
    return () => ipcRenderer.removeListener('push:data', handler);
  },
  onExit: (cb) => {
    const handler = (_, info) => cb(info);
    ipcRenderer.once('push:exit', handler);
    return () => ipcRenderer.removeListener('push:exit', handler);
  },
  forcePushStart: (opts) => ipcRenderer.invoke('push:forcePushStart', opts),
  forcePushReady: () => ipcRenderer.send('push:forcePushReady'),
  onForcePushData: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('push:forcePushData', handler);
    return () => ipcRenderer.removeListener('push:forcePushData', handler);
  },
  onForcePushExit: (cb) => {
    const handler = (_, info) => cb(info);
    ipcRenderer.once('push:forcePushExit', handler);
    return () => ipcRenderer.removeListener('push:forcePushExit', handler);
  },
  removeListeners: () => {
    ipcRenderer.removeAllListeners('push:data');
    ipcRenderer.removeAllListeners('push:exit');
    ipcRenderer.removeAllListeners('push:forcePushData');
    ipcRenderer.removeAllListeners('push:forcePushExit');
  },
});

contextBridge.exposeInMainWorld('cloneAPI', {
  start: (url, reposDir) => ipcRenderer.invoke('clone:start', { url, reposDir }),
  ready: () => ipcRenderer.send('clone:ready'),
  onData: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('clone:data', handler);
    return () => ipcRenderer.removeListener('clone:data', handler);
  },
  onExit: (cb) => {
    const handler = (_, info) => cb(info);
    ipcRenderer.once('clone:exit', handler);
    return () => ipcRenderer.removeListener('clone:exit', handler);
  },
});

contextBridge.exposeInMainWorld('deleteAPI', {
  ...makeApi('delete:data', 'delete:exit', 'delete:start', 'delete:ready'),
});

contextBridge.exposeInMainWorld('worktreeRemoveAPI', {
  ...makeApi('worktreeRemove:data', 'worktreeRemove:exit', 'worktreeRemove:start', 'worktreeRemove:ready'),
});

contextBridge.exposeInMainWorld('worktreeSwitchAPI', {
  ...makeApi('worktreeSwitch:data', 'worktreeSwitch:exit', 'worktreeSwitch:start', 'worktreeSwitch:ready'),
});

contextBridge.exposeInMainWorld('commitPushAPI', {
  ...makeApi('commitPush:data', 'commitPush:exit', 'commitPush:start', 'commitPush:ready'),
});

contextBridge.exposeInMainWorld('syncAPI', {
  ...makeApi('sync:data', 'sync:exit', 'sync:start', 'sync:ready'),
});

contextBridge.exposeInMainWorld('prCreateAPI', {
  ...makeApi('prCreate:data', 'prCreate:exit', 'prCreate:start', 'prCreate:ready'),
});

contextBridge.exposeInMainWorld('azInstallAPI', {
  check: () => ipcRenderer.invoke('azInstall:check'),
  ...makeApi('azInstall:data', 'azInstall:exit', 'azInstall:start', 'azInstall:ready'),
});

contextBridge.exposeInMainWorld('claudeAPI', {
  run: (prompt) => ipcRenderer.invoke('claude:run', prompt),
});

contextBridge.exposeInMainWorld('credentialsAPI', {
  get: (key) => ipcRenderer.invoke('credentials:get', key),
  set: (key, value) => ipcRenderer.invoke('credentials:set', key, value),
  delete: (key) => ipcRenderer.invoke('credentials:delete', key),
});

contextBridge.exposeInMainWorld('shellAPI', {
  openInExplorer: (folderPath) => ipcRenderer.invoke('shell:openInExplorer', folderPath),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openInGitApp: (repoPath) => ipcRenderer.invoke('shell:openInGitApp', repoPath),
  openInPowerShell: (folderPath) => ipcRenderer.invoke('shell:openInPowerShell', folderPath),
  findSolutions: (folderPath) => ipcRenderer.invoke('shell:findSolutions', folderPath),
  openSolution: (slnPath) => ipcRenderer.invoke('shell:openSolution', slnPath),
});

contextBridge.exposeInMainWorld('setupInstallAPI', {
  ...makeApi('setupInstall:data', 'setupInstall:exit', 'setupInstall:start', 'setupInstall:ready'),
});

contextBridge.exposeInMainWorld('windowAPI', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close')
});

contextBridge.exposeInMainWorld('shortcutAPI', {
  onAlt: (cb) => ipcRenderer.on('shortcut:alt', (_, key) => cb(key))
});

contextBridge.exposeInMainWorld('webviewEventsAPI', {
  onWindowOpen: (cb) => ipcRenderer.on('webview:windowOpen', (_, url) => cb(url))
});

contextBridge.exposeInMainWorld('startupAPI', {
  onStatus: (cb) => ipcRenderer.on('startup:status', (_, msg) => cb(msg)),
  getStatus: () => ipcRenderer.invoke('startup:getStatus'),
});

// Partition is stable for the first instance (persist:codehive) and unique for additional instances
contextBridge.exposeInMainWorld('appSession', {
  getPartition: () => ipcRenderer.invoke('startup:getPartition')
});

contextBridge.exposeInMainWorld('updaterAPI', {
  getVersion: () => ipcRenderer.invoke('updater:getVersion'),
  isPackaged: () => ipcRenderer.invoke('updater:isPackaged'),
  publish: (version) => ipcRenderer.invoke('updater:publish', version),
  check: () => ipcRenderer.invoke('updater:check'),
  download: (url) => ipcRenderer.invoke('updater:download', url),
  install: (zipPath) => ipcRenderer.invoke('updater:install', zipPath),
  onProgress: (cb) => ipcRenderer.on('updater:progress', (_, pct) => cb(pct)),
  removeProgressListener: () => ipcRenderer.removeAllListeners('updater:progress'),
});
