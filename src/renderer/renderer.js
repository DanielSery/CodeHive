import { addRepoGroup, createWorktreeTab, registerWorktreeDialog, registerDeleteDialog, registerWorktreeRemoveDialog, registerWorktreeSwitchDialog, registerOnStateChange, removeRepoGroup, showTabCloseButton, showTabRemoveButton, getRepoOrder, getOpenWorktreePaths } from './sidebar.js';
import { showWorktreeDialog, showCloneDialog, showDeleteDialog, showWorktreeRemoveDialog, showWorktreeSwitchDialog, registerSidebarFns, registerRemoveRepoGroup, registerOnCloneComplete } from './dialogs.js';
import { cycleWorkspace, openWorktree, registerTabButtonFns } from './workspace-manager.js';

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

function saveState() {
  const state = {
    directories: JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').directories || [],
    repoOrder: getRepoOrder(),
    openWorktrees: getOpenWorktreePaths()
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function saveDirectories(dirPath) {
  const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  const dirs = state.directories || [];
  if (!dirs.includes(dirPath)) dirs.push(dirPath);
  state.directories = dirs;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

registerOnStateChange(saveState);
registerOnCloneComplete((reposDir) => {
  saveDirectories(reposDir);
  saveState();
});

// Save when workspaces are opened/closed (poll every 2s for simplicity)
let _lastOpenPaths = '';
setInterval(() => {
  const current = JSON.stringify(getOpenWorktreePaths());
  if (current !== _lastOpenPaths) {
    _lastOpenPaths = current;
    saveState();
  }
}, 2000);

async function restoreState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  let state;
  try { state = JSON.parse(raw); } catch { return; }
  if (!state.directories || state.directories.length === 0) return;

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

  // Re-open workspaces
  if (state.openWorktrees && state.openWorktrees.length > 0) {
    const openSet = new Set(state.openWorktrees.map(p => p.replace(/\\/g, '/')));
    const tabs = document.querySelectorAll('.workspace-tab');
    for (const tab of tabs) {
      const normalized = tab._wtPath.replace(/\\/g, '/');
      if (openSet.has(normalized)) {
        const wt = { path: tab._wtPath, branch: tab._wtBranch, name: tab._wtPath.split(/[\\/]/).pop() };
        await openWorktree(tab, wt);
      }
    }
  }
}

// ===== Open Directory =====

async function openDirectory() {
  const dirPath = await window.reposAPI.openDirectoryDialog();
  if (!dirPath) return;

  const repos = await window.reposAPI.scanDirectory(dirPath);
  if (repos.length === 0) {
    alert('No repositories with a Bare subdirectory found in this directory.');
    return;
  }

  saveDirectories(dirPath);

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
