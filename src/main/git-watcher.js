const fs = require('fs');

const DEBOUNCE_MS = 500;

// Active watchers keyed by wtPath
const watchers = new Map();

function watchGit(wtPath, onChange) {
  if (watchers.has(wtPath)) return;

  const entry = { watcher: null, debounceTimer: null };
  watchers.set(wtPath, entry);

  const debouncedChange = () => {
    clearTimeout(entry.debounceTimer);
    entry.debounceTimer = setTimeout(() => onChange(wtPath), DEBOUNCE_MS);
  };

  try {
    entry.watcher = fs.watch(wtPath, { recursive: true }, (eventType, filename) => {
      if (filename && filename.replace(/\\/g, '/').startsWith('.git/')) return;
      debouncedChange();
    });
    entry.watcher.on('error', () => {
      if (entry.watcher) { entry.watcher.close(); entry.watcher = null; }
    });
  } catch {
    watchers.delete(wtPath);
  }
}

function unwatchGit(wtPath) {
  const entry = watchers.get(wtPath);
  if (!entry) return;
  clearTimeout(entry.debounceTimer);
  if (entry.watcher) entry.watcher.close();
  watchers.delete(wtPath);
}

module.exports = { watchGit, unwatchGit };
