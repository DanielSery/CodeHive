import { terminal, registerPtyApi } from './terminal-panel.js';
import { toast } from './toast.js';

registerPtyApi(window.pushAPI);

const pushConfirmOverlay = document.getElementById('push-confirm-overlay');
const pushConfirmReason = document.getElementById('push-confirm-reason');

let _pendingWtPath = null;
let _onDone = null;

function hidePushConfirm() {
  pushConfirmOverlay.classList.remove('visible');
  _pendingWtPath = null;
  _onDone = null;
}

document.getElementById('push-skip-btn').addEventListener('click', () => {
  hidePushConfirm();
  terminal.showCloseButton();
});

document.getElementById('push-force-btn').addEventListener('click', async () => {
  const wtPath = _pendingWtPath;
  const onDone = _onDone;
  hidePushConfirm();
  terminal.setTitle('Force pushing...');

  const disposeData = window.pushAPI.onForcePushData((data) => terminal.write(data));
  window.pushAPI.onForcePushExit(({ exitCode }) => {
    disposeData();
    if (exitCode === 0) {
      terminal.writeln('\x1b[32mForce push complete!\x1b[0m');
      terminal.setTitle('Force push complete');
      if (onDone) onDone(); else terminal.showCloseButton();
    } else {
      terminal.writeln('\x1b[31mForce push failed.\x1b[0m');
      terminal.setTitle('Force push failed');
      toast.error('Force push failed — see terminal');
      terminal.showCloseButton();
    }
  });

  try {
    await window.pushAPI.forcePushStart({ wtPath });
    window.pushAPI.forcePushReady();
  } catch (err) {
    disposeData();
    terminal.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    terminal.setTitle('Force push failed');
    toast.error('Force push failed — see terminal');
    terminal.showCloseButton();
  }
});

/**
 * Run push after a successful main operation.
 * Tries regular push; if it fails shows a force-push confirmation with the reason.
 * @param {string} wtPath - worktree path
 * @param {{ onSuccess?: () => void }} [opts]
 *   onSuccess: called after successful push (regular or force). Defaults to showCloseButton.
 */
export async function runPushFlow(wtPath, { onSuccess } = {}) {
  terminal.setTitle('Pushing...');
  let outputBuffer = '';

  const disposeData = window.pushAPI.onData((data) => {
    terminal.write(data);
    outputBuffer += data;
  });

  window.pushAPI.onExit(({ exitCode }) => {
    disposeData();
    if (exitCode === 0) {
      terminal.writeln('\x1b[32mPush complete!\x1b[0m');
      terminal.setTitle('Push complete');
      if (onSuccess) onSuccess(); else terminal.showCloseButton();
    } else {
      pushConfirmReason.textContent = extractPushReason(outputBuffer);
      _pendingWtPath = wtPath;
      _onDone = onSuccess || null;
      pushConfirmOverlay.classList.add('visible');
    }
  });

  try {
    await window.pushAPI.start({ wtPath });
    window.pushAPI.ready();
  } catch (err) {
    disposeData();
    terminal.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    terminal.setTitle('Push failed');
    toast.error('Push failed — see terminal');
    terminal.showCloseButton();
  }
}

function extractPushReason(output) {
  const stripped = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
  const lines = stripped.split('\n').map(l => l.trim()).filter(Boolean);
  const relevant = lines.filter(l => /^(error|hint|remote\s*:|\s*!)/i.test(l));
  return relevant.length > 0 ? relevant.join('\n') : 'The remote branch has diverged. A force push is required.';
}
