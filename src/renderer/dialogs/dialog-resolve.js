import { resolveWorkItem, fetchLatestBuildNumber, addWorkItemComment, fetchBuildArtifacts, fetchContainerItems, fetchBuildsForDefinition } from '../azure-api.js';
import { terminal, registerPtyApi } from '../terminal-panel.js';
import { runPty } from './pty-runner.js';

registerPtyApi(window.setupInstallAPI);

const overlay = document.getElementById('resolve-task-dialog-overlay');
const buildInput = document.getElementById('resolve-task-build-input');
const releaseInput = document.getElementById('resolve-task-release-input');
const commentInput = document.getElementById('resolve-task-comment-input');
const taskLink = document.getElementById('resolve-task-link');
const pipelineWarning = document.getElementById('resolve-task-pipeline-warning');
const installDesc = document.getElementById('resolve-task-install-desc');
const buildSelectorEl = document.getElementById('resolve-task-build-selector');
const buildSelectEl = document.getElementById('resolve-task-build-select');
const artifactsList = document.getElementById('resolve-task-artifacts-list');
let _resolve = null;
let _ctx = null;
let _taskId = null;
let _auth = null;
let _org = null;
let _project = null;
let _definitionId = null;

export function showResolveTaskDialog(ctx, taskId, { org, project, auth, targetBranch, mergeTime, pipelineStatus, buildId = null, buildNumber = null, definitionId = null }) {
  _ctx = ctx;
  _taskId = taskId;
  _auth = auth;
  _org = org;
  _project = project;
  _definitionId = definitionId;
  buildInput.value = '';
  buildInput.placeholder = 'Loading build number...';
  releaseInput.value = 'internal';
  commentInput.value = '';
  buildSelectorEl.style.display = 'none';
  buildSelectEl.innerHTML = '';

  const taskUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_workitems/edit/${taskId}`;
  taskLink.href = taskUrl;
  taskLink.style.display = '';

  if (pipelineStatus === 'failed') {
    pipelineWarning.textContent = 'Pipeline failed \u2014 the attached build number reflects a failed build.';
    pipelineWarning.style.display = '';
  } else if (pipelineStatus === 'running') {
    pipelineWarning.textContent = 'Pipeline is still running \u2014 the attached build number reflects an incomplete build.';
    pipelineWarning.style.display = '';
  } else {
    pipelineWarning.style.display = 'none';
  }

  if (buildId) {
    const statusLabel = pipelineStatus === 'succeeded' ? 'completed successfully' : pipelineStatus === 'failed' ? 'failed' : 'in progress';
    installDesc.textContent = buildNumber ? `Build ${buildNumber} ${statusLabel}` : `Build ${statusLabel}`;
    loadArtifactsForBuild(buildId, definitionId);
    if (definitionId) {
      fetchBuildsForDefinition(org, project, auth, definitionId).then(builds => {
        if (builds.length <= 1) return;
        const sortedBuilds = [...builds].sort((a, b) => {
          const aParts = a.buildNumber.split('.').map(Number);
          const bParts = b.buildNumber.split('.').map(Number);
          for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
            const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
            if (diff !== 0) { return diff; }
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
  } else {
    installDesc.textContent = 'No build available yet.';
    artifactsList.innerHTML = '';
  }

  overlay.classList.add('visible');
  buildInput.focus();

  fetchLatestBuildNumber(org, project, auth, targetBranch, mergeTime).then(fetchedBuildNumber => {
    if (fetchedBuildNumber && !buildInput.value) {
      buildInput.value = fetchedBuildNumber;
    }
    buildInput.placeholder = 'e.g. 20260327.1';
  });

  return new Promise((resolve) => { _resolve = resolve; });
}

function hide(result) {
  overlay.classList.remove('visible');
  if (_resolve) { _resolve(result); _resolve = null; }
  _ctx = null;
  _taskId = null;
}

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
          () => hide(false),
          () => hide(false)
        );
      } else {
        window.shellAPI.openExternal(link.dataset.url);
      }
    });
  }
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

async function confirm() {
  const integrationBuild = buildInput.value.trim();
  const releaseNote = releaseInput.value.trim();
  const comment = commentInput.value.trim();
  const confirmBtn = document.getElementById('resolve-task-confirm-btn');
  const commentBtn = document.getElementById('resolve-task-comment-btn');
  confirmBtn.disabled = true;
  commentBtn.disabled = true;
  const ok = await resolveWorkItem(_ctx, _taskId, { integrationBuild, releaseNote });
  if (ok && comment) {
    await addWorkItemComment(_ctx, _taskId, comment);
  }
  confirmBtn.disabled = false;
  commentBtn.disabled = false;
  hide(ok ? 'resolved' : false);
}

async function commentOnly() {
  const comment = commentInput.value.trim();
  if (!comment) { return; }
  const confirmBtn = document.getElementById('resolve-task-confirm-btn');
  const commentBtn = document.getElementById('resolve-task-comment-btn');
  confirmBtn.disabled = true;
  commentBtn.disabled = true;
  await addWorkItemComment(_ctx, _taskId, comment);
  confirmBtn.disabled = false;
  commentBtn.disabled = false;
  hide('commented');
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

taskLink.addEventListener('click', (e) => { e.preventDefault(); window.shellAPI.openExternal(taskLink.href); });
buildSelectEl.addEventListener('change', () => {
  const selectedId = Number(buildSelectEl.value);
  loadArtifactsForBuild(selectedId, _definitionId);
});
document.getElementById('resolve-task-confirm-btn').addEventListener('click', confirm);
document.getElementById('resolve-task-comment-btn').addEventListener('click', commentOnly);
document.getElementById('resolve-task-cancel-btn').addEventListener('click', () => hide(false));
overlay.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hide(false); }
  if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { confirm(); }
});
