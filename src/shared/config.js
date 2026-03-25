const DEFAULT_PORT = 8590;
const POLL_INTERVAL = 3000;

const XTERM_THEME = {
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
};

const XTERM_OPTIONS = {
  cursorBlink: false,
  fontSize: 13,
  fontFamily: "'Consolas', 'Courier New', monospace",
  theme: XTERM_THEME
};

module.exports = { DEFAULT_PORT, POLL_INTERVAL, XTERM_THEME, XTERM_OPTIONS };
