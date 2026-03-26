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

export const AZURE_PAT_KEY = 'codehive-azure-pat';
export function loadStoredPat() { return localStorage.getItem(AZURE_PAT_KEY) || ''; }
export function saveStoredPat(pat) { if (pat) localStorage.setItem(AZURE_PAT_KEY, pat); }
