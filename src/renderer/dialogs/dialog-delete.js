import { terminal, registerPtyApi } from '../terminal-panel.js';
import { toast } from '../toast.js';
import { runPty } from './pty-runner.js';

registerPtyApi(window.deleteAPI);

const deleteDialogOverlay = document.getElementById('delete-dialog-overlay');
const deleteDialogPath = document.getElementById('delete-dialog-path');

let _deleteGroupEl = null;
let _removeRepoGroup = null;

export function registerRemoveRepoGroup(fn) {
  _removeRepoGroup = fn;
}

export function showDeleteDialog(groupEl) {
  _deleteGroupEl = groupEl;
  deleteDialogPath.textContent = groupEl._repoDir;
  deleteDialogOverlay.classList.add('visible');
}

function hideDeleteDialog() {
  deleteDialogOverlay.classList.remove('visible');
  _deleteGroupEl = null;
}

async function confirmDeleteRepo() {
  if (!_deleteGroupEl) return;
  const groupEl = _deleteGroupEl;
  const repoName = groupEl.dataset.repoName;
  hideDeleteDialog();

  terminal.show(`Deleting ${repoName}...`);

  window.deleteAPI.removeListeners();
  const disposeData = runPty(window.deleteAPI, {
    successMsg: 'Project deleted successfully',
    failMsg: 'Delete failed',
    onSuccess: () => {
      terminal.setTitle('Project deleted');
      if (_removeRepoGroup) _removeRepoGroup(groupEl);
      setTimeout(() => terminal.close(), 1200);
    },
    onError: () => terminal.setTitle(`Delete failed: ${repoName}`),
  });

  try {
    await window.deleteAPI.start(groupEl._repoDir);
    window.deleteAPI.ready();
  } catch (err) {
    disposeData();
    terminal.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    terminal.setTitle(`Delete failed: ${repoName}`);
    toast.error('Delete failed — see terminal');
    terminal.showCloseButton();
  }
}

document.getElementById('delete-cancel-btn').addEventListener('click', hideDeleteDialog);
document.getElementById('delete-confirm-btn').addEventListener('click', confirmDeleteRepo);
deleteDialogOverlay.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmDeleteRepo();
  else if (e.key === 'Escape') hideDeleteDialog();
});
