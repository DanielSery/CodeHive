import { getActive, getActiveId } from './state.js';
import { XTERM_OPTIONS } from '../shared/xterm-config.js';

const terminalEl = document.getElementById('clone-terminal');
const xtermContainerEl = document.getElementById('clone-terminal-xterm');
const titleEl = document.getElementById('clone-terminal-title');
const closeBtn = document.getElementById('clone-terminal-close');
const placeholder = document.getElementById('editor-placeholder');
const sidebarTab = document.getElementById('sidebar-terminal-tab');
const collapsedTerminalBtn = document.getElementById('collapsed-terminal-btn');
const terminalContextMenu = document.getElementById('terminal-context-menu');

let xterm = null;
let fitAddon = null;
const _registeredPtyApis = [];

export function registerPtyApi(api) {
  _registeredPtyApis.push(api);
}

function createTerminal() {
  if (xterm) {
    xterm.dispose();
  }
  xterm = new Terminal(XTERM_OPTIONS);
  fitAddon = new (FitAddon.FitAddon || FitAddon)();
  xterm.loadAddon(fitAddon);
  xterm.open(xtermContainerEl);
  fitAddon.fit();
  xterm.attachCustomKeyEventHandler((e) => {
    if (e.ctrlKey && e.key === 'c' && e.type === 'keydown') {
      const selection = xterm.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
        return false;
      }
    }
    return true;
  });
  return xterm;
}

function showTerminal(title) {
  titleEl.textContent = title;
  closeBtn.style.display = 'none';
  terminalEl.classList.add('active');
  placeholder.style.display = 'none';
  sidebarTab.classList.add('active');
  collapsedTerminalBtn.classList.add('active');

  // Deselect active worktree tab visually
  const ws = getActive();
  if (ws) {
    ws.webview.classList.remove('active');
    ws.tabEl.classList.remove('active');
    if (ws.tabEl._dotEl) ws.tabEl._dotEl.classList.remove('active');
  }
}

function showCloseButton() {
  closeBtn.style.display = 'block';
}

function setTitle(title) {
  titleEl.textContent = title;
}

function hideTerminal() {
  terminalEl.classList.remove('active');
}

function deactivateTerminalTab() {
  sidebarTab.classList.remove('active');
  collapsedTerminalBtn.classList.remove('active');
}

function closeTerminal() {
  terminalEl.classList.remove('active');
  sidebarTab.classList.remove('active');
  collapsedTerminalBtn.classList.remove('active');
  for (const api of _registeredPtyApis) api.removeListeners();

  // Restore previous view
  const ws = getActive();
  if (ws) {
    ws.webview.classList.add('active');
    ws.tabEl.classList.add('active');
    if (ws.tabEl._dotEl) ws.tabEl._dotEl.classList.add('active');
  } else {
    placeholder.style.display = 'flex';
  }
}

function toggleTerminal() {
  if (isActive()) {
    // Hide terminal, restore workspace
    terminalEl.classList.remove('active');
    sidebarTab.classList.remove('active');
    collapsedTerminalBtn.classList.remove('active');
    const ws = getActive();
    if (ws) {
      ws.webview.classList.add('active');
      ws.tabEl.classList.add('active');
      if (ws.tabEl._dotEl) ws.tabEl._dotEl.classList.add('active');
    } else {
      placeholder.style.display = 'flex';
    }
  } else {
    // Create empty terminal if none exists
    if (!xterm) createTerminal();
    terminalEl.classList.add('active');
    sidebarTab.classList.add('active');
    collapsedTerminalBtn.classList.add('active');
    placeholder.style.display = 'none';
    // Deselect active worktree tab visually
    const ws = getActive();
    if (ws) {
      ws.webview.classList.remove('active');
      ws.tabEl.classList.remove('active');
      if (ws.tabEl._dotEl) ws.tabEl._dotEl.classList.remove('active');
    }
    fit();
  }
}

function getXterm() {
  return xterm;
}

function fit() {
  if (fitAddon && terminalEl.classList.contains('active')) {
    fitAddon.fit();
  }
}

function isActive() {
  return terminalEl.classList.contains('active');
}

closeBtn.addEventListener('click', closeTerminal);
sidebarTab.addEventListener('click', toggleTerminal);
collapsedTerminalBtn.addEventListener('click', toggleTerminal);

xtermContainerEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const selection = xterm?.getSelection();
  if (!selection) return;
  terminalContextMenu.style.left = e.clientX + 'px';
  terminalContextMenu.style.top = e.clientY + 'px';
  terminalContextMenu.classList.add('visible');
  requestAnimationFrame(() => {
    const rect = terminalContextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) terminalContextMenu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    if (rect.bottom > window.innerHeight) terminalContextMenu.style.top = (window.innerHeight - rect.height - 4) + 'px';
  });
});

terminalContextMenu.addEventListener('click', (e) => {
  const item = e.target.closest('.context-menu-item');
  if (!item) return;
  terminalContextMenu.classList.remove('visible');
  if (item.dataset.action === 'copy') {
    const selection = xterm?.getSelection();
    if (selection) navigator.clipboard.writeText(selection);
  }
});

document.addEventListener('click', () => terminalContextMenu.classList.remove('visible'));
document.addEventListener('contextmenu', (e) => {
  if (!terminalContextMenu.contains(e.target)) terminalContextMenu.classList.remove('visible');
});

window.addEventListener('resize', () => {
  if (!isActive()) return;
  fit();
});

export const terminal = {
  show(title) {
    showTerminal(title);
    createTerminal();
  },
  write(data) {
    xterm?.write(data);
  },
  writeln(text) {
    xterm?.writeln(text);
  },
  setTitle,
  showCloseButton,
  close: closeTerminal,
};

export { createTerminal, showTerminal, showCloseButton, setTitle, hideTerminal, deactivateTerminalTab, closeTerminal, toggleTerminal, getXterm, fit };
