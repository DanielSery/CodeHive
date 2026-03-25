// ===== State =====
const workspaces = new Map(); // id -> { folderPath, name, webview, tabEl }
let activeWorkspaceId = null;
let workspaceCounter = 0;

function setTabStatus(tabEl, status) {
  tabEl.dataset.status = status;
  if (tabEl._dotEl) tabEl._dotEl.dataset.status = status;
}

// DOM refs
const repoGroupsEl = document.getElementById('repo-groups');
const collapsedDotsEl = document.getElementById('collapsed-dots');
const editorArea = document.getElementById('editor-area');
const placeholder = document.getElementById('editor-placeholder');
const sidebar = document.getElementById('sidebar');
const resizeHandle = document.getElementById('sidebar-resize-handle');

// ===== Open Directory =====

async function openDirectory() {
  const dirPath = await window.reposAPI.openDirectoryDialog();
  if (!dirPath) return;

  const repos = await window.reposAPI.scanDirectory(dirPath);
  if (repos.length === 0) {
    alert('No repositories with a Bare subdirectory found in this directory.');
    return;
  }

  for (const repo of repos) {
    addRepoGroup(repo);
  }
}

// ===== Repo Groups =====

function addRepoGroup(repo) {
  // Don't add duplicate groups
  if (repoGroupsEl.querySelector(`[data-repo-name="${CSS.escape(repo.name)}"]`)) return;

  const groupEl = document.createElement('div');
  groupEl.className = 'repo-group';
  groupEl.dataset.repoName = repo.name;

  const headerEl = document.createElement('div');
  headerEl.className = 'repo-group-header';
  headerEl.innerHTML = `
    <span class="repo-group-chevron">&#x25B6;</span>
    <span class="repo-group-name">${repo.name}</span>
    <span class="repo-group-count">${repo.worktrees.length}</span>
  `;

  const tabsEl = document.createElement('div');
  tabsEl.className = 'repo-group-tabs';

  // Collapsed by default
  let collapsed = true;

  headerEl.addEventListener('click', () => {
    collapsed = !collapsed;
    tabsEl.classList.toggle('expanded', !collapsed);
    headerEl.querySelector('.repo-group-chevron').innerHTML = collapsed ? '&#x25B6;' : '&#x25BC;';
  });

  // Add separator in collapsed dots if not the first group
  if (collapsedDotsEl.children.length > 0) {
    const sep = document.createElement('hr');
    sep.className = 'collapsed-dots-separator';
    collapsedDotsEl.appendChild(sep);
  }

  repo.worktrees.forEach((wt) => {
    const tabEl = createWorktreeTab(wt);
    tabsEl.appendChild(tabEl);
  });

  groupEl.appendChild(headerEl);
  groupEl.appendChild(tabsEl);
  repoGroupsEl.appendChild(groupEl);

  // Auto-expand if first group
  if (repoGroupsEl.children.length === 1) {
    collapsed = false;
    tabsEl.classList.add('expanded');
    headerEl.querySelector('.repo-group-chevron').innerHTML = '&#x25BC;';
  }
}

function createWorktreeTab(wt) {
  const tabEl = document.createElement('div');
  tabEl.className = 'workspace-tab';
  setTabStatus(tabEl, 'idle');
  tabEl.innerHTML = `
    <span class="workspace-tab-status"></span>
    <span class="workspace-tab-label">${wt.branch}</span>
    <button class="workspace-tab-close" title="Close">&times;</button>
  `;

  tabEl._wtPath = wt.path;
  tabEl._wtBranch = wt.branch;
  tabEl._workspaceId = null;
  tabEl._pollTimer = null;
  tabEl._wasWorking = false;

  // Create matching collapsed dot button
  const dotEl = document.createElement('button');
  dotEl.className = 'collapsed-dot';
  dotEl.dataset.status = 'idle';
  dotEl.title = wt.branch;
  dotEl.innerHTML = '<span class="collapsed-dot-indicator"></span>';
  dotEl.addEventListener('click', () => openWorktree(tabEl, wt));
  collapsedDotsEl.appendChild(dotEl);
  tabEl._dotEl = dotEl;

  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('workspace-tab-close')) return;
    openWorktree(tabEl, wt);
  });

  tabEl.querySelector('.workspace-tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    if (tabEl._workspaceId !== null) {
      closeWorkspace(tabEl._workspaceId);
    }
  });

  return tabEl;
}

// ===== Workspace Management =====

async function openWorktree(tabEl, wt) {
  // If already opened, just switch to it
  if (tabEl._workspaceId !== null && workspaces.has(tabEl._workspaceId)) {
    switchWorkspace(tabEl._workspaceId);
    return;
  }

  const id = ++workspaceCounter;
  const url = await window.codeServerAPI.openFolder(wt.path);

  // Create webview
  const webview = document.createElement('webview');
  webview.className = 'workspace-webview';
  webview.id = `workspace-${id}`;
  webview.setAttribute('src', url);
  webview.setAttribute('allowpopups', 'true');
  webview.setAttribute('disableblinkfeatures', 'Auxclick');
  editorArea.appendChild(webview);

  webview.addEventListener('did-finish-load', () => {
    webview.insertCSS(`
      .activitybar .actions-container .action-item {
        display: none !important;
      }
      .activitybar .actions-container .action-item:has(a[aria-label*="Explorer"]),
      .activitybar .actions-container .action-item:has(a[aria-label*="Source Control"]),
      .activitybar .actions-container .action-item:has(a[aria-label*="Search"]),
      .activitybar .actions-container .action-item:has(a[aria-label*="Extensions"]),
      .activitybar .actions-container .action-item:has(a[aria-label*="Claude"]) {
        display: flex !important;
      }
      [id="workbench.panel.chat"],
      [id="workbench.panel.chatEditing"] {
        display: none !important;
      }
    `).catch(() => {});
  });

  tabEl._workspaceId = id;
  setTabStatus(tabEl, 'open');

  workspaces.set(id, {
    folderPath: wt.path,
    name: wt.branch,
    webview,
    tabEl
  });

  startClaudePoll(id);
  switchWorkspace(id);
}

function switchWorkspace(id) {
  if (activeWorkspaceId === id) return;

  if (activeWorkspaceId !== null) {
    const prev = workspaces.get(activeWorkspaceId);
    if (prev) {
      prev.webview.classList.remove('active');
      prev.tabEl.classList.remove('active');
      if (prev.tabEl._dotEl) prev.tabEl._dotEl.classList.remove('active');
    }
  }

  const ws = workspaces.get(id);
  if (ws) {
    ws.webview.classList.add('active');
    ws.tabEl.classList.add('active');
    if (ws.tabEl._dotEl) ws.tabEl._dotEl.classList.add('active');
    activeWorkspaceId = id;
    placeholder.style.display = 'none';
    document.querySelector('.titlebar-title').textContent = `DevShell — ${ws.name}`;
  }
}

function closeWorkspace(id) {
  const ws = workspaces.get(id);
  if (!ws) return;

  stopClaudePoll(id);
  ws.webview.remove();
  ws.tabEl.classList.remove('active');
  ws.tabEl._workspaceId = null;
  ws.tabEl._wasWorking = false;
  setTabStatus(ws.tabEl, 'idle');
  workspaces.delete(id);

  if (activeWorkspaceId === id) {
    activeWorkspaceId = null;
    const remaining = Array.from(workspaces.keys());
    if (remaining.length > 0) {
      switchWorkspace(remaining[remaining.length - 1]);
    } else {
      placeholder.style.display = 'flex';
      document.querySelector('.titlebar-title').textContent = 'DevShell';
    }
  }
}

// ===== Claude Status Polling =====

const POLL_INTERVAL = 3000;

function startClaudePoll(id) {
  const ws = workspaces.get(id);
  if (!ws) return;

  ws.tabEl._pollTimer = setInterval(() => pollClaudeStatus(id), POLL_INTERVAL);
}

function stopClaudePoll(id) {
  const ws = workspaces.get(id);
  if (!ws || !ws.tabEl._pollTimer) return;
  clearInterval(ws.tabEl._pollTimer);
  ws.tabEl._pollTimer = null;
}

async function pollClaudeStatus(id) {
  const ws = workspaces.get(id);
  if (!ws || ws.tabEl._workspaceId === null || ws.tabEl.dataset.status === 'idle') return;

  try {
    const result = await window.reposAPI.checkClaudeActive(ws.folderPath);

    if (result === 'working') {
      setTabStatus(ws.tabEl, 'working');
      ws.tabEl._wasWorking = true;
    } else if (ws.tabEl._wasWorking && ws.tabEl.dataset.status === 'working') {
      setTabStatus(ws.tabEl, 'done');
    }
    // Otherwise stay in current state (open or done)
  } catch {
    // Ignore errors
  }
}

// ===== Webview Sizing =====
// (handled by CSS: position absolute + right:0/bottom:0)

// ===== Keyboard Shortcuts =====

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'o') { e.preventDefault(); openDirectory(); }
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    const ids = Array.from(workspaces.keys());
    if (ids.length > 1) {
      const idx = ids.indexOf(activeWorkspaceId);
      const next = e.shiftKey ? (idx - 1 + ids.length) % ids.length : (idx + 1) % ids.length;
      switchWorkspace(ids[next]);
    }
  }
});

// ===== Title Bar =====

document.getElementById('btn-open-directory').addEventListener('click', openDirectory);

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

  // Overlay prevents webview from capturing mouse events during drag
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

// Double-click to toggle collapse/expand
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
document.getElementById('btn-minimize').addEventListener('click', () => window.windowAPI.minimize());
document.getElementById('btn-maximize').addEventListener('click', () => window.windowAPI.maximize());
document.getElementById('btn-close').addEventListener('click', () => window.windowAPI.close());
