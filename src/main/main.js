const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const vscode = require('./vscode-server');
const ipcHandlers = require('./ipc-handlers');
const { DEFAULT_PORT } = require('../shared/config');

let mainWindow;
let serverProcess = null;
let serverPort = DEFAULT_PORT;
let startupStatus = 'Starting...';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1e1e2e',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', '..', 'index.html'));

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') { mainWindow.webContents.toggleDevTools(); event.preventDefault(); }
  });
}

app.whenReady().then(async () => {
  vscode.seedDefaultSettings();

  // Show window immediately so user sees startup progress
  createWindow();
  ipcHandlers.register(mainWindow, () => serverPort);

  ipcMain.handle('startup:getStatus', () => startupStatus);

  const sendStatus = (msg) => {
    startupStatus = msg;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('startup:status', msg);
    }
  };

  sendStatus('Installing extensions...');
  console.log('Installing VS Code extensions...');
  vscode.installExtensions(sendStatus);

  sendStatus('Starting VS Code server...');
  console.log('Starting VS Code server...');
  try {
    const { port, alreadyRunning } = await vscode.resolvePort(serverPort);
    serverPort = port;
    if (alreadyRunning) {
      console.log(`VS Code server already running on port ${port}, connecting`);
    } else {
      const result = await vscode.startServer(port);
      serverProcess = result.proc;
      console.log(`VS Code server ready on port ${port}`);
    }
    sendStatus(null);
  } catch (err) {
    console.error('VS Code server failed to start:', err);
    sendStatus('VS Code server failed to start');
  }
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  app.quit();
});
