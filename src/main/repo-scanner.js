const path = require('path');
const fs = require('fs');
const { execSync, exec } = require('child_process');

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

function readLastJsonlEntry(filePath, size) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const chunkSize = Math.min(4096, size);
    const buf = Buffer.alloc(chunkSize);
    fs.readSync(fd, buf, 0, chunkSize, size - chunkSize);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').trim().split('\n');
    return JSON.parse(lines[lines.length - 1]);
  } catch {}
  return null;
}

function checkClaudeActive(wtPath) {
  const normalized = wtPath.replace(/\\/g, '/');
  const encoded = normalized.replace(/^\//, '').replace(/[/:]/g, '-').replace(/\//g, '-');
  const projectDir = path.join(
    process.env.USERPROFILE || process.env.HOME || '',
    '.claude', 'projects', encoded
  );

  try {
    const files = fs.readdirSync(projectDir);
    const now = Date.now();

    // Collect all JSONL files (main + subagents)
    const jsonlFiles = [];
    for (const file of files) {
      if (file.endsWith('.jsonl')) {
        jsonlFiles.push(path.join(projectDir, file));
      }
      // Check subagent directories
      const subDir = path.join(projectDir, file, 'subagents');
      try {
        const subs = fs.readdirSync(subDir);
        for (const sub of subs) {
          if (sub.endsWith('.jsonl')) jsonlFiles.push(path.join(subDir, sub));
        }
      } catch {}
    }

    let latestMtime = 0;
    let latestFile = null;
    let latestSize = 0;

    for (const filePath of jsonlFiles) {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latestFile = filePath;
        latestSize = stat.size;
      }
    }

    if (!latestFile) return null;

    const last = readLastJsonlEntry(latestFile, latestSize);
    if (!last) return null;

    const lastType = last.type;
    const stopReason = last.message && last.message.stop_reason;
    const isRecent = now - latestMtime < 30000;
    const isVeryRecent = now - latestMtime < 8000;

    // Claude finished its turn — but if very recent, may still be between tool calls
    if (lastType === 'assistant' && stopReason === 'end_turn' && !isVeryRecent) return null;

    // Claude proposed tool use — if file is stale, it's waiting for user approval
    if (lastType === 'assistant' && stopReason === 'tool_use' && !isRecent) return 'waiting';

    // Tool result came back with an error and Claude stopped responding
    if (lastType === 'user' && !isRecent) {
      const content = last.message && last.message.content;
      if (Array.isArray(content)) {
        const hasError = content.some(c => c && c.type === 'tool_result' && c.is_error);
        if (hasError) return 'error';
      }
    }

    // File was modified recently — Claude is actively working
    if (isRecent) return 'working';

  } catch {}

  return null;
}

function getCachedBranches(barePath) {
  try {
    const stdout = execSync('git branch -r', { cwd: barePath, encoding: 'utf8', timeout: 10000 });
    if (!stdout) return [];
    return stdout.trim().split('\n')
      .map(b => b.trim())
      .filter(b => b && !b.includes('->'))
      .map(b => b.replace(/^origin\//, ''));
  } catch {
    return [];
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

    exec('git fetch --progress origin', { cwd: barePath, encoding: 'utf8', timeout: 60000 }, () => {
      exec('git branch -r', { cwd: barePath, encoding: 'utf8', timeout: 10000 }, (err, stdout) => {
        if (err || !stdout) { resolve([]); return; }
        const branches = stdout.trim().split('\n')
          .map(b => b.trim())
          .filter(b => b && !b.includes('->'))
          .map(b => b.replace(/^origin\//, ''));
        resolve(branches);
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

function getFirstBranchCommit(wtPath, sourceBranch) {
  try {
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
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function hasPushedCommits(wtPath, branch, sourceBranch) {
  try {
    const out = execSync(`git rev-list --count origin/${sourceBranch}..origin/${branch}`, {
      cwd: wtPath,
      encoding: 'utf8',
      timeout: 5000
    });
    return parseInt(out.trim(), 10) > 0;
  } catch {
    return false;
  }
}

module.exports = { scanDirectory, checkClaudeActive, getCachedBranches, fetchAndListBranches, getGitUser, getRemoteUrl, getLaunchConfigs, gitDiffStat, getFirstBranchCommit, hasUncommittedChanges, hasPushedCommits };
