import { getState, saveDirectories, resetDirectories, STORAGE_KEY } from './storage.js';
import { getRepoOrder, getWorktreeOrders, addRepoGroup } from './sidebar/index.js';
import { setCloneReposDir } from './dialogs/index.js';

const noDirEl = document.getElementById('placeholder-no-dir');
const hasDirEl = document.getElementById('placeholder-has-dir');
const hasReposEl = document.getElementById('placeholder-has-repos');
const dirPathEl = document.getElementById('placeholder-dir-path');

function setActivePlaceholder(panel) {
  noDirEl.style.display = panel === 'no-dir' ? '' : 'none';
  hasDirEl.style.display = panel === 'has-dir' ? '' : 'none';
  hasReposEl.style.display = panel === 'has-repos' ? '' : 'none';
}

export function showPlaceholder() {
  const repoGroups = document.getElementById('repo-groups');
  if (repoGroups && repoGroups.children.length > 0) {
    setActivePlaceholder('has-repos');
  } else if (dirPathEl.textContent) {
    setActivePlaceholder('has-dir');
  } else {
    setActivePlaceholder('no-dir');
  }
}

export function saveState() {
  const prev = getState();
  const state = {
    directories: prev.directories || [],
    repoOrder: getRepoOrder(),
    worktreeOrders: getWorktreeOrders(),
    branchCache: prev.branchCache || {},
    sourceBranches: prev.sourceBranches || {},
    taskIds: prev.taskIds || {},
    prefs: prev.prefs || {},
    pipelineInstalled: prev.pipelineInstalled || {},
    newTasksCache: prev.newTasksCache || {}
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export async function restoreState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  let state;
  try { state = JSON.parse(raw); } catch { return; }
  if (!state.directories || state.directories.length === 0) return;

  setCloneReposDir(state.directories[0]);
  dirPathEl.textContent = state.directories[0];
  setActivePlaceholder('has-dir');

  const allRepos = [];
  for (const dir of state.directories) {
    const repos = await window.reposAPI.scanDirectory(dir);
    for (const repo of repos) {
      if (!allRepos.find(r => r.name === repo.name)) {
        allRepos.push(repo);
      }
    }
  }

  if (allRepos.length === 0) return;

  if (state.repoOrder && state.repoOrder.length > 0) {
    const order = state.repoOrder;
    allRepos.sort((a, b) => {
      const ia = order.indexOf(a.name);
      const ib = order.indexOf(b.name);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  }

  for (const repo of allRepos) {
    if (state.worktreeOrders && state.worktreeOrders[repo.name]) {
      const order = state.worktreeOrders[repo.name];
      repo.worktrees.sort((a, b) => {
        const ia = order.indexOf(a.path.replace(/\\/g, '/'));
        const ib = order.indexOf(b.path.replace(/\\/g, '/'));
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      });
    }
    addRepoGroup(repo);
  }
  setActivePlaceholder('has-repos');
}

export function onOpenDirectory(clearAllGroups) {
  return async function openDirectory() {
    const dirPath = await window.reposAPI.openDirectoryDialog();
    if (!dirPath) return;

    clearAllGroups();
    resetDirectories(dirPath);
    setCloneReposDir(dirPath);
    dirPathEl.textContent = dirPath;
    setActivePlaceholder('has-dir');

    const repos = await window.reposAPI.scanDirectory(dirPath);
    for (const repo of repos) {
      addRepoGroup(repo);
    }
    if (repos.length > 0) {
      setActivePlaceholder('has-repos');
    }

    saveState();
  };
}
