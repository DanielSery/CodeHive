const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const vscode = require('./vscode-server');
const { scanDirectory, checkClaudeActive } = require('./repo-scanner');

let mainWindow;
let serverProcess = null;
let serverPort = 8590;

// ===== Window =====

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1e1e2e',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F5') { mainWindow.reload(); event.preventDefault(); }
    if (input.key === 'F12') { mainWindow.webContents.toggleDevTools(); event.preventDefault(); }
  });
}

// ===== IPC Handlers =====

ipcMain.handle('codeserver:openFolder', (event, folderPath) => {
  return vscode.buildFolderUrl(serverPort, folderPath);
});

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('repos:scanDirectory', (event, dirPath) => {
  return scanDirectory(dirPath);
});

ipcMain.handle('repos:claudeActive', (event, wtPath) => {
  return checkClaudeActive(wtPath);
});

ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow.close());

// ===== App Lifecycle =====

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
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  app.quit();
});
