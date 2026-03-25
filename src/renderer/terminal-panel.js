import { getActive, getActiveId } from './state.js';

const XTERM_OPTIONS = {
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
};

const terminalEl = document.getElementById('clone-terminal');
const xtermContainerEl = document.getElementById('clone-terminal-xterm');
const titleEl = document.getElementById('clone-terminal-title');
const closeBtn = document.getElementById('clone-terminal-close');
const placeholder = document.getElementById('editor-placeholder');

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

  // Hide active workspace webview
  const ws = getActive();
  if (ws) ws.webview.classList.remove('active');
}

function showCloseButton() {
  closeBtn.style.display = 'block';
}

function setTitle(title) {
  titleEl.textContent = title;
}

function closeTerminal() {
  terminalEl.classList.remove('active');
  window.cloneAPI.removeListeners();
  window.worktreeAPI.removeListeners();
  if (xterm) {
    xterm.dispose();
    xterm = null;
    fitAddon = null;
    xtermContainerEl.innerHTML = '';
  }

  // Restore previous view
  const ws = getActive();
  if (ws) {
    ws.webview.classList.add('active');
  } else {
    placeholder.style.display = 'flex';
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

window.addEventListener('resize', () => {
  if (!isActive()) return;
  fit();
  if (xterm) {
    window.cloneAPI.resize(xterm.cols, xterm.rows);
    window.worktreeAPI.resize(xterm.cols, xterm.rows);
  }
});

export { createTerminal, showTerminal, showCloseButton, setTitle, closeTerminal, getXterm, fit };
