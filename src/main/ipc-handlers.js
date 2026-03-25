const { ipcMain, dialog, shell } = require('electron');
const vscode = require('./vscode-server');
const { scanDirectory, checkClaudeActive, getCachedBranches, fetchAndListBranches, getGitUser } = require('./repo-scanner');
const { createWorktreePty, createClonePty, createDeletePty, createWorktreeRemovePty, createWorktreeSwitchPty } = require('./pty-manager');

let worktreePty = null;
let clonePty = null;
let deletePty = null;
let worktreeRemovePty = null;
let worktreeSwitchPty = null;

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

  ipcMain.handle('repos:scanDirectory', async (event, dirPath) => {
    if (!vscode.isTrustedFolder(dirPath, getServerPort())) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Trust', 'Don\'t Trust'],
        defaultId: 0,
        cancelId: 1,
        title: 'Trust Folder',
        message: `Do you trust the authors of the files in this folder?\n\n${dirPath}`,
        detail: 'Trusting a folder allows VS Code extensions to run with full functionality for workspaces inside it.'
      });
      if (response === 0) {
        await vscode.seedTrustedFolders([dirPath], getServerPort());
      }
    }
    return scanDirectory(dirPath);
  });

  ipcMain.handle('repos:claudeActive', (event, wtPath) => {
    return checkClaudeActive(wtPath);
  });

  ipcMain.handle('repos:cachedBranches', (event, barePath) => {
    return getCachedBranches(barePath);
  });

  ipcMain.handle('repos:fetchBranches', (event, barePath) => {
    return fetchAndListBranches(barePath);
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

  ipcMain.on('worktree:ready', () => { if (worktreePty) worktreePty.flush(); });

  // Clone PTY
  ipcMain.handle('clone:start', (event, { url, reposDir }) => {
    const result = createClonePty(mainWindow, { url, reposDir });
    clonePty = result.proc;
    return { repoName: result.repoName, repoDir: result.repoDir, bareDir: result.bareDir };
  });

  ipcMain.on('clone:ready', () => { if (clonePty) clonePty.flush(); });

  // Delete PTY
  ipcMain.handle('delete:start', (event, { repoDir }) => {
    const result = createDeletePty(mainWindow, { repoDir });
    deletePty = result.proc;
    return {};
  });

  ipcMain.on('delete:ready', () => { if (deletePty) deletePty.flush(); });

  // Worktree Remove PTY
  ipcMain.handle('worktreeRemove:start', (event, opts) => {
    const result = createWorktreeRemovePty(mainWindow, opts);
    worktreeRemovePty = result.proc;
    return {};
  });

  ipcMain.on('worktreeRemove:ready', () => { if (worktreeRemovePty) worktreeRemovePty.flush(); });

  // Worktree Switch PTY
  ipcMain.handle('worktreeSwitch:start', (event, opts) => {
    const result = createWorktreeSwitchPty(mainWindow, opts);
    worktreeSwitchPty = result.proc;
    return { wtPath: result.wtPath, branchName: result.branchName, dirName: result.dirName };
  });

  ipcMain.on('worktreeSwitch:ready', () => { if (worktreeSwitchPty) worktreeSwitchPty.flush(); });

  // Shell
  ipcMain.handle('shell:openInExplorer', (event, folderPath) => {
    return shell.openPath(folderPath);
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
