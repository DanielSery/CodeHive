import { getWorkspace, getActive, getActiveId, setActiveId, nextId, addWorkspace, removeWorkspace, getAllIds } from './state.js';
import { setTabStatus, startClaudePoll, stopClaudePoll } from './claude-poll.js';
import { deactivateTerminalTab } from './terminal-panel.js';

let _showTabCloseButton = null;
let _showTabRemoveButton = null;

function registerTabButtonFns(showClose, showRemove) {
  _showTabCloseButton = showClose;
  _showTabRemoveButton = showRemove;
}

const editorArea = document.getElementById('editor-area');
const placeholder = document.getElementById('editor-placeholder');
const titlebarCommitBtn = document.getElementById('btn-titlebar-commit');
const titlebarCreatePrBtn = document.getElementById('btn-titlebar-create-pr');
const titlebarOpenPrBtn = document.getElementById('btn-titlebar-open-pr');
const titlebarCompletePrBtn = document.getElementById('btn-titlebar-complete-pr');
const titlebarResolveTaskBtn = document.getElementById('btn-titlebar-resolve-task');
const titlebarOpenTaskBtn = document.getElementById('btn-titlebar-open-task');
const titlebarSwitchBtn = document.getElementById('btn-titlebar-switch');
const titlebarRunGroup = document.getElementById('titlebar-run-group');
const titlebarStartBtn = document.getElementById('btn-titlebar-start');
const titlebarDebugBtn = document.getElementById('btn-titlebar-debug');
const titlebarLaunchCombobox = document.getElementById('titlebar-launch-combobox');
const titlebarLaunchName = document.getElementById('titlebar-launch-name');
const titlebarLaunchList = document.getElementById('titlebar-launch-list');

let launchConfigs = [];
let selectedLaunchConfig = null;

const sessionPartition = window.appSession.getPartition();

// Resolves when the VS Code server signals it's ready (startup status clears).
// Also queries current status in case the event fired before this listener registered.
const serverReady = new Promise((resolve) => {
  let resolved = false;
  const done = () => { if (!resolved) { resolved = true; console.log('[serverReady] resolved'); resolve(); } };
  window.startupAPI.onStatus((msg) => {
    console.log('[serverReady] onStatus:', JSON.stringify(msg));
    if (!msg) done();
  });
  window.startupAPI.getStatus().then((msg) => {
    console.log('[serverReady] getStatus:', JSON.stringify(msg));
    if (!msg) done();
  });
});

function renderLaunchList() {
  titlebarLaunchList.innerHTML = '';
  launchConfigs.forEach(config => {
    const item = document.createElement('div');
    item.className = 'titlebar-launch-item';
    if (selectedLaunchConfig && config.name === selectedLaunchConfig.name) item.classList.add('selected');
    item.textContent = config.name;
    item.addEventListener('click', () => {
      selectedLaunchConfig = config;
      titlebarLaunchName.textContent = config.name;
      titlebarLaunchList.classList.remove('open');
      renderLaunchList();
    });
    titlebarLaunchList.appendChild(item);
  });
}

async function loadLaunchConfigs(folderPath) {
  try {
    const configs = await window.reposAPI.launchConfigs(folderPath);
    launchConfigs = configs;
    if (configs.length > 0) {
      const stillValid = selectedLaunchConfig && configs.find(c => c.name === selectedLaunchConfig.name);
      selectedLaunchConfig = stillValid || configs[0];
      titlebarLaunchName.textContent = selectedLaunchConfig.name;
      titlebarRunGroup.classList.add('visible');
      titlebarStartBtn.classList.add('visible');
      titlebarDebugBtn.classList.add('visible');
    } else {
      titlebarRunGroup.classList.remove('visible');
      titlebarStartBtn.classList.remove('visible');
      titlebarDebugBtn.classList.remove('visible');
      launchConfigs = [];
      selectedLaunchConfig = null;
    }
  } catch {
    titlebarRunGroup.classList.remove('visible');
    titlebarStartBtn.classList.remove('visible');
    titlebarDebugBtn.classList.remove('visible');
  }
}

titlebarLaunchCombobox.addEventListener('click', () => {
  if (titlebarLaunchList.classList.contains('open')) {
    titlebarLaunchList.classList.remove('open');
  } else {
    renderLaunchList();
    titlebarLaunchList.classList.add('open');
  }
});

document.addEventListener('click', (e) => {
  if (!titlebarLaunchCombobox.contains(e.target)) {
    titlebarLaunchList.classList.remove('open');
  }
});

titlebarStartBtn.addEventListener('click', () => {
  const ws = getActive();
  if (!ws) return;
  ws.webview.focus();
  ws.webview.sendInputEvent({ type: 'keyDown', keyCode: 'F5', modifiers: ['control'] });
  ws.webview.sendInputEvent({ type: 'keyUp', keyCode: 'F5', modifiers: ['control'] });
});

titlebarDebugBtn.addEventListener('click', () => {
  const ws = getActive();
  if (!ws) return;
  ws.webview.focus();
  ws.webview.sendInputEvent({ type: 'keyDown', keyCode: 'F5', modifiers: [] });
  ws.webview.sendInputEvent({ type: 'keyUp', keyCode: 'F5', modifiers: [] });
});

const allTitlebarActionBtns = [titlebarCommitBtn, titlebarCreatePrBtn, titlebarOpenPrBtn, titlebarCompletePrBtn, titlebarResolveTaskBtn, titlebarOpenTaskBtn, titlebarSwitchBtn];

function updateTitlebarActions(hasActive) {
  if (!hasActive) {
    for (const btn of allTitlebarActionBtns) btn.classList.remove('visible');
    titlebarRunGroup.classList.remove('visible');
    titlebarStartBtn.classList.remove('visible');
    titlebarDebugBtn.classList.remove('visible');
    launchConfigs = [];
    selectedLaunchConfig = null;
    return;
  }
  syncTitlebarToTab();
}

function syncTitlebarToTab() {
  const ws = getActive();
  if (!ws) {
    for (const btn of allTitlebarActionBtns) btn.classList.remove('visible');
    return;
  }
  const tabEl = ws.tabEl;

  // Use the same logic as context-menu.js showContextMenu
  const isOpen = tabEl._workspaceId !== null;
  const hasTask = !!tabEl._wtTaskId;
  const hasPr = !!tabEl._existingPrUrl;
  const canComplete = tabEl._completePrState === 'can-complete';
  const canResolve = tabEl._completePrState === 'can-resolve';
  const hasChanges = !!tabEl._hasUncommittedChanges;
  const hasPushed = !!tabEl._hasPushedCommits;
  const showCreatePr = !hasChanges && hasPushed && !hasPr && !canComplete && !canResolve;

  titlebarCommitBtn.classList.toggle('visible', isOpen && hasChanges);
  titlebarCreatePrBtn.classList.toggle('visible', showCreatePr);
  titlebarOpenPrBtn.classList.toggle('visible', hasPr);
  titlebarCompletePrBtn.classList.toggle('visible', !hasChanges && canComplete);
  titlebarResolveTaskBtn.classList.toggle('visible', !hasChanges && canResolve);
  titlebarOpenTaskBtn.classList.toggle('visible', hasTask);
  titlebarSwitchBtn.classList.toggle('visible', true);

  // Sync open-pr button color to PR state
  if (hasPr) {
    const createPrBtn = tabEl.querySelector('.workspace-tab-create-pr');
    let color = 'var(--accent)';
    if (createPrBtn && createPrBtn.classList.contains('has-pr-approved')) color = 'var(--green)';
    else if (createPrBtn && createPrBtn.classList.contains('has-pr-failed')) color = 'var(--red)';
    else if (createPrBtn && createPrBtn.classList.contains('has-pr-comments')) color = 'var(--peach)';
    else if (createPrBtn && createPrBtn.classList.contains('has-pr-succeeded')) color = 'var(--yellow)';
    titlebarOpenPrBtn.style.color = color;
  }
}

async function openWorktree(tabEl, wt) {
  console.log('[openWorktree] called for', wt.path);
  // If already opened, just switch to it
  if (tabEl._workspaceId !== null && getWorkspace(tabEl._workspaceId)) {
    console.log('[openWorktree] already open, switching to', tabEl._workspaceId);
    switchWorkspace(tabEl._workspaceId);
    return;
  }

  const id = nextId();
  console.log('[openWorktree] waiting for serverReady...');
  await serverReady;
  console.log('[openWorktree] serverReady resolved, requesting URL...');
  const url = await window.codeServerAPI.openFolder(wt.path);
  console.log('[openWorktree] URL:', url);

  // Check if server is reachable; restart immediately if not
  try {
    await fetch(url, { mode: 'no-cors' });
    console.log('[openWorktree] probe ok');
  } catch (err) {
    console.warn('[openWorktree] server not reachable, restarting VS Code server...', err.message);
    try {
      await window.codeServerAPI.restartServer();
      console.log('[openWorktree] server restarted successfully');
    } catch (restartErr) {
      console.error('[openWorktree] server restart failed:', restartErr.message);
    }
  }

  const webview = document.createElement('webview');
  webview.className = 'workspace-webview';
  webview.id = `workspace-${id}`;
  webview.setAttribute('src', url);
  webview.setAttribute('partition', await sessionPartition);
  webview.setAttribute('allowpopups', 'true');
  webview.setAttribute('disableblinkfeatures', 'Auxclick');
  editorArea.appendChild(webview);

  // Retry loading if the webview fails to connect
  webview.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -102 /* ERR_CONNECTION_REFUSED */ || e.errorCode === -7 /* ERR_TIMED_OUT */) {
      console.warn(`[openWorktree] webview load failed (code ${e.errorCode}), retrying in 2s...`);
      setTimeout(() => webview.reload(), 2000);
    }
  });

  // Suppress popups that navigate to external URLs (e.g. Azure CDN 404s when opening diffs)
  webview.addEventListener('new-window', (e) => {
    const popupUrl = e.url || '';
    e.preventDefault();

    // Allow local VS Code server URLs to open inside the webview
    if (popupUrl.startsWith(`http://127.0.0.1:`)) {
      webview.loadURL(popupUrl);
      return;
    }

    // Handle vscode://file/... links (e.g. Claude Code file references) — open inside the webview
    if (popupUrl.startsWith('vscode://file/')) {
      const currentUrl = new URL(webview.getURL());
      const port = currentUrl.port;
      const token = currentUrl.searchParams.get('tkn');
      const folder = currentUrl.searchParams.get('folder');
      if (port && token && folder) {
        // Parse path from vscode://file/C:/path/to/file:line:col
        let filePart = popupUrl.slice('vscode://file/'.length);
        // Windows paths arrive as /C:/... — strip leading slash
        if (/^\/[A-Za-z]:/.test(filePart)) filePart = filePart.slice(1);
        // Strip optional :line and :line:col suffix (digits only, not the drive-letter colon)
        filePart = filePart.replace(/:(\d+)(?::(\d+))?$/, '');
        // Build VS Code remote URI
        let normalized = filePart.replace(/\\/g, '/');
        if (/^[A-Za-z]:/.test(normalized)) normalized = '/' + normalized;
        const fileUri = `vscode-remote://localhost:${port}${normalized}`;
        const openUrl = `http://127.0.0.1:${port}/?tkn=${encodeURIComponent(token)}&folder=${encodeURIComponent(folder)}&open-file=${encodeURIComponent(fileUri)}`;
        webview.loadURL(openUrl);
      }
      return;
    }

    // Block all other popups (external CDN requests that cause 404 errors)
  });

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
  if (_showTabCloseButton) _showTabCloseButton(tabEl);

  addWorkspace(id, {
    folderPath: wt.path,
    name: wt.branch,
    webview,
    tabEl
  });

  startClaudePoll(id);
  switchWorkspace(id);
}

function switchWorkspace(id) {
  // Always hide terminal and deactivate its tab
  const terminalPanel = document.getElementById('clone-terminal');
  if (terminalPanel.classList.contains('active')) {
    terminalPanel.classList.remove('active');
  }
  deactivateTerminalTab();

  const activeId = getActiveId();
  if (activeId === id) {
    // Re-activate the workspace visually (may have been hidden by terminal)
    const ws = getWorkspace(id);
    if (ws) {
      ws.webview.classList.add('active');
      ws.tabEl.classList.add('active');
      if (ws.tabEl._dotEl) ws.tabEl._dotEl.classList.add('active');
      placeholder.style.display = 'none';
    }
    return;
  }

  if (activeId !== null) {
    const prev = getWorkspace(activeId);
    if (prev) {
      prev.webview.classList.remove('active');
      prev.tabEl.classList.remove('active');
      if (prev.tabEl._dotEl) prev.tabEl._dotEl.classList.remove('active');
    }
  }

  const ws = getWorkspace(id);
  if (ws) {
    ws.webview.classList.add('active');
    ws.tabEl.classList.add('active');
    if (ws.tabEl._dotEl) ws.tabEl._dotEl.classList.add('active');
    setActiveId(id);
    placeholder.style.display = 'none';
    const status = ws.tabEl.dataset.status;
    if (status !== 'working' && status !== 'waiting' && status !== 'error') {
      setTabStatus(ws.tabEl, 'open');
    }
    document.querySelector('.titlebar-title').textContent = `CodeHive — ${ws.name}`;
    updateTitlebarActions(true);
    loadLaunchConfigs(ws.folderPath);
  }
}

function closeWorkspace(id) {
  const ws = getWorkspace(id);
  if (!ws) return;

  stopClaudePoll(id);
  ws.webview.remove();
  ws.tabEl.classList.remove('active');
  ws.tabEl._workspaceId = null;
  ws.tabEl._wasWorking = false;
  setTabStatus(ws.tabEl, 'idle');
  if (_showTabRemoveButton) _showTabRemoveButton(ws.tabEl);
  removeWorkspace(id);

  if (getActiveId() === id) {
    setActiveId(null);
    const remaining = getAllIds();
    if (remaining.length > 0) {
      switchWorkspace(remaining[remaining.length - 1]);
    } else {
      placeholder.style.display = 'flex';
      document.querySelector('.titlebar-title').textContent = 'CodeHive';
      updateTitlebarActions(false);
    }
  }
}

function cycleWorkspace(forward) {
  const ids = getAllIds();
  if (ids.length <= 1) return;
  const idx = ids.indexOf(getActiveId());
  const next = forward ? (idx + 1) % ids.length : (idx - 1 + ids.length) % ids.length;
  switchWorkspace(ids[next]);
}

export { openWorktree, switchWorkspace, closeWorkspace, cycleWorkspace, registerTabButtonFns, syncTitlebarToTab };
