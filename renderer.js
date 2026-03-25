// ===== State =====
const workspaces = new Map(); // id -> { folderPath, name, webview, tabEl }
let activeWorkspaceId = null;
let workspaceCounter = 0;

function formatBranchLabel(branch) {
  // "dsery/Test-new-branch" -> "Test new branch"
  const name = branch.includes('/') ? branch.substring(branch.indexOf('/') + 1) : branch;
  return name.replace(/-/g, ' ');
}

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

  document.getElementById('btn-clone-repo').classList.add('visible');
}

// ===== Repo Groups =====

function addRepoGroup(repo) {
  // Don't add duplicate groups
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
  `;

  const tabsEl = document.createElement('div');
  tabsEl.className = 'repo-group-tabs';

  // Expanded by default
  let collapsed = false;

  headerEl.querySelector('.repo-group-add').addEventListener('click', (e) => {
    e.stopPropagation();
    showWorktreeDialog(groupEl, tabsEl);
  });

  headerEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('repo-group-add')) return;
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

  // Drag-and-drop reordering
  groupEl.setAttribute('draggable', 'true');

  groupEl.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    groupEl.classList.add('dragging');
    // Timeout so the drag ghost renders before we style it
    setTimeout(() => groupEl.classList.add('drag-ghost'), 0);
  });

  groupEl.addEventListener('dragend', () => {
    groupEl.classList.remove('dragging', 'drag-ghost');
    document.querySelectorAll('.repo-group.drag-over').forEach(el => el.classList.remove('drag-over'));
  });

  groupEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const dragging = repoGroupsEl.querySelector('.dragging');
    if (!dragging || dragging === groupEl) return;

    const rect = groupEl.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;

    // Remove drag-over from all groups
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
    // Reset to blue when switching to this project (unless Claude is working)
    if (ws.tabEl.dataset.status !== 'working') {
      setTabStatus(ws.tabEl, 'open');
    }
    document.querySelector('.titlebar-title').textContent = `CodeHive — ${ws.name}`;
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
      document.querySelector('.titlebar-title').textContent = 'CodeHive';
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
      ws.tabEl._wasWorking = false;
      // If this is the active project, go back to blue; otherwise green
      setTabStatus(ws.tabEl, id === activeWorkspaceId ? 'open' : 'done');
    }
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

// ===== New Worktree Dialog =====

const wtDialogOverlay = document.getElementById('worktree-dialog-overlay');
const wtBranchSearch = document.getElementById('wt-branch-search');
const wtBranchList = document.getElementById('wt-branch-list');
const wtNameInput = document.getElementById('wt-name-input');
const wtPreview = document.getElementById('wt-preview');

let wtAllBranches = [];
let wtSelectedBranch = null;
let wtCurrentGroupEl = null;
let wtCurrentTabsEl = null;
let wtGitUser = '';

function nameToSlug(name) {
  return name.trim().replace(/\s+/g, '-').substring(0, 15);
}

function userToPrefix(fullName) {
  // "Daniel Sery" -> "dsery", "Daniel Šerý" -> "dsery"
  const parts = fullName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().split(/\s+/);
  if (parts.length === 0) return 'user';
  if (parts.length === 1) return parts[0];
  return parts[0][0] + parts[parts.length - 1];
}

function nameToBranch(user, name) {
  return `${userToPrefix(user)}/${name.trim().replace(/\s+/g, '-')}`;
}

function updateWtPreview() {
  const name = wtNameInput.value.trim();
  if (!name || !wtSelectedBranch) {
    wtPreview.textContent = '';
    return;
  }
  const slug = nameToSlug(name);
  const branch = nameToBranch(wtGitUser, name);
  wtPreview.textContent = `Branch: ${branch}  |  Dir: ${slug}`;
}

function renderBranchList(filter) {
  wtBranchList.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const filtered = wtAllBranches.filter(b => b.toLowerCase().includes(q));
  if (filtered.length === 0) {
    wtBranchList.classList.remove('open');
    return;
  }
  for (const b of filtered) {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    if (b === wtSelectedBranch) item.classList.add('selected');
    item.textContent = b;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      wtSelectedBranch = b;
      wtBranchSearch.value = b;
      wtBranchList.classList.remove('open');
      updateWtPreview();
    });
    wtBranchList.appendChild(item);
  }
  wtBranchList.classList.add('open');
}

async function showWorktreeDialog(groupEl, tabsEl) {
  wtCurrentGroupEl = groupEl;
  wtCurrentTabsEl = tabsEl;
  wtSelectedBranch = null;
  wtAllBranches = [];
  wtBranchSearch.value = '';
  wtBranchSearch.placeholder = 'Fetching branches...';
  wtBranchSearch.disabled = true;
  wtNameInput.value = '';
  wtPreview.textContent = '';
  wtBranchList.innerHTML = '';
  wtBranchList.classList.remove('open');

  wtDialogOverlay.classList.add('visible');

  // Load branches and user in parallel (fetch is async, won't block UI)
  const [branches, user] = await Promise.all([
    window.reposAPI.remoteBranches(groupEl._barePath),
    window.reposAPI.gitUser(groupEl._barePath)
  ]);
  wtAllBranches = branches;
  wtGitUser = user || 'user';

  wtBranchSearch.placeholder = 'Search branches...';
  wtBranchSearch.disabled = false;
  renderBranchList('');
  wtBranchSearch.focus();
}

function hideWorktreeDialog() {
  wtDialogOverlay.classList.remove('visible');
  wtBranchList.classList.remove('open');
}

async function confirmCreateWorktree() {
  if (!wtSelectedBranch || !wtNameInput.value.trim()) return;

  const name = wtNameInput.value.trim();
  const dirName = nameToSlug(name);
  const branchName = nameToBranch(wtGitUser, name);
  const groupEl = wtCurrentGroupEl;
  const tabsEl = wtCurrentTabsEl;

  hideWorktreeDialog();

  cloneTerminalTitle.textContent = `Creating worktree: ${branchName}`;
  cloneTerminalCloseBtn.style.display = 'none';

  // Show terminal panel
  cloneTerminalEl.classList.add('active');
  placeholder.style.display = 'none';

  // Hide active workspace webview if any
  if (activeWorkspaceId !== null) {
    const ws = workspaces.get(activeWorkspaceId);
    if (ws) ws.webview.classList.remove('active');
  }

  // Initialize xterm
  if (cloneXterm) {
    cloneXterm.dispose();
  }
  cloneXterm = new Terminal({
    cursorBlink: false,
    fontSize: 13,
    fontFamily: "'Consolas', 'Courier New', monospace",
    theme: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#cdd6f4',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#cba6f7',
      cyan: '#94e2d5',
      white: '#bac2de'
    }
  });
  cloneFitAddon = new (FitAddon.FitAddon || FitAddon)();
  cloneXterm.loadAddon(cloneFitAddon);
  cloneXterm.open(cloneTerminalXtermEl);
  cloneFitAddon.fit();

  window.worktreeAPI.resize(cloneXterm.cols, cloneXterm.rows);

  window.worktreeAPI.removeListeners();
  window.worktreeAPI.onData((data) => {
    cloneXterm.write(data);
  });

  window.worktreeAPI.onExit(({ exitCode, wtPath, branchName: branch, dirName: dir }) => {
    if (exitCode === 0) {
      cloneXterm.writeln('');
      cloneXterm.writeln('\x1b[32mWorktree created successfully!\x1b[0m');

      // Add the new worktree tab
      const wt = { path: wtPath, branch, name: dir };
      const tabEl = createWorktreeTab(wt);
      tabsEl.appendChild(tabEl);

      // Auto-close terminal and open the new worktree
      setTimeout(async () => {
        closeCloneTerminal();
        try {
          await openWorktree(tabEl, wt);
        } catch (err) {
          console.error('Failed to open worktree:', err);
          alert(`Worktree created but failed to open: ${err.message || err}`);
        }
      }, 800);
    } else {
      cloneXterm.writeln('');
      cloneXterm.writeln(`\x1b[31mWorktree creation failed with exit code ${exitCode}\x1b[0m`);
      cloneTerminalTitle.textContent = `Worktree creation failed`;
      cloneTerminalCloseBtn.style.display = 'block';
    }
  });

  try {
    await window.worktreeAPI.start({
      barePath: groupEl._barePath,
      repoDir: groupEl._repoDir,
      branchName,
      dirName,
      sourceBranch: wtSelectedBranch
    });
  } catch (err) {
    cloneXterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    cloneTerminalTitle.textContent = `Worktree creation failed`;
    cloneTerminalCloseBtn.style.display = 'block';
  }
}

wtBranchSearch.addEventListener('input', () => {
  wtSelectedBranch = null;
  renderBranchList(wtBranchSearch.value);
});

wtBranchSearch.addEventListener('focus', () => {
  renderBranchList(wtBranchSearch.value);
});

wtBranchSearch.addEventListener('blur', () => {
  setTimeout(() => wtBranchList.classList.remove('open'), 200);
});

document.querySelector('.combobox-arrow').addEventListener('click', () => {
  if (wtBranchList.classList.contains('open')) {
    wtBranchList.classList.remove('open');
  } else {
    renderBranchList(wtBranchSearch.value);
    wtBranchSearch.focus();
  }
});

wtBranchSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideWorktreeDialog();
});

wtNameInput.addEventListener('input', updateWtPreview);
wtNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmCreateWorktree();
  if (e.key === 'Escape') hideWorktreeDialog();
});

wtDialogOverlay.addEventListener('click', (e) => {
  if (e.target === wtDialogOverlay) hideWorktreeDialog();
});
document.getElementById('wt-cancel-btn').addEventListener('click', hideWorktreeDialog);
document.getElementById('wt-confirm-btn').addEventListener('click', confirmCreateWorktree);

// ===== Title Bar =====

document.getElementById('btn-open-directory').addEventListener('click', openDirectory);

// ===== Clone Repository =====

const cloneDialogOverlay = document.getElementById('clone-dialog-overlay');
const cloneUrlInput = document.getElementById('clone-url-input');
const cloneTerminalEl = document.getElementById('clone-terminal');
const cloneTerminalXtermEl = document.getElementById('clone-terminal-xterm');
const cloneTerminalTitle = document.getElementById('clone-terminal-title');
const cloneTerminalCloseBtn = document.getElementById('clone-terminal-close');

let cloneXterm = null;
let cloneFitAddon = null;

function showCloneDialog() {
  cloneUrlInput.value = '';
  cloneDialogOverlay.classList.add('visible');
  setTimeout(() => cloneUrlInput.focus(), 50);
}

function hideCloneDialog() {
  cloneDialogOverlay.classList.remove('visible');
}

function parseRepoName(url) {
  const cleaned = url.replace(/\.git\/?$/, '').replace(/\/$/, '');
  return cleaned.split('/').pop();
}

async function startClone() {
  const url = cloneUrlInput.value.trim();
  if (!url) return;

  hideCloneDialog();

  // Use C:/Repos as the workspace root
  const reposDir = 'C:/Repos';

  const repoName = parseRepoName(url);
  cloneTerminalTitle.textContent = `Cloning ${repoName}...`;
  cloneTerminalCloseBtn.style.display = 'none';

  // Show terminal panel in the editor area
  cloneTerminalEl.classList.add('active');
  placeholder.style.display = 'none';

  // Hide active workspace webview if any
  if (activeWorkspaceId !== null) {
    const ws = workspaces.get(activeWorkspaceId);
    if (ws) ws.webview.classList.remove('active');
  }

  // Initialize xterm (loaded via script tags, available as globals)
  if (cloneXterm) {
    cloneXterm.dispose();
  }
  cloneXterm = new Terminal({
    cursorBlink: false,
    fontSize: 13,
    fontFamily: "'Consolas', 'Courier New', monospace",
    theme: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#cdd6f4',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#cba6f7',
      cyan: '#94e2d5',
      white: '#bac2de'
    }
  });
  cloneFitAddon = new (FitAddon.FitAddon || FitAddon)();
  cloneXterm.loadAddon(cloneFitAddon);
  cloneXterm.open(cloneTerminalXtermEl);
  cloneFitAddon.fit();

  // Notify main process of terminal size
  window.cloneAPI.resize(cloneXterm.cols, cloneXterm.rows);

  // Listen for data from the PTY
  window.cloneAPI.removeListeners();
  window.cloneAPI.onData((data) => {
    cloneXterm.write(data);
  });

  window.cloneAPI.onExit(async ({ exitCode, repoName: name, repoDir, bareDir, reposDir: rDir }) => {
    if (exitCode === 0) {
      cloneXterm.writeln('');
      cloneXterm.writeln('\x1b[32mRepository cloned successfully!\x1b[0m');
      cloneTerminalTitle.textContent = `Clone complete: ${name}`;

      // Scan and add the new repo to the sidebar
      const repos = await window.reposAPI.scanDirectory(rDir);
      const newRepo = repos.find(r => r.name === name);
      if (newRepo) {
        addRepoGroup(newRepo);
      }
    } else {
      cloneXterm.writeln('');
      cloneXterm.writeln(`\x1b[31mClone failed with exit code ${exitCode}\x1b[0m`);
      cloneTerminalTitle.textContent = `Clone failed: ${name}`;
    }
    cloneTerminalCloseBtn.style.display = 'block';
  });

  // Start the clone
  try {
    await window.cloneAPI.start(url, reposDir);
  } catch (err) {
    cloneXterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    cloneTerminalTitle.textContent = `Clone failed: ${repoName}`;
    cloneTerminalCloseBtn.style.display = 'block';
  }
}

function closeCloneTerminal() {
  cloneTerminalEl.classList.remove('active');
  window.cloneAPI.removeListeners();
  window.worktreeAPI.removeListeners();
  if (cloneXterm) {
    cloneXterm.dispose();
    cloneXterm = null;
    cloneFitAddon = null;
    cloneTerminalXtermEl.innerHTML = '';
  }

  // Restore previous view
  if (activeWorkspaceId !== null) {
    const ws = workspaces.get(activeWorkspaceId);
    if (ws) ws.webview.classList.add('active');
  } else {
    placeholder.style.display = 'flex';
  }
}

document.getElementById('btn-clone-repo').addEventListener('click', showCloneDialog);
cloneDialogOverlay.addEventListener('click', (e) => {
  if (e.target === cloneDialogOverlay) hideCloneDialog();
});
document.getElementById('clone-cancel-btn').addEventListener('click', hideCloneDialog);
document.getElementById('clone-confirm-btn').addEventListener('click', startClone);
cloneTerminalCloseBtn.addEventListener('click', closeCloneTerminal);

cloneUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startClone();
  if (e.key === 'Escape') hideCloneDialog();
});

// Handle terminal resize
window.addEventListener('resize', () => {
  if (cloneFitAddon && cloneTerminalEl.classList.contains('active')) {
    cloneFitAddon.fit();
    if (cloneXterm) {
      window.cloneAPI.resize(cloneXterm.cols, cloneXterm.rows);
      window.worktreeAPI.resize(cloneXterm.cols, cloneXterm.rows);
    }
  }
});

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
