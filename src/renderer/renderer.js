import { addRepoGroup, clearAllGroups, createWorktreeTab, rebuildCollapsedDots, registerWorktreeDialog, registerDeleteDialog, registerWorktreeRemoveDialog, registerWorktreeSwitchDialog, registerCommitPushDialog, registerCreatePrDialog, registerToggleTerminal, registerOnStateChange, removeRepoGroup, showTabCloseButton, showTabRemoveButton, getRepoOrder, getWorktreeOrders } from './sidebar/index.js';
import { showWorktreeDialog, showCloneDialog, showDeleteDialog, showWorktreeRemoveDialog, showWorktreeSwitchDialog, showCommitPushDialog, showCreatePrDialog, setCloneReposDir, registerSidebarFns, registerRemoveRepoGroup, registerOnCloneComplete } from './dialogs/index.js';
import { cycleWorkspace, registerTabButtonFns } from './workspace-manager.js';
import { getActive } from './state.js';
import { toggleTerminal, createTerminal, showTerminal, showCloseButton } from './terminal-panel.js';
import { getState, saveDirectories, resetDirectories, STORAGE_KEY } from './storage.js';
import { showPatDialog } from './dialogs/dialog-pat.js';
import { loadStoredPat } from './dialogs/utils.js';

// Wire cross-module dependencies (avoids circular imports)
registerWorktreeDialog(showWorktreeDialog);
registerDeleteDialog(showDeleteDialog);
registerWorktreeRemoveDialog(showWorktreeRemoveDialog);
registerWorktreeSwitchDialog(showWorktreeSwitchDialog);
registerCommitPushDialog(showCommitPushDialog);
registerCreatePrDialog(showCreatePrDialog);
registerToggleTerminal(toggleTerminal);
registerTabButtonFns(showTabCloseButton, showTabRemoveButton);
registerSidebarFns(addRepoGroup, createWorktreeTab, rebuildCollapsedDots);
registerRemoveRepoGroup(removeRepoGroup);
// ===== State Persistence =====

function saveState() {
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

registerOnStateChange(saveState);
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

document.getElementById('btn-titlebar-commit').addEventListener('click', () => {
  const ws = getActive();
  if (ws) showCommitPushDialog(ws.tabEl, ws.tabEl.closest('.repo-group'));
});
document.getElementById('btn-titlebar-pr').addEventListener('click', () => {
  const ws = getActive();
  if (ws) showCreatePrDialog(ws.tabEl, ws.tabEl.closest('.repo-group'));
});

// ===== Theme toggle =====

(function() {
  const btn = document.getElementById('btn-theme');
  const iconDark = document.getElementById('theme-icon-dark');
  const iconLight = document.getElementById('theme-icon-light');

  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      iconDark.style.display = 'none';
      iconLight.style.display = '';
    } else {
      document.documentElement.removeAttribute('data-theme');
      iconDark.style.display = '';
      iconLight.style.display = 'none';
    }
  }

  // Sync icon with already-applied theme (set by inline script in <head>)
  const stored = localStorage.getItem('codehive-theme');
  applyTheme(stored === 'light' ? 'light' : 'dark');

  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    localStorage.setItem('codehive-theme', next);
    applyTheme(next);
  });
})();

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

// ===== Startup status =====

const startupEl = document.getElementById('startup-status');
window.startupAPI.onStatus((msg) => {
  startupEl.textContent = msg || '';
});

// ===== AZ CLI check on startup =====

async function checkAndInstallAz() {
  const { installed } = await window.azInstallAPI.check();
  if (installed) return;

  showTerminal('Installing Azure CLI...');
  const xterm = createTerminal();

  window.azInstallAPI.onData((data) => { xterm.write(data); });
  window.azInstallAPI.onExit(({ exitCode }) => {
    if (exitCode === 0) {
      xterm.write('\r\n\x1b[32mAzure CLI installed successfully.\x1b[0m\r\n');
    } else {
      xterm.write(`\r\n\x1b[31mAzure CLI installation failed (exit code ${exitCode}).\x1b[0m\r\n`);
    }
    showCloseButton();
  });

  await window.azInstallAPI.start();
  window.azInstallAPI.ready();
}

// ===== Azure PAT button =====

const btnAzurePat = document.getElementById('btn-azure-pat');
if (loadStoredPat()) btnAzurePat.style.display = 'none';
btnAzurePat.addEventListener('click', showPatDialog);

// ===== Restore on startup =====

restoreState().then(() => checkAndInstallAz());
