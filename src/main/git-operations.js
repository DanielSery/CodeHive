const path = require('path');
const fs = require('fs');
const { execSync, exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const { assertSafeRef, shellQuote } = require('./pty-scripts');

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

function gitFileDiff(wtPath, filePath, context = 3) {
  try {
    const ctx = Math.min(Math.max(0, parseInt(context, 10) || 3), 9999);
    const escaped = filePath.replace(/"/g, '\\"');
    const out = execSync(`git diff HEAD -U${ctx} -- "${escaped}"`, { cwd: wtPath, encoding: 'utf8', timeout: 5000 });
    return { ok: true, diff: out };
  } catch {
    return { ok: false, diff: '' };
  }
}

function gitBranchDiffStat(wtPath, targetBranch) {
  const result = [];
  try {
    assertSafeRef(targetBranch);
    const out = execSync(`git diff --numstat origin/${targetBranch}...HEAD`, { cwd: wtPath, encoding: 'utf8', timeout: 5000 });
    for (const line of out.trim().split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      result.push({ path: parts[2], added: parseInt(parts[0]) || 0, removed: parseInt(parts[1]) || 0, isNew: false });
    }
  } catch {}
  return result;
}

function gitBranchFileDiff(wtPath, filePath, targetBranch, context = 3) {
  try {
    assertSafeRef(targetBranch);
    const ctx = Math.min(Math.max(0, parseInt(context, 10) || 3), 9999);
    const escaped = filePath.replace(/"/g, '\\"');
    const out = execSync(`git diff origin/${targetBranch}...HEAD -U${ctx} -- "${escaped}"`, { cwd: wtPath, encoding: 'utf8', timeout: 5000 });
    return { ok: true, diff: out };
  } catch {
    return { ok: false, diff: '' };
  }
}

function gitRevertLines(wtPath, filePath, changes) {
  // changes: [{ newLineNum: 1-based, newCount, oldLines: string[] }]
  const abs = path.join(wtPath, filePath);
  try {
    const raw = fs.readFileSync(abs, 'utf8');
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const lines = raw.split(eol);
    // Apply in descending line order so earlier splices don't shift later indices
    const sorted = [...changes].sort((a, b) => b.newLineNum - a.newLineNum);
    for (const { newLineNum, newCount, oldLines } of sorted) {
      lines.splice(newLineNum - 1, newCount, ...oldLines);
    }
    fs.writeFileSync(abs, lines.join(eol), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
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

async function hasPushedCommits(wtPath, branch, sourceBranch) {
  try {
    assertSafeRef(branch);
    assertSafeRef(sourceBranch);
    const { stdout } = await execAsync(`git rev-list --count origin/${sourceBranch}..origin/${branch}`, {
      cwd: wtPath,
      encoding: 'utf8',
      timeout: 5000
    });
    return { value: parseInt(stdout.trim(), 10) > 0, error: false };
  } catch {
    // Source branch may not be fetched in this worktree — fall back to comparing
    // origin/branch against local HEAD (HEAD should be at or beyond the source tip after a fast-forward).
    try {
      assertSafeRef(branch);
      const { stdout } = await execAsync(`git rev-list --count HEAD..origin/${branch}`, { cwd: wtPath, encoding: 'utf8', timeout: 5000 });
      return { value: parseInt(stdout.trim(), 10) > 0, error: false };
    } catch (err) {
      return { value: false, error: true, message: err.message };
    }
  }
}

async function _resolveAheadBase(wtPath, branch, sourceBranch) {
  // Prefer origin/branch as the base — gives the exact ahead count vs remote.
  // If origin/branch doesn't exist yet (never pushed), fall back to origin/sourceBranch
  // so we only show commits introduced on this branch, not the whole repo history.
  try {
    await execAsync(`git rev-parse --verify refs/remotes/origin/${branch}`, { cwd: wtPath, encoding: 'utf8', timeout: 3000 });
    return { base: `refs/remotes/origin/${branch}`, remoteExists: true };
  } catch {}
  if (sourceBranch) {
    try {
      assertSafeRef(sourceBranch);
      await execAsync(`git rev-parse --verify refs/remotes/origin/${sourceBranch}`, { cwd: wtPath, encoding: 'utf8', timeout: 3000 });
      return { base: `refs/remotes/origin/${sourceBranch}`, remoteExists: false };
    } catch {}
  }
  return { base: null, remoteExists: false };
}

async function getSyncStatus(wtPath, branch, sourceBranch) {
  try {
    assertSafeRef(branch);

    // Pre-flight fetch: update remote-tracking refs before reading them.
    // Failures (offline, no remote) are swallowed — stale cached refs are fine.
    try {
      await execAsync(`git fetch origin ${shellQuote(branch)} --no-tags --quiet`,
        { cwd: wtPath, encoding: 'utf8', timeout: 8000 });
    } catch {}

    let uncommitted = false;
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd: wtPath, encoding: 'utf8', timeout: 5000 });
      uncommitted = stdout.trim().length > 0;
    } catch {}

    let localAhead = 0;
    let localBehind = 0;
    const { base, remoteExists } = await _resolveAheadBase(wtPath, branch, sourceBranch);

    if (base) {
      try {
        const { stdout: aOut } = await execAsync(`git rev-list --count ${base}..HEAD`, { cwd: wtPath, encoding: 'utf8', timeout: 5000 });
        localAhead = parseInt(aOut.trim(), 10) || 0;
      } catch {}
      // localBehind only makes sense when comparing against the actual remote branch
      if (remoteExists) {
        try {
          const { stdout: bOut } = await execAsync(`git rev-list --count HEAD..refs/remotes/origin/${branch}`, { cwd: wtPath, encoding: 'utf8', timeout: 5000 });
          localBehind = parseInt(bOut.trim(), 10) || 0;
        } catch {}
      }
    }
    // If base is null we have no remote at all — localAhead/localBehind stay 0 (clean)

    return { uncommitted, localAhead, localBehind, error: false };
  } catch (err) {
    return { uncommitted: false, localAhead: 0, localBehind: 0, error: true, message: err.message };
  }
}

function getCommitsAhead(wtPath, branch, sourceBranch) {
  try {
    assertSafeRef(branch);
    const { base } = _resolveAheadBase(wtPath, branch, sourceBranch);
    if (!base) return [];
    const out = execSync(`git log --format=%H%x09%s%x09%ai ${base}..HEAD`, { cwd: wtPath, encoding: 'utf8', timeout: 5000 });
    return out.trim().split('\n').filter(Boolean).map(line => {
      const parts = line.split('\t');
      return { hash: parts[0] ? parts[0].substring(0, 8) : '', message: parts[1] || '', date: parts[2] || '' };
    });
  } catch {
    return [];
  }
}

function getCommitsBehind(wtPath, branch) {
  try {
    assertSafeRef(branch);
    try {
      execSync(`git rev-parse --verify refs/remotes/origin/${branch}`, { cwd: wtPath, encoding: 'utf8', timeout: 3000, stdio: 'pipe' });
    } catch {
      return [];
    }
    const out = execSync(`git log --format=%H%x09%s%x09%ai HEAD..refs/remotes/origin/${branch}`, { cwd: wtPath, encoding: 'utf8', timeout: 5000 });
    return out.trim().split('\n').filter(Boolean).map(line => {
      const parts = line.split('\t');
      return { hash: parts[0] ? parts[0].substring(0, 8) : '', message: parts[1] || '', date: parts[2] || '' };
    });
  } catch {
    return [];
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

function getRebaseCommits(wtPath, sourceBranch) {
  try {
    assertSafeRef(sourceBranch);
    // Use origin/ first to match what buildRebaseScript uses (git rebase -i origin/branch).
    // This ensures the dialog shows the same commits that will actually be replayed.
    // Fall back to local branch if origin doesn't exist (local-only workflow).
    let ref = `origin/${sourceBranch}`;
    try {
      execSync(`git rev-parse --verify origin/${sourceBranch}`, { cwd: wtPath, encoding: 'utf8', timeout: 3000 });
    } catch {
      ref = sourceBranch;
    }
    // Use %x09 (tab) to separate hash from subject — avoids shell quoting issues with spaces
    const out = execSync(`git log --format=%H%x09%s --reverse ${ref}..HEAD`, {
      cwd: wtPath,
      encoding: 'utf8',
      timeout: 5000
    });
    const lines = out.trim().split('\n').filter(Boolean);
    return lines.map(line => {
      const tabIdx = line.indexOf('\t');
      return {
        hash: line.substring(0, tabIdx),
        message: line.substring(tabIdx + 1).trim()
      };
    });
  } catch {
    return [];
  }
}

function gitGetFileLines(wtPath, filePath, startLine, endLine) {
  try {
    const abs = path.join(wtPath, filePath);
    const raw = fs.readFileSync(abs, 'utf8');
    const lines = raw.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    const start = Math.max(0, (startLine || 1) - 1);
    const end = endLine != null ? Math.min(lines.length, endLine) : lines.length;
    return { ok: true, lines: lines.slice(start, end) };
  } catch (e) {
    return { ok: false, lines: [], error: e.message };
  }
}

/**
 * Get commits in sourceWtPath that are NOT in targetBranch.
 * Uses origin/ first to avoid stale local refs showing too many commits;
 * falls back to local branch for local-only workflows.
 */
function getCherryPickCommits(sourceWtPath, targetBranch) {
  try {
    assertSafeRef(targetBranch);
    // Try origin/ first; fall back to local branch if origin doesn't exist.
    let ref = `origin/${targetBranch}`;
    try {
      execSync(`git rev-parse --verify origin/${targetBranch}`, { cwd: sourceWtPath, encoding: 'utf8', timeout: 3000 });
    } catch {
      ref = targetBranch;
    }
    const out = execSync(`git log --format=%H%x09%s --reverse ${ref}..HEAD`, {
      cwd: sourceWtPath,
      encoding: 'utf8',
      timeout: 5000
    });
    const lines = out.trim().split('\n').filter(Boolean);
    return lines.map(line => {
      const tabIdx = line.indexOf('\t');
      return {
        hash: line.substring(0, tabIdx),
        message: line.substring(tabIdx + 1).trim()
      };
    });
  } catch {
    return [];
  }
}

module.exports = { getCachedBranches, fetchAndListBranches, getGitUser, getRemoteUrl, getLaunchConfigs, gitDiffStat, gitFileDiff, gitBranchDiffStat, gitBranchFileDiff, gitRevertLines, getFirstBranchCommit, hasUncommittedChanges, hasPushedCommits, gitRevertFile, getRebaseCommits, getCherryPickCommits, gitGetFileLines, getSyncStatus, getCommitsAhead, getCommitsBehind };
