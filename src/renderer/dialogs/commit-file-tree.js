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


function renderTreeNode(treeContainer, diffArea, rowRefs, node, depth, files, wtPath, allEntries, { showRevert, onLoadDiff, onClearDiffCache, notifyChange }, folderPath = '') {
  const folders = [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const fileEntries = [...node.files].sort((a, b) => a.name.localeCompare(b.name));

  for (const [name, child] of folders) {
    const displayName = name;
    const effectiveChild = child;

    const indices = getAllIndices(effectiveChild);

    const folderRow = document.createElement('div');
    folderRow.className = 'commit-tree-folder';
    folderRow.style.paddingLeft = `${4 + depth * 10}px`;

    const arrow = document.createElement('span');
    arrow.className = 'commit-tree-arrow';
    arrow.textContent = '▾';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'commit-tree-folder-name';
    nameSpan.textContent = displayName;

    folderRow.appendChild(arrow);
    folderRow.appendChild(nameSpan);

    if (showRevert) {
      const folderRevertBtn = document.createElement('button');
      folderRevertBtn.className = 'commit-file-revert-btn';
      folderRevertBtn.title = 'Revert all changes in folder';
      folderRevertBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10l4-4M2 10l4 4"/><path d="M2 10h7a4 4 0 0 0 0-8H8"/></svg>';
      folderRevertBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const live = indices.filter(i => files[i]);
        if (live.length === 0) return;
        for (const i of live) {
          const folderFile = files[i];
          const result = await window.reposAPI.gitRevertFile(wtPath, folderFile.path, folderFile.isNew);
          if (result.ok) {
            files[i] = null;
            const refs = rowRefs.get(i);
            if (refs) { refs.treeRow.remove(); refs.diffSection.remove(); }
          }
        }
        if (indices.every(i => !files[i])) { folderRow.remove(); childContainer.remove(); }
        if (files.every(folderFile => !folderFile)) {
          treeContainer.innerHTML = '<span class="commit-file-list-empty">No changes detected</span>';
          diffArea.innerHTML = '';
        }
        notifyChange();
      });
      folderRow.appendChild(folderRevertBtn);
    }

    const fullPath = folderPath + displayName + '/';
    const collapseKey = `codehive:folder-collapse:${wtPath}:${fullPath}`;
    let folderCollapsed = localStorage.getItem(collapseKey) === '1';
    const childContainer = document.createElement('div');
    if (folderCollapsed) { childContainer.style.display = 'none'; arrow.textContent = '▸'; }
    const toggleCollapse = () => {
      folderCollapsed = !folderCollapsed;
      childContainer.style.display = folderCollapsed ? 'none' : '';
      arrow.textContent = folderCollapsed ? '▸' : '▾';
      if (folderCollapsed) localStorage.setItem(collapseKey, '1');
      else localStorage.removeItem(collapseKey);
    };
    arrow.addEventListener('click', (e) => { e.preventDefault(); toggleCollapse(); });
    nameSpan.addEventListener('click', toggleCollapse);

    renderTreeNode(childContainer, diffArea, rowRefs, effectiveChild, depth + 1, files, wtPath, allEntries, { showRevert, onLoadDiff, onClearDiffCache, notifyChange }, fullPath);
    treeContainer.appendChild(folderRow);
    treeContainer.appendChild(childContainer);
  }

  for (const { idx, name } of fileEntries) {
    const f = files[idx];
    const filePath = f.path.replace(/\\/g, '/');

    // --- Tree row ---
    const row = document.createElement('label');
    row.className = 'commit-file-row';
    row.style.paddingLeft = `${18 + depth * 10}px`;

    const fileInfo = document.createElement('div');
    fileInfo.className = 'commit-file-info';

    const statusDot = document.createElement('span');
    statusDot.className = 'commit-file-status-dot' + (f.isNew ? ' commit-file-status-dot--new' : ' commit-file-status-dot--modified');
    fileInfo.appendChild(statusDot);

    const fileNameSpan = document.createElement('span');
    fileNameSpan.className = 'commit-file-name';
    fileNameSpan.textContent = name;
    fileInfo.appendChild(fileNameSpan);

    const statSpan = null;

    row.appendChild(fileInfo);

    if (showRevert) {
      const fileRevertBtn = document.createElement('button');
      fileRevertBtn.className = 'commit-file-revert-btn';
      fileRevertBtn.title = f.isNew ? 'Remove file' : 'Revert changes';
      fileRevertBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10l4-4M2 10l4 4"/><path d="M2 10h7a4 4 0 0 0 0-8H8"/></svg>';
      fileRevertBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const result = await window.reposAPI.gitRevertFile(wtPath, f.path, f.isNew);
        if (result.ok) {
          files[idx] = null;
          const refs = rowRefs.get(idx);
          if (refs) { refs.treeRow.remove(); refs.diffSection.remove(); }
          if (files.every(file => !file)) {
            treeContainer.innerHTML = '<span class="commit-file-list-empty">No changes detected</span>';
            diffArea.innerHTML = '';
          }
          notifyChange();
        }
      });
      row.appendChild(fileRevertBtn);
    }

    treeContainer.appendChild(row);

    // --- Diff section in right panel ---
    const diffSection = document.createElement('div');
    diffSection.className = 'commit-diff-section';

    const diffHeader = document.createElement('div');
    diffHeader.className = 'commit-diff-section-header';

    const diffTitle = document.createElement('div');
    diffTitle.className = 'commit-diff-section-title';

    const diffFilename = document.createElement('span');
    diffFilename.className = 'commit-diff-section-filename';
    diffFilename.textContent = name;

    const diffFilepath = document.createElement('span');
    diffFilepath.className = 'commit-diff-section-filepath';
    diffFilepath.textContent = filePath;

    diffTitle.appendChild(diffFilename);
    diffTitle.appendChild(diffFilepath);

    const diffStat = document.createElement('span');
    diffStat.className = 'commit-file-stat-group';
    if (f.isNew) {
      diffStat.innerHTML = '<span class="commit-file-stat commit-file-new">new</span>';
    } else {
      diffStat.innerHTML = `<span class="commit-file-stat commit-file-added">+${f.added}</span><span class="commit-file-stat commit-file-removed"> -${f.removed}</span>`;
    }

    diffHeader.appendChild(diffTitle);
    diffHeader.appendChild(diffStat);

    if (showRevert) {
      const diffRevertBtn = document.createElement('button');
      diffRevertBtn.className = 'commit-diff-revert-btn';
      diffRevertBtn.title = f.isNew ? 'Remove file' : 'Revert changes';
      diffRevertBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10l4-4M2 10l4 4"/><path d="M2 10h7a4 4 0 0 0 0-8H8"/></svg>';
      diffRevertBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const result = await window.reposAPI.gitRevertFile(wtPath, f.path, f.isNew);
        if (result.ok) {
          files[idx] = null;
          const refs = rowRefs.get(idx);
          if (refs) { refs.treeRow.remove(); refs.diffSection.remove(); }
          if (files.every(file => !file)) {
            treeContainer.innerHTML = '<span class="commit-file-list-empty">No changes detected</span>';
            diffArea.innerHTML = '';
          }
          notifyChange();
        }
      });
      diffHeader.appendChild(diffRevertBtn);
    }

    const diffPanel = document.createElement('div');
    diffPanel.className = 'commit-diff-panel';

    diffSection.appendChild(diffHeader);
    diffSection.appendChild(diffPanel);
    diffArea.appendChild(diffSection);

    rowRefs.set(idx, { treeRow: row, diffSection });

    // Click on tree row → scroll diff section into view and mark it active
    row.addEventListener('click', (e) => {
      e.preventDefault();
      // Scroll the diff area directly so we target the right scroll container
      const areaRect = diffArea.getBoundingClientRect();
      const sectionRect = diffSection.getBoundingClientRect();
      diffArea.scrollBy({ top: sectionRect.top - areaRect.top - 8, behavior: 'smooth' });
      // Active state: remove from previous, apply to this section
      diffArea.querySelectorAll('.commit-diff-section--active').forEach(el => el.classList.remove('commit-diff-section--active'));
      treePanelBody.querySelectorAll('.commit-file-row--active').forEach(el => el.classList.remove('commit-file-row--active'));
      diffSection.classList.add('commit-diff-section--active');
      row.classList.add('commit-file-row--active');
    });

    const loadDiff = async () => {
      diffPanel.innerHTML = '<div class="commit-diff-empty">Loading…</div>';
      const result = await onLoadDiff(wtPath, f.path);
      renderFileDiff(diffPanel, result.ok ? result.diff : '', {
        onRevertLines: showRevert ? async (changes) => {
          const r = await window.reposAPI.gitRevertLines(wtPath, f.path, changes);
          if (r.ok) { if (onClearDiffCache) onClearDiffCache(f.path); loadDiff(); }
        } : null,
        onExpandGap: async (startLine, endLine) => {
          const r = await window.reposAPI.gitGetFileLines(wtPath, f.path, startLine, endLine);
          return r.ok ? r.lines : [];
        }
      });
    };

    allEntries.push({ diffPanel, loadDiff, f });
  }
}

/**
 * Renders the commit file list as a split view into `container`.
 * Returns { getSelectedFiles } to read which files are checked.
 */
export function renderCommitFileList(container, rawFiles, wtPath, { toolbar, showRevert = true, onLoadDiff = (wt, fp) => window.reposAPI.gitFileDiff(wt, fp, 3), onChange = null } = {}) {
  const files = (rawFiles || []).map(f => ({ ...f }));
  const notifyChange = () => { if (onChange) onChange(); };
  const allEntries = [];
  const diffCache = new Map();
  const rowRefs = new Map();

  container.innerHTML = '';
  if (files.length === 0) {
    container.innerHTML = '<span class="commit-file-list-empty">No changes detected</span>';
    if (toolbar) toolbar.innerHTML = '';
    return { getSelectedFiles: () => [], isEmpty: () => true };
  }

  // Split layout
  const splitContainer = document.createElement('div');
  splitContainer.className = 'commit-split-container';

  // Left: tree panel
  const treePanel = document.createElement('div');
  treePanel.className = 'commit-tree-panel';

  const treePanelBody = document.createElement('div');
  treePanelBody.className = 'commit-tree-panel-body';
  treePanel.appendChild(treePanelBody);

  // Right: diff area
  const diffArea = document.createElement('div');
  diffArea.className = 'commit-diff-area';

  // Resize handle
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'commit-tree-resize-handle';

  splitContainer.appendChild(treePanel);
  splitContainer.appendChild(resizeHandle);
  splitContainer.appendChild(diffArea);
  container.appendChild(splitContainer);

  // Resize + collapse via drag (pointer capture for reliable tracking)
  const COLLAPSE_THRESHOLD = 48;
  const EXPAND_FROM_COLLAPSED = 24;
  let panelCollapsed = false;
  let dragStartX = 0;
  let dragStartWidth = 0;

  resizeHandle.addEventListener('pointerdown', (e) => {
    resizeHandle.setPointerCapture(e.pointerId);
    dragStartX = e.clientX;
    dragStartWidth = panelCollapsed ? 0 : treePanel.offsetWidth;
    treePanel.style.transition = 'none';
    e.preventDefault();
  });

  resizeHandle.addEventListener('pointermove', (e) => {
    if (!resizeHandle.hasPointerCapture(e.pointerId)) return;
    const delta = e.clientX - dragStartX;
    const newWidth = dragStartWidth + delta;
    if (panelCollapsed) {
      if (delta > EXPAND_FROM_COLLAPSED) {
        panelCollapsed = false;
        treePanel.classList.remove('commit-tree-panel--collapsed');
        treePanel.style.width = `${Math.max(80, newWidth)}px`;
      }
    } else {
      if (newWidth < COLLAPSE_THRESHOLD) {
        panelCollapsed = true;
        treePanel.classList.add('commit-tree-panel--collapsed');
      } else {
        treePanel.style.width = `${Math.min(500, newWidth)}px`;
      }
    }
  });

  resizeHandle.addEventListener('pointerup', () => {
    treePanel.style.transition = '';
  });

  const cachedLoadDiff = async (wt, fp) => {
    if (diffCache.has(fp)) return diffCache.get(fp);
    const result = await onLoadDiff(wt, fp);
    if (result.ok) diffCache.set(fp, result);
    return result;
  };
  const clearDiffCache = (fp) => diffCache.delete(fp);

  const tree = buildFileTree(files);
  renderTreeNode(treePanelBody, diffArea, rowRefs, tree, 0, files, wtPath, allEntries, { showRevert, onLoadDiff: cachedLoadDiff, onClearDiffCache: clearDiffCache, notifyChange });

  // Load all diffs in parallel with concurrency cap
  const CONCURRENCY = 6;
  const nonNew = allEntries.filter(e => !e.f.isNew);
  allEntries.filter(e => e.f.isNew).forEach(e => {
    e.diffPanel.innerHTML = '<div class="commit-diff-empty">New untracked file — no diff available</div>';
  });
  (async () => {
    for (let i = 0; i < nonNew.length; i += CONCURRENCY) {
      await Promise.all(nonNew.slice(i, i + CONCURRENCY).map(e => e.loadDiff()));
    }
  })();

  if (toolbar) toolbar.innerHTML = '';

  return {
    getSelectedFiles: () => files.filter(f => f).map(f => f.path),
    isEmpty: () => files.every(f => !f),
  };
}
