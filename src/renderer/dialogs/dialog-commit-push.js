import { createTerminal, showTerminal, showCloseButton, setTitle, closeTerminal } from '../terminal-panel.js';

const commitPushDialogOverlay = document.getElementById('commit-push-dialog-overlay');
const commitPushTitleInput = document.getElementById('commit-push-title-input');
const commitPushDescInput = document.getElementById('commit-push-desc-input');
const commitPushFileList = document.getElementById('commit-push-file-list');

let _commitPushTabEl = null;
let _commitPushGroupEl = null;

function renderCommitFileList(files) {
  if (!files || files.length === 0) {
    commitPushFileList.innerHTML = '<span class="commit-file-list-empty">No changes detected</span>';
    return;
  }
  commitPushFileList.innerHTML = files.map(f => {
    const stat = f.isNew
      ? '<span class="commit-file-stat commit-file-new">new</span>'
      : `<span class="commit-file-stat commit-file-added">+${f.added}</span><span class="commit-file-stat commit-file-removed"> -${f.removed}</span>`;
    return `<div class="commit-file-row"><span class="commit-file-path" title="${f.path}">${f.path}</span>${stat}</div>`;
  }).join('');
}

export async function showCommitPushDialog(tabEl, groupEl) {
  _commitPushTabEl = tabEl;
  _commitPushGroupEl = groupEl;
  commitPushTitleInput.value = '';
  commitPushDescInput.value = '';
  commitPushFileList.innerHTML = '<span class="commit-file-list-empty">Loading...</span>';
  commitPushDialogOverlay.classList.add('visible');
  setTimeout(() => commitPushTitleInput.focus(), 50);

  const files = await window.reposAPI.gitDiffStat(tabEl._wtPath);
  renderCommitFileList(files);
}

function hideCommitPushDialog() {
  commitPushDialogOverlay.classList.remove('visible');
  _commitPushTabEl = null;
  _commitPushGroupEl = null;
}

async function confirmCommitPush() {
  const title = commitPushTitleInput.value.trim();
  if (!title || !_commitPushTabEl) return;

  const desc = commitPushDescInput.value.trim();
  const tabEl = _commitPushTabEl;
  const wtPath = tabEl._wtPath;
  const branch = tabEl._wtBranch;

  hideCommitPushDialog();

  showTerminal(`Commit & Push: ${branch}`);
  const xterm = createTerminal();

  window.commitPushAPI.removeListeners();
  window.commitPushAPI.onData((data) => {
    xterm.write(data);
  });

  window.commitPushAPI.onExit(({ exitCode }) => {
    if (exitCode === 0) {
      xterm.writeln('');
      xterm.writeln('\x1b[32mCommit & push completed successfully!\x1b[0m');
      setTitle('Commit & push complete');
      setTimeout(() => closeTerminal(), 1200);
    } else {
      xterm.writeln('');
      xterm.writeln(`\x1b[31mCommit & push failed with exit code ${exitCode}\x1b[0m`);
      setTitle('Commit & push failed');
      showCloseButton();
    }
  });

  try {
    await window.commitPushAPI.start({ wtPath, title, description: desc, branch });
    window.commitPushAPI.ready();
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle('Commit & push failed');
    showCloseButton();
  }
}

commitPushDialogOverlay.addEventListener('click', (e) => {
  if (e.target === commitPushDialogOverlay) hideCommitPushDialog();
});
document.getElementById('commit-push-cancel-btn').addEventListener('click', hideCommitPushDialog);
document.getElementById('commit-push-confirm-btn').addEventListener('click', confirmCommitPush);

commitPushTitleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmCommitPush();
  if (e.key === 'Escape') hideCommitPushDialog();
});
commitPushDescInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideCommitPushDialog();
});
