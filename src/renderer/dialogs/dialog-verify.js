import { fetchBuildArtifacts, fetchContainerItems, fetchBuildsForDefinition } from '../azure-api.js';
import { terminal, registerPtyApi } from '../terminal-panel.js';
import { runPty } from './pty-runner.js';

registerPtyApi(window.setupInstallAPI);

const overlay = document.getElementById('verify-dialog-overlay');
const titleEl = document.getElementById('verify-dialog-title');
const buildDesc = document.getElementById('verify-build-desc');
const subtitleEl = document.getElementById('verify-dialog-subtitle');
const subtitleTextEl = document.getElementById('verify-dialog-subtitle-text');
const taskLink = document.getElementById('verify-task-link');
const artifactsList = document.getElementById('verify-artifacts-list');
const buildSelectorEl = document.getElementById('verify-build-selector');
const buildSelectEl = document.getElementById('verify-build-select');
const confirmBtn = document.getElementById('verify-confirm-btn');
const cancelBtn = document.getElementById('verify-cancel-btn');
const skipBtn = document.getElementById('verify-skip-btn');
let _resolve = null;
let _auth = null;
let _mode = 'install';
let _org = null;
let _project = null;
let _definitionId = null;

async function loadArtifactsForBuild(buildId, definitionId) {
  artifactsList.innerHTML = '<span class="verify-loading">Loading artifacts\u2026</span>';
  const artifacts = await fetchBuildArtifacts(_org, _project, _auth, buildId, definitionId);
  const setups = artifacts.find(a => a.name === 'Setups');
  let items;
  if (setups?.containerId) {
    items = (await fetchContainerItems(_org, _auth, setups.containerId)).filter(a => /\.msi$/i.test(a.name));
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
}

export function showInstallDialog(org, project, auth, buildId, buildNumber, pipelineCompleted = true, definitionId = null, taskUrl = null) {
  _auth = auth;
  _org = org;
  _project = project;
  _definitionId = definitionId;
  _mode = 'install';
  titleEl.textContent = 'Install Build';
  buildDesc.textContent = buildNumber
    ? (pipelineCompleted ? `Build ${buildNumber} completed successfully` : `Build ${buildNumber} in progress`)
    : (pipelineCompleted ? 'Build completed successfully' : 'Build in progress');
  subtitleTextEl.textContent = 'Download and install the setup';
  subtitleEl.style.display = '';
  if (taskUrl) {
    taskLink.href = taskUrl;
    taskLink.style.display = '';
  } else {
    taskLink.style.display = 'none';
  }
  artifactsList.style.display = '';
  buildSelectorEl.style.display = 'none';
  buildSelectEl.innerHTML = '';
  confirmBtn.style.display = 'none';
  skipBtn.style.display = '';
  cancelBtn.textContent = 'Cancel';
  overlay.classList.add('visible');

  loadArtifactsForBuild(buildId, definitionId);

  if (definitionId) {
    fetchBuildsForDefinition(org, project, auth, definitionId).then(builds => {
      if (builds.length <= 1) return;
      const sortedBuilds = [...builds].sort((a, b) => {
        const aParts = a.buildNumber.split('.').map(Number);
        const bParts = b.buildNumber.split('.').map(Number);
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
          if (diff !== 0) return diff;
        }
        return 0;
      });
      buildSelectEl.innerHTML = sortedBuilds.map(b => {
        const label = b.buildNumber + (b.id === buildId ? ' (current)' : '');
        return `<option value="${escHtml(String(b.id))}" data-build-number="${escHtml(b.buildNumber)}"${b.id === buildId ? ' selected' : ''}>${escHtml(label)}</option>`;
      }).join('');
      buildSelectorEl.style.display = '';
    });
  }

  return new Promise(resolve => { _resolve = resolve; });
}

export function showVerifyDialog(buildNumber) {
  _mode = 'verify';
  titleEl.textContent = 'Mark as Verified';
  buildDesc.textContent = buildNumber ? `Build ${buildNumber}` : 'Build completed';
  subtitleTextEl.textContent = 'Confirm you have tested the application';
  subtitleEl.style.display = '';
  taskLink.style.display = 'none';
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
  terminal.show('Installing setup\u2026');
  window.setupInstallAPI.removeListeners();
  runPty(window.setupInstallAPI, {
    onSuccess: () => { terminal.setTitle('Setup installed'); onSuccess?.(); terminal.showCloseButton(); },
    onError: () => { terminal.writeln('\x1b[31mInstallation failed\x1b[0m'); terminal.setTitle('Installation failed'); onFailure?.(); },
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

taskLink.addEventListener('click', (e) => { e.preventDefault(); window.shellAPI.openExternal(taskLink.href); });

buildSelectEl.addEventListener('change', () => {
  const selectedId = Number(buildSelectEl.value);
  loadArtifactsForBuild(selectedId, _definitionId);
});

document.getElementById('verify-confirm-btn').addEventListener('click', () => hide('verified'));
document.getElementById('verify-skip-btn').addEventListener('click', () => hide('skipped'));
document.getElementById('verify-cancel-btn').addEventListener('click', () => hide(false));
overlay.addEventListener('keydown', e => {
  if (e.key === 'Escape') hide(false);
  if (e.key === 'Enter' && _mode === 'verify') hide('verified');
});
