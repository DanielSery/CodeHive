const git = require('./ipc-git');
const pty = require('./ipc-pty');
const shell = require('./ipc-shell');

function register(mainWindow, getServerPort) {
  git.register(mainWindow);
  pty.register(mainWindow);
  shell.register(mainWindow, getServerPort);
}

function killAllPtys() {
  pty.killAllPtys();
}

module.exports = { register, killAllPtys };
