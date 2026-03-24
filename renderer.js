// ===== State =====
const workspaces = new Map();
let activeWorkspaceId = null;
let workspaceCounter = 0;

// Workspace colors for visual distinction
const WORKSPACE_COLORS = [
  '#89b4fa', '#a6e3a1', '#f9e2af', '#f38ba8',
  '#cba6f7', '#94e2d5', '#fab387', '#f5c2e7'
];

// DOM refs
const workspaceTabsEl = document.getElementById('workspace-tabs');
const editorArea = document.getElementById('editor-area');
const placeholder = document.getElementById('editor-placeholder');

// ===== Workspaces =====

async function addWorkspace(folderPath, name) {
  const id = ++workspaceCounter;
  const color = WORKSPACE_COLORS[(id - 1) % WORKSPACE_COLORS.length];
  const displayName = name || folderPath.split(/[/\\]/).pop() || `Workspace ${id}`;

  const url = await window.codeServerAPI.openFolder(folderPath);

  // Create webview
  const webview = document.createElement('webview');
  webview.className = 'workspace-webview';
  webview.id = `workspace-${id}`;
  webview.setAttribute('src', url);
  webview.setAttribute('allowpopups', 'true');
  webview.setAttribute('disableblinkfeatures', 'Auxclick');
  editorArea.appendChild(webview);

  // Customize VS Code: show only Explorer, Source Control, Search, Extensions, Claude
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

  // Create sidebar tab
  const tabEl = document.createElement('div');
  tabEl.className = 'workspace-tab';
  tabEl.dataset.id = id;
  tabEl.innerHTML = `
    <span class="workspace-tab-color" style="background: ${color}"></span>
    <span class="workspace-tab-label">${displayName}</span>
    <button class="workspace-tab-close" title="Close">&times;</button>
  `;

  tabEl.addEventListener('click', (e) => {
    if (!e.target.classList.contains('workspace-tab-close')) {
      switchWorkspace(id);
    }
  });

  tabEl.querySelector('.workspace-tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeWorkspace(id);
  });

  tabEl.addEventListener('dblclick', () => renameWorkspace(id));
  tabEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e, [
      { label: 'Rename', action: () => renameWorkspace(id) },
      { separator: true },
      { label: 'Close', action: () => closeWorkspace(id) }
    ]);
  });

  // Drag & drop
  tabEl.draggable = true;
  tabEl.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', id.toString());
    tabEl.classList.add('dragging');
  });
  tabEl.addEventListener('dragend', () => tabEl.classList.remove('dragging'));
  tabEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = workspaceTabsEl.querySelector('.dragging');
    if (dragging && dragging !== tabEl) {
      const rect = tabEl.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (e.clientY < mid) workspaceTabsEl.insertBefore(dragging, tabEl);
      else workspaceTabsEl.insertBefore(dragging, tabEl.nextSibling);
    }
  });

  workspaceTabsEl.appendChild(tabEl);

  workspaces.set(id, { folderPath, name: displayName, color, webview, tabEl });
  switchWorkspace(id);
}

function switchWorkspace(id) {
  if (activeWorkspaceId === id) return;

  // Deactivate current
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
  ws.tabEl.remove();
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

function renameWorkspace(id) {
  const ws = workspaces.get(id);
  if (!ws) return;

  const labelEl = ws.tabEl.querySelector('.workspace-tab-label');
  const currentName = ws.name;

  const input = document.createElement('input');
  input.value = currentName;
  labelEl.textContent = '';
  labelEl.appendChild(input);
  input.focus();
  input.select();

  const finish = () => {
    const newName = input.value.trim() || currentName;
    ws.name = newName;
    labelEl.textContent = newName;
    if (activeWorkspaceId === id) {
      document.querySelector('.titlebar-title').textContent = `DevShell — ${newName}`;
    }
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    else if (e.key === 'Escape') { input.value = currentName; input.blur(); }
  });
}

// ===== Add Workspace Dialog =====

function showAddWorkspaceDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog">
      <h3>Add Workspace</h3>
      <input type="text" id="folder-input" placeholder="Enter folder path (e.g., C:\\Repos\\my-project)" autofocus>
      <div class="dialog-buttons">
        <button class="dialog-btn" id="dialog-cancel">Cancel</button>
        <button class="dialog-btn dialog-btn-primary" id="dialog-ok">Open</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const input = overlay.querySelector('#folder-input');
  const cancel = overlay.querySelector('#dialog-cancel');
  const ok = overlay.querySelector('#dialog-ok');

  const close = () => overlay.remove();

  const submit = () => {
    const path = input.value.trim();
    if (path) {
      addWorkspace(path);
      close();
    }
  };

  cancel.addEventListener('click', close);
  ok.addEventListener('click', submit);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') close();
  });

  input.focus();
}

// ===== Context Menu =====

function showContextMenu(event, items) {
  const existing = document.querySelector('.context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = event.clientX + 'px';
  menu.style.top = event.clientY + 'px';

  items.forEach(item => {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      menu.appendChild(sep);
    } else {
      const el = document.createElement('div');
      el.className = 'context-menu-item';
      el.textContent = item.label;
      el.addEventListener('click', () => { menu.remove(); item.action(); });
      menu.appendChild(el);
    }
  });

  document.body.appendChild(menu);
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

// ===== Action Buttons =====

document.querySelectorAll('.action-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const action = btn.dataset.action;
    const ws = activeWorkspaceId ? workspaces.get(activeWorkspaceId) : null;

    switch (action) {
      case 'claude': {
        // TODO: trigger Claude in the active workspace's VS Code
        break;
      }
      case 'git-sync': {
        // TODO: trigger git sync in the active workspace's VS Code terminal
        break;
      }
      case 'build': {
        // TODO: trigger build in the active workspace's VS Code terminal
        break;
      }
    }
  });
});

// ===== Keyboard Shortcuts =====

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'n') { e.preventDefault(); showAddWorkspaceDialog(); }
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

document.getElementById('btn-new-workspace').addEventListener('click', showAddWorkspaceDialog);
document.getElementById('btn-minimize').addEventListener('click', () => window.windowAPI.minimize());
document.getElementById('btn-maximize').addEventListener('click', () => window.windowAPI.maximize());
document.getElementById('btn-close').addEventListener('click', () => window.windowAPI.close());
