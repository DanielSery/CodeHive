const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const FALLBACK_SLOW = 15000;
const FALLBACK_FAST = 3000;
const DEBOUNCE_MS = 300;

// Active watchers keyed by wtPath
const watchers = new Map();

function getProjectDir(wtPath) {
  const normalized = wtPath.replace(/\\/g, '/');
  const encoded = normalized.replace(/^\//, '').replace(/[/:]/g, '-').replace(/\//g, '-');
  return path.join(
    process.env.USERPROFILE || process.env.HOME || '',
    '.claude', 'projects', encoded
  );
}

/**
 * Read the last JSON line from a JSONL file without reading the entire file.
 * Uses async I/O to avoid blocking the main process.
 */
async function readLastJsonlEntry(filePath, size) {
  let fd;
  try {
    fd = await fsp.open(filePath, 'r');
    const chunkSize = Math.min(4096, size);
    const buf = Buffer.alloc(chunkSize);
    await fd.read(buf, 0, chunkSize, size - chunkSize);
    await fd.close();
    fd = null;
    const lines = buf.toString('utf8').trim().split('\n');
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    if (fd) await fd.close().catch(() => {});
  }
  return null;
}

const VERY_RECENT_MS = 8000;
const RECENT_MS = 30000;

/**
 * Internal check that returns { status, recheckIn }.
 * recheckIn (ms) is set when an end_turn is masked by the isVeryRecent guard,
 * telling the watcher exactly when to re-check for the done transition.
 */
async function checkClaudeActiveInternal(wtPath) {
  const projectDir = getProjectDir(wtPath);

  try {
    const files = await fsp.readdir(projectDir);
    const now = Date.now();

    // Collect all JSONL files (main + subagents)
    const jsonlFiles = [];
    for (const file of files) {
      if (file.endsWith('.jsonl')) {
        jsonlFiles.push(path.join(projectDir, file));
      }
      const subDir = path.join(projectDir, file, 'subagents');
      try {
        const subs = await fsp.readdir(subDir);
        for (const sub of subs) {
          if (sub.endsWith('.jsonl')) jsonlFiles.push(path.join(subDir, sub));
        }
      } catch {}
    }

    // Stat all files in parallel
    const stats = await Promise.all(jsonlFiles.map(async (fp) => {
      try {
        const stat = await fsp.stat(fp);
        return { fp, mtimeMs: stat.mtimeMs, size: stat.size };
      } catch { return null; }
    }));

    let latestMtime = 0;
    let latestFile = null;
    let latestSize = 0;

    for (const s of stats) {
      if (s && s.mtimeMs > latestMtime) {
        latestMtime = s.mtimeMs;
        latestFile = s.fp;
        latestSize = s.size;
      }
    }

    if (!latestFile) return { status: null };

    const last = await readLastJsonlEntry(latestFile, latestSize);
    if (!last) return { status: null };

    const lastType = last.type;
    const stopReason = last.message && last.message.stop_reason;
    const age = now - latestMtime;
    const isRecent = age < RECENT_MS;
    const isVeryRecent = age < VERY_RECENT_MS;

    // Claude finished its turn — but if very recent, may still be between tool calls
    if (lastType === 'assistant' && stopReason === 'end_turn') {
      if (!isVeryRecent) return { status: null };
      // Still in the grace period — report working but tell caller exactly when to re-check
      return { status: 'working', recheckIn: VERY_RECENT_MS - age + 500 };
    }

    // Claude proposed tool use — if file is stale, it's waiting for user approval
    if (lastType === 'assistant' && stopReason === 'tool_use' && !isRecent) return { status: 'waiting' };

    // Tool result came back with an error and Claude stopped responding
    if (lastType === 'user' && !isRecent) {
      const content = last.message && last.message.content;
      if (Array.isArray(content)) {
        const hasError = content.some(c => c && c.type === 'tool_result' && c.is_error);
        if (hasError) return { status: 'error' };
      }
    }

    // File was modified recently — Claude is actively working
    if (isRecent) return { status: 'working' };

  } catch {}

  return { status: null };
}

/**
 * Check whether Claude Code is actively working on a worktree.
 * Fully async — does not block the main thread.
 *
 * Returns: null | 'working' | 'waiting' | 'error'
 */
async function checkClaudeActive(wtPath) {
  return (await checkClaudeActiveInternal(wtPath)).status;
}

/**
 * Start watching a worktree for Claude status changes.
 * Uses fs.watch for near-instant detection + adaptive fallback poll.
 * Calls onChange(wtPath, status) whenever the status changes.
 */
function watchClaude(wtPath, onChange) {
  if (watchers.has(wtPath)) return;

  const projectDir = getProjectDir(wtPath);
  const entry = { watcher: null, fallbackTimer: null, lastStatus: undefined, debounceTimer: null, recheckTimer: null };
  watchers.set(wtPath, entry);

  async function check() {
    const { status, recheckIn } = await checkClaudeActiveInternal(wtPath);
    if (status !== entry.lastStatus) {
      entry.lastStatus = status;
      onChange(wtPath, status);
      resetFallback();
    }
    // Schedule a precise re-check when an end_turn is masked by the isVeryRecent guard
    if (entry.recheckTimer) clearTimeout(entry.recheckTimer);
    if (recheckIn) {
      entry.recheckTimer = setTimeout(check, recheckIn);
    }
  }

  function debouncedCheck() {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.debounceTimer = setTimeout(check, DEBOUNCE_MS);
  }

  function resetFallback() {
    if (entry.fallbackTimer) clearInterval(entry.fallbackTimer);
    // Poll fast when Claude is active (need to detect end of activity),
    // slow when idle (just a safety net for missed fs.watch events)
    const interval = (entry.lastStatus === 'working') ? FALLBACK_FAST : FALLBACK_SLOW;
    entry.fallbackTimer = setInterval(check, interval);
  }

  function tryWatch() {
    if (entry.watcher) return;
    try {
      fs.accessSync(projectDir);
      entry.watcher = fs.watch(projectDir, { recursive: true }, debouncedCheck);
      entry.watcher.on('error', () => {
        if (entry.watcher) { entry.watcher.close(); entry.watcher = null; }
      });
    } catch {}
  }

  // Try to establish watcher (directory may not exist yet)
  tryWatch();

  // Initial check
  check();
  resetFallback();

  // If watcher couldn't be set up, periodically retry
  if (!entry.watcher) {
    entry._watchRetry = setInterval(() => {
      if (entry.watcher || !watchers.has(wtPath)) {
        clearInterval(entry._watchRetry);
        entry._watchRetry = null;
        return;
      }
      tryWatch();
    }, FALLBACK_SLOW);
  }
}

/**
 * Stop watching a worktree.
 */
function unwatchClaude(wtPath) {
  const entry = watchers.get(wtPath);
  if (!entry) return;
  if (entry.watcher) entry.watcher.close();
  if (entry.fallbackTimer) clearInterval(entry.fallbackTimer);
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  if (entry.recheckTimer) clearTimeout(entry.recheckTimer);
  if (entry._watchRetry) clearInterval(entry._watchRetry);
  watchers.delete(wtPath);
}

module.exports = { checkClaudeActive, watchClaude, unwatchClaude };
