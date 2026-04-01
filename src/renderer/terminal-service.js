import { showTerminal, createTerminal, showCloseButton, setTitle, closeTerminal } from './terminal-panel.js';

let _xterm = null;

export const terminal = {
  show(title) {
    showTerminal(title);
    _xterm = createTerminal();
  },
  write(data) {
    _xterm?.write(data);
  },
  writeln(text) {
    _xterm?.writeln(text);
  },
  setTitle,
  showCloseButton,
  close: closeTerminal,
};
