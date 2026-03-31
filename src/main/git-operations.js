const path = require('path');
const fs = require('fs');
const { execSync, exec } = require('child_process');
const { assertSafeRef } = require('./pty-scripts');

function getCachedBranches(barePath) {
  try {
    const stdout = execSync('git branch -r', { cwd: barePath, encoding: 'utf8', timeout: 10000 });
    if (!stdout) return { value: [], error: false };
    const value = stdout.trim().split('\n')
      .map(b => b.trim())
      .filter(b => b && !b.includes('->'))
      .map(b => b.replace(/^origin\//, ''));
    return { value, error: false };
  } catch (err) {
    return { value: [], error: true, message: err.message };
  }
}

function fetchAndListBranches(barePath) {
  return new Promise((resolve) => {
    try {
      const existing = execSync('git config remote.origin.fetch', { cwd: barePath, encoding: 'utf8' }).trim();
      if (!existing || existing.includes('"')) throw new Error('missing or malformed');
    } catch {
      try {
        execSync('git config remote.origin.fetch +refs/heads/*:refs/remotes/origin/*', { cwd: barePath, encoding: 'utf8' });
      } catch {}
    }

    exec('git fetch --progress origin', { cwd: barePath, encoding: 'utf8', timeout: 60000 }, (fetchErr) => {
      exec('git branch -r', { cwd: barePath, encoding: 'utf8', timeout: 10000 }, (err, stdout) => {
        if (err || !stdout) { resolve({ value: [], error: true, message: (fetchErr || err || new Error('no output')).message }); return; }
        const branches = stdout.trim().split('\n')
          .map(b => b.trim())
          .filter(b => b && !b.includes('->'))
          .map(b => b.replace(/^origin\//, ''));
        resolve({ value: branches, error: false });
      });
    });
  });
}

function getGitUser(barePath) {
  try {
    return execSync('git config user.name', {
      cwd: barePath,
      encoding: 'utf8',
      timeout: 5000
    }).trim();
  } catch {
    return '';
  }
}

function getRemoteUrl(barePath) {
  try {
    return execSync('git remote get-url origin', {
      cwd: barePath,
      encoding: 'utf8',
      timeout: 5000
    }).trim();
  } catch {
    return null;
  }
}

function getLaunchConfigs(wtPath) {
  try {
    const launchPath = path.join(wtPath, '.vscode', 'launch.json');
    const raw = fs.readFileSync(launchPath, 'utf8');
    // Strip JSONC comments before parsing
    const stripped = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const parsed = JSON.parse(stripped);
    return (parsed.configurations || []).map(c => ({ name: c.name, type: c.type || '' }));
  } catch {
    return [];
  }
}

function gitDiffStat(wtPath) {
  const result = [];
  const seen = new Set();

  try {
    const diffOut = execSync('git diff --numstat HEAD', { cwd: wtPath, encoding: 'utf8', timeout: 5000 });
    for (const line of diffOut.trim().split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const filePath = parts[2];
      result.push({ path: filePath, added: parseInt(parts[0]) || 0, removed: parseInt(parts[1]) || 0, isNew: false });
      seen.add(filePath);
    }
  } catch {}

  try {
    const statusOut = execSync('git status --porcelain', { cwd: wtPath, encoding: 'utf8', timeout: 5000 });
    for (const line of statusOut.trim().split('\n').filter(Boolean)) {
      if (line.startsWith('?? ')) {
        const filePath = line.substring(3).trim();
        if (!seen.has(filePath)) {
          result.push({ path: filePath, added: null, removed: null, isNew: true });
        }
      }
    }
  } catch {}

  return result;
}

function gitFileDiff(wtPath, filePath) {
  try {
    const escaped = filePath.replace(/"/g, '\\"');
    const out = execSync(`git diff HEAD -- "${escaped}"`, { cwd: wtPath, encoding: 'utf8', timeout: 5000 });
    return { ok: true, diff: out };
  } catch {
    return { ok: false, diff: '' };
  }
}

function getFirstBranchCommit(wtPath, sourceBranch) {
  try {
    assertSafeRef(sourceBranch);
    const out = execSync(`git log --format=%s --reverse origin/${sourceBranch}..HEAD`, {
      cwd: wtPath,
      encoding: 'utf8',
      timeout: 5000
    });
    return out.trim().split('\n')[0].trim() || null;
  } catch {
    return null;
  }
}

function hasUncommittedChanges(wtPath) {
  try {
    const out = execSync('git status --porcelain', { cwd: wtPath, encoding: 'utf8', timeout: 5000 });
    return { value: out.trim().length > 0, error: false };
  } catch (err) {
    return { value: false, error: true, message: err.message };
  }
}

function hasPushedCommits(wtPath, branch, sourceBranch) {
  try {
    assertSafeRef(branch);
    assertSafeRef(sourceBranch);
    const out = execSync(`git rev-list --count origin/${sourceBranch}..origin/${branch}`, {
      cwd: wtPath,
      encoding: 'utf8',
      timeout: 5000,
      stdio: 'pipe'
    });
    return { value: parseInt(out.trim(), 10) > 0, error: false };
  } catch {
    // Source branch may not be fetched in this worktree — fall back to checking
    // whether the feature branch itself exists on origin.
    try {
      assertSafeRef(branch);
      execSync(`git rev-parse --verify origin/${branch}`, { cwd: wtPath, encoding: 'utf8', timeout: 5000, stdio: 'pipe' });
      return { value: true, error: false };
    } catch (err) {
      return { value: false, error: true, message: err.message };
    }
  }
}

function gitRevertFile(wtPath, filePath, isNew) {
  if (isNew) {
    const abs = path.join(wtPath, filePath);
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) fs.rmSync(abs, { recursive: true, force: true });
      else fs.unlinkSync(abs);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  } else {
    try {
      const escaped = filePath.replace(/"/g, '\\"');
      execSync(`git checkout HEAD -- "${escaped}"`, { cwd: wtPath, encoding: 'utf8', timeout: 5000 });
      // If the path is a submodule, also update it to match the checked-out pointer
      try {
        execSync(`git submodule update --init -- "${escaped}"`, { cwd: wtPath, encoding: 'utf8', timeout: 15000 });
      } catch {}
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }
}

module.exports = { getCachedBranches, fetchAndListBranches, getGitUser, getRemoteUrl, getLaunchConfigs, gitDiffStat, gitFileDiff, getFirstBranchCommit, hasUncommittedChanges, hasPushedCommits, gitRevertFile };
