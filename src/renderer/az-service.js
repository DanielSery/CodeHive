import { terminal } from './terminal-service.js';
import { loadStoredPat } from './dialogs/utils.js';
import { showPatDialog } from './dialogs/dialog-pat.js';

export async function checkAndInstallAz() {
  const { installed } = await window.azInstallAPI.check();
  if (installed) return;

  terminal.show('Installing Azure CLI...');

  const disposeData = window.azInstallAPI.onData((data) => { terminal.write(data); });
  window.azInstallAPI.onExit(({ exitCode }) => {
    disposeData();
    if (exitCode === 0) {
      terminal.write('\r\n\x1b[32mAzure CLI installed successfully.\x1b[0m\r\n');
    } else {
      terminal.write(`\r\n\x1b[31mAzure CLI installation failed (exit code ${exitCode}).\x1b[0m\r\n`);
    }
    terminal.showCloseButton();
  });

  try {
    await window.azInstallAPI.start();
    window.azInstallAPI.ready();
  } catch (err) {
    disposeData();
    terminal.write(`\r\n\x1b[31mAzure CLI installation failed: ${err.message || err}\x1b[0m\r\n`);
    terminal.showCloseButton();
  }
}

export function initPatButton() {
  const btn = document.getElementById('btn-azure-pat');
  loadStoredPat().then(pat => { if (pat) btn.style.display = 'none'; });
  btn.addEventListener('click', showPatDialog);
}
