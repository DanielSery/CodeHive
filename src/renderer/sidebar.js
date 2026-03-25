import { setTabStatus } from './claude-poll.js';
import { openWorktree, closeWorkspace } from './workspace-manager.js';

const BIN_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12M5.3 4V2.7a1 1 0 011-1h3.4a1 1 0 011 1V4M6.5 7.3v4.4M9.5 7.3v4.4"/><path d="M3.5 4l.7 9.3a1 1 0 001 .9h5.6a1 1 0 001-.9L12.5 4"/></svg>';
const SWITCH_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 1l3 3-3 3"/><path d="M14 4H5"/><path d="M5 15l-3-3 3-3"/><path d="M2 12h9"/></svg>';

const repoGroupsEl = document.getElementById('repo-groups');
const collapsedDotsEl = document.getElementById('collapsed-dots');
const sidebar = document.getElementById('sidebar');
const resizeHandle = document.getElementById('sidebar-resize-handle');
const contextMenu = document.getElementById('wt-context-menu');
const projectContextMenu = document.getElementById('project-context-menu');

// Lazy references to avoid circular import with dialogs.js
let _showWorktreeDialog = null;
let _showDeleteDialog = null;
let _showWorktreeRemoveDialog = null;
let _showWorktreeSwitchDialog = null;
let _onStateChange = null;

function registerOnStateChange(fn) {
  _onStateChange = fn;
}

function registerWorktreeDialog(fn) {
  _showWorktreeDialog = fn;
}

function registerDeleteDialog(fn) {
  _showDeleteDialog = fn;
}

function registerWorktreeRemoveDialog(fn) {
  _showWorktreeRemoveDialog = fn;
}

function registerWorktreeSwitchDialog(fn) {
  _showWorktreeSwitchDialog = fn;
}

function formatBranchLabel(branch) {
  const name = branch.includes('/') ? branch.substring(branch.indexOf('/') + 1) : branch;
  return name.replace(/-/g, ' ');
}

// ===== Repo Groups =====

function addRepoGroup(repo) {
  if (repoGroupsEl.querySelector(`[data-repo-name="${CSS.escape(repo.name)}"]`)) return;

  const groupEl = document.createElement('div');
  groupEl.className = 'repo-group';
  groupEl.dataset.repoName = repo.name;

  groupEl._barePath = repo.barePath;
  groupEl._repoDir = repo.barePath.replace(/[\\/]Bare$/, '');

  const headerEl = document.createElement('div');
  headerEl.className = 'repo-group-header';
  headerEl.innerHTML = `
    <span class="repo-group-chevron">&#x25B6;</span>
    <span class="repo-group-name">${repo.name}</span>
    <button class="repo-group-add" title="Add Worktree">+</button>
    <button class="repo-group-delete" title="Delete Project"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12M5.3 4V2.7a1 1 0 011-1h3.4a1 1 0 011 1V4M6.5 7.3v4.4M9.5 7.3v4.4"/><path d="M3.5 4l.7 9.3a1 1 0 001 .9h5.6a1 1 0 001-.9L12.5 4"/></svg></button>
  `;

  const tabsEl = document.createElement('div');
  tabsEl.className = 'repo-group-tabs';

  let collapsed = false;

  headerEl.querySelector('.repo-group-add').addEventListener('click', (e) => {
    e.stopPropagation();
    if (_showWorktreeDialog) _showWorktreeDialog(groupEl, tabsEl);
  });

  headerEl.querySelector('.repo-group-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    if (_showDeleteDialog) _showDeleteDialog(groupEl);
  });

  headerEl.addEventListener('click', (e) => {
    if (e.target.closest('.repo-group-add') || e.target.closest('.repo-group-delete')) return;
    collapsed = !collapsed;
    tabsEl.classList.toggle('expanded', !collapsed);
    headerEl.querySelector('.repo-group-chevron').innerHTML = collapsed ? '&#x25B6;' : '&#x25BC;';
  });

  headerEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showProjectContextMenu(e.clientX, e.clientY, groupEl, tabsEl);
  });

  if (collapsedDotsEl.children.length > 0) {
    const sep = document.createElement('hr');
    sep.className = 'collapsed-dots-separator';
    collapsedDotsEl.appendChild(sep);
  }

  repo.worktrees.forEach((wt) => {
    const tabEl = createWorktreeTab(wt);
    tabsEl.appendChild(tabEl);
  });

  // Drag-and-drop reordering
  groupEl.setAttribute('draggable', 'true');

  groupEl.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    groupEl.classList.add('dragging');
    setTimeout(() => groupEl.classList.add('drag-ghost'), 0);
  });

  groupEl.addEventListener('dragend', () => {
    groupEl.classList.remove('dragging', 'drag-ghost');
    document.querySelectorAll('.repo-group.drag-over').forEach(el => el.classList.remove('drag-over'));
    rebuildCollapsedDots();
    if (_onStateChange) _onStateChange();
  });

  groupEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const dragging = repoGroupsEl.querySelector('.dragging');
    if (!dragging || dragging === groupEl) return;

    const rect = groupEl.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;

    document.querySelectorAll('.repo-group.drag-over').forEach(el => el.classList.remove('drag-over'));
    groupEl.classList.add('drag-over');

    if (e.clientY < midY) {
      repoGroupsEl.insertBefore(dragging, groupEl);
    } else {
      repoGroupsEl.insertBefore(dragging, groupEl.nextSibling);
    }
  });

  groupEl.addEventListener('dragleave', () => {
    groupEl.classList.remove('drag-over');
  });

  tabsEl.classList.add('expanded');
  headerEl.querySelector('.repo-group-chevron').innerHTML = '&#x25BC;';

  groupEl.appendChild(headerEl);
  groupEl.appendChild(tabsEl);
  repoGroupsEl.appendChild(groupEl);
}

function createWorktreeTab(wt) {
  const tabEl = document.createElement('div');
  tabEl.className = 'workspace-tab';
  setTabStatus(tabEl, 'idle');
  tabEl.innerHTML = `
    <span class="workspace-tab-status"></span>
    <span class="workspace-tab-label">${formatBranchLabel(wt.branch)}</span>
    <button class="workspace-tab-switch" title="Switch Worktree">${SWITCH_ICON_SVG}</button>
    <button class="workspace-tab-remove" title="Remove Worktree">${BIN_ICON_SVG}</button>
    <button class="workspace-tab-close" title="Close" style="display:none">&times;</button>
  `;

  tabEl._wtPath = wt.path;
  tabEl._wtBranch = wt.branch;
  tabEl._workspaceId = null;
  tabEl._pollTimer = null;
  tabEl._wasWorking = false;

  const dotEl = document.createElement('button');
  dotEl.className = 'collapsed-dot';
  dotEl.dataset.status = 'idle';
  dotEl.title = wt.branch;
  dotEl.innerHTML = '<span class="collapsed-dot-indicator"></span>';
  dotEl.addEventListener('click', () => openWorktree(tabEl, wt));
  collapsedDotsEl.appendChild(dotEl);
  tabEl._dotEl = dotEl;

  tabEl.querySelector('.workspace-tab-switch').addEventListener('click', (e) => {
    e.stopPropagation();
    if (_showWorktreeSwitchDialog) {
      const groupEl = tabEl.closest('.repo-group');
      _showWorktreeSwitchDialog(tabEl, groupEl);
    }
  });

  tabEl.querySelector('.workspace-tab-remove').addEventListener('click', (e) => {
    e.stopPropagation();
    if (_showWorktreeRemoveDialog) {
      const groupEl = tabEl.closest('.repo-group');
      _showWorktreeRemoveDialog(tabEl, groupEl);
    }
  });

  tabEl.addEventListener('click', (e) => {
    if (e.target.closest('.workspace-tab-close') || e.target.closest('.workspace-tab-switch') || e.target.closest('.workspace-tab-remove')) return;
    openWorktree(tabEl, wt);
  });

  tabEl.querySelector('.workspace-tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    if (tabEl._workspaceId !== null) {
      closeWorkspace(tabEl._workspaceId);
    }
  });

  tabEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, tabEl);
  });

  return tabEl;
}

function showTabCloseButton(tabEl) {
  const switchBtn = tabEl.querySelector('.workspace-tab-switch');
  const removeBtn = tabEl.querySelector('.workspace-tab-remove');
  const closeBtn = tabEl.querySelector('.workspace-tab-close');
  if (switchBtn) switchBtn.style.display = 'none';
  if (removeBtn) removeBtn.style.display = 'none';
  if (closeBtn) closeBtn.style.display = '';
}

function showTabRemoveButton(tabEl) {
  const switchBtn = tabEl.querySelector('.workspace-tab-switch');
  const removeBtn = tabEl.querySelector('.workspace-tab-remove');
  const closeBtn = tabEl.querySelector('.workspace-tab-close');
  if (switchBtn) switchBtn.style.display = '';
  if (removeBtn) removeBtn.style.display = '';
  if (closeBtn) closeBtn.style.display = 'none';
}

// ===== Sidebar Resize =====

const COLLAPSE_THRESHOLD = 60;
const MIN_WIDTH = 120;
const DEFAULT_WIDTH = 220;
let preCollapseWidth = DEFAULT_WIDTH;

resizeHandle.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = sidebar.getBoundingClientRect().width;
  const wasCollapsed = sidebar.classList.contains('collapsed');
  let rafId = null;
  let lastX = startX;

  resizeHandle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;cursor:col-resize;';
  document.body.appendChild(overlay);

  function applyWidth() {
    const delta = lastX - startX;
    let newWidth = (wasCollapsed ? 40 : startWidth) + delta;

    if (newWidth < COLLAPSE_THRESHOLD) {
      sidebar.style.width = '40px';
      sidebar.classList.add('collapsed');
    } else {
      if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH;
      sidebar.style.width = newWidth + 'px';
      sidebar.classList.remove('collapsed');
    }
    rafId = null;
  }

  function onMouseMove(e) {
    lastX = e.clientX;
    if (!rafId) rafId = requestAnimationFrame(applyWidth);
  }

  function onMouseUp() {
    if (rafId) { cancelAnimationFrame(rafId); applyWidth(); }
    overlay.remove();
    resizeHandle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    if (!sidebar.classList.contains('collapsed')) {
      preCollapseWidth = sidebar.getBoundingClientRect().width;
    }
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
});

resizeHandle.addEventListener('dblclick', () => {
  if (sidebar.classList.contains('collapsed')) {
    sidebar.style.width = preCollapseWidth + 'px';
    sidebar.classList.remove('collapsed');
  } else {
    preCollapseWidth = sidebar.getBoundingClientRect().width;
    sidebar.style.width = '40px';
    sidebar.classList.add('collapsed');
  }
});

// ===== Collapsed Dots Rebuild =====

function rebuildCollapsedDots() {
  collapsedDotsEl.innerHTML = '';
  const groups = repoGroupsEl.querySelectorAll('.repo-group');
  groups.forEach((groupEl, i) => {
    if (i > 0) {
      const sep = document.createElement('hr');
      sep.className = 'collapsed-dots-separator';
      collapsedDotsEl.appendChild(sep);
    }
    const tabs = groupEl.querySelectorAll('.workspace-tab');
    for (const tab of tabs) {
      if (tab._dotEl) collapsedDotsEl.appendChild(tab._dotEl);
    }
  });
}

// ===== Context Menu =====

let _contextMenuTabEl = null;

function showContextMenu(x, y, tabEl) {
  hideProjectContextMenu();
  _contextMenuTabEl = tabEl;

  const isOpen = tabEl._workspaceId !== null;
  contextMenu.querySelector('[data-action="close-editor"]').style.display = isOpen ? '' : 'none';
  contextMenu.querySelector('[data-action="switch"]').style.display = isOpen ? 'none' : '';
  contextMenu.querySelector('[data-action="remove"]').style.display = isOpen ? 'none' : '';
  // Hide separator when editor is open (no danger items shown)
  const sep = contextMenu.querySelector('.context-menu-separator');
  if (sep) sep.style.display = isOpen ? 'none' : '';

  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.classList.add('visible');

  // Adjust if overflowing viewport
  requestAnimationFrame(() => {
    const rect = contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      contextMenu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      contextMenu.style.top = (window.innerHeight - rect.height - 4) + 'px';
    }
  });
}

function hideContextMenu() {
  contextMenu.classList.remove('visible');
  _contextMenuTabEl = null;
}

document.addEventListener('click', hideContextMenu);
document.addEventListener('contextmenu', (e) => {
  if (!contextMenu.contains(e.target)) hideContextMenu();
});

contextMenu.addEventListener('click', (e) => {
  const item = e.target.closest('.context-menu-item');
  if (!item || !_contextMenuTabEl) return;
  const tabEl = _contextMenuTabEl;
  const action = item.dataset.action;
  hideContextMenu();

  if (action === 'open-explorer') {
    window.shellAPI.openInExplorer(tabEl._wtPath);
  } else if (action === 'close-editor') {
    if (tabEl._workspaceId !== null) {
      closeWorkspace(tabEl._workspaceId);
    }
  } else if (action === 'switch') {
    if (_showWorktreeSwitchDialog) {
      const groupEl = tabEl.closest('.repo-group');
      _showWorktreeSwitchDialog(tabEl, groupEl);
    }
  } else if (action === 'remove') {
    if (_showWorktreeRemoveDialog) {
      const groupEl = tabEl.closest('.repo-group');
      _showWorktreeRemoveDialog(tabEl, groupEl);
    }
  }
});

// ===== Project Context Menu =====

let _projectContextMenuGroupEl = null;
let _projectContextMenuTabsEl = null;

function showProjectContextMenu(x, y, groupEl, tabsEl) {
  hideContextMenu();
  _projectContextMenuGroupEl = groupEl;
  _projectContextMenuTabsEl = tabsEl;
  projectContextMenu.style.left = x + 'px';
  projectContextMenu.style.top = y + 'px';
  projectContextMenu.classList.add('visible');

  requestAnimationFrame(() => {
    const rect = projectContextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      projectContextMenu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      projectContextMenu.style.top = (window.innerHeight - rect.height - 4) + 'px';
    }
  });
}

function hideProjectContextMenu() {
  projectContextMenu.classList.remove('visible');
  _projectContextMenuGroupEl = null;
  _projectContextMenuTabsEl = null;
}

document.addEventListener('click', hideProjectContextMenu);
document.addEventListener('contextmenu', (e) => {
  if (!projectContextMenu.contains(e.target)) hideProjectContextMenu();
});

projectContextMenu.addEventListener('click', (e) => {
  const item = e.target.closest('.context-menu-item');
  if (!item || !_projectContextMenuGroupEl) return;
  const groupEl = _projectContextMenuGroupEl;
  const tabsEl = _projectContextMenuTabsEl;
  const action = item.dataset.action;
  hideProjectContextMenu();

  if (action === 'open-explorer') {
    window.shellAPI.openInExplorer(groupEl._repoDir);
  } else if (action === 'add-worktree') {
    if (_showWorktreeDialog) _showWorktreeDialog(groupEl, tabsEl);
  } else if (action === 'delete-project') {
    if (_showDeleteDialog) _showDeleteDialog(groupEl);
  }
});

function removeRepoGroup(groupEl) {
  // Close all open workspaces in this group
  const tabs = groupEl.querySelectorAll('.workspace-tab');
  for (const tab of tabs) {
    if (tab._workspaceId !== null) {
      closeWorkspace(tab._workspaceId);
    }
    if (tab._dotEl) tab._dotEl.remove();
  }
  groupEl.remove();
}

function getRepoOrder() {
  return Array.from(repoGroupsEl.querySelectorAll('.repo-group'))
    .map(el => el.dataset.repoName);
}

function getOpenWorktreePaths() {
  const paths = [];
  for (const tab of document.querySelectorAll('.workspace-tab')) {
    if (tab._workspaceId !== null) {
      paths.push(tab._wtPath);
    }
  }
  return paths;
}

export { addRepoGroup, createWorktreeTab, registerWorktreeDialog, registerDeleteDialog, registerWorktreeRemoveDialog, registerWorktreeSwitchDialog, registerOnStateChange, removeRepoGroup, showTabCloseButton, showTabRemoveButton, getRepoOrder, getOpenWorktreePaths };
