import { terminal } from '../terminal-service.js';
import { toast } from '../toast.js';

const cloneDialogOverlay = document.getElementById('clone-dialog-overlay');
const cloneUrlInput = document.getElementById('clone-url-input');

let _cloneReposDir = null;
let _addRepoGroup = null;
let _onCloneComplete = null;

export function setCloneReposDir(dir) {
  _cloneReposDir = dir;
}

export function registerCloneSidebarFns(addRepoGroup) {
  _addRepoGroup = addRepoGroup;
}

export function registerOnCloneComplete(fn) {
  _onCloneComplete = fn;
}

export function showCloneDialog() {
  cloneUrlInput.value = '';
  cloneDialogOverlay.classList.add('visible');
  setTimeout(() => cloneUrlInput.focus(), 50);
}

function hideCloneDialog() {
  cloneDialogOverlay.classList.remove('visible');
}

function parseRepoName(url) {
  const cleaned = url.replace(/\.git\/?$/, '').replace(/\/$/, '');
  return cleaned.split('/').pop();
}

async function startClone() {
  const url = cloneUrlInput.value.trim();
  if (!url) return;

  hideCloneDialog();

  const reposDir = _cloneReposDir;
  if (!reposDir) {
    toast.error('Please open a directory first');
    return;
  }
  const repoName = parseRepoName(url);

  terminal.show(`Cloning ${repoName}...`);

  const disposeData = window.cloneAPI.onData((data) => {
    terminal.write(data);
  });

  window.cloneAPI.onExit(async ({ exitCode, repoName: name, repoDir, bareDir, reposDir: rDir }) => {
    disposeData();
    if (exitCode === 0) {
      terminal.writeln('');
      terminal.writeln('\x1b[32mRepository cloned successfully!\x1b[0m');
      terminal.setTitle(`Clone complete: ${name}`);
      toast.success(`Cloned ${name}`);

      const repos = await window.reposAPI.scanDirectory(rDir);
      const newRepo = repos.find(r => r.name === name);
      if (newRepo && _addRepoGroup) {
        _addRepoGroup(newRepo);
      }
      if (_onCloneComplete) _onCloneComplete(rDir);
    } else {
      terminal.writeln('');
      terminal.writeln(`\x1b[31mClone failed with exit code ${exitCode}\x1b[0m`);
      terminal.setTitle(`Clone failed: ${name}`);
      toast.error(`Clone failed for ${name}`);
    }
    terminal.showCloseButton();
  });

  try {
    await window.cloneAPI.start(url, reposDir);
    window.cloneAPI.ready();
  } catch (err) {
    disposeData();
    terminal.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    terminal.setTitle(`Clone failed: ${repoName}`);
    terminal.showCloseButton();
  }
}

document.getElementById('clone-cancel-btn').addEventListener('click', hideCloneDialog);
document.getElementById('clone-confirm-btn').addEventListener('click', startClone);

cloneUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startClone();
  if (e.key === 'Escape') hideCloneDialog();
});
