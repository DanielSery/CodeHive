const { ipcMain, dialog } = require('electron');
const vscode = require('./vscode-server');
const { scanDirectory, checkClaudeActive, listRemoteBranches, getGitUser } = require('./repo-scanner');
const { createWorktreePty, createClonePty, createDeletePty } = require('./pty-manager');

let worktreePty = null;
let clonePty = null;
let deletePty = null;

function register(mainWindow, getServerPort) {
  ipcMain.handle('codeserver:openFolder', (event, folderPath) => {
    return vscode.buildFolderUrl(getServerPort(), folderPath);
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

  // Worktree PTY
  ipcMain.handle('worktree:start', (event, opts) => {
    const result = createWorktreePty(mainWindow, opts);
    worktreePty = result.proc;
    return { wtPath: result.wtPath, branchName: result.branchName, dirName: result.dirName };
  });

  ipcMain.on('worktree:resize', (event, { cols, rows }) => {
    if (worktreePty) worktreePty.resize(cols, rows);
  });

  // Clone PTY
  ipcMain.handle('clone:start', (event, { url, reposDir }) => {
    const result = createClonePty(mainWindow, { url, reposDir });
    clonePty = result.proc;
    return { repoName: result.repoName, repoDir: result.repoDir, bareDir: result.bareDir };
  });

  ipcMain.on('clone:resize', (event, { cols, rows }) => {
    if (clonePty) clonePty.resize(cols, rows);
  });

  // Delete PTY
  ipcMain.handle('delete:start', (event, { repoDir }) => {
    const result = createDeletePty(mainWindow, { repoDir });
    deletePty = result.proc;
    return {};
  });

  ipcMain.on('delete:resize', (event, { cols, rows }) => {
    if (deletePty) deletePty.resize(cols, rows);
  });

  // Window controls
  ipcMain.on('window:minimize', () => mainWindow.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow.close());
}

module.exports = { register };
