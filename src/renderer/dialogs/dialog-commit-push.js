import { terminal, registerPtyApi } from '../terminal-panel.js';
import { toast } from '../toast.js';
import { _refreshTabStatus } from '../sidebar/registers.js';
import { runPty } from './pty-runner.js';
import { renderCommitFileList } from './commit-file-tree.js';

registerPtyApi(window.commitPushAPI);

const commitPushDialogOverlay = document.getElementById('commit-push-dialog-overlay');
const commitPushDialogBox = document.getElementById('commit-push-dialog-box');
const commitPushTitleInput = document.getElementById('commit-push-title-input');
const commitPushDescInput = document.getElementById('commit-push-desc-input');
const commitPushFileList = document.getElementById('commit-push-file-list');

const DIALOG_SIZE_KEY = 'commitPushDialogSize';

function saveDialogSize() {
  localStorage.setItem(DIALOG_SIZE_KEY, JSON.stringify({
    width: commitPushDialogBox.offsetWidth,
    height: commitPushDialogBox.offsetHeight,
  }));
}

function restoreDialogSize() {
  const saved = localStorage.getItem(DIALOG_SIZE_KEY);
  if (!saved) return;
  const { width, height } = JSON.parse(saved);
  commitPushDialogBox.style.width = `${width}px`;
  commitPushDialogBox.style.height = `${height}px`;
}

let _saveTimer = null;
const _resizeObserver = new ResizeObserver(() => {
  if (!commitPushDialogOverlay.classList.contains('visible')) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveDialogSize, 300);
});
_resizeObserver.observe(commitPushDialogBox);

let _commitPushTabEl = null;
let _fileTree = null;

export async function showCommitPushDialog(tabEl, _groupEl) {
  _commitPushTabEl = tabEl;
  commitPushTitleInput.value = '';
  commitPushDescInput.value = '';
  commitPushFileList.innerHTML = '<span class="commit-file-list-empty">Loading...</span>';
  restoreDialogSize();
  commitPushDialogOverlay.classList.add('visible');
  setTimeout(() => commitPushTitleInput.focus(), 50);

  const files = await window.reposAPI.gitDiffStat(tabEl._wtPath);
  _fileTree = renderCommitFileList(commitPushFileList, files, tabEl._wtPath);
}

function hideCommitPushDialog() {
  commitPushDialogOverlay.classList.remove('visible');
  _commitPushTabEl = null;
  _fileTree = null;
}

async function confirmCommitPush() {
  const title = commitPushTitleInput.value.trim();
  if (!title || !_commitPushTabEl) return;

  const selectedFiles = _fileTree?.getSelectedFiles() || [];
  if (selectedFiles.length === 0) return;

  const desc = commitPushDescInput.value.trim();
  const tabEl = _commitPushTabEl;
  const wtPath = tabEl._wtPath;
  const branch = tabEl._wtBranch;

  hideCommitPushDialog();

  terminal.show(`Commit & Push: ${branch}`);

  const disposeData = runPty(window.commitPushAPI, {
    successMsg: `Pushed ${branch} successfully`,
    failMsg: 'Commit & push failed',
    onSuccess: () => {
      terminal.setTitle('Commit & push complete');
      if (_refreshTabStatus) _refreshTabStatus(tabEl);
      setTimeout(() => terminal.close(), 1200);
    },
    onError: () => terminal.setTitle('Commit & push failed'),
  });

  try {
    await window.commitPushAPI.start({ wtPath, title, description: desc, branch, files: selectedFiles });
    window.commitPushAPI.ready();
  } catch (err) {
    disposeData();
    terminal.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    terminal.setTitle('Commit & push failed');
    terminal.showCloseButton();
  }
}

document.getElementById('commit-push-cancel-btn').addEventListener('click', hideCommitPushDialog);
document.getElementById('commit-push-confirm-btn').addEventListener('click', confirmCommitPush);

commitPushTitleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmCommitPush();
  if (e.key === 'Escape') hideCommitPushDialog();
});
commitPushDescInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideCommitPushDialog();
});
