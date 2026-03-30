import { createTerminal, showTerminal, showCloseButton, setTitle, closeTerminal } from '../terminal-panel.js';
import { toast } from '../toast.js';
import { _refreshTabStatus } from '../sidebar/registers.js';

const commitPushDialogOverlay = document.getElementById('commit-push-dialog-overlay');
const commitPushTitleInput = document.getElementById('commit-push-title-input');
const commitPushDescInput = document.getElementById('commit-push-desc-input');
const commitPushFileList = document.getElementById('commit-push-file-list');

let _commitPushTabEl = null;
let _commitFiles = [];
let _folderUpdaters = [];

function buildFileTree(files) {
  const root = { children: new Map(), files: [] };
  for (let i = 0; i < files.length; i++) {
    const parts = files[i].path.replace(/\\/g, '/').split('/');
    const name = parts.pop();
    let node = root;
    for (const part of parts) {
      if (!node.children.has(part)) node.children.set(part, { children: new Map(), files: [] });
      node = node.children.get(part);
    }
    node.files.push({ idx: i, name });
  }
  return root;
}

function getAllIndices(node) {
  const out = node.files.map(f => f.idx);
  for (const child of node.children.values()) out.push(...getAllIndices(child));
  return out;
}

function renderTreeNode(container, node, depth) {
  const folders = [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const fileEntries = [...node.files].sort((a, b) => a.name.localeCompare(b.name));

  for (const [name, child] of folders) {
    const indices = getAllIndices(child);

    const folderRow = document.createElement('div');
    folderRow.className = 'commit-tree-folder';
    folderRow.style.paddingLeft = `${4 + depth * 14}px`;

    const arrow = document.createElement('span');
    arrow.className = 'commit-tree-arrow';
    arrow.textContent = '▾';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.className = 'commit-file-checkbox';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'commit-tree-folder-name';
    nameSpan.textContent = name + '/';

    const folderRevertBtn = document.createElement('button');
    folderRevertBtn.className = 'commit-file-revert';
    folderRevertBtn.title = 'Revert all changes in folder';
    folderRevertBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10l4-4M2 10l4 4"/><path d="M2 10h7a4 4 0 0 0 0-8H8"/></svg>';
    folderRevertBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const live = indices.filter(i => _commitFiles[i]);
      if (live.length === 0) return;
      for (const i of live) {
        const f = _commitFiles[i];
        const result = await window.reposAPI.gitRevertFile(_commitPushTabEl._wtPath, f.path, f.isNew);
        if (result.ok) {
          _commitFiles[i] = null;
          const fileRow = commitPushFileList.querySelector(`[data-file-idx="${i}"]`);
          if (fileRow) fileRow.closest('.commit-file-row').remove();
        }
      }
      _folderUpdaters.forEach(fn => fn());
      // Remove folder row + container if all files reverted
      if (indices.every(i => !_commitFiles[i])) {
        folderRow.remove();
        childContainer.remove();
      }
      // If no files left at all, show empty state
      if (_commitFiles.every(f => !f)) {
        commitPushFileList.innerHTML = '<span class="commit-file-list-empty">No changes detected</span>';
      }
    });

    folderRow.appendChild(arrow);
    folderRow.appendChild(cb);
    folderRow.appendChild(nameSpan);
    folderRow.appendChild(folderRevertBtn);

    const childContainer = document.createElement('div');

    const updateCb = () => {
      const live = indices.filter(i => _commitFiles[i]);
      if (live.length === 0) { cb.checked = false; cb.indeterminate = false; return; }
      const n = live.filter(i => _commitFiles[i].checked).length;
      if (n === 0) { cb.checked = false; cb.indeterminate = false; }
      else if (n === live.length) { cb.checked = true; cb.indeterminate = false; }
      else { cb.indeterminate = true; }
    };
    _folderUpdaters.push(updateCb);

    cb.addEventListener('change', () => {
      cb.indeterminate = false;
      for (const i of indices) {
        if (!_commitFiles[i]) continue;
        _commitFiles[i].checked = cb.checked;
        const fileCb = commitPushFileList.querySelector(`[data-file-idx="${i}"]`);
        if (fileCb) fileCb.checked = cb.checked;
      }
    });

    let collapsed = false;
    const toggleCollapse = () => {
      collapsed = !collapsed;
      childContainer.style.display = collapsed ? 'none' : '';
      arrow.textContent = collapsed ? '▸' : '▾';
    };
    arrow.addEventListener('click', (e) => { e.preventDefault(); toggleCollapse(); });
    nameSpan.addEventListener('click', toggleCollapse);

    renderTreeNode(childContainer, child, depth + 1);
    container.appendChild(folderRow);
    container.appendChild(childContainer);
  }

  for (const { idx, name } of fileEntries) {
    const f = _commitFiles[idx];
    const row = document.createElement('label');
    row.className = 'commit-file-row';
    row.style.paddingLeft = `${10 + depth * 14}px`;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.className = 'commit-file-checkbox';
    cb.dataset.fileIdx = idx;
    cb.addEventListener('change', () => {
      _commitFiles[idx].checked = cb.checked;
      _folderUpdaters.forEach(fn => fn());
    });

    const nameSpan = document.createElement('span');
    nameSpan.className = 'commit-file-path';
    nameSpan.title = f.path;
    nameSpan.textContent = name;

    const statSpan = document.createElement('span');
    if (f.isNew) {
      statSpan.innerHTML = '<span class="commit-file-stat commit-file-new">new</span>';
    } else {
      statSpan.innerHTML = `<span class="commit-file-stat commit-file-added">+${f.added}</span><span class="commit-file-stat commit-file-removed"> -${f.removed}</span>`;
    }

    const revertBtn = document.createElement('button');
    revertBtn.className = 'commit-file-revert';
    revertBtn.title = f.isNew ? 'Remove file' : 'Revert changes';
    revertBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10l4-4M2 10l4 4"/><path d="M2 10h7a4 4 0 0 0 0-8H8"/></svg>';
    revertBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const result = await window.reposAPI.gitRevertFile(_commitPushTabEl._wtPath, f.path, f.isNew);
      if (result.ok) {
        _commitFiles[idx] = null;
        row.remove();
        _folderUpdaters.forEach(fn => fn());
        // If no files left, show empty state
        const remaining = _commitFiles.filter(Boolean);
        if (remaining.length === 0) {
          commitPushFileList.innerHTML = '<span class="commit-file-list-empty">No changes detected</span>';
        }
      }
    });

    row.appendChild(cb);
    row.appendChild(nameSpan);
    row.appendChild(statSpan);
    row.appendChild(revertBtn);
    container.appendChild(row);
  }
}

function renderCommitFileList(files) {
  _commitFiles = (files || []).map(f => ({ ...f, checked: true }));
  _folderUpdaters = [];
  commitPushFileList.innerHTML = '';
  if (_commitFiles.length === 0) {
    commitPushFileList.innerHTML = '<span class="commit-file-list-empty">No changes detected</span>';
    return;
  }
  const tree = buildFileTree(_commitFiles);
  renderTreeNode(commitPushFileList, tree, 0);
}

export async function showCommitPushDialog(tabEl, _groupEl) {
  _commitPushTabEl = tabEl;
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
}

async function confirmCommitPush() {
  const title = commitPushTitleInput.value.trim();
  if (!title || !_commitPushTabEl) return;

  const selectedFiles = _commitFiles.filter(f => f && f.checked).map(f => f.path);
  if (selectedFiles.length === 0) return;

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
      toast.success(`Pushed ${branch} successfully`);
      if (_refreshTabStatus) _refreshTabStatus(tabEl);
      setTimeout(() => closeTerminal(), 1200);
    } else {
      xterm.writeln('');
      xterm.writeln(`\x1b[31mCommit & push failed with exit code ${exitCode}\x1b[0m`);
      setTitle('Commit & push failed');
      toast.error('Commit & push failed — see terminal for details');
      showCloseButton();
    }
  });

  try {
    await window.commitPushAPI.start({ wtPath, title, description: desc, branch, files: selectedFiles });
    window.commitPushAPI.ready();
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle('Commit & push failed');
    showCloseButton();
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
