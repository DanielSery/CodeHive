import { terminal, registerPtyApi } from '../terminal-panel.js';
import { toast } from '../toast.js';
import { runPty } from './pty-runner.js';

registerPtyApi(window.worktreeRemoveAPI);
import { saveDeleteBranchPref, getDeleteBranchPref, clearWorktreeStorage } from '../storage.js';
import { removeWtState } from '../worktree-state.js';

const wtRemoveDialogOverlay = document.getElementById('wt-remove-dialog-overlay');
const wtRemoveDialogPath = document.getElementById('wt-remove-dialog-path');
const wtRemoveDeleteBranchCheckbox = document.getElementById('wt-remove-delete-branch');

let _removeTabEl = null;
let _removeGroupEl = null;

export function showWorktreeRemoveDialog(tabEl, groupEl) {
  _removeTabEl = tabEl;
  _removeGroupEl = groupEl;
  wtRemoveDialogPath.textContent = tabEl._wtPath;
  wtRemoveDeleteBranchCheckbox.checked = getDeleteBranchPref('removeDeleteBranch');
  wtRemoveDialogOverlay.classList.add('visible');
}

function hideWorktreeRemoveDialog() {
  wtRemoveDialogOverlay.classList.remove('visible');
  _removeTabEl = null;
  _removeGroupEl = null;
}

async function confirmRemoveWorktree() {
  if (!_removeTabEl || !_removeGroupEl) return;
  const tabEl = _removeTabEl;
  const groupEl = _removeGroupEl;
  const wtPath = tabEl._wtPath;
  const branchLabel = tabEl._wtBranch;
  const deleteBranch = wtRemoveDeleteBranchCheckbox.checked;
  saveDeleteBranchPref('removeDeleteBranch', deleteBranch);
  hideWorktreeRemoveDialog();

  terminal.show(`Removing worktree: ${branchLabel}`);

  const disposeData = runPty(window.worktreeRemoveAPI, {
    successMsg: 'Worktree removed successfully',
    failMsg: 'Worktree removal failed',
    onSuccess: () => {
      terminal.setTitle('Worktree removed');
      clearWorktreeStorage(wtPath);
      removeWtState(wtPath);
      if (tabEl._dotEl) tabEl._dotEl.remove();
      tabEl.remove();
      setTimeout(() => terminal.close(), 1200);
    },
    onError: () => terminal.setTitle('Worktree removal failed'),
  });

  try {
    await window.worktreeRemoveAPI.start({
      barePath: groupEl._barePath,
      wtPath,
      branchName: branchLabel,
      deleteBranch
    });
    window.worktreeRemoveAPI.ready();
  } catch (err) {
    disposeData();
    terminal.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    terminal.setTitle('Worktree removal failed');
    toast.error('Worktree removal failed — see terminal');
    terminal.showCloseButton();
  }
}

document.getElementById('wt-remove-cancel-btn').addEventListener('click', hideWorktreeRemoveDialog);
document.getElementById('wt-remove-confirm-btn').addEventListener('click', confirmRemoveWorktree);
document.addEventListener('keydown', (e) => {
  if (!wtRemoveDialogOverlay.classList.contains('visible')) return;
  if (e.key === 'Enter') confirmRemoveWorktree();
  else if (e.key === 'Escape') hideWorktreeRemoveDialog();
});
