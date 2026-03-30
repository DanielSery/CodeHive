const { ipcMain, dialog, shell, safeStorage } = require('electron');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const vscode = require('./vscode-server');
const { scanDirectory, checkClaudeActive, getCachedBranches, fetchAndListBranches, getGitUser, getRemoteUrl, getLaunchConfigs, gitDiffStat, getFirstBranchCommit, hasUncommittedChanges, hasPushedCommits, gitRevertFile } = require('./repo-scanner');
const { watchClaude, unwatchClaude } = require('./claude-status');
const { createWorktreePty, createClonePty, createDeletePty, createWorktreeRemovePty, createWorktreeSwitchPty, createCommitPushPty, createPrCreatePty, createAzInstallPty } = require('./pty-manager');

let worktreePty = null;
let clonePty = null;
let deletePty = null;
let worktreeRemovePty = null;
let worktreeSwitchPty = null;
let commitPushPty = null;
let prCreatePty = null;
let azInstallPty = null;

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

  // Claude status watching (push-based via fs.watch)
  ipcMain.on('claude:watch', (event, wtPath) => {
    watchClaude(wtPath, (watchedPath, status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('claude:status', watchedPath, status);
      }
    });
  });

  ipcMain.on('claude:unwatch', (event, wtPath) => {
    unwatchClaude(wtPath);
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

  ipcMain.handle('repos:firstBranchCommit', (event, { wtPath, sourceBranch }) => {
    return getFirstBranchCommit(wtPath, sourceBranch);
  });

  ipcMain.handle('repos:hasUncommittedChanges', (event, wtPath) => {
    return hasUncommittedChanges(wtPath);
  });

  ipcMain.handle('repos:hasPushedCommits', (event, { wtPath, branch, sourceBranch }) => {
    return hasPushedCommits(wtPath, branch, sourceBranch);
  });

  ipcMain.handle('repos:gitRevertFile', (event, { wtPath, filePath, isNew }) => {
    return gitRevertFile(wtPath, filePath, isNew);
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

  // AZ CLI check & install
  ipcMain.handle('azInstall:check', () => {
    return new Promise((resolve) => {
      const cmd = process.platform === 'win32' ? 'where az' : 'which az';
      exec(cmd, (err) => resolve({ installed: !err }));
    });
  });

  ipcMain.handle('azInstall:start', () => {
    const result = createAzInstallPty(mainWindow);
    azInstallPty = result.proc;
    return {};
  });

  ipcMain.on('azInstall:ready', () => { if (azInstallPty) azInstallPty.flush(); });

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
      const start = Date.now();
      const child = spawn('claude', ['-p', '--model', 'claude-haiku-4-5', '-'], { shell: true, timeout: 30000 });
      let stderr = '';
      child.stdout.on('data', (d) => { output += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('close', (code) => {
        console.log(`[Claude] response time: ${Date.now() - start}ms, exit: ${code}, stderr: ${stderr.trim()}, response: ${output.trim()}`);
        resolve(output.trim());
      });
      child.on('error', (e) => { console.log('[Claude] spawn error:', e); resolve(''); });
      child.stdin.write(prompt);
      child.stdin.end();
    });
  });

  // Credential storage (OS keychain via safeStorage)
  const credentialPath = path.join(app.getPath('userData'), 'credentials.enc');

  ipcMain.handle('credentials:get', (event, key) => {
    try {
      if (!fs.existsSync(credentialPath)) return null;
      const raw = fs.readFileSync(credentialPath);
      const decrypted = safeStorage.decryptString(raw);
      const store = JSON.parse(decrypted);
      return store[key] || null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('credentials:set', (event, key, value) => {
    try {
      let store = {};
      if (fs.existsSync(credentialPath)) {
        try {
          const raw = fs.readFileSync(credentialPath);
          store = JSON.parse(safeStorage.decryptString(raw));
        } catch {}
      }
      store[key] = value;
      const encrypted = safeStorage.encryptString(JSON.stringify(store));
      fs.writeFileSync(credentialPath, encrypted);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('credentials:delete', (event, key) => {
    try {
      if (!fs.existsSync(credentialPath)) return true;
      const raw = fs.readFileSync(credentialPath);
      const store = JSON.parse(safeStorage.decryptString(raw));
      delete store[key];
      const encrypted = safeStorage.encryptString(JSON.stringify(store));
      fs.writeFileSync(credentialPath, encrypted);
      return true;
    } catch {
      return false;
    }
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
