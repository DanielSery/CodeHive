const { ipcMain, dialog, shell } = require('electron');
const { exec, spawn } = require('child_process');
const vscode = require('./vscode-server');
const { scanDirectory, checkClaudeActive, getCachedBranches, fetchAndListBranches, getGitUser, getRemoteUrl, getLaunchConfigs, gitDiffStat } = require('./repo-scanner');
const { createWorktreePty, createClonePty, createDeletePty, createWorktreeRemovePty, createWorktreeSwitchPty, createCommitPushPty, createPrCreatePty } = require('./pty-manager');

let worktreePty = null;
let clonePty = null;
let deletePty = null;
let worktreeRemovePty = null;
let worktreeSwitchPty = null;
let commitPushPty = null;
let prCreatePty = null;

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

  ipcMain.handle('repos:remoteUrl', (event, barePath) => {
    return getRemoteUrl(barePath);
  });

  ipcMain.handle('repos:launchConfigs', (event, wtPath) => {
    return getLaunchConfigs(wtPath);
  });

  ipcMain.handle('repos:gitDiffStat', (event, wtPath) => {
    return gitDiffStat(wtPath);
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

  // Commit & Push PTY
  ipcMain.handle('commitPush:start', (event, opts) => {
    const result = createCommitPushPty(mainWindow, opts);
    commitPushPty = result.proc;
    return {};
  });

  ipcMain.on('commitPush:ready', () => { if (commitPushPty) commitPushPty.flush(); });

  // PR Create PTY
  ipcMain.handle('prCreate:start', (event, opts) => {
    const result = createPrCreatePty(mainWindow, opts);
    prCreatePty = result.proc;
    return {};
  });

  ipcMain.on('prCreate:ready', () => { if (prCreatePty) prCreatePty.flush(); });

  // Shell
  ipcMain.handle('shell:openInExplorer', (event, folderPath) => {
    return shell.openPath(folderPath);
  });

  ipcMain.handle('shell:openExternal', (event, url) => {
    return shell.openExternal(url);
  });

  // Claude CLI
  ipcMain.handle('claude:run', (event, prompt) => {
    return new Promise((resolve) => {
      let output = '';
      const child = spawn('claude', ['-p', '-'], { shell: true, timeout: 30000 });
      child.stdout.on('data', (d) => { output += d.toString(); });
      child.on('close', () => resolve(output.trim()));
      child.on('error', () => resolve(''));
      child.stdin.write(prompt);
      child.stdin.end();
    });
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
