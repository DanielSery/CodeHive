import { clearWorktreeStorage } from '../storage.js';
import { initWtState } from '../worktree-state.js';
import { _refreshTabStatus } from '../sidebar/registers.js';
import { toast } from '../toast.js';

const wtDisconnectDialogOverlay = document.getElementById('wt-disconnect-dialog-overlay');
const wtDisconnectDialogBranch = document.getElementById('wt-disconnect-dialog-branch');

let _disconnectTabEl = null;

export function showWorktreeDisconnectDialog(tabEl) {
  _disconnectTabEl = tabEl;
  wtDisconnectDialogBranch.textContent = tabEl._wtBranch;
  wtDisconnectDialogOverlay.classList.add('visible');
}

function hideWorktreeDisconnectDialog() {
  wtDisconnectDialogOverlay.classList.remove('visible');
  _disconnectTabEl = null;
}

async function confirmDisconnectWorktree() {
  if (!_disconnectTabEl) return;
  const tabEl = _disconnectTabEl;
  const wtPath = tabEl._wtPath;
  hideWorktreeDisconnectDialog();

  const result = await window.reposAPI.checkoutIdle(wtPath);
  if (!result.success) {
    toast.error(`Failed to checkout idle branch: ${result.error}`);
    return;
  }
  tabEl._wtBranch = result.branch;
  const labelEl = tabEl.querySelector('.workspace-tab-label');
  if (labelEl) labelEl.textContent = result.branch;
  if (tabEl._dotEl) tabEl._dotEl.title = result.branch;

  tabEl._wtTaskId = null;
  tabEl._wtSourceBranch = null;
  clearWorktreeStorage(wtPath);
  initWtState(wtPath);
  if (_refreshTabStatus) _refreshTabStatus(tabEl);
}

document.getElementById('wt-disconnect-cancel-btn').addEventListener('click', hideWorktreeDisconnectDialog);
document.getElementById('wt-disconnect-confirm-btn').addEventListener('click', confirmDisconnectWorktree);
document.addEventListener('keydown', (e) => {
  if (!wtDisconnectDialogOverlay.classList.contains('visible')) return;
  if (e.key === 'Enter') confirmDisconnectWorktree();
  else if (e.key === 'Escape') hideWorktreeDisconnectDialog();
});
