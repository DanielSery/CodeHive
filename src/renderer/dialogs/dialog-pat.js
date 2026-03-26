import { saveStoredPat } from './utils.js';

const azurePatDialogOverlay = document.getElementById('azure-pat-dialog-overlay');
const azurePatInput = document.getElementById('azure-pat-input');
let _patDialogResolve = null;

export function showPatDialog() {
  return new Promise((resolve) => {
    _patDialogResolve = resolve;
    azurePatInput.value = '';
    azurePatDialogOverlay.classList.add('visible');
    azurePatInput.focus();
  });
}

export function hidePatDialog(pat) {
  azurePatDialogOverlay.classList.remove('visible');
  if (_patDialogResolve) { _patDialogResolve(pat || null); _patDialogResolve = null; }
}

document.getElementById('azure-pat-confirm-btn').addEventListener('click', () => {
  const pat = azurePatInput.value.trim();
  if (!pat) return;
  saveStoredPat(pat);
  hidePatDialog(pat);
});
document.getElementById('azure-pat-cancel-btn').addEventListener('click', () => hidePatDialog(null));
azurePatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const pat = azurePatInput.value.trim(); if (pat) { saveStoredPat(pat); hidePatDialog(pat); } }
  if (e.key === 'Escape') hidePatDialog(null);
});
azurePatDialogOverlay.addEventListener('click', (e) => { if (e.target === azurePatDialogOverlay) hidePatDialog(null); });
