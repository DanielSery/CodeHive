import { getActive, getActiveId } from './state.js';
import { XTERM_OPTIONS } from '../shared/xterm-config.js';

const terminalEl = document.getElementById('clone-terminal');
const xtermContainerEl = document.getElementById('clone-terminal-xterm');
const titleEl = document.getElementById('clone-terminal-title');
const closeBtn = document.getElementById('clone-terminal-close');
const placeholder = document.getElementById('editor-placeholder');
const sidebarTab = document.getElementById('sidebar-terminal-tab');

let xterm = null;
let fitAddon = null;

function createTerminal() {
  if (xterm) {
    xterm.dispose();
  }
  xterm = new Terminal(XTERM_OPTIONS);
  fitAddon = new (FitAddon.FitAddon || FitAddon)();
  xterm.loadAddon(fitAddon);
  xterm.open(xtermContainerEl);
  fitAddon.fit();
  return xterm;
}

function showTerminal(title) {
  titleEl.textContent = title;
  closeBtn.style.display = 'none';
  terminalEl.classList.add('active');
  placeholder.style.display = 'none';
  sidebarTab.classList.add('active');

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

function deactivateTerminalTab() {
  sidebarTab.classList.remove('active');
}

function closeTerminal() {
  terminalEl.classList.remove('active');
  sidebarTab.classList.remove('active');
  window.cloneAPI.removeListeners();
  window.worktreeAPI.removeListeners();
  window.deleteAPI.removeListeners();
  window.worktreeRemoveAPI.removeListeners();
  window.worktreeSwitchAPI.removeListeners();
  window.commitPushAPI.removeListeners();
  window.prCreateAPI.removeListeners();

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

window.addEventListener('resize', () => {
  if (!isActive()) return;
  fit();
});

export { createTerminal, showTerminal, showCloseButton, setTitle, deactivateTerminalTab, closeTerminal, toggleTerminal, getXterm, fit };
