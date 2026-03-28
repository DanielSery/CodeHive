import { saveStoredPat } from './utils.js';
import { toast } from '../toast.js';

const azurePatDialogOverlay = document.getElementById('azure-pat-dialog-overlay');
const azurePatInput = document.getElementById('azure-pat-input');
let _patDialogResolve = null;

function hidePATButton() {
  const btn = document.getElementById('btn-azure-pat');
  if (btn) btn.style.display = 'none';
}

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

async function savePat() {
  const pat = azurePatInput.value.trim();
  if (!pat) return;
  try {
    await saveStoredPat(pat);
    hidePATButton();
    hidePatDialog(pat);
  } catch (err) {
    toast.error('Failed to save PAT — please try again');
  }
}

document.getElementById('azure-pat-confirm-btn').addEventListener('click', savePat);
document.getElementById('azure-pat-cancel-btn').addEventListener('click', () => hidePatDialog(null));
azurePatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') savePat();
  if (e.key === 'Escape') hidePatDialog(null);
});
