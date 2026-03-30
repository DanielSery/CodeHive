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
const titlebarOpenPipelineBtn = document.getElementById('btn-titlebar-open-pipeline');
const titlebarVerifyBtn = document.getElementById('btn-titlebar-verify');
const titlebarOpenTaskBtn = document.getElementById('btn-titlebar-open-task');
const titlebarSwitchBtn = document.getElementById('btn-titlebar-switch');

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

const allTitlebarActionBtns = [titlebarCommitBtn, titlebarCreatePrBtn, titlebarOpenPrBtn, titlebarCompletePrBtn, titlebarResolveTaskBtn, titlebarOpenPipelineBtn, titlebarVerifyBtn, titlebarOpenTaskBtn, titlebarSwitchBtn];

function updateTitlebarActions(hasActive) {
  if (!hasActive) {
    for (const btn of allTitlebarActionBtns) btn.classList.remove('visible');
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

  const isOpen = tabEl._workspaceId !== null;
  const hasTask = !!tabEl._wtTaskId;
  const hasPr = !!tabEl._existingPrUrl;
  const canComplete = !!tabEl._canCompletePr;
  const canResolve = !!tabEl._canResolveTask;
  const hasChanges = !!tabEl._hasUncommittedChanges;
  const hasPushed = !!tabEl._hasPushedCommits;
  const showCreatePr = !hasChanges && hasPushed && !hasPr && !canComplete && !canResolve;

  const canOpenPipeline = !!tabEl._canOpenPipeline && !tabEl._pipelineVerified && tabEl._pipelineStatus !== 'succeeded';
  const canVerify = !!tabEl._canVerify && !tabEl._pipelineVerified;

  titlebarCommitBtn.classList.toggle('visible', isOpen && hasChanges);
  titlebarCreatePrBtn.classList.toggle('visible', showCreatePr);
  titlebarCompletePrBtn.classList.toggle('visible', !hasChanges && canComplete);
  titlebarResolveTaskBtn.classList.toggle('visible', !hasChanges && canResolve);
  titlebarOpenPipelineBtn.classList.toggle('visible', !hasChanges && canOpenPipeline);
  if (canOpenPipeline) {
    let color = 'var(--accent)';
    if (tabEl._pipelineStatus === 'running') color = 'var(--yellow)';
    else if (tabEl._pipelineStatus === 'failed') color = 'var(--red)';
    titlebarOpenPipelineBtn.style.color = color;
  } else {
    titlebarOpenPipelineBtn.style.color = '';
  }
  titlebarVerifyBtn.classList.toggle('visible', !hasChanges && canVerify);
  titlebarOpenTaskBtn.classList.toggle('visible', hasTask);
  titlebarSwitchBtn.classList.toggle('visible', true);

  // Open PR button with status coloring
  const showOpenPr = hasPr && !hasChanges && !canComplete;
  titlebarOpenPrBtn.classList.toggle('visible', showOpenPr);
  if (showOpenPr) {
    const openPrBtn = tabEl.querySelector('.workspace-tab-open-pr');
    let color = 'var(--accent)';
    if (openPrBtn && openPrBtn.classList.contains('has-pr-approved')) color = 'var(--green)';
    else if (openPrBtn && openPrBtn.classList.contains('has-pr-failed')) color = 'var(--red)';
    else if (openPrBtn && openPrBtn.classList.contains('has-pr-comments')) color = 'var(--peach)';
    else if (openPrBtn && openPrBtn.classList.contains('has-pr-succeeded')) color = 'var(--yellow)';
    titlebarOpenPrBtn.style.color = color;
  } else {
    titlebarOpenPrBtn.style.color = '';
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

  let retryTimer = null;

  // Retry loading if the webview fails to connect
  const onFailLoad = (e) => {
    if (e.errorCode === -102 /* ERR_CONNECTION_REFUSED */ || e.errorCode === -7 /* ERR_TIMED_OUT */) {
      console.warn(`[openWorktree] webview load failed (code ${e.errorCode}), retrying in 2s...`);
      retryTimer = setTimeout(() => {
        if (webview.isConnected) webview.reload();
      }, 2000);
    }
  };

  // Suppress popups that navigate to external URLs (e.g. Azure CDN 404s when opening diffs)
  const onNewWindow = (e) => {
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
  };

  // F11 is "step into" in VS Code — prevent Chromium from using it for fullscreen
  const onEnterFullScreen = () => webview.getWebContents().exitFullScreen();

  const onFinishLoad = () => {
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
      .quick-input-widget {
        margin-top: 35px !important;
      }
    `).catch(() => {});
  };

  webview.addEventListener('did-fail-load', onFailLoad);
  webview.addEventListener('new-window', onNewWindow);
  webview.addEventListener('did-finish-load', onFinishLoad);
  webview.addEventListener('enter-html-full-screen', onEnterFullScreen);

  // Store cleanup function for use when closing the workspace
  webview._cleanup = () => {
    if (retryTimer) clearTimeout(retryTimer);
    webview.removeEventListener('did-fail-load', onFailLoad);
    webview.removeEventListener('new-window', onNewWindow);
    webview.removeEventListener('did-finish-load', onFinishLoad);
    webview.removeEventListener('enter-html-full-screen', onEnterFullScreen);
  };

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
  }
}

function closeWorkspace(id) {
  const ws = getWorkspace(id);
  if (!ws) return;

  stopClaudePoll(id);
  if (ws.webview._cleanup) ws.webview._cleanup();
  ws.webview.remove();
  ws.tabEl.classList.remove('active');
  if (ws.tabEl._dotEl) ws.tabEl._dotEl.classList.remove('active');
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
