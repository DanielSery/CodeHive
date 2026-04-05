const { ipcMain } = require('electron');
const { exec, spawn } = require('child_process');
const { createWorktreePty, createClonePty, createDeletePty, createWorktreeRemovePty, createWorktreeSwitchPty, createCommitPushPty, createPrCreatePty, createAzInstallPty, createSetupInstallPty, createRebasePty, createForcePushPty, createFastForwardPty, createCherryPickPty, createPushPty } = require('./pty-manager');

let worktreePty = null;
let clonePty = null;
let deletePty = null;
let worktreeRemovePty = null;
let worktreeSwitchPty = null;
let commitPushPty = null;
let prCreatePty = null;
let azInstallPty = null;
let setupInstallPty = null;
let rebasePty = null;
let forcePushPty = null;
let fastForwardPty = null;
let cherryPickPty = null;
let pushPty = null;

function register(mainWindow) {
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

  // Rebase PTY
  ipcMain.handle('rebase:start', (event, opts) => {
    const result = createRebasePty(mainWindow, opts);
    rebasePty = result.proc;
    return {};
  });
  ipcMain.on('rebase:ready', () => { if (rebasePty) rebasePty.flush(); });

  // Fast-forward PTY
  ipcMain.handle('rebase:fastForwardStart', (event, opts) => {
    const result = createFastForwardPty(mainWindow, opts);
    fastForwardPty = result.proc;
    return {};
  });
  ipcMain.on('rebase:fastForwardReady', () => { if (fastForwardPty) fastForwardPty.flush(); });

  // Force push PTY (shared)
  ipcMain.handle('push:forcePushStart', (event, opts) => {
    const result = createForcePushPty(mainWindow, opts);
    forcePushPty = result.proc;
    return {};
  });
  ipcMain.on('push:forcePushReady', () => { if (forcePushPty) forcePushPty.flush(); });

  // Regular push PTY (shared)
  ipcMain.handle('push:start', (event, opts) => {
    const result = createPushPty(mainWindow, opts);
    pushPty = result.proc;
    return {};
  });
  ipcMain.on('push:ready', () => { if (pushPty) pushPty.flush(); });

  // Cherry-pick PTY
  ipcMain.handle('cherryPick:start', (event, opts) => {
    const result = createCherryPickPty(mainWindow, opts);
    cherryPickPty = result.proc;
    return {};
  });
  ipcMain.on('cherryPick:ready', () => { if (cherryPickPty) cherryPickPty.flush(); });

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

  // Setup install PTY
  ipcMain.handle('setupInstall:start', (event, { downloadUrl, auth }) => {
    const result = createSetupInstallPty(mainWindow, { downloadUrl, auth });
    setupInstallPty = result.proc;
  });
  ipcMain.on('setupInstall:ready', () => { if (setupInstallPty) setupInstallPty.flush(); });

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
}

function killAllPtys() {
  for (const pty of [worktreePty, clonePty, deletePty, worktreeRemovePty, worktreeSwitchPty, commitPushPty, prCreatePty, azInstallPty, rebasePty, forcePushPty, fastForwardPty, cherryPickPty, pushPty]) {
    if (pty) pty.kill();
  }
}

module.exports = { register, killAllPtys };
