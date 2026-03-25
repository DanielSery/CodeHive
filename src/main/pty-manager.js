const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';

function spawnProc(cmd, cwd) {
  const buffer = [];
  let exitInfo = null;
  let ready = false;
  const listeners = { data: [], exit: [] };

  console.log('[spawnProc] cmd:', cmd, 'cwd:', cwd);
  const proc = spawn(cmd, [], {
    cwd,
    env: process.env,
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  proc.stdout.on('data', (data) => {
    const str = data.toString().replace(/\r?\n/g, '\r\n');
    console.log('[spawnProc] stdout:', str.substring(0, 100));
    if (ready) {
      for (const cb of listeners.data) cb(str);
    } else {
      buffer.push(str);
    }
  });

  proc.stderr.on('data', (data) => {
    const str = data.toString().replace(/\r?\n/g, '\r\n');
    console.log('[spawnProc] stderr:', str.substring(0, 100));
    if (ready) {
      for (const cb of listeners.data) cb(str);
    } else {
      buffer.push(str);
    }
  });

  proc.on('close', (code) => {
    console.log('[spawnProc] close, code:', code, 'buffer:', buffer.length, 'ready:', ready);
    const info = { exitCode: code || 0 };
    if (ready) {
      for (const cb of listeners.exit) cb(info);
    } else {
      exitInfo = info;
    }
  });

  proc.on('error', (err) => {
    console.log('[spawnProc] error:', err.message);
    buffer.push(`Error: ${err.message}\r\n`);
    exitInfo = { exitCode: 1 };
  });

  return {
    onData: (cb) => listeners.data.push(cb),
    onExit: (cb) => listeners.exit.push(cb),
    flush: () => {
      console.log('[spawnProc] flush called, buffer:', buffer.length, 'exitInfo:', !!exitInfo, 'data listeners:', listeners.data.length, 'exit listeners:', listeners.exit.length);
      ready = true;
      for (const str of buffer) {
        for (const cb of listeners.data) cb(str);
      }
      buffer.length = 0;
      if (exitInfo) {
        for (const cb of listeners.exit) cb(exitInfo);
      }
    },
    resize: () => {},
    kill: () => proc.kill()
  };
}

function createWorktreePty(mainWindow, { barePath, repoDir, branchName, dirName, sourceBranch }) {
  const wtPath = path.join(repoDir, dirName).replace(/\\/g, '/');
  const startPoint = `refs/remotes/origin/${sourceBranch}`;

  // Check if the branch already exists locally
  let branchExists = false;
  try {
    execSync(`git rev-parse --verify refs/heads/${branchName}`, { cwd: barePath, encoding: 'utf8', stdio: 'pipe' });
    branchExists = true;
  } catch {}

  const cmd = branchExists
    ? `git worktree add ${wtPath} ${branchName}`
    : `git worktree add ${wtPath} -b ${branchName} ${startPoint}`;

  const proc = spawnProc(cmd, barePath);

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
  const urlPath = url.replace(/\.git\/?$/, '').replace(/\/$/, '');
  const repoName = urlPath.split('/').pop();
  const repoDir = path.join(reposDir, repoName);
  const bareDir = path.join(repoDir, 'Bare');

  fs.mkdirSync(bareDir, { recursive: true });

  const gitCmds = `git init --bare . && git remote add origin ${url} && git config remote.origin.fetch +refs/heads/*:refs/remotes/origin/* && git fetch origin && echo. && echo === CLONE COMPLETE ===`;
  const cmd = process.platform === 'win32' ? gitCmds : gitCmds.replace(/echo\./g, 'echo');

  const proc = spawnProc(cmd, bareDir);

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
  const barePath = path.join(repoDir, 'Bare');
  const os = require('os');

  // Collect worktree paths upfront
  let worktreePaths = [];
  try {
    const output = execSync('git worktree list --porcelain', {
      cwd: barePath,
      encoding: 'utf8',
      timeout: 10000
    });
    const blocks = output.trim().split('\n\n');
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      const wtLine = lines.find(l => l.startsWith('worktree '));
      const isBare = lines.some(l => l.trim() === 'bare');
      if (!wtLine || isBare) continue;
      worktreePaths.push(wtLine.substring('worktree '.length).trim());
    }
  } catch {}

  // Write a temporary batch/shell script for reliable execution
  const isWin = process.platform === 'win32';
  const scriptExt = isWin ? '.cmd' : '.sh';
  const scriptPath = path.join(os.tmpdir(), `codehive-delete-${Date.now()}${scriptExt}`);

  const lines = [];
  if (isWin) {
    lines.push('@echo off');
    lines.push('echo Removing worktrees...');
    for (const wt of worktreePaths) {
      const wtWin = wt.replace(/\//g, '\\');
      lines.push(`echo   ${path.basename(wt)}`);
      lines.push(`git worktree remove "${wtWin}" --force 2>nul`);
      lines.push(`if exist "${wtWin}" rd /s /q "${wtWin}"`);
    }
    lines.push('echo.');
    lines.push('echo Removing project directory...');
    const repoDirWin = repoDir.replace(/\//g, '\\');
    lines.push(`echo   ${repoDirWin}`);
    lines.push(`cd /d "%TEMP%"`);
    lines.push(`rd /s /q "${repoDirWin}"`);
    lines.push('echo.');
    lines.push('echo === DELETE COMPLETE ===');
  } else {
    lines.push('#!/bin/sh');
    lines.push('echo "Removing worktrees..."');
    for (const wt of worktreePaths) {
      lines.push(`echo "  ${path.basename(wt)}"`);
      lines.push(`git worktree remove "${wt}" --force 2>/dev/null || rm -rf "${wt}"`);
    }
    lines.push('echo ""');
    lines.push('echo "Removing project directory..."');
    lines.push(`echo "  ${repoDir}"`);
    lines.push('cd /tmp');
    lines.push(`rm -rf "${repoDir}"`);
    lines.push('echo ""');
    lines.push('echo "=== DELETE COMPLETE ==="');
  }

  fs.writeFileSync(scriptPath, lines.join('\n'), { encoding: 'utf8' });

  const cmd = isWin ? scriptPath : `sh "${scriptPath}"`;
  const proc = spawnProc(cmd, barePath);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('delete:data', data);
    }
  });

  proc.onExit(({ exitCode }) => {
    // Clean up temp script
    try { fs.unlinkSync(scriptPath); } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('delete:exit', { exitCode, repoDir });
    }
  });

  return { proc };
}

function createWorktreeRemovePty(mainWindow, { barePath, wtPath }) {
  const isWin = process.platform === 'win32';
  const os = require('os');
  const scriptExt = isWin ? '.cmd' : '.sh';
  const scriptPath = path.join(os.tmpdir(), `codehive-wt-remove-${Date.now()}${scriptExt}`);

  const wtForGit = wtPath.replace(/\\/g, '/');
  const wtForFs = isWin ? wtPath.replace(/\//g, '\\') : wtPath;

  const lines = [];
  if (isWin) {
    lines.push('@echo off');
    lines.push(`echo Removing worktree: ${path.basename(wtPath)}`);
    lines.push(`git worktree remove "${wtForGit}" --force 2>nul`);
    lines.push(`if exist "${wtForFs}" (`);
    lines.push(`  echo Cleaning up directory...`);
    lines.push(`  rd /s /q "${wtForFs}"`);
    lines.push(`)`);
    lines.push(`git worktree prune 2>nul`);
    lines.push('echo.');
    lines.push('echo === REMOVE COMPLETE ===');
  } else {
    lines.push('#!/bin/sh');
    lines.push(`echo "Removing worktree: ${path.basename(wtPath)}"`);
    lines.push(`git worktree remove "${wtForGit}" --force 2>/dev/null`);
    lines.push(`if [ -d "${wtPath}" ]; then`);
    lines.push(`  echo "Cleaning up directory..."`);
    lines.push(`  rm -rf "${wtPath}"`);
    lines.push('fi');
    lines.push('git worktree prune 2>/dev/null');
    lines.push('echo ""');
    lines.push('echo "=== REMOVE COMPLETE ==="');
  }

  fs.writeFileSync(scriptPath, lines.join('\n'), { encoding: 'utf8' });

  const cmd = isWin ? scriptPath : `sh "${scriptPath}"`;
  const proc = spawnProc(cmd, barePath);

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

function createWorktreeSwitchPty(mainWindow, { barePath, oldWtPath, branchName, sourceBranch }) {
  const startPoint = `refs/remotes/origin/${sourceBranch}`;
  const oldWtForGit = oldWtPath.replace(/\\/g, '/');
  const dirName = path.basename(oldWtPath);

  // Run checkout from within the worktree directory to avoid cmd.exe quoting issues with git -C
  const cwd = path.resolve(oldWtPath);
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

module.exports = { createWorktreePty, createClonePty, createDeletePty, createWorktreeRemovePty, createWorktreeSwitchPty };
