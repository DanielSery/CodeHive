// ===== State =====
const workspaces = new Map(); // id -> { folderPath, name, webview, tabEl }
let activeWorkspaceId = null;
let workspaceCounter = 0;

const WORKSPACE_COLORS = [
  '#89b4fa', '#a6e3a1', '#f9e2af', '#f38ba8',
  '#cba6f7', '#94e2d5', '#fab387', '#f5c2e7'
];

// DOM refs
const repoGroupsEl = document.getElementById('repo-groups');
const editorArea = document.getElementById('editor-area');
const placeholder = document.getElementById('editor-placeholder');

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

  // Add worktree tabs
  const colorOffset = workspaceCounter;
  repo.worktrees.forEach((wt, i) => {
    const color = WORKSPACE_COLORS[(colorOffset + i) % WORKSPACE_COLORS.length];
    const tabEl = createWorktreeTab(wt, color);
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

function createWorktreeTab(wt, color) {
  const tabEl = document.createElement('div');
  tabEl.className = 'workspace-tab';
  tabEl.innerHTML = `
    <span class="workspace-tab-color" style="background: ${color}"></span>
    <span class="workspace-tab-label">${wt.branch}</span>
    <button class="workspace-tab-close" title="Close">&times;</button>
  `;

  // Store worktree info on the element
  tabEl._wtPath = wt.path;
  tabEl._wtBranch = wt.branch;
  tabEl._workspaceId = null; // assigned when opened

  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('workspace-tab-close')) return;
    openWorktree(tabEl, wt, color);
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

async function openWorktree(tabEl, wt, color) {
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

  workspaces.set(id, {
    folderPath: wt.path,
    name: wt.branch,
    color,
    webview,
    tabEl
  });

  switchWorkspace(id);
}

function switchWorkspace(id) {
  if (activeWorkspaceId === id) return;

  if (activeWorkspaceId !== null) {
    const prev = workspaces.get(activeWorkspaceId);
    if (prev) {
      prev.webview.classList.remove('active');
      prev.tabEl.classList.remove('active');
    }
  }

  const ws = workspaces.get(id);
  if (ws) {
    ws.webview.classList.add('active');
    ws.tabEl.classList.add('active');
    activeWorkspaceId = id;
    placeholder.style.display = 'none';
    document.querySelector('.titlebar-title').textContent = `DevShell — ${ws.name}`;
  }
}

function closeWorkspace(id) {
  const ws = workspaces.get(id);
  if (!ws) return;

  ws.webview.remove();
  ws.tabEl.classList.remove('active');
  ws.tabEl._workspaceId = null;
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
document.getElementById('btn-collapse-sidebar').addEventListener('click', () => {
  document.getElementById('sidebar').classList.add('collapsed');
});
document.getElementById('btn-expand-sidebar').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('collapsed');
});
document.getElementById('btn-minimize').addEventListener('click', () => window.windowAPI.minimize());
document.getElementById('btn-maximize').addEventListener('click', () => window.windowAPI.maximize());
document.getElementById('btn-close').addEventListener('click', () => window.windowAPI.close());
