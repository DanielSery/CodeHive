// xterm is loaded via script tags in index.html
// Terminal and FitAddon are available as globals

const tabs = new Map();
let activeTabId = null;
let tabCounter = 0;

const tabList = document.getElementById('tab-list');
const terminalContainer = document.getElementById('terminal-container');
const newTabBtn = document.getElementById('new-tab-btn');

// Catppuccin Mocha theme
const termTheme = {
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  cursorAccent: '#1e1e2e',
  selectionBackground: '#585b7066',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#f5c2e7',
  cyan: '#94e2d5',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#f5c2e7',
  brightCyan: '#94e2d5',
  brightWhite: '#a6adc8'
};

async function createTab(name) {
  const localId = ++tabCounter;
  const ptyId = await window.terminalAPI.createTerminal();

  const term = new Terminal({
    theme: termTheme,
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
    fontSize: 14,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 10000
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon.WebLinksAddon());

  // Create terminal DOM
  const wrapper = document.createElement('div');
  wrapper.className = 'terminal-wrapper';
  wrapper.id = `term-${localId}`;
  terminalContainer.appendChild(wrapper);

  term.open(wrapper);

  requestAnimationFrame(() => {
    fitAddon.fit();
    window.terminalAPI.resize(ptyId, term.cols, term.rows);
  });

  // Input -> pty
  term.onData((data) => {
    window.terminalAPI.sendInput(ptyId, data);
  });

  // Create tab element
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.id = localId;
  tabEl.innerHTML = `
    <span class="tab-icon">&gt;_</span>
    <span class="tab-label">${name || `Terminal ${localId}`}</span>
    <button class="tab-close" title="Close">&times;</button>
  `;

  tabEl.addEventListener('click', (e) => {
    if (!e.target.classList.contains('tab-close')) {
      switchTab(localId);
    }
  });

  tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(localId);
  });

  tabEl.addEventListener('dblclick', () => renameTab(localId));
  tabEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e, localId);
  });

  // Drag & drop reorder
  tabEl.draggable = true;
  tabEl.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', localId.toString());
    tabEl.classList.add('dragging');
  });
  tabEl.addEventListener('dragend', () => tabEl.classList.remove('dragging'));
  tabEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = tabList.querySelector('.dragging');
    if (dragging && dragging !== tabEl) {
      const rect = tabEl.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (e.clientY < mid) {
        tabList.insertBefore(dragging, tabEl);
      } else {
        tabList.insertBefore(dragging, tabEl.nextSibling);
      }
    }
  });

  tabList.appendChild(tabEl);

  tabs.set(localId, { ptyId, term, fitAddon, wrapper, tabEl, name: name || `Terminal ${localId}` });

  switchTab(localId);
  return localId;
}

function switchTab(id) {
  if (activeTabId === id) return;

  if (activeTabId !== null) {
    const prev = tabs.get(activeTabId);
    if (prev) {
      prev.wrapper.classList.remove('active');
      prev.tabEl.classList.remove('active');
    }
  }

  const tab = tabs.get(id);
  if (tab) {
    tab.wrapper.classList.add('active');
    tab.tabEl.classList.add('active');
    activeTabId = id;

    requestAnimationFrame(() => {
      tab.fitAddon.fit();
      window.terminalAPI.resize(tab.ptyId, tab.term.cols, tab.term.rows);
      tab.term.focus();
    });

    document.querySelector('.titlebar-title').textContent = tab.name;
  }
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;

  window.terminalAPI.kill(tab.ptyId);
  tab.term.dispose();
  tab.wrapper.remove();
  tab.tabEl.remove();
  tabs.delete(id);

  if (activeTabId === id) {
    activeTabId = null;
    const remaining = Array.from(tabs.keys());
    if (remaining.length > 0) {
      switchTab(remaining[remaining.length - 1]);
    } else {
      createTab();
    }
  }
}

function renameTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;

  const labelEl = tab.tabEl.querySelector('.tab-label');
  const currentName = tab.name;

  const input = document.createElement('input');
  input.value = currentName;
  labelEl.textContent = '';
  labelEl.appendChild(input);
  input.focus();
  input.select();

  const finishRename = () => {
    const newName = input.value.trim() || currentName;
    tab.name = newName;
    labelEl.textContent = newName;
    if (activeTabId === id) {
      document.querySelector('.titlebar-title').textContent = newName;
    }
  };

  input.addEventListener('blur', finishRename);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    else if (e.key === 'Escape') { input.value = currentName; input.blur(); }
  });
}

function showContextMenu(event, tabId) {
  const existing = document.querySelector('.context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = event.clientX + 'px';
  menu.style.top = event.clientY + 'px';

  const items = [
    { label: 'Rename', action: () => renameTab(tabId) },
    { label: 'Duplicate', action: () => createTab(tabs.get(tabId)?.name + ' (copy)') },
    { separator: true },
    { label: 'Close', action: () => closeTab(tabId) },
    { label: 'Close Others', action: () => closeOtherTabs(tabId) }
  ];

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

function closeOtherTabs(keepId) {
  Array.from(tabs.keys()).filter(id => id !== keepId).forEach(id => closeTab(id));
}

// Receive pty data
window.terminalAPI.onData((ptyId, data) => {
  for (const [id, tab] of tabs) {
    if (tab.ptyId === ptyId) {
      tab.term.write(data);
      break;
    }
  }
});

// Handle exit
window.terminalAPI.onExit((ptyId, exitCode) => {
  for (const [id, tab] of tabs) {
    if (tab.ptyId === ptyId) {
      tab.term.writeln(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m`);
      break;
    }
  }
});

// Resize
window.addEventListener('resize', () => {
  if (activeTabId !== null) {
    const tab = tabs.get(activeTabId);
    if (tab) {
      tab.fitAddon.fit();
      window.terminalAPI.resize(tab.ptyId, tab.term.cols, tab.term.rows);
    }
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 't') { e.preventDefault(); createTab(); }
  if (e.ctrlKey && e.key === 'w') { e.preventDefault(); if (activeTabId) closeTab(activeTabId); }
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    const ids = Array.from(tabs.keys());
    if (ids.length > 1) {
      const idx = ids.indexOf(activeTabId);
      const next = e.shiftKey ? (idx - 1 + ids.length) % ids.length : (idx + 1) % ids.length;
      switchTab(ids[next]);
    }
  }
  if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
    e.preventDefault();
    const ids = Array.from(tabs.keys());
    const idx = parseInt(e.key) - 1;
    if (idx < ids.length) switchTab(ids[idx]);
  }
});

// Title bar
document.getElementById('btn-new-tab').addEventListener('click', () => createTab());
document.getElementById('btn-minimize').addEventListener('click', () => window.terminalAPI.minimize());
document.getElementById('btn-maximize').addEventListener('click', () => window.terminalAPI.maximize());
document.getElementById('btn-close').addEventListener('click', () => window.terminalAPI.close());

// New tab
newTabBtn.addEventListener('click', () => createTab());

// Start
createTab('PowerShell');
