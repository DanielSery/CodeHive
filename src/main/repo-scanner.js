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
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const stat = fs.statSync(path.join(projectDir, file));
      if (now - stat.mtimeMs < 5000) return 'working';
    }
  } catch {}

  return null;
}

function listRemoteBranches(barePath) {
  return new Promise((resolve) => {
    try {
      const existing = execSync('git config remote.origin.fetch', { cwd: barePath, encoding: 'utf8' }).trim();
      if (!existing || existing.includes('"')) throw new Error('missing or malformed');
    } catch {
      try {
        execSync('git config remote.origin.fetch +refs/heads/*:refs/remotes/origin/*', { cwd: barePath, encoding: 'utf8' });
      } catch {}
    }

    exec('git fetch origin', { cwd: barePath, encoding: 'utf8', timeout: 60000 }, () => {
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

module.exports = { scanDirectory, checkClaudeActive, listRemoteBranches, getGitUser };
