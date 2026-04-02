import { renderFileDiff } from './commit-diff-viewer.js';

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

function renderTreeNode(container, node, depth, files, folderUpdaters, wtPath, allEntries, getDiffMode) {
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
      const live = indices.filter(i => files[i]);
      if (live.length === 0) return;
      for (const i of live) {
        const f = files[i];
        const result = await window.reposAPI.gitRevertFile(wtPath, f.path, f.isNew);
        if (result.ok) {
          files[i] = null;
          const fileRow = container.querySelector(`[data-file-idx="${i}"]`);
          if (fileRow) fileRow.closest('.commit-file-row').remove();
        }
      }
      folderUpdaters.forEach(fn => fn());
      if (indices.every(i => !files[i])) {
        folderRow.remove();
        childContainer.remove();
      }
      if (files.every(f => !f)) {
        container.innerHTML = '<span class="commit-file-list-empty">No changes detected</span>';
      }
    });

    folderRow.appendChild(arrow);
    folderRow.appendChild(cb);
    folderRow.appendChild(nameSpan);
    folderRow.appendChild(folderRevertBtn);

    const childContainer = document.createElement('div');

    const updateCb = () => {
      const live = indices.filter(i => files[i]);
      if (live.length === 0) { cb.checked = false; cb.indeterminate = false; return; }
      const n = live.filter(i => files[i].checked).length;
      if (n === 0) { cb.checked = false; cb.indeterminate = false; }
      else if (n === live.length) { cb.checked = true; cb.indeterminate = false; }
      else { cb.indeterminate = true; }
    };
    folderUpdaters.push(updateCb);

    cb.addEventListener('change', () => {
      cb.indeterminate = false;
      for (const i of indices) {
        if (!files[i]) continue;
        files[i].checked = cb.checked;
        const fileCb = container.querySelector(`[data-file-idx="${i}"]`);
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

    renderTreeNode(childContainer, child, depth + 1, files, folderUpdaters, wtPath, allEntries, getDiffMode);
    container.appendChild(folderRow);
    container.appendChild(childContainer);
  }

  for (const { idx, name } of fileEntries) {
    const f = files[idx];
    const row = document.createElement('label');
    row.className = 'commit-file-row';
    row.style.paddingLeft = `${10 + depth * 14}px`;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.className = 'commit-file-checkbox';
    cb.dataset.fileIdx = idx;
    cb.addEventListener('change', () => {
      files[idx].checked = cb.checked;
      folderUpdaters.forEach(fn => fn());
    });

    const nameSpan = document.createElement('span');
    nameSpan.className = 'commit-file-path commit-file-path-diffable';
    nameSpan.title = 'Click to view diff';
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
      const result = await window.reposAPI.gitRevertFile(wtPath, f.path, f.isNew);
      if (result.ok) {
        files[idx] = null;
        row.remove();
        diffPanel.remove();
        folderUpdaters.forEach(fn => fn());
        if (files.every(f => !f)) {
          container.innerHTML = '<span class="commit-file-list-empty">No changes detected</span>';
        }
      }
    });

    row.appendChild(cb);
    row.appendChild(nameSpan);
    row.appendChild(statSpan);
    row.appendChild(revertBtn);
    container.appendChild(row);

    const diffPanel = document.createElement('div');
    diffPanel.className = 'commit-diff-panel';
    diffPanel.style.display = 'none';
    container.appendChild(diffPanel);

    const loadDiff = async () => {
      diffPanel.innerHTML = '<div class="commit-diff-empty">Loading…</div>';
      const result = await window.reposAPI.gitFileDiff(wtPath, f.path, 3);
      renderFileDiff(diffPanel, result.ok ? result.diff : '', {
        mode: getDiffMode(),
        onRevertLines: async (changes) => {
          const r = await window.reposAPI.gitRevertLines(wtPath, f.path, changes);
          if (r.ok) loadDiff();
        },
        onExpandGap: async (startLine, endLine) => {
          const r = await window.reposAPI.gitGetFileLines(wtPath, f.path, startLine, endLine);
          return r.ok ? r.lines : [];
        }
      });
    };

    allEntries.push({ diffPanel, loadDiff, nameSpan, f });

    nameSpan.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (diffPanel.style.display !== 'none') {
        diffPanel.style.display = 'none';
        nameSpan.classList.remove('commit-file-path-expanded');
        return;
      }
      nameSpan.classList.add('commit-file-path-expanded');
      diffPanel.style.display = 'block';
      if (!diffPanel._loaded) {
        diffPanel._loaded = true;
        if (f.isNew) {
          diffPanel.innerHTML = '<div class="commit-diff-empty">New untracked file — no diff available</div>';
        } else {
          await loadDiff();
        }
      }
    });
  }
}

/**
 * Renders the commit file list into `container`.
 * Returns { getSelectedFiles } to read which files are checked.
 */
export function renderCommitFileList(container, rawFiles, wtPath, { toolbar } = {}) {
  const files = (rawFiles || []).map(f => ({ ...f, checked: true }));
  const folderUpdaters = [];

  let expandAll = localStorage.getItem('diffExpandAll') === 'true';
  let diffMode = localStorage.getItem('diffViewMode') || 'split';

  const allEntries = [];
  const getDiffMode = () => diffMode;

  container.innerHTML = '';
  if (files.length === 0) {
    container.innerHTML = '<span class="commit-file-list-empty">No changes detected</span>';
    if (toolbar) toolbar.innerHTML = '';
    return { getSelectedFiles: () => [] };
  }

  const tree = buildFileTree(files);
  renderTreeNode(container, tree, 0, files, folderUpdaters, wtPath, allEntries, getDiffMode);

  function openEntry(entry) {
    const { diffPanel, loadDiff, nameSpan, f } = entry;
    diffPanel.style.display = 'block';
    nameSpan.classList.add('commit-file-path-expanded');
    if (!diffPanel._loaded) {
      diffPanel._loaded = true;
      if (f.isNew) {
        diffPanel.innerHTML = '<div class="commit-diff-empty">New untracked file — no diff available</div>';
      } else {
        loadDiff();
      }
    }
  }

  function closeEntry(entry) {
    entry.diffPanel.style.display = 'none';
    entry.nameSpan.classList.remove('commit-file-path-expanded');
  }

  if (toolbar) {
    toolbar.innerHTML = '';

    const expandBtn = document.createElement('button');
    expandBtn.className = 'commit-diff-ctrl-btn' + (expandAll ? ' active' : '');
    expandBtn.textContent = expandAll ? 'Collapse All' : 'Expand All';
    expandBtn.addEventListener('click', () => {
      expandAll = !expandAll;
      localStorage.setItem('diffExpandAll', expandAll);
      expandBtn.textContent = expandAll ? 'Collapse All' : 'Expand All';
      expandBtn.classList.toggle('active', expandAll);
      for (const entry of allEntries) {
        if (expandAll) openEntry(entry); else closeEntry(entry);
      }
    });

    const modeBtn = document.createElement('button');
    modeBtn.className = 'commit-diff-ctrl-btn' + (diffMode === 'inline' ? ' active' : '');
    modeBtn.textContent = diffMode === 'inline' ? 'Inline' : 'Split';
    modeBtn.title = 'Toggle between split and inline diff view';
    modeBtn.addEventListener('click', () => {
      diffMode = diffMode === 'split' ? 'inline' : 'split';
      localStorage.setItem('diffViewMode', diffMode);
      modeBtn.textContent = diffMode === 'inline' ? 'Inline' : 'Split';
      modeBtn.classList.toggle('active', diffMode === 'inline');
      for (const entry of allEntries) {
        if (entry.diffPanel._loaded && !entry.f.isNew) entry.loadDiff();
      }
    });

    toolbar.appendChild(expandBtn);
    toolbar.appendChild(modeBtn);
  }

  if (expandAll) {
    for (const entry of allEntries) openEntry(entry);
  }

  return {
    getSelectedFiles: () => files.filter(f => f && f.checked).map(f => f.path),
  };
}
