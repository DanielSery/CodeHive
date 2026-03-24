const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terminalAPI', {
  createTerminal: (cwd) => ipcRenderer.invoke('terminal:create', cwd),
  sendInput: (id, data) => ipcRenderer.send('terminal:input', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
  kill: (id) => ipcRenderer.send('terminal:kill', id),

  onData: (callback) => {
    ipcRenderer.on('terminal:data', (event, id, data) => callback(id, data));
  },
  onExit: (callback) => {
    ipcRenderer.on('terminal:exit', (event, id, exitCode) => callback(id, exitCode));
  },

  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close')
});
