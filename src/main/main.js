const { app, BrowserWindow } = require('electron');
const path = require('path');
const vscode = require('./vscode-server');
const ipcHandlers = require('./ipc-handlers');
const { DEFAULT_PORT } = require('../shared/config');

let mainWindow;
let serverProcess = null;
let serverPort = DEFAULT_PORT;

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
    if (input.key === 'F5') { mainWindow.reload(); event.preventDefault(); }
    if (input.key === 'F12') { mainWindow.webContents.toggleDevTools(); event.preventDefault(); }
  });
}

app.whenReady().then(async () => {
  console.log('Installing VS Code extensions...');
  vscode.installExtensions();

  console.log('Starting VS Code server...');
  try {
    const port = await vscode.findPort(serverPort);
    serverPort = port;
    const result = await vscode.startServer(port);
    serverProcess = result.proc;
    console.log(`VS Code server ready on port ${port}`);
  } catch (err) {
    console.error('VS Code server failed to start:', err);
  }

  createWindow();
  ipcHandlers.register(mainWindow, () => serverPort);
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  app.quit();
});
