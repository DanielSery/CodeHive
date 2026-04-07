import { resolveWorkItem, fetchLatestBuildNumber, addWorkItemComment } from '../azure-api.js';

const overlay = document.getElementById('resolve-task-dialog-overlay');
const buildInput = document.getElementById('resolve-task-build-input');
const releaseInput = document.getElementById('resolve-task-release-input');
const commentInput = document.getElementById('resolve-task-comment-input');
const taskLink = document.getElementById('resolve-task-link');
const pipelineWarning = document.getElementById('resolve-task-pipeline-warning');
let _resolve = null;
let _ctx = null;
let _taskId = null;

export function showResolveTaskDialog(ctx, taskId, { org, project, auth, targetBranch, mergeTime, pipelineStatus }) {
  _ctx = ctx;
  _taskId = taskId;
  buildInput.value = '';
  buildInput.placeholder = 'Loading build number...';
  releaseInput.value = 'internal';
  commentInput.value = '';

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

  overlay.classList.add('visible');
  commentInput.focus();

  // Fetch the first build after the PR was merged on the target branch
  fetchLatestBuildNumber(org, project, auth, targetBranch, mergeTime).then(buildNumber => {
    if (buildNumber && !buildInput.value) {
      buildInput.value = buildNumber;
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
  if (!comment) return;
  const confirmBtn = document.getElementById('resolve-task-confirm-btn');
  const commentBtn = document.getElementById('resolve-task-comment-btn');
  confirmBtn.disabled = true;
  commentBtn.disabled = true;
  await addWorkItemComment(_ctx, _taskId, comment);
  confirmBtn.disabled = false;
  commentBtn.disabled = false;
  hide('commented');
}

taskLink.addEventListener('click', (e) => { e.preventDefault(); window.shellAPI.openExternal(taskLink.href); });
document.getElementById('resolve-task-confirm-btn').addEventListener('click', confirm);
document.getElementById('resolve-task-comment-btn').addEventListener('click', commentOnly);
document.getElementById('resolve-task-cancel-btn').addEventListener('click', () => hide(false));
overlay.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hide(false);
  if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') confirm();
});
