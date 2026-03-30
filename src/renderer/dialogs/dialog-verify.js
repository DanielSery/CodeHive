import { fetchBuildArtifacts } from '../azure-api.js';

const overlay = document.getElementById('verify-dialog-overlay');
const buildDesc = document.getElementById('verify-build-desc');
const artifactsList = document.getElementById('verify-artifacts-list');
let _resolve = null;

export function showVerifyDialog(org, project, auth, buildId, buildNumber) {
  buildDesc.textContent = buildNumber ? `Build ${buildNumber} completed successfully` : 'Build completed successfully';
  artifactsList.innerHTML = '<span class="verify-loading">Loading artifacts\u2026</span>';
  overlay.classList.add('visible');

  fetchBuildArtifacts(org, project, auth, buildId).then(artifacts => {
    if (artifacts.length === 0) {
      artifactsList.innerHTML = '<span class="verify-loading">No artifacts found for this build</span>';
      return;
    }
    artifactsList.innerHTML = artifacts.map(a => `
      <div class="verify-artifact-item">
        <span class="verify-artifact-name">${escHtml(a.name)}</span>
        ${a.downloadUrl ? `<button class="verify-artifact-link" data-url="${escHtml(a.downloadUrl)}">Download</button>` : ''}
      </div>
    `).join('');
    for (const link of artifactsList.querySelectorAll('.verify-artifact-link')) {
      link.addEventListener('click', () => window.shellAPI.openExternal(link.dataset.url));
    }
  });

  return new Promise(resolve => { _resolve = resolve; });
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hide(result) {
  overlay.classList.remove('visible');
  if (_resolve) { _resolve(result); _resolve = null; }
}

document.getElementById('verify-confirm-btn').addEventListener('click', () => hide('verified'));
document.getElementById('verify-cancel-btn').addEventListener('click', () => hide(false));
overlay.addEventListener('keydown', e => {
  if (e.key === 'Escape') hide(false);
  if (e.key === 'Enter') hide('verified');
});
