import { createTerminal, showTerminal, showCloseButton, setTitle, closeTerminal } from '../terminal-panel.js';
import { toast } from '../toast.js';

const wtRemoveDialogOverlay = document.getElementById('wt-remove-dialog-overlay');
const wtRemoveDialogPath = document.getElementById('wt-remove-dialog-path');

let _removeTabEl = null;
let _removeGroupEl = null;

export function showWorktreeRemoveDialog(tabEl, groupEl) {
  _removeTabEl = tabEl;
  _removeGroupEl = groupEl;
  wtRemoveDialogPath.textContent = tabEl._wtPath;
  wtRemoveDialogOverlay.classList.add('visible');
}

function hideWorktreeRemoveDialog() {
  wtRemoveDialogOverlay.classList.remove('visible');
  _removeTabEl = null;
  _removeGroupEl = null;
}

async function confirmRemoveWorktree() {
  if (!_removeTabEl || !_removeGroupEl) return;
  const tabEl = _removeTabEl;
  const groupEl = _removeGroupEl;
  const wtPath = tabEl._wtPath;
  const branchLabel = tabEl._wtBranch;
  hideWorktreeRemoveDialog();

  showTerminal(`Removing worktree: ${branchLabel}`);
  const xterm = createTerminal();


  window.worktreeRemoveAPI.removeListeners();
  window.worktreeRemoveAPI.onData((data) => {
    xterm.write(data);
  });

  window.worktreeRemoveAPI.onExit(({ exitCode }) => {
    if (exitCode === 0) {
      xterm.writeln('');
      xterm.writeln('\x1b[32mWorktree removed successfully!\x1b[0m');
      setTitle('Worktree removed');
      if (tabEl._dotEl) tabEl._dotEl.remove();
      tabEl.remove();
      setTimeout(() => closeTerminal(), 1200);
    } else {
      xterm.writeln('');
      xterm.writeln(`\x1b[31mWorktree removal failed with exit code ${exitCode}\x1b[0m`);
      setTitle(`Worktree removal failed`);
      toast.error('Worktree removal failed — see terminal');
      showCloseButton();
    }
  });

  try {
    await window.worktreeRemoveAPI.start({
      barePath: groupEl._barePath,
      wtPath
    });
    window.worktreeRemoveAPI.ready();
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle(`Worktree removal failed`);
    toast.error('Worktree removal failed — see terminal');
    showCloseButton();
  }
}

document.getElementById('wt-remove-cancel-btn').addEventListener('click', hideWorktreeRemoveDialog);
document.getElementById('wt-remove-confirm-btn').addEventListener('click', confirmRemoveWorktree);
wtRemoveDialogOverlay.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmRemoveWorktree();
  else if (e.key === 'Escape') hideWorktreeRemoveDialog();
});
