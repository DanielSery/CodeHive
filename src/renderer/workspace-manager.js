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
const titlebarPrBtn = document.getElementById('btn-titlebar-pr');
const titlebarRunGroup = document.getElementById('titlebar-run-group');
const titlebarStartBtn = document.getElementById('btn-titlebar-start');
const titlebarDebugBtn = document.getElementById('btn-titlebar-debug');
const titlebarLaunchCombobox = document.getElementById('titlebar-launch-combobox');
const titlebarLaunchName = document.getElementById('titlebar-launch-name');
const titlebarLaunchList = document.getElementById('titlebar-launch-list');

let launchConfigs = [];
let selectedLaunchConfig = null;

// Resolves when the VS Code server signals it's ready (startup status clears).
// Also queries current status in case the event fired before this listener registered.
const serverReady = new Promise((resolve) => {
  let resolved = false;
  const done = () => { if (!resolved) { resolved = true; resolve(); } };
  window.startupAPI.onStatus((msg) => { if (!msg) done(); });
  window.startupAPI.getStatus().then((msg) => { if (!msg) done(); });
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

function updateTitlebarActions(hasActive) {
  titlebarCommitBtn.classList.toggle('visible', hasActive);
  titlebarPrBtn.classList.toggle('visible', hasActive);
  if (!hasActive) {
    titlebarRunGroup.classList.remove('visible');
    titlebarStartBtn.classList.remove('visible');
    titlebarDebugBtn.classList.remove('visible');
    launchConfigs = [];
    selectedLaunchConfig = null;
  }
}

async function openWorktree(tabEl, wt) {
  // If already opened, just switch to it
  if (tabEl._workspaceId !== null && getWorkspace(tabEl._workspaceId)) {
    switchWorkspace(tabEl._workspaceId);
    return;
  }

  const id = nextId();
  await serverReady;
  const url = await window.codeServerAPI.openFolder(wt.path);

  const webview = document.createElement('webview');
  webview.className = 'workspace-webview';
  webview.id = `workspace-${id}`;
  webview.setAttribute('src', url);
  webview.setAttribute('partition', 'persist:codehive');
  webview.setAttribute('allowpopups', 'true');
  webview.setAttribute('disableblinkfeatures', 'Auxclick');
  editorArea.appendChild(webview);

  // Suppress popups that navigate to external URLs (e.g. Azure CDN 404s when opening diffs)
  webview.addEventListener('new-window', (e) => {
    const popupUrl = e.url || '';
    // Allow local VS Code server URLs to open inside the webview
    if (popupUrl.startsWith(`http://127.0.0.1:`)) {
      e.preventDefault();
      webview.loadURL(popupUrl);
      return;
    }
    // Block all other popups (external CDN requests that cause 404 errors)
    e.preventDefault();
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

export { openWorktree, switchWorkspace, closeWorkspace, cycleWorkspace, registerTabButtonFns };
