const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const vscode = require('./vscode-server');
const ipcHandlers = require('./ipc-handlers');
const { DEFAULT_PORT } = require('../shared/config');

let mainWindow;
let serverProcess = null;
let serverPort = DEFAULT_PORT;
let startupStatus = 'Starting...';
let sessionPartition = 'persist:codehive'; // overridden for second instances

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
  ipcMain.handle('startup:getPartition', () => sessionPartition);

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
  console.log('[startup] Resolving port...');
  try {
    const { port, alreadyRunning } = await vscode.resolvePort(serverPort);
    serverPort = port;
    console.log(`[startup] resolvePort => port=${port}, alreadyRunning=${alreadyRunning}`);
    if (alreadyRunning) {
      // Second instance — use a unique partition to avoid IndexedDB conflicts with the first
      const { randomUUID } = require('crypto');
      sessionPartition = `persist:codehive-${randomUUID()}`;
      console.log(`[startup] VS Code server already running on port ${port}, connecting (partition: ${sessionPartition})`);
    } else {
      console.log(`[startup] Starting VS Code server on port ${port}...`);
      const result = await vscode.startServer(port);
      serverProcess = result.proc;
      console.log(`[startup] VS Code server ready on port ${port}`);
    }
    console.log('[startup] Sending null status (server ready)');
    sendStatus(null);
  } catch (err) {
    console.error('[startup] VS Code server failed to start:', err);
    sendStatus('VS Code server failed to start');
  }
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  app.quit();
});
