const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

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
  // Claude stores sessions in ~/.claude/projects/<encoded-path>/*.jsonl
  // While Claude is working, it writes to the session file continuously.
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

  // Return null — let the renderer decide based on its own state tracking
  return null;
}

module.exports = { scanDirectory, checkClaudeActive };
