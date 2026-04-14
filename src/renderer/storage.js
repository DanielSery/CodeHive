const STORAGE_KEY = 'codehive-state';

export function normalizePath(p) { return p.replace(/\\/g, '/'); }

export function getState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

export function saveSourceBranch(wtPath, sourceBranch) {
  const state = getState();
  if (!state.sourceBranches) state.sourceBranches = {};
  state.sourceBranches[normalizePath(wtPath)] = sourceBranch;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getSourceBranch(wtPath) {
  const state = getState();
  return (state.sourceBranches && state.sourceBranches[normalizePath(wtPath)]) || null;
}

export function saveTaskId(wtPath, taskId) {
  const state = getState();
  if (!state.taskIds) state.taskIds = {};
  state.taskIds[normalizePath(wtPath)] = taskId;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getTaskId(wtPath) {
  const state = getState();
  return (state.taskIds && state.taskIds[normalizePath(wtPath)]) || null;
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

export function saveDeleteBranchPref(key, value) {
  const state = getState();
  if (!state.prefs) state.prefs = {};
  state.prefs[key] = value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getDeleteBranchPref(key) {
  const state = getState();
  return !!(state.prefs && state.prefs[key]);
}

export function getCheckUpdatesOnStartup() {
  const state = getState();
  return state.prefs?.checkUpdatesOnStartup !== false;
}

export function saveCheckUpdatesOnStartup(value) {
  const state = getState();
  if (!state.prefs) state.prefs = {};
  state.prefs.checkUpdatesOnStartup = value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function saveTaskResolved(wtPath, resolved) {
  const state = getState();
  if (!state.taskResolved) state.taskResolved = {};
  const key = normalizePath(wtPath);
  if (resolved) {
    state.taskResolved[key] = true;
  } else {
    delete state.taskResolved[key];
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  console.log('[storage] saveTaskResolved', key, resolved);
}

export function getTaskResolved(wtPath) {
  const state = getState();
  const result = !!(state.taskResolved && state.taskResolved[normalizePath(wtPath)]);
  console.log('[storage] getTaskResolved', normalizePath(wtPath), result);
  return result;
}

export function savePipelineInstalled(wtPath, installed) {
  const state = getState();
  if (!state.pipelineInstalled) state.pipelineInstalled = {};
  const key = normalizePath(wtPath);
  if (installed) {
    state.pipelineInstalled[key] = true;
  } else {
    delete state.pipelineInstalled[key];
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getPipelineInstalled(wtPath) {
  const state = getState();
  return !!(state.pipelineInstalled && state.pipelineInstalled[normalizePath(wtPath)]);
}


export function saveSelectedSolution(wtPath, slnPath) {
  const state = getState();
  if (!state.selectedSolution) state.selectedSolution = {};
  state.selectedSolution[normalizePath(wtPath)] = slnPath;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getSelectedSolution(wtPath) {
  const state = getState();
  return (state.selectedSolution && state.selectedSolution[normalizePath(wtPath)]) || null;
}

export function clearWorktreeStorage(wtPath) {
  const state = getState();
  const key = normalizePath(wtPath);
  if (state.sourceBranches) delete state.sourceBranches[key];
  if (state.taskIds) delete state.taskIds[key];
  if (state.taskResolved) delete state.taskResolved[key];
  if (state.pipelineInstalled) delete state.pipelineInstalled[key];
  if (state.selectedSolution) delete state.selectedSolution[key];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export { STORAGE_KEY };
