import { addRepoGroup, clearAllGroups, createWorktreeTab, rebuildCollapsedDots, registerWorktreeDialog, registerDeleteDialog, registerWorktreeRemoveDialog, registerWorktreeSwitchDialog, registerCommitPushDialog, registerCreatePrDialog, registerSetTaskDialog, registerToggleTerminal, registerOnStateChange, registerRefreshTabStatus, removeRepoGroup, showTabCloseButton, showTabRemoveButton, refreshTabStatus } from './sidebar/index.js';
import './titlebar-icons.js';
import { showWorktreeDialog, showCloneDialog, showDeleteDialog, showWorktreeRemoveDialog, showWorktreeSwitchDialog, showCommitPushDialog, showCreatePrDialog, showSetTaskDialog, registerSidebarFns, registerRemoveRepoGroup, registerOnCloneComplete } from './dialogs/index.js';

import { cycleWorkspace, registerTabButtonFns } from './workspace-manager.js';
import { getActive } from './state.js';
import { getWtState } from './worktree-state.js';
import { toggleTerminal } from './terminal-panel.js';
import { pr } from './pr-service.js';
import { pipeline } from './pipeline-service.js';
import { saveDirectories } from './storage.js';
import { saveState, restoreState, onOpenDirectory } from './app-state-service.js';
import { checkAndInstallAz, initPatButton } from './az-service.js';
import { showUpdateDialog } from './dialogs/dialog-update.js';
import { toast } from './toast.js';

// Wire cross-module dependencies (avoids circular imports)
registerWorktreeDialog(showWorktreeDialog);
registerDeleteDialog(showDeleteDialog);
registerWorktreeRemoveDialog(showWorktreeRemoveDialog);
registerWorktreeSwitchDialog(showWorktreeSwitchDialog);
registerCommitPushDialog(showCommitPushDialog);
registerCreatePrDialog(showCreatePrDialog);
registerSetTaskDialog(showSetTaskDialog);
registerToggleTerminal(toggleTerminal);
registerRefreshTabStatus(refreshTabStatus);
registerTabButtonFns(showTabCloseButton, showTabRemoveButton);
registerSidebarFns(addRepoGroup, createWorktreeTab, rebuildCollapsedDots);
registerRemoveRepoGroup(removeRepoGroup);
// ===== State Persistence =====

registerOnStateChange(saveState);
registerOnCloneComplete((reposDir) => {
  saveDirectories(reposDir);
  saveState();
});

// ===== Event Listeners =====

const openDirectory = onOpenDirectory(clearAllGroups);
document.getElementById('btn-open-directory').addEventListener('click', openDirectory);
document.getElementById('btn-clone-repo').addEventListener('click', showCloneDialog);


document.getElementById('btn-titlebar-open-explorer').addEventListener('click', () => {
  const ws = getActive();
  if (ws) window.shellAPI.openInExplorer(ws.tabEl._wtPath);
});
document.getElementById('btn-titlebar-commit').addEventListener('click', () => {
  const ws = getActive();
  if (ws) showCommitPushDialog(ws.tabEl, ws.tabEl.closest('.repo-group'));
});
document.getElementById('btn-titlebar-create-pr').addEventListener('click', () => {
  const ws = getActive();
  if (ws) showCreatePrDialog(ws.tabEl, ws.tabEl.closest('.repo-group'));
});
document.getElementById('btn-titlebar-open-pr').addEventListener('click', () => {
  const ws = getActive();
  if (ws) pr.open(ws.tabEl);
});
document.getElementById('btn-titlebar-complete-pr').addEventListener('click', () => {
  const ws = getActive();
  if (ws) {
    const btn = ws.tabEl.querySelector('.workspace-tab-complete-pr');
    if (btn) btn.click();
  }
});
document.getElementById('btn-titlebar-resolve-task').addEventListener('click', () => {
  const ws = getActive();
  if (ws) {
    const btn = ws.tabEl.querySelector('.workspace-tab-resolve-task');
    if (btn) btn.click();
  }
});
document.getElementById('btn-titlebar-open-pipeline').addEventListener('click', () => {
  const ws = getActive();
  if (ws) pipeline.open(ws.tabEl);
});
document.getElementById('btn-titlebar-open-task').addEventListener('click', () => {
  const ws = getActive();
  if (ws) { const taskUrl = getWtState(ws.tabEl._wtPath)?.taskUrl; if (taskUrl) window.shellAPI.openExternal(taskUrl); }
});
document.getElementById('btn-titlebar-git-app').addEventListener('click', () => {
  const ws = getActive();
  if (ws) window.shellAPI.openInGitApp(ws.tabEl._wtPath).then(result => {
    if (!result || !result.app) toast.error('No Git app found (Fork, SourceTree, GitKraken, Git Bash)');
  });
});
document.getElementById('btn-titlebar-switch').addEventListener('click', () => {
  const ws = getActive();
  if (ws) showWorktreeSwitchDialog(ws.tabEl, ws.tabEl.closest('.repo-group'));
});
document.getElementById('btn-titlebar-install').addEventListener('click', () => {
  const ws = getActive();
  if (ws) {
    const btn = ws.tabEl.querySelector('.workspace-tab-install-btn');
    if (btn) btn.click();
  }
});
document.getElementById('btn-titlebar-set-task').addEventListener('click', () => {
  const ws = getActive();
  if (ws) showSetTaskDialog(ws.tabEl);
});
document.getElementById('btn-titlebar-open-merged-pr').addEventListener('click', () => {
  const ws = getActive();
  if (ws) pr.openMerged(ws.tabEl);
});
document.getElementById('btn-titlebar-remove').addEventListener('click', () => {
  const ws = getActive();
  if (ws) showWorktreeRemoveDialog(ws.tabEl, ws.tabEl.closest('.repo-group'));
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

function isDialogOpen() {
  return !!document.querySelector('.dialog-overlay.visible');
}

document.addEventListener('keydown', (e) => {
  if (isDialogOpen()) return;
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

// ===== Azure PAT button =====

initPatButton();

// ===== Check for Updates / Publish Update button =====

updaterAPI.isPackaged().then(isPackaged => {
  const updateButton = document.getElementById('btn-check-updates');
  if (isPackaged) {
    updateButton.addEventListener('click', () => showUpdateDialog(false));
  } else {
    updateButton.title = 'Publish Update';
    updateButton.addEventListener('click', () => updaterAPI.publish());
  }
});

// ===== Restore on startup =====

restoreState().then(() => {
  checkAndInstallAz();
});
