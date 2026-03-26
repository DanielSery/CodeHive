const fs = require('fs');
const { spawnProc } = require('./pty-spawn.js');
const { buildWorktreeCmd, buildCloneCmd, buildDeleteScript, buildWorktreeRemoveScript, buildCommitPushScript, buildPrCreateScript } = require('./pty-scripts.js');

function createWorktreePty(mainWindow, { barePath, repoDir, branchName, dirName, sourceBranch }) {
  const { cmd, cwd, wtPath } = buildWorktreeCmd(barePath, { repoDir, dirName, branchName, sourceBranch });
  const proc = spawnProc(cmd, cwd);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('worktree:data', data);
    }
  });

  proc.onExit(({ exitCode }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('worktree:exit', { exitCode, wtPath, branchName, dirName });
    }
  });

  return { proc, wtPath, branchName, dirName };
}

function createClonePty(mainWindow, { url, reposDir }) {
  const { cmd, cwd, repoName, repoDir, bareDir } = buildCloneCmd({ url, reposDir });
  const proc = spawnProc(cmd, cwd);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clone:data', data);
    }
  });

  proc.onExit(({ exitCode }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clone:exit', { exitCode, repoName, repoDir, bareDir, reposDir });
    }
  });

  return { proc, repoName, repoDir, bareDir };
}

function createDeletePty(mainWindow, { repoDir }) {
  const { cmd, cwd, scriptPath } = buildDeleteScript(repoDir);
  const proc = spawnProc(cmd, cwd);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('delete:data', data);
    }
  });

  proc.onExit(({ exitCode }) => {
    try { fs.unlinkSync(scriptPath); } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('delete:exit', { exitCode, repoDir });
    }
  });

  return { proc };
}

function createWorktreeRemovePty(mainWindow, { barePath, wtPath }) {
  const { cmd, cwd, scriptPath } = buildWorktreeRemoveScript(barePath, wtPath);
  const proc = spawnProc(cmd, cwd);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('worktreeRemove:data', data);
    }
  });

  proc.onExit(({ exitCode }) => {
    try { fs.unlinkSync(scriptPath); } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('worktreeRemove:exit', { exitCode, wtPath });
    }
  });

  return { proc };
}

function createWorktreeSwitchPty(mainWindow, { oldWtPath, branchName, sourceBranch }) {
  const startPoint = `refs/remotes/origin/${sourceBranch}`;
  const oldWtForGit = oldWtPath.replace(/\\/g, '/');
  const dirName = require('path').basename(oldWtPath);

  const cwd = require('path').resolve(oldWtPath);
  const cmd = `git checkout -B ${branchName} ${startPoint}`;
  const proc = spawnProc(cmd, cwd);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('worktreeSwitch:data', data);
    }
  });

  proc.onExit(({ exitCode }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('worktreeSwitch:exit', { exitCode, wtPath: oldWtForGit, branchName, dirName });
    }
  });

  return { proc, wtPath: oldWtForGit, branchName, dirName };
}

function createCommitPushPty(mainWindow, { wtPath, title, description, branch }) {
  const { cmd, cwd, scriptPath } = buildCommitPushScript(wtPath, { title, description, branch });
  const proc = spawnProc(cmd, cwd);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('commitPush:data', data);
    }
  });

  proc.onExit(({ exitCode }) => {
    try { fs.unlinkSync(scriptPath); } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('commitPush:exit', { exitCode });
    }
  });

  return { proc };
}

function createPrCreatePty(mainWindow, { wtPath, sourceBranch, targetBranch, title, description, pat, workItemId }) {
  const { cmd, cwd, scriptPath } = buildPrCreateScript(wtPath, { sourceBranch, targetBranch, title, description, pat, workItemId });
  const proc = spawnProc(cmd, cwd);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('prCreate:data', data);
    }
  });

  proc.onExit(({ exitCode }) => {
    try { fs.unlinkSync(scriptPath); } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('prCreate:exit', { exitCode });
    }
  });

  return { proc };
}

module.exports = { createWorktreePty, createClonePty, createDeletePty, createWorktreeRemovePty, createWorktreeSwitchPty, createCommitPushPty, createPrCreatePty };
