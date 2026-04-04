import { toast } from '../toast.js';
import { UPDATE_AVAILABLE_SVG } from '../sidebar/worktree-tab-icons.js';

const overlay = document.getElementById('update-dialog-overlay');
const titleEl = document.getElementById('update-dialog-title');
const bodyEl = document.getElementById('update-dialog-body');
const progressWrap = document.getElementById('update-progress-wrap');
const progressFill = document.getElementById('update-progress-fill');
const progressLabel = document.getElementById('update-progress-label');
const closeBtn = document.getElementById('update-close-btn');
const actionBtn = document.getElementById('update-action-btn');

let pendingZipPath = null;
let pendingZipAsset = null;
let progressRegistered = false;

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setState(state, data = {}) {
  progressWrap.style.display = 'none';
  actionBtn.style.display = 'none';
  actionBtn.disabled = false;

  if (state === 'updateAvailable') {
    titleEl.textContent = 'Update Available';
    const name = data.releaseName ? ` \u2014 ${escHtml(data.releaseName)}` : '';
    let html = `A new version of CodeHive is available.<br><br><strong>${escHtml(data.latestVersion)}</strong>${name}`;
    if (data.releaseNotes) {
      html += `<div style="margin-top:10px;max-height:180px;overflow-y:auto;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:8px;font-size:11px;white-space:pre-wrap;color:var(--text-muted)">${escHtml(data.releaseNotes)}</div>`;
    }
    bodyEl.innerHTML = html;
    actionBtn.style.display = '';
    actionBtn.textContent = 'Download \u0026 Install';
  } else if (state === 'downloading') {
    titleEl.textContent = 'Downloading Update';
    bodyEl.textContent = 'Downloading...';
    progressWrap.style.display = '';
    actionBtn.style.display = '';
    actionBtn.disabled = true;
    actionBtn.textContent = 'Downloading...';
  } else if (state === 'ready') {
    titleEl.textContent = 'Ready to Install';
    bodyEl.textContent = 'Download complete. The app will restart to apply the update.';
    actionBtn.style.display = '';
    actionBtn.textContent = 'Restart \u0026 Install';
  }
}

closeBtn.addEventListener('click', () => {
  overlay.classList.remove('visible');
  pendingZipPath = null;
  pendingZipAsset = null;
});

overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeBtn.click();
});

actionBtn.addEventListener('click', async () => {
  if (pendingZipPath) {
    await window.updaterAPI.install(pendingZipPath);
    return;
  }

  if (!pendingZipAsset) return;

  setState('downloading');

  window.updaterAPI.removeProgressListener();
  if (!progressRegistered) {
    window.updaterAPI.onProgress((pct) => {
      progressFill.style.width = `${pct}%`;
      progressLabel.textContent = `${pct}%`;
    });
    progressRegistered = true;
  }

  try {
    pendingZipPath = await window.updaterAPI.download(pendingZipAsset.downloadUrl);
    setState('ready');
  } catch (err) {
    overlay.classList.remove('visible');
    pendingZipPath = null;
    toast.error(`Download failed: ${err.message}`);
  }
});

export async function showUpdateDialog(autoCheck = false) {
  let result;
  try {
    result = await window.updaterAPI.check();
  } catch (err) {
    if (!autoCheck) toast.error(`Failed to check for updates: ${err.message}`);
    return;
  }

  if (!result.hasUpdate) {
    if (!autoCheck) toast.info(`CodeHive ${result.currentVersion} is up to date`);
    return;
  }

  // Update found — open dialog
  document.getElementById('btn-check-updates').innerHTML = UPDATE_AVAILABLE_SVG;
  pendingZipPath = null;
  pendingZipAsset = null;
  progressFill.style.width = '0%';
  progressLabel.textContent = '';
  overlay.classList.add('visible');

  pendingZipAsset = result.assets.find(a => a.name.endsWith('.zip')) || result.assets[0] || null;
  setState('updateAvailable', result);
}
