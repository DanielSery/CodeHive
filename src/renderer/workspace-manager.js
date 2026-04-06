import { getWorkspace, getActive, getActiveId, setActiveId, nextId, addWorkspace, removeWorkspace, getAllIds } from './state.js';
import { setTabStatus, startClaudePoll, stopClaudePoll } from './claude-poll.js';
import { hideTerminal, deactivateTerminalTab } from './terminal-panel.js';
import { getWtState } from './worktree-state.js';
import { DOT_SWITCH_SVG, DOT_DONE_SWITCH_SVG, DOT_SYNC_SVG } from './sidebar/worktree-tab-icons.js';

let _showTabCloseButton = null;
let _showTabRemoveButton = null;

function registerTabButtonFns(showClose, showRemove) {
  _showTabCloseButton = showClose;
  _showTabRemoveButton = showRemove;
}

const editorArea = document.getElementById('editor-area');
const placeholder = document.getElementById('editor-placeholder');
const titlebarOpenExplorerBtn = document.getElementById('btn-titlebar-open-explorer');
const titlebarGitAppBtn = document.getElementById('btn-titlebar-git-app');
const titlebarSwitchBtn = document.getElementById('btn-titlebar-switch');
const titlebarCommitBtn = document.getElementById('btn-titlebar-commit');
const titlebarCreatePrBtn = document.getElementById('btn-titlebar-create-pr');
const titlebarCompletePrBtn = document.getElementById('btn-titlebar-complete-pr');
const titlebarOpenPipelineBtn = document.getElementById('btn-titlebar-open-pipeline');
const titlebarInstallBtn = document.getElementById('btn-titlebar-install');
const titlebarResolveTaskBtn = document.getElementById('btn-titlebar-resolve-task');
const titlebarSetTaskBtn = document.getElementById('btn-titlebar-set-task');
const titlebarOpenTaskBtn = document.getElementById('btn-titlebar-open-task');
const titlebarOpenPrBtn = document.getElementById('btn-titlebar-open-pr');
const titlebarOpenMergedPrBtn = document.getElementById('btn-titlebar-open-merged-pr');
const titlebarRemoveBtn = document.getElementById('btn-titlebar-remove');
const titlebarSep1 = document.getElementById('titlebar-sep-1');
const titlebarSep2 = document.getElementById('titlebar-sep-2');

const sessionPartition = window.appSession.getPartition();

// Shared handler for URLs that VS Code tries to open in a new window.
// Used by both the (legacy) new-window webview event and the main-process setWindowOpenHandler.
function handleWebviewLink(webview, url) {
  if (!url) return;

  // vscode://file/... links — open file inside the webview
  if (url.startsWith('vscode://file/')) {
    const currentUrl = new URL(webview.getURL());
    const port = currentUrl.port;
    const token = currentUrl.searchParams.get('tkn');
    const folder = currentUrl.searchParams.get('folder');
    if (port && token && folder) {
      let filePart = url.slice('vscode://file/'.length);
      if (/^\/[A-Za-z]:/.test(filePart)) filePart = filePart.slice(1);
      filePart = filePart.replace(/:(\d+)(?::(\d+))?$/, '');
      let normalized = filePart.replace(/\\/g, '/');
      if (/^[A-Za-z]:/.test(normalized)) normalized = '/' + normalized;
      const fileUri = `vscode-remote://localhost:${port}${normalized}`;
      const openUrl = `http://127.0.0.1:${port}/?tkn=${encodeURIComponent(token)}&folder=${encodeURIComponent(folder)}&open-file=${encodeURIComponent(fileUri)}`;
      webview.loadURL(openUrl);
    }
    return;
  }

  // http://127.0.0.1: URLs — load in webview, but intercept file-like paths
  if (url.startsWith('http://127.0.0.1:')) {
    const parsedUrl = new URL(url);
    const pathPart = parsedUrl.pathname;
    if (/\.\w{1,10}$/.test(pathPart) && !parsedUrl.search) {
      const currentUrl = new URL(webview.getURL());
      const port = currentUrl.port;
      const token = currentUrl.searchParams.get('tkn');
      const folder = currentUrl.searchParams.get('folder');
      if (port && token && folder) {
        let absPath;
        if (/^\/[A-Za-z]:\//.test(pathPart)) {
          absPath = pathPart.slice(1);
        } else {
          let folderPath = '';
          try {
            const folderUri = new URL(folder);
            folderPath = folderUri.pathname;
            if (/^\/[A-Za-z]:/.test(folderPath)) folderPath = folderPath.slice(1);
          } catch {}
          const relPath = pathPart.startsWith('/') ? pathPart.slice(1) : pathPart;
          absPath = (folderPath + '/' + relPath).replace(/\\/g, '/');
        }
        let normalized = absPath.replace(/\\/g, '/');
        if (/^[A-Za-z]:/.test(normalized)) normalized = '/' + normalized;
        const fileUri = `vscode-remote://localhost:${port}${normalized}`;
        const openUrl = `http://127.0.0.1:${port}/?tkn=${encodeURIComponent(token)}&folder=${encodeURIComponent(folder)}&open-file=${encodeURIComponent(fileUri)}`;
        webview.loadURL(openUrl);
        return;
      }
    }
    webview.loadURL(url);
    return;
  }
  // Block everything else (external CDN requests, etc.)
}

// Handle window-open events forwarded from the main process via setWindowOpenHandler.
// This is the Electron 14+ replacement for the webview's deprecated new-window event.
window.webviewEventsAPI.onWindowOpen((url) => {
  const ws = getActive();
  if (!ws) return;
  handleWebviewLink(ws.webview, url);
});

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

const allTitlebarActionBtns = [titlebarOpenExplorerBtn, titlebarGitAppBtn, titlebarSwitchBtn, titlebarCommitBtn, titlebarCreatePrBtn, titlebarCompletePrBtn, titlebarOpenPipelineBtn, titlebarInstallBtn, titlebarResolveTaskBtn, titlebarSetTaskBtn, titlebarOpenTaskBtn, titlebarOpenPrBtn, titlebarOpenMergedPrBtn, titlebarRemoveBtn];

function updateTitlebarActions(hasActive) {
  if (!hasActive) {
    for (const btn of allTitlebarActionBtns) btn.classList.remove('visible');
    titlebarSep1.style.display = 'none';
    titlebarSep2.style.display = 'none';
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
  const wtState = getWtState(tabEl._wtPath);

  const hasTask = !!tabEl._wtTaskId;
  const hasPr = !!wtState?.existingPrUrl;
  const hasMergedPr = !!wtState?.mergedPrUrl;
  const canComplete = !!wtState?.canCompletePr;
  const canResolve = !!wtState?.canResolveTask;
  const hasChanges = !!wtState?.hasUncommittedChanges;
  const hasPushed = !!wtState?.hasPushedCommits;
  const showCreatePr = !hasChanges && hasPushed && !hasPr && !canComplete && !canResolve;

  const canOpenPipeline = !!wtState?.canOpenPipeline && !!wtState?.pipelineUrl && wtState?.pipelineStatus !== 'succeeded';
  const installBtn = tabEl.querySelector('.workspace-tab-install-btn');
  const canInstall = !!installBtn && installBtn.style.display !== 'none';

  titlebarSwitchBtn.innerHTML = wtState?.taskResolved ? DOT_DONE_SWITCH_SVG : DOT_SWITCH_SVG;

  titlebarCommitBtn.innerHTML = DOT_SYNC_SVG;
  titlebarCommitBtn.style.color = '';

  titlebarSep1.style.display = '';
  titlebarSep2.style.display = '';
  titlebarOpenExplorerBtn.classList.toggle('visible', true);
  titlebarGitAppBtn.classList.toggle('visible', true);
  titlebarSwitchBtn.classList.toggle('visible', true);
  titlebarCommitBtn.classList.toggle('visible', hasChanges);
  titlebarCreatePrBtn.classList.toggle('visible', showCreatePr);
  titlebarCompletePrBtn.classList.toggle('visible', !hasChanges && canComplete);
  titlebarOpenPipelineBtn.classList.toggle('visible', !hasChanges && canOpenPipeline);
  titlebarInstallBtn.classList.toggle('visible', !hasChanges && canInstall);
  titlebarResolveTaskBtn.classList.toggle('visible', !hasChanges && canResolve);
  titlebarSetTaskBtn.classList.toggle('visible', !hasTask);
titlebarOpenTaskBtn.classList.toggle('visible', hasTask);

  titlebarOpenPrBtn.classList.toggle('visible', hasPr);

  titlebarOpenMergedPrBtn.classList.toggle('visible', hasMergedPr);
  titlebarRemoveBtn.classList.toggle('visible', true);
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
    e.preventDefault();
    handleWebviewLink(webview, e.url || '');
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
  hideTerminal();
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
  const wtState = getWtState(ws.tabEl._wtPath);
  if (wtState) wtState.wasWorking = false;
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
