import { resolveWorkItem, fetchLatestBuildNumber, addWorkItemComment } from '../azure-api.js';

const overlay = document.getElementById('resolve-task-dialog-overlay');
const buildInput = document.getElementById('resolve-task-build-input');
const releaseInput = document.getElementById('resolve-task-release-input');
const commentInput = document.getElementById('resolve-task-comment-input');
let _resolve = null;
let _ctx = null;
let _taskId = null;

export function showResolveTaskDialog(ctx, taskId, { org, project, auth, targetBranch }) {
  _ctx = ctx;
  _taskId = taskId;
  buildInput.value = '';
  buildInput.placeholder = 'Loading build number...';
  releaseInput.value = 'internal';
  commentInput.value = '';
  overlay.classList.add('visible');
  commentInput.focus();

  // Fetch the latest successful build from the target branch (where the PR was merged)
  fetchLatestBuildNumber(org, project, auth, targetBranch).then(buildNumber => {
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

document.getElementById('resolve-task-confirm-btn').addEventListener('click', confirm);
document.getElementById('resolve-task-comment-btn').addEventListener('click', commentOnly);
document.getElementById('resolve-task-cancel-btn').addEventListener('click', () => hide(false));
overlay.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hide(false);
  if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') confirm();
});
