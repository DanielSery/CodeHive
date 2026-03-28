import { createTerminal, showTerminal, showCloseButton, setTitle, closeTerminal } from '../terminal-panel.js';
import { toast } from '../toast.js';

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

  showTerminal(`Deleting ${repoName}...`);
  const xterm = createTerminal();


  window.deleteAPI.removeListeners();
  window.deleteAPI.onData((data) => {
    xterm.write(data);
  });

  window.deleteAPI.onExit(({ exitCode }) => {
    if (exitCode === 0) {
      xterm.writeln('');
      xterm.writeln('\x1b[32mProject deleted successfully!\x1b[0m');
      setTitle('Project deleted');
      if (_removeRepoGroup) _removeRepoGroup(groupEl);
      setTimeout(() => closeTerminal(), 1200);
    } else {
      xterm.writeln('');
      xterm.writeln(`\x1b[31mDelete failed with exit code ${exitCode}\x1b[0m`);
      setTitle(`Delete failed: ${repoName}`);
      toast.error('Delete failed — see terminal');
      showCloseButton();
    }
  });

  try {
    await window.deleteAPI.start(groupEl._repoDir);
    window.deleteAPI.ready();
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle(`Delete failed: ${repoName}`);
    toast.error('Delete failed — see terminal');
    showCloseButton();
  }
}

document.getElementById('delete-cancel-btn').addEventListener('click', hideDeleteDialog);
document.getElementById('delete-confirm-btn').addEventListener('click', confirmDeleteRepo);
