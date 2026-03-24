const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const pty = require('node-pty');

let mainWindow;
const terminals = new Map();
let terminalIdCounter = 0;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: '#1e1e2e',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');

  // F5 to reload, F12 for dev tools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F5') {
      mainWindow.reload();
      event.preventDefault();
    }
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

function getShell() {
  if (os.platform() === 'win32') {
    return 'powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

ipcMain.handle('terminal:create', (event, cwd) => {
  const id = ++terminalIdCounter;
  const shell = getShell();

  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: cwd || os.homedir(),
    env: process.env
  });

  ptyProcess.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:data', id, data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    terminals.delete(id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:exit', id, exitCode);
    }
  });

  terminals.set(id, ptyProcess);
  return id;
});

ipcMain.on('terminal:input', (event, id, data) => {
  const term = terminals.get(id);
  if (term) {
    term.write(data);
  }
});

ipcMain.on('terminal:resize', (event, id, cols, rows) => {
  const term = terminals.get(id);
  if (term) {
    try {
      term.resize(cols, rows);
    } catch (e) {
      // ignore resize errors
    }
  }
});

ipcMain.on('terminal:kill', (event, id) => {
  const term = terminals.get(id);
  if (term) {
    term.kill();
    terminals.delete(id);
  }
});

ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});
ipcMain.on('window:close', () => mainWindow.close());

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  for (const [id, term] of terminals) {
    term.kill();
  }
  terminals.clear();
  app.quit();
});
