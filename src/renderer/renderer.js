import { addRepoGroup, clearAllGroups, createWorktreeTab, registerWorktreeDialog, registerDeleteDialog, registerWorktreeRemoveDialog, registerWorktreeSwitchDialog, registerOnStateChange, registerSidebarBranchCache, registerSourceBranchLookup, removeRepoGroup, showTabCloseButton, showTabRemoveButton, getRepoOrder } from './sidebar.js';
import { showWorktreeDialog, showCloneDialog, showDeleteDialog, showWorktreeRemoveDialog, showWorktreeSwitchDialog, setCloneReposDir, registerSidebarFns, registerRemoveRepoGroup, registerOnCloneComplete, registerBranchCache, registerSaveSourceBranch } from './dialogs.js';
import { cycleWorkspace, registerTabButtonFns } from './workspace-manager.js';

// Wire cross-module dependencies (avoids circular imports)
registerWorktreeDialog(showWorktreeDialog);
registerDeleteDialog(showDeleteDialog);
registerWorktreeRemoveDialog(showWorktreeRemoveDialog);
registerWorktreeSwitchDialog(showWorktreeSwitchDialog);
registerTabButtonFns(showTabCloseButton, showTabRemoveButton);
registerSidebarFns(addRepoGroup, createWorktreeTab);
registerRemoveRepoGroup(removeRepoGroup);

// ===== State Persistence =====

const STORAGE_KEY = 'codehive-state';

function getState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

function saveState() {
  const prev = getState();
  const state = {
    directories: prev.directories || [],
    repoOrder: getRepoOrder(),
    branchCache: prev.branchCache || {},
    sourceBranches: prev.sourceBranches || {}
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function saveSourceBranch(wtPath, sourceBranch) {
  const state = getState();
  if (!state.sourceBranches) state.sourceBranches = {};
  state.sourceBranches[wtPath.replace(/\\/g, '/')] = sourceBranch;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getSourceBranch(wtPath) {
  const state = getState();
  return (state.sourceBranches && state.sourceBranches[wtPath.replace(/\\/g, '/')]) || null;
}

function saveBranchCache(repoName, branches) {
  const state = getState();
  if (!state.branchCache) state.branchCache = {};
  state.branchCache[repoName] = branches;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getCachedBranchesFromState(repoName) {
  const state = getState();
  return (state.branchCache && state.branchCache[repoName]) || [];
}

function saveDirectories(dirPath) {
  const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  const dirs = state.directories || [];
  if (!dirs.includes(dirPath)) dirs.push(dirPath);
  state.directories = dirs;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function resetDirectories(dirPath) {
  const state = getState();
  state.directories = [dirPath];
  state.repoOrder = [];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

registerOnStateChange(saveState);
registerBranchCache(getCachedBranchesFromState, saveBranchCache);
registerSidebarBranchCache(getCachedBranchesFromState, saveBranchCache);
registerSourceBranchLookup(getSourceBranch);
registerSaveSourceBranch(saveSourceBranch);
registerOnCloneComplete((reposDir) => {
  saveDirectories(reposDir);
  saveState();
});


async function restoreState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  let state;
  try { state = JSON.parse(raw); } catch { return; }
  if (!state.directories || state.directories.length === 0) return;

  // Set clone directory to the first saved directory
  setCloneReposDir(state.directories[0]);

  // Scan all saved directories
  const allRepos = [];
  for (const dir of state.directories) {
    const repos = await window.reposAPI.scanDirectory(dir);
    for (const repo of repos) {
      if (!allRepos.find(r => r.name === repo.name)) {
        allRepos.push(repo);
      }
    }
  }

  document.getElementById('btn-clone-repo').classList.add('visible');

  if (allRepos.length === 0) return;

  // Sort repos by saved order
  if (state.repoOrder && state.repoOrder.length > 0) {
    const order = state.repoOrder;
    allRepos.sort((a, b) => {
      const ia = order.indexOf(a.name);
      const ib = order.indexOf(b.name);
      // Repos not in saved order go to the end
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  }

  for (const repo of allRepos) {
    addRepoGroup(repo);
  }

  document.getElementById('btn-clone-repo').classList.add('visible');

}

// ===== Open Directory =====

async function openDirectory() {
  const dirPath = await window.reposAPI.openDirectoryDialog();
  if (!dirPath) return;

  // Clear existing workspace and replace with new directory
  clearAllGroups();
  resetDirectories(dirPath);
  setCloneReposDir(dirPath);

  const repos = await window.reposAPI.scanDirectory(dirPath);
  for (const repo of repos) {
    addRepoGroup(repo);
  }

  document.getElementById('btn-clone-repo').classList.add('visible');
  saveState();
}

// ===== Event Listeners =====

document.getElementById('btn-open-directory').addEventListener('click', openDirectory);
document.getElementById('btn-clone-repo').addEventListener('click', showCloneDialog);

document.getElementById('btn-minimize').addEventListener('click', () => window.windowAPI.minimize());
document.getElementById('btn-maximize').addEventListener('click', () => window.windowAPI.maximize());
document.getElementById('btn-close').addEventListener('click', () => window.windowAPI.close());

// ===== Keyboard Shortcuts =====

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'o') { e.preventDefault(); openDirectory(); }
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    cycleWorkspace(!e.shiftKey);
  }
});

// Save state before window closes
window.addEventListener('beforeunload', saveState);

// ===== Restore on startup =====

restoreState();
