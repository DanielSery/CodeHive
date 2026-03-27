export function inferWorkItemType(title) {
  return /bug|fix/i.test(title) ? 'Bug' : 'Story';
}

export function sanitizePathPart(s) {
  return s.replace(/[^a-zA-Z0-9\s-]/g, '');
}

export function nameToSlug(name) {
  return sanitizePathPart(name).trim().replace(/\s+/g, '-').substring(0, 15);
}

export function userToPrefix(fullName) {
  const parts = fullName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().split(/\s+/);
  if (parts.length === 0) return 'user';
  if (parts.length === 1) return parts[0];
  return parts[0][0] + parts[parts.length - 1];
}

export function nameToBranch(user, name) {
  return `${userToPrefix(user)}/${sanitizePathPart(name).trim().replace(/\s+/g, '-')}`;
}

export function truncateToWords(str, maxLen) {
  if (str.length <= maxLen) return str;
  const cut = str.substring(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > maxLen * 0.6 ? cut.substring(0, lastSpace) : cut;
}

const _normalize = s => s.toLowerCase().replace(/[_\-/.:\s]/g, '');

/**
 * Fuzzy match: checks if all characters of `query` appear in order in `text`,
 * ignoring separators (_-/. ) and case. e.g. "rel26" matches "release_26".
 */
export function fuzzyMatch(text, query) {
  if (!query) return true;
  return fuzzyScore(text, query) >= 0;
}

/**
 * Fuzzy score: returns a numeric score for how well `query` matches `text`.
 * Higher = better. Returns -1 if no match. Consecutive character runs are
 * rewarded quadratically, so "rel26" scores higher in "release_26" (runs: rel,26)
 * than in "release_24.0.6" (runs: rel, 2, 6).
 */
export function fuzzyScore(text, query) {
  if (!query) return 0;
  const t = _normalize(text);
  const q = _normalize(query);
  let ti = 0;
  let score = 0;
  let runLength = 1;
  let prevIdx = -2;
  let firstMatchPos = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx === -1) return -1;
    if (firstMatchPos === -1) firstMatchPos = idx;
    if (idx === prevIdx + 1) {
      runLength++;
    } else {
      score += runLength * runLength;
      runLength = 1;
    }
    prevIdx = idx;
    ti = idx + 1;
  }
  score += runLength * runLength;
  score -= firstMatchPos * 0.01;
  return score;
}

export const AZURE_PAT_KEY = 'codehive-azure-pat';
export function loadStoredPat() { return localStorage.getItem(AZURE_PAT_KEY) || ''; }
export function saveStoredPat(pat) { if (pat) localStorage.setItem(AZURE_PAT_KEY, pat); }

const _featureCache = {};
export function getCachedFeatures(barePath) { return _featureCache[barePath] || null; }
export function saveFeatureCache(barePath, features) { _featureCache[barePath] = features; }

const _taskCache = {};
export function getCachedTasks(barePath) { return _taskCache[barePath] || null; }
export function saveTaskCache(barePath, data) { _taskCache[barePath] = data; }
