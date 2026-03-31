import { fetchBuildArtifacts, fetchContainerItems } from '../azure-api.js';
import { showTerminal, createTerminal, showCloseButton, setTitle } from '../terminal-panel.js';

const overlay = document.getElementById('verify-dialog-overlay');
const titleEl = document.getElementById('verify-dialog-title');
const buildDesc = document.getElementById('verify-build-desc');
const subtitleEl = document.getElementById('verify-dialog-subtitle');
const artifactsList = document.getElementById('verify-artifacts-list');
const confirmBtn = document.getElementById('verify-confirm-btn');
const cancelBtn = document.getElementById('verify-cancel-btn');
const skipBtn = document.getElementById('verify-skip-btn');
let _resolve = null;
let _auth = null;
let _mode = 'install';

export function showInstallDialog(org, project, auth, buildId, buildNumber, pipelineCompleted = true, definitionId = null) {
  _auth = auth;
  _mode = 'install';
  titleEl.textContent = 'Install Build';
  buildDesc.textContent = buildNumber
    ? (pipelineCompleted ? `Build ${buildNumber} completed successfully` : `Build ${buildNumber} in progress`)
    : (pipelineCompleted ? 'Build completed successfully' : 'Build in progress');
  subtitleEl.textContent = 'Download and install the setup';
  subtitleEl.style.display = '';
  artifactsList.style.display = '';
  artifactsList.innerHTML = '<span class="verify-loading">Loading artifacts\u2026</span>';
  confirmBtn.style.display = 'none';
  skipBtn.style.display = '';
  cancelBtn.textContent = 'Done';
  overlay.classList.add('visible');

  fetchBuildArtifacts(org, project, auth, buildId, definitionId).then(async artifacts => {
    const setups = artifacts.find(a => a.name === 'Setups');
    let items;
    if (setups?.containerId) {
      items = (await fetchContainerItems(org, auth, setups.containerId)).filter(a => /\.msi$/i.test(a.name));
    } else if (setups) {
      items = [{ name: 'Setup', downloadUrl: setups.downloadUrl, runnable: true }];
    } else {
      items = artifacts;
    }
    if (items.length === 0) {
      artifactsList.innerHTML = '<span class="verify-loading">No artifacts found for this build</span>';
      return;
    }
    artifactsList.innerHTML = items.map(a => `
      <div class="verify-artifact-item">
        <span class="verify-artifact-name">${escHtml(a.name)}</span>
        ${a.downloadUrl ? `<button class="verify-artifact-link" data-url="${escHtml(a.downloadUrl)}"${a.runnable ? ' data-runnable="1"' : ''}>${a.runnable ? 'Install' : 'Download'}</button>` : ''}
      </div>
    `).join('');
    for (const link of artifactsList.querySelectorAll('.verify-artifact-link')) {
      link.addEventListener('click', () => {
        if (link.dataset.runnable) {
          overlay.classList.remove('visible');
          startSetupInstall(link.dataset.url, _auth,
            () => hide('installed'),
            () => hide(false)
          );
        } else {
          window.shellAPI.openExternal(link.dataset.url);
        }
      });
    }
  });

  return new Promise(resolve => { _resolve = resolve; });
}

export function showVerifyDialog(buildNumber) {
  _mode = 'verify';
  titleEl.textContent = 'Mark as Verified';
  buildDesc.textContent = buildNumber ? `Build ${buildNumber}` : 'Build completed';
  subtitleEl.textContent = 'Confirm you have tested the application';
  subtitleEl.style.display = '';
  artifactsList.style.display = 'none';
  artifactsList.innerHTML = '';
  confirmBtn.style.display = '';
  confirmBtn.textContent = 'Mark as Verified';
  skipBtn.style.display = 'none';
  cancelBtn.textContent = 'Cancel';
  overlay.classList.add('visible');

  return new Promise(resolve => { _resolve = resolve; });
}

async function startSetupInstall(downloadUrl, auth, onSuccess, onFailure) {
  showTerminal('Installing setup\u2026');
  const xterm = createTerminal();
  window.setupInstallAPI.removeListeners();
  window.setupInstallAPI.onData(data => xterm.write(data));
  window.setupInstallAPI.onExit(({ exitCode }) => {
    if (exitCode === 0) {
      setTitle('Setup installed');
      onSuccess?.();
    } else {
      xterm.writeln('\r\n\x1b[31mInstallation failed\x1b[0m');
      setTitle('Installation failed');
      onFailure?.();
    }
    showCloseButton();
  });
  await window.setupInstallAPI.start({ downloadUrl, auth });
  window.setupInstallAPI.ready();
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hide(result) {
  overlay.classList.remove('visible');
  if (_resolve) { _resolve(result); _resolve = null; }
}

document.getElementById('verify-confirm-btn').addEventListener('click', () => hide('verified'));
document.getElementById('verify-skip-btn').addEventListener('click', () => hide('skipped'));
document.getElementById('verify-cancel-btn').addEventListener('click', () => hide(false));
overlay.addEventListener('keydown', e => {
  if (e.key === 'Escape') hide(false);
  if (e.key === 'Enter' && _mode === 'verify') hide('verified');
});
