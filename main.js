const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const pty = require('node-pty');
const vscode = require('./vscode-server');
const { scanDirectory, checkClaudeActive, listRemoteBranches, getGitUser } = require('./repo-scanner');

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

ipcMain.handle('repos:remoteBranches', (event, barePath) => {
  return listRemoteBranches(barePath);
});

ipcMain.handle('repos:gitUser', (event, barePath) => {
  return getGitUser(barePath);
});

// ===== Worktree Creation via PTY =====
let worktreePty = null;

ipcMain.handle('worktree:start', (event, { barePath, repoDir, branchName, dirName, sourceBranch }) => {
  const wtPath = path.join(repoDir, dirName).replace(/\\/g, '/');
  const startPoint = `refs/remotes/origin/${sourceBranch}`;
  const cmd = `git worktree add ${wtPath} -b ${branchName} ${startPoint}`;

  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
  const args = process.platform === 'win32' ? ['/c', cmd] : ['-c', cmd];

  worktreePty = pty.spawn(shell, args, {
    name: 'xterm-color',
    cols: 120,
    rows: 30,
    cwd: barePath,
    env: process.env
  });

  worktreePty.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('worktree:data', data);
    }
  });

  worktreePty.onExit(({ exitCode }) => {
    worktreePty = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('worktree:exit', { exitCode, wtPath, branchName, dirName });
    }
  });

  return { wtPath, branchName, dirName };
});

ipcMain.on('worktree:resize', (event, { cols, rows }) => {
  if (worktreePty) worktreePty.resize(cols, rows);
});

// ===== Clone Repository =====
let clonePty = null;

ipcMain.handle('clone:start', (event, { url, reposDir }) => {
  // Extract repo name from URL (last segment, strip .git)
  const urlPath = url.replace(/\.git\/?$/, '').replace(/\/$/, '');
  const repoName = urlPath.split('/').pop();
  const repoDir = path.join(reposDir, repoName);
  const bareDir = path.join(repoDir, 'Bare');

  const fs = require('fs');
  fs.mkdirSync(bareDir, { recursive: true });

  // Run git commands with cwd set to bareDir so no path issues
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
  const gitCmds = `git init --bare . && git remote add origin ${url} && git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*" && git fetch origin && echo. && echo === CLONE COMPLETE ===`;
  const args = process.platform === 'win32'
    ? ['/c', gitCmds]
    : ['-c', gitCmds.replace(/echo\./g, 'echo')];

  clonePty = pty.spawn(shell, args, {
    name: 'xterm-color',
    cols: 120,
    rows: 30,
    cwd: bareDir,
    env: process.env
  });

  clonePty.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clone:data', data);
    }
  });

  clonePty.onExit(({ exitCode }) => {
    clonePty = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clone:exit', { exitCode, repoName, repoDir, bareDir, reposDir });
    }
  });

  return { repoName, repoDir, bareDir };
});

ipcMain.on('clone:resize', (event, { cols, rows }) => {
  if (clonePty) clonePty.resize(cols, rows);
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
