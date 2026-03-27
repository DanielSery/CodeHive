import { createTerminal, showTerminal, showCloseButton, setTitle, closeTerminal } from '../terminal-panel.js';

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

    folderRow.appendChild(arrow);
    folderRow.appendChild(cb);
    folderRow.appendChild(nameSpan);

    const childContainer = document.createElement('div');

    const updateCb = () => {
      const n = indices.filter(i => _commitFiles[i].checked).length;
      if (n === 0) { cb.checked = false; cb.indeterminate = false; }
      else if (n === indices.length) { cb.checked = true; cb.indeterminate = false; }
      else { cb.indeterminate = true; }
    };
    _folderUpdaters.push(updateCb);

    cb.addEventListener('change', () => {
      cb.indeterminate = false;
      for (const i of indices) {
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

    row.appendChild(cb);
    row.appendChild(nameSpan);
    row.appendChild(statSpan);
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

  const selectedFiles = _commitFiles.filter(f => f.checked).map(f => f.path);
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
      setTimeout(() => closeTerminal(), 1200);
    } else {
      xterm.writeln('');
      xterm.writeln(`\x1b[31mCommit & push failed with exit code ${exitCode}\x1b[0m`);
      setTitle('Commit & push failed');
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
