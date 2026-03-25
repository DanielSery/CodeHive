const path = require('path');
const fs = require('fs');
const pty = require('node-pty');

const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';

function spawnPty(cmd, cwd) {
  const args = process.platform === 'win32' ? ['/c', cmd] : ['-c', cmd];
  return pty.spawn(shell, args, {
    name: 'xterm-color',
    cols: 120,
    rows: 30,
    cwd,
    env: process.env
  });
}

function createWorktreePty(mainWindow, { barePath, repoDir, branchName, dirName, sourceBranch }) {
  const wtPath = path.join(repoDir, dirName).replace(/\\/g, '/');
  const startPoint = `refs/remotes/origin/${sourceBranch}`;

  // Check if the branch already exists locally
  let branchExists = false;
  try {
    const { execSync } = require('child_process');
    execSync(`git rev-parse --verify refs/heads/${branchName}`, { cwd: barePath, encoding: 'utf8', stdio: 'pipe' });
    branchExists = true;
  } catch {}

  const cmd = branchExists
    ? `git worktree add ${wtPath} ${branchName}`
    : `git worktree add ${wtPath} -b ${branchName} ${startPoint}`;

  const proc = spawnPty(cmd, barePath);

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

  const proc = spawnPty(cmd, bareDir);

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
  const { execSync } = require('child_process');

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
  const proc = spawnPty(cmd, barePath);

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
  const proc = spawnPty(cmd, barePath);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('worktreeRemove:data', data);
    }
  });

  proc.onExit(({ exitCode }) => {
    try { fs.unlinkSync(scriptPath); } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('worktreeRemove:exit', { exitCode: 0, wtPath });
    }
  });

  return { proc };
}

function createWorktreeSwitchPty(mainWindow, { barePath, repoDir, oldWtPath, branchName, dirName, sourceBranch }) {
  const newWtPath = path.join(repoDir, dirName).replace(/\\/g, '/');
  const startPoint = `refs/remotes/origin/${sourceBranch}`;
  const isWin = process.platform === 'win32';
  const os = require('os');
  const scriptExt = isWin ? '.cmd' : '.sh';
  const scriptPath = path.join(os.tmpdir(), `codehive-wt-switch-${Date.now()}${scriptExt}`);

  const oldWtForGit = oldWtPath.replace(/\\/g, '/');
  const needsMove = oldWtForGit !== newWtPath;

  // 1) git -C <worktree> checkout -B <branch> <startPoint>  — switch branch in-place
  // 2) git worktree move <old> <new>                         — relocate directory (git-native, handles .git bookkeeping)
  const lines = [];
  if (isWin) {
    lines.push('@echo off');
    lines.push(`echo Switching branch to: ${branchName}`);
    lines.push(`git -C "${oldWtForGit}" checkout -B ${branchName} ${startPoint}`);
    lines.push('if errorlevel 1 (');
    lines.push('  echo.');
    lines.push('  echo === SWITCH FAILED ===');
    lines.push('  exit /b 1');
    lines.push(')');
    if (needsMove) {
      lines.push('echo.');
      lines.push(`echo Moving worktree: ${path.basename(oldWtPath)} -^> ${dirName}`);
      lines.push(`git worktree move "${oldWtForGit}" "${newWtPath}"`);
      lines.push('if errorlevel 1 (');
      lines.push('  echo.');
      lines.push('  echo === MOVE FAILED ===');
      lines.push('  exit /b 1');
      lines.push(')');
    }
    lines.push('echo.');
    lines.push('echo === SWITCH COMPLETE ===');
  } else {
    lines.push('#!/bin/sh');
    lines.push(`echo "Switching branch to: ${branchName}"`);
    lines.push(`git -C "${oldWtForGit}" checkout -B ${branchName} ${startPoint} || { echo ""; echo "=== SWITCH FAILED ==="; exit 1; }`);
    if (needsMove) {
      lines.push('echo ""');
      lines.push(`echo "Moving worktree: ${path.basename(oldWtPath)} -> ${dirName}"`);
      lines.push(`git worktree move "${oldWtForGit}" "${newWtPath}" || { echo ""; echo "=== MOVE FAILED ==="; exit 1; }`);
    }
    lines.push('echo ""');
    lines.push('echo "=== SWITCH COMPLETE ==="');
  }

  fs.writeFileSync(scriptPath, lines.join('\n'), { encoding: 'utf8' });

  const cmd = isWin ? scriptPath : `sh "${scriptPath}"`;
  const proc = spawnPty(cmd, barePath);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('worktreeSwitch:data', data);
    }
  });

  proc.onExit(({ exitCode }) => {
    try { fs.unlinkSync(scriptPath); } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('worktreeSwitch:exit', { exitCode, wtPath: newWtPath, branchName, dirName });
    }
  });

  return { proc, wtPath: newWtPath, branchName, dirName };
}

module.exports = { createWorktreePty, createClonePty, createDeletePty, createWorktreeRemovePty, createWorktreeSwitchPty };
