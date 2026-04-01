import { getState, saveDirectories, resetDirectories, STORAGE_KEY } from './storage.js';
import { getRepoOrder, getWorktreeOrders, addRepoGroup } from './sidebar/index.js';
import { setCloneReposDir } from './dialogs/index.js';

export function saveState() {
  const prev = getState();
  const state = {
    directories: prev.directories || [],
    repoOrder: getRepoOrder(),
    worktreeOrders: getWorktreeOrders(),
    branchCache: prev.branchCache || {},
    sourceBranches: prev.sourceBranches || {},
    taskIds: prev.taskIds || {}
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
}

export function onOpenDirectory(clearAllGroups) {
  return async function openDirectory() {
    const dirPath = await window.reposAPI.openDirectoryDialog();
    if (!dirPath) return;

    clearAllGroups();
    resetDirectories(dirPath);
    setCloneReposDir(dirPath);

    const repos = await window.reposAPI.scanDirectory(dirPath);
    for (const repo of repos) {
      addRepoGroup(repo);
    }

    saveState();
  };
}
