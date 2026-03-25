import { addRepoGroup, createWorktreeTab, registerWorktreeDialog, registerDeleteDialog, registerWorktreeRemoveDialog, removeRepoGroup, showTabCloseButton, showTabRemoveButton } from './sidebar.js';
import { showWorktreeDialog, showCloneDialog, showDeleteDialog, showWorktreeRemoveDialog, registerSidebarFns, registerRemoveRepoGroup } from './dialogs.js';
import { cycleWorkspace, registerTabButtonFns } from './workspace-manager.js';

// Wire cross-module dependencies (avoids circular imports)
registerWorktreeDialog(showWorktreeDialog);
registerDeleteDialog(showDeleteDialog);
registerWorktreeRemoveDialog(showWorktreeRemoveDialog);
registerTabButtonFns(showTabCloseButton, showTabRemoveButton);
registerSidebarFns(addRepoGroup, createWorktreeTab);
registerRemoveRepoGroup(removeRepoGroup);

// ===== Open Directory =====

async function openDirectory() {
  const dirPath = await window.reposAPI.openDirectoryDialog();
  if (!dirPath) return;

  const repos = await window.reposAPI.scanDirectory(dirPath);
  if (repos.length === 0) {
    alert('No repositories with a Bare subdirectory found in this directory.');
    return;
  }

  for (const repo of repos) {
    addRepoGroup(repo);
  }

  document.getElementById('btn-clone-repo').classList.add('visible');
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
