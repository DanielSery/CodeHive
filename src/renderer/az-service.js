import { terminal, registerPtyApi } from './terminal-panel.js';
import { runPty } from './dialogs/pty-runner.js';

registerPtyApi(window.azInstallAPI);
import { loadStoredPat } from './dialogs/utils.js';
import { showPatDialog } from './dialogs/dialog-pat.js';

export async function checkAndInstallAz() {
  const { installed } = await window.azInstallAPI.check();
  if (installed) return;

  terminal.show('Installing Azure CLI...');

  const disposeData = runPty(window.azInstallAPI, {
    successMsg: 'Azure CLI installed successfully',
    onSuccess: () => terminal.showCloseButton(),
    onError: ({ exitCode }) => {
      terminal.writeln(`\x1b[31mAzure CLI installation failed (exit code ${exitCode}).\x1b[0m`);
    },
  });

  try {
    await window.azInstallAPI.start();
    window.azInstallAPI.ready();
  } catch (err) {
    disposeData();
    terminal.writeln(`\x1b[31mAzure CLI installation failed: ${err.message || err}\x1b[0m`);
    terminal.showCloseButton();
  }
}

export function initPatButton() {
  const btn = document.getElementById('btn-azure-pat');
  loadStoredPat().then(pat => { if (pat) btn.style.display = 'none'; });
  btn.addEventListener('click', showPatDialog);
}
