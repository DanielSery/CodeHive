const STORAGE_KEY = 'codehive-state';

export function getState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

export function saveSourceBranch(wtPath, sourceBranch) {
  const state = getState();
  if (!state.sourceBranches) state.sourceBranches = {};
  state.sourceBranches[wtPath.replace(/\\/g, '/')] = sourceBranch;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getSourceBranch(wtPath) {
  const state = getState();
  return (state.sourceBranches && state.sourceBranches[wtPath.replace(/\\/g, '/')]) || null;
}

export function saveTaskId(wtPath, taskId) {
  const state = getState();
  if (!state.taskIds) state.taskIds = {};
  state.taskIds[wtPath.replace(/\\/g, '/')] = taskId;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getTaskId(wtPath) {
  const state = getState();
  return (state.taskIds && state.taskIds[wtPath.replace(/\\/g, '/')]) || null;
}

export function saveBranchCache(repoName, branches) {
  const state = getState();
  if (!state.branchCache) state.branchCache = {};
  state.branchCache[repoName] = branches;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getCachedBranchesFromState(repoName) {
  const state = getState();
  return (state.branchCache && state.branchCache[repoName]) || [];
}

export function saveDirectories(dirPath) {
  const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  const dirs = state.directories || [];
  if (!dirs.includes(dirPath)) dirs.push(dirPath);
  state.directories = dirs;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetDirectories(dirPath) {
  const state = getState();
  state.directories = [dirPath];
  state.repoOrder = [];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export { STORAGE_KEY };
