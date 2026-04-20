const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const vscode = require('./vscode-server');
const ipcHandlers = require('./ipc-handlers');
const { DEFAULT_PORT } = require('../shared/config');

// True if this is the first (or only) CodeHive process. Second instances return false.
// Used to distinguish orphan VS Code servers (kill + restart) from servers owned by
// another live CodeHive window (connect without disturbing).
const isFirstInstance = app.requestSingleInstanceLock();

let mainWindow;
let serverProcess = null;
let serverPort = DEFAULT_PORT;
let startupStatus = 'Starting...';
let sessionPartition = 'persist:codehive';

Menu.setApplicationMenu(null);

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

  if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12') { mainWindow.webContents.toggleDevTools(); event.preventDefault(); }
    });
  }

  // Forward Alt shortcuts from webviews (which capture keyboard focus away from the main document)
  const ALT_SHORTCUT_KEYS = new Set(['0','1','2','3','4','5','6','7','8','9','w','W','n','N','r','R','Enter']);
  mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
    webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.alt && !input.control && ALT_SHORTCUT_KEYS.has(input.key)) {
        mainWindow.webContents.send('shortcut:alt', input.key);
        event.preventDefault();
      }
    });

    // Block all new windows opened by VS Code (new-window event is deprecated in Electron 14+).
    // Forward the URL to the renderer so it can open file links inside the embedded editor.
    webContents.setWindowOpenHandler(({ url }) => {
      mainWindow.webContents.send('webview:windowOpen', url);
      return { action: 'deny' };
    });
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

  if (!vscode.isVSCodeInstalled()) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'VS Code Not Found',
      message: 'Visual Studio Code is not installed or not in PATH.',
      detail: 'MUCHA requires VS Code to run the embedded editor. Please install it and restart the app.',
      buttons: ['Download VS Code', 'Close'],
      defaultId: 0,
      cancelId: 1
    });
    if (response === 0) shell.openExternal('https://code.visualstudio.com/');
    app.quit();
    return;
  }

  sendStatus('Installing extensions...');
  console.log('Installing VS Code extensions...');
  await vscode.installExtensions(sendStatus);

  sendStatus('Starting VS Code server...');
  console.log('[startup] Resolving port...');
  try {
    const { port, alreadyRunning } = await vscode.resolvePort(serverPort);
    serverPort = port;
    console.log(`[startup] resolvePort => port=${port}, alreadyRunning=${alreadyRunning}`);
    if (alreadyRunning) {
      if (isFirstInstance) {
        // No other CodeHive window is open, so this is an orphan server from a previous session.
        // Kill it and start fresh so we own the process and the port is clean.
        console.log(`[startup] Orphan VS Code server on port ${port}, killing and restarting...`);
        await vscode.killServerOnPort(port);
        const result = await vscode.startServer(port);
        serverProcess = result.proc;
        console.log(`[startup] VS Code server restarted on port ${port}`);
      } else {
        // Another CodeHive window is running and owns this server — connect to it.
        // Both windows open different worktrees (different workspace URIs) so IndexedDB won't conflict.
        console.log(`[startup] Second CodeHive instance, connecting to existing server on port ${port}`);
      }
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

  ipcMain.handle('codeserver:restart', async () => {
    vscode.killServer(serverProcess);
    serverProcess = null;
    // Also kill by port in case serverProcess was null (orphan from previous session)
    await vscode.killServerOnPort(serverPort);
    sendStatus('Restarting VS Code server...');
    try {
      const result = await vscode.startServer(serverPort);
      serverProcess = result.proc;
      sendStatus(null);
      return { port: serverPort };
    } catch (err) {
      console.error('[restart] VS Code server failed to restart:', err);
      sendStatus('VS Code server failed to restart');
      throw err;
    }
  });
});

app.on('window-all-closed', () => {
  ipcHandlers.killAllPtys();
  vscode.killServer(serverProcess); // kills full process tree, not just the shell
  app.quit();
});
