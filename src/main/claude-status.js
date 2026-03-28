const path = require('path');
const fs = require('fs');

/**
 * Read the last JSON line from a JSONL file without reading the entire file.
 * Reads only the final 4KB chunk for efficiency.
 */
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

/**
 * Check whether Claude Code is actively working on a worktree.
 * Inspects Claude's JSONL conversation files for the given path.
 *
 * Returns:
 *   null      — idle / no activity
 *   'working' — Claude is actively generating
 *   'waiting' — Claude proposed tool use and is waiting for user approval
 *   'error'   — last tool result was an error and Claude stopped
 */
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

module.exports = { checkClaudeActive };
