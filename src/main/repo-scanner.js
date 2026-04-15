const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// Re-export from focused modules for backward compatibility with ipc-handlers.js
const { checkClaudeActive } = require('./claude-status');
const { getCachedBranches, fetchAndListBranches, getGitUser, getRemoteUrl, getLaunchConfigs, gitDiffStat, gitFileDiff, gitBranchDiffStat, gitBranchFileDiff, gitRevertLines, getFirstBranchCommit, hasUncommittedChanges, hasPushedCommits, gitRevertFile, getRebaseCommits, getCherryPickCommits, gitGetFileLines, getSyncStatus, getCommitsAhead, getCommitsBehind, checkoutIdle } = require('./git-operations');

function createPackagesJunction(wtPath, barePath) {
  const packagesSource = path.join(barePath, 'Packages');
  fs.mkdirSync(packagesSource, { recursive: true });

  const junctionTarget = path.join(wtPath, 'Packages');
  const jWin = junctionTarget.replace(/\//g, '\\');
  const sWin = packagesSource.replace(/\//g, '\\');

  let lstat;
  try { lstat = fs.lstatSync(junctionTarget); } catch {}

  if (lstat) {
    if (lstat.isSymbolicLink()) {
      // Junction exists — skip if already pointing at Bare\Packages
      try {
        const current = path.normalize(fs.readlinkSync(junctionTarget));
        const expected = path.normalize(packagesSource);
        if (current.toLowerCase() === expected.toLowerCase()) return;
      } catch {}
      // Wrong target — remove junction only (no /s so contents are untouched)
      try {
        if (process.platform === 'win32') execSync(`cmd /c rmdir "${jWin}"`, { stdio: 'pipe' });
        else fs.unlinkSync(junctionTarget);
      } catch (e) {
        console.error('[CodeHive] Failed to remove wrong Packages junction:', e.message);
        return;
      }
    } else {
      // Real directory — migrate each entry to Bare\Packages then remove the dir
      try {
        for (const entry of fs.readdirSync(junctionTarget)) {
          const src = path.join(junctionTarget, entry);
          const dst = path.join(packagesSource, entry);
          try { fs.lstatSync(dst); } catch { fs.renameSync(src, dst); }
        }
        if (process.platform === 'win32') execSync(`cmd /c rd /s /q "${jWin}"`, { stdio: 'pipe' });
        else fs.rmSync(junctionTarget, { recursive: true, force: true });
      } catch (e) {
        console.error('[CodeHive] Failed to migrate Packages directory:', e.message);
        return;
      }
    }
  }

  try {
    if (process.platform === 'win32') execSync(`cmd /c mklink /J "${jWin}" "${sWin}"`, { stdio: 'pipe' });
    else fs.symlinkSync(packagesSource, junctionTarget, 'dir');
    console.log(`[CodeHive] Created Packages junction: ${junctionTarget} -> ${packagesSource}`);
  } catch (e) {
    console.error('[CodeHive] Failed to create Packages junction:', e.message);
  }
}

function scanDirectory(dirPath) {
  const repos = [];
  let children;
  try {
    children = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return repos;
  }

  for (const child of children) {
    if (!child.isDirectory()) continue;
    const childPath = path.join(dirPath, child.name);
    const barePath = path.join(childPath, 'Bare');

    let bareStat;
    try { bareStat = fs.statSync(barePath); } catch { continue; }
    if (!bareStat.isDirectory()) continue;

    const worktrees = listWorktrees(barePath);
    for (const wt of worktrees) createPackagesJunction(wt.path, barePath);
    repos.push({ name: child.name, barePath, worktrees });
  }

  return repos;
}

function listWorktrees(barePath) {
  const worktrees = [];
  try {
    // Prune stale worktree entries (deleted directories)
    try { execSync('git worktree prune', { cwd: barePath, timeout: 5000 }); } catch {}

    const output = execSync('git worktree list --porcelain', {
      cwd: barePath,
      encoding: 'utf8',
      timeout: 10000
    });

    const blocks = output.trim().split('\n\n');
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      const wtLine = lines.find(l => l.startsWith('worktree '));
      const branchLine = lines.find(l => l.startsWith('branch '));
      const isBare = lines.some(l => l.trim() === 'bare');
      if (!wtLine || isBare) continue;

      const wtPath = wtLine.substring('worktree '.length).trim();

      // Skip worktrees whose directories no longer exist
      try { if (!fs.statSync(wtPath).isDirectory()) continue; } catch { continue; }

      const branch = branchLine
        ? branchLine.substring('branch '.length).replace('refs/heads/', '')
        : path.basename(wtPath);

      worktrees.push({ path: wtPath, branch, name: path.basename(wtPath) });
    }
  } catch (err) {
    console.warn(`Failed to list worktrees for ${barePath}:`, err.message);
  }
  return worktrees;
}

module.exports = { scanDirectory, createPackagesJunction, checkClaudeActive, getCachedBranches, fetchAndListBranches, getGitUser, getRemoteUrl, getLaunchConfigs, gitDiffStat, gitFileDiff, gitBranchDiffStat, gitBranchFileDiff, gitRevertLines, getFirstBranchCommit, hasUncommittedChanges, hasPushedCommits, gitRevertFile, getRebaseCommits, getCherryPickCommits, gitGetFileLines, getSyncStatus, getCommitsAhead, getCommitsBehind, checkoutIdle };
