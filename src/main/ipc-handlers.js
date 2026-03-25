const { ipcMain, dialog, shell } = require('electron');
const vscode = require('./vscode-server');
const { scanDirectory, checkClaudeActive, getCachedBranches, fetchAndListBranches, getGitUser } = require('./repo-scanner');
const { createWorktreePty, createClonePty, createDeletePty, createWorktreeRemovePty, createWorktreeSwitchPty, createCommitPushPty, createPullRequestPty } = require('./pty-manager');

let worktreePty = null;
let clonePty = null;
let deletePty = null;
let worktreeRemovePty = null;
let worktreeSwitchPty = null;
let commitPushPty = null;
let pullRequestPty = null;

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

  ipcMain.on('worktree:resize', (event, { cols, rows }) => {
    try { if (worktreePty) worktreePty.resize(cols, rows); } catch {}
  });

  // Clone PTY
  ipcMain.handle('clone:start', (event, { url, reposDir }) => {
    const result = createClonePty(mainWindow, { url, reposDir });
    clonePty = result.proc;
    return { repoName: result.repoName, repoDir: result.repoDir, bareDir: result.bareDir };
  });

  ipcMain.on('clone:resize', (event, { cols, rows }) => {
    try { if (clonePty) clonePty.resize(cols, rows); } catch {}
  });

  // Delete PTY
  ipcMain.handle('delete:start', (event, { repoDir }) => {
    const result = createDeletePty(mainWindow, { repoDir });
    deletePty = result.proc;
    return {};
  });

  ipcMain.on('delete:resize', (event, { cols, rows }) => {
    try { if (deletePty) deletePty.resize(cols, rows); } catch {}
  });

  // Worktree Remove PTY
  ipcMain.handle('worktreeRemove:start', (event, opts) => {
    const result = createWorktreeRemovePty(mainWindow, opts);
    worktreeRemovePty = result.proc;
    return {};
  });

  ipcMain.on('worktreeRemove:resize', (event, { cols, rows }) => {
    try { if (worktreeRemovePty) worktreeRemovePty.resize(cols, rows); } catch {}
  });

  // Worktree Switch PTY
  ipcMain.handle('worktreeSwitch:start', (event, opts) => {
    const result = createWorktreeSwitchPty(mainWindow, opts);
    worktreeSwitchPty = result.proc;
    return { wtPath: result.wtPath, branchName: result.branchName, dirName: result.dirName };
  });

  ipcMain.on('worktreeSwitch:resize', (event, { cols, rows }) => {
    try { if (worktreeSwitchPty) worktreeSwitchPty.resize(cols, rows); } catch {}
  });

  // Commit & Push PTY
  ipcMain.handle('commitPush:start', (event, opts) => {
    const result = createCommitPushPty(mainWindow, opts);
    commitPushPty = result.proc;
    return {};
  });

  ipcMain.on('commitPush:resize', (event, { cols, rows }) => {
    try { if (commitPushPty) commitPushPty.resize(cols, rows); } catch {}
  });

  // Pull Request PTY
  ipcMain.handle('pullRequest:start', (event, opts) => {
    const result = createPullRequestPty(mainWindow, opts);
    pullRequestPty = result.proc;
    return {};
  });

  ipcMain.on('pullRequest:resize', (event, { cols, rows }) => {
    try { if (pullRequestPty) pullRequestPty.resize(cols, rows); } catch {}
  });

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
