import { setTabStatus } from '../claude-poll.js';
import { openWorktree, closeWorkspace } from '../workspace-manager.js';
import { getSourceBranch, getTaskId } from '../storage.js';
import { rebuildCollapsedDots, collapsedDotsEl } from './collapsed-dots.js';
import { showContextMenu } from './context-menu.js';
import { _showWorktreeSwitchDialog, _showWorktreeRemoveDialog, _showCommitPushDialog, _showCreatePrDialog, _onStateChange } from './registers.js';
import { parseAzureRemoteUrl, fetchPolicyEvaluations, fetchPrUnresolvedThreadCount, completePullRequest } from '../azure-api.js';
import { showResolveTaskDialog } from '../dialogs/dialog-resolve.js';

const BIN_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12M5.3 4V2.7a1 1 0 011-1h3.4a1 1 0 011 1V4M6.5 7.3v4.4M9.5 7.3v4.4"/><path d="M3.5 4l.7 9.3a1 1 0 001 .9h5.6a1 1 0 001-.9L12.5 4"/></svg>';
const SWITCH_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 1l3 3-3 3"/><path d="M14 4H5"/><path d="M5 15l-3-3 3-3"/><path d="M2 12h9"/></svg>';
const COMMIT_PUSH_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12V3"/><path d="M4 7l4-4 4 4"/><circle cx="8" cy="14" r="1.5"/></svg>';
const PR_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="4" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="4" cy="12" r="2"/><path d="M4 6v4"/><path d="M12 10V6c0-1.1-.9-2-2-2H8"/><path d="M10 2L8 4l2 2"/></svg>';
const COMPLETE_PR_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="4" r="2"/><circle cx="4" cy="12" r="2"/><path d="M4 6v4"/><path d="M9 8l2 2 3.5-3.5"/></svg>';
const RESOLVE_TASK_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M5.5 8l2 2 3-3"/></svg>';

function formatBranchLabel(branch) {
  let name = branch.includes('/') ? branch.substring(branch.indexOf('/') + 1) : branch;
  name = name.replace(/^\d+-/, '');
  return name.replace(/-/g, ' ');
}

function extractTaskIdFromBranch(branch) {
  const afterSlash = branch.includes('/') ? branch.substring(branch.indexOf('/') + 1) : branch;
  const m = afterSlash.match(/^(\d+)-/);
  return m ? m[1] : null;
}

export async function checkExistingPr(tabEl) {
  const groupEl = tabEl.closest('.repo-group');
  if (!groupEl) return;
  const barePath = groupEl._barePath;
  const branch = tabEl._wtBranch;
  if (!barePath || !branch) return;

  let remoteUrl;
  try { remoteUrl = await window.reposAPI.remoteUrl(barePath); } catch { return; }
  if (!remoteUrl) return;

  const parsed = parseAzureRemoteUrl(remoteUrl);
  const createPrBtnEarly = tabEl.querySelector('.workspace-tab-create-pr');
  if (!parsed) {
    if (createPrBtnEarly) createPrBtnEarly.style.display = 'none';
    return;
  }

  const pat = localStorage.getItem('codehive-azure-pat');
  if (!pat) return;

  const auth = btoa(':' + pat);
  const { org, project } = parsed;
  const sourceRef = `refs/heads/${branch}`;
  const apiUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/pullrequests?searchCriteria.sourceRefName=${encodeURIComponent(sourceRef)}&searchCriteria.status=active&api-version=7.0`;

  let data;
  try {
    const resp = await fetch(apiUrl, { headers: { Authorization: `Basic ${auth}` } });
    if (!resp.ok) return;
    data = await resp.json();
  } catch { return; }

  if (!data.value || data.value.length === 0) {
    if (createPrBtnEarly) {
      createPrBtnEarly.classList.remove('has-pr', 'has-pr-succeeded', 'has-pr-approved', 'has-pr-failed', 'has-pr-comments');
      createPrBtnEarly.title = 'Create Pull Request (Ctrl+Alt+M)';
    }
    // Check for completed PR — if found and tab has a linked task, show "Resolve Task" button
    console.log('[checkExistingPr] no active PR for', branch, 'taskId=', tabEl._wtTaskId, 'completePrState=', tabEl._completePrState);
    if (tabEl._wtTaskId && tabEl._completePrState !== 'can-resolve') {
      const completedUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/pullrequests?searchCriteria.sourceRefName=${encodeURIComponent(sourceRef)}&searchCriteria.status=completed&$top=1&api-version=7.0`;
      try {
        const cResp = await fetch(completedUrl, { headers: { Authorization: `Basic ${auth}` } });
        console.log('[checkExistingPr] completed PR fetch status=', cResp.status);
        if (cResp.ok) {
          const cData = await cResp.json();
          console.log('[checkExistingPr] completed PRs found=', cData.value?.length);
          if (cData.value && cData.value.length > 0) {
            const completePrBtn = tabEl.querySelector('.workspace-tab-complete-pr');
            if (completePrBtn) {
              if (createPrBtnEarly) createPrBtnEarly.style.display = 'none';
              const cPr = cData.value[0];
              tabEl._prData = { id: cPr.pullRequestId, repoId: cPr.repository.id, lastCommitId: cPr.lastMergeSourceCommit?.commitId, org, project, auth, targetRefName: cPr.targetRefName };
              completePrBtn.innerHTML = RESOLVE_TASK_ICON_SVG;
              completePrBtn.title = 'Resolve Azure Task';
              completePrBtn.style.display = 'inline-flex';
              tabEl._completePrState = 'can-resolve';
              console.log('[checkExistingPr] showing resolve task button for', branch);
            }
            return;
          }
        }
      } catch (err) { console.warn('[checkExistingPr] completed PR check error:', err); }
    }
    if (createPrBtnEarly && tabEl._completePrState !== 'can-resolve') createPrBtnEarly.style.display = '';
    return;
  }

  const pr = data.value[0];
  const prUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.pullRequestId}`;
  tabEl._existingPrUrl = prUrl;
  tabEl._prData = { id: pr.pullRequestId, repoId: pr.repository.id, lastCommitId: pr.lastMergeSourceCommit?.commitId, org, project, auth, targetRefName: pr.targetRefName };

  const createPrBtn = tabEl.querySelector('.workspace-tab-create-pr');
  if (!createPrBtn) return;

  let statusClass = 'has-pr';

  const [evaluations, unresolvedCount] = await Promise.all([
    fetchPolicyEvaluations(org, project, auth, pr.repository.project.id, pr.pullRequestId),
    fetchPrUnresolvedThreadCount(org, project, auth, pr.repository.id, pr.pullRequestId),
  ]);
  const reviewerRejected = (pr.reviewers || []).some(r => r.vote <= -10);

  if (evaluations.length > 0 || reviewerRejected) {
    const hasFailed = reviewerRejected || evaluations.some(e => e.status === 'rejected' || e.status === 'broken');
    if (hasFailed) {
      statusClass = 'has-pr-failed';
    } else {
      const buildEvals = evaluations.filter(e => e.context?.buildId);
      const nonBuildEvals = evaluations.filter(e => !e.context?.buildId);
      const allBuildsApproved = buildEvals.length > 0 && buildEvals.every(e => e.status === 'approved');
      const allApproved = evaluations.every(e => e.status === 'approved');
      if (allApproved && unresolvedCount === 0) statusClass = 'has-pr-approved';
      else if (unresolvedCount > 0) statusClass = 'has-pr-comments';
      else if (allBuildsApproved && nonBuildEvals.some(e => e.status === 'queued' || e.status === 'running')) statusClass = 'has-pr-succeeded';
    }
  } else if (unresolvedCount > 0) {
    statusClass = 'has-pr-comments';
  }

  createPrBtn.classList.remove('has-pr', 'has-pr-succeeded', 'has-pr-approved', 'has-pr-failed', 'has-pr-comments');
  createPrBtn.classList.add(statusClass);
  createPrBtn.style.display = statusClass === 'has-pr-approved' ? 'none' : '';
  createPrBtn.title = `View Pull Request #${pr.pullRequestId} (Ctrl+Alt+M)`;

  const completePrBtn = tabEl.querySelector('.workspace-tab-complete-pr');
  if (completePrBtn && tabEl._completePrState !== 'can-resolve') {
    if (statusClass === 'has-pr-approved') {
      completePrBtn.innerHTML = COMPLETE_PR_ICON_SVG;
      completePrBtn.title = 'Complete Pull Request (merge + delete branch)';
      completePrBtn.style.display = 'inline-flex';
      tabEl._completePrState = 'can-complete';
    } else {
      completePrBtn.style.display = 'none';
      tabEl._completePrState = null;
    }
  }
}

export function showTabCloseButton(tabEl) {
  const switchBtn = tabEl.querySelector('.workspace-tab-switch');
  const removeBtn = tabEl.querySelector('.workspace-tab-remove');
  const commitPushBtn = tabEl.querySelector('.workspace-tab-commit-push');
  const createPrBtn = tabEl.querySelector('.workspace-tab-create-pr');
  const closeBtn = tabEl.querySelector('.workspace-tab-close');
  if (switchBtn) switchBtn.style.display = 'none';
  if (removeBtn) removeBtn.style.display = 'none';
  if (commitPushBtn) commitPushBtn.style.display = '';
  if (createPrBtn) createPrBtn.style.display = tabEl._completePrState === 'can-resolve' ? 'none' : '';
  if (closeBtn) closeBtn.style.display = '';
  checkExistingPr(tabEl);
}

export function showTabRemoveButton(tabEl) {
  const switchBtn = tabEl.querySelector('.workspace-tab-switch');
  const removeBtn = tabEl.querySelector('.workspace-tab-remove');
  const commitPushBtn = tabEl.querySelector('.workspace-tab-commit-push');
  const createPrBtn = tabEl.querySelector('.workspace-tab-create-pr');
  const closeBtn = tabEl.querySelector('.workspace-tab-close');
  if (switchBtn) switchBtn.style.display = '';
  if (removeBtn) removeBtn.style.display = '';
  if (commitPushBtn) commitPushBtn.style.display = 'none';
  if (createPrBtn) createPrBtn.style.display = (tabEl._completePrState === 'can-resolve' || !tabEl._existingPrUrl) ? 'none' : '';
  if (closeBtn) closeBtn.style.display = 'none';
  checkExistingPr(tabEl);
}

export function getWorktreeOrders() {
  const repoGroupsEl = document.getElementById('repo-groups');
  const orders = {};
  for (const groupEl of repoGroupsEl.querySelectorAll('.repo-group')) {
    const repoName = groupEl.dataset.repoName;
    orders[repoName] = Array.from(groupEl.querySelectorAll('.workspace-tab'))
      .map(tab => tab._wtPath);
  }
  return orders;
}

export function getOpenWorktreePaths() {
  const paths = [];
  for (const tab of document.querySelectorAll('.workspace-tab')) {
    if (tab._workspaceId !== null) {
      paths.push(tab._wtPath);
    }
  }
  return paths;
}

export function createWorktreeTab(wt) {
  const tabEl = document.createElement('div');
  tabEl.className = 'workspace-tab';
  tabEl.title = 'Open Workspace';
  setTabStatus(tabEl, 'idle');
  tabEl.innerHTML = `
    <span class="workspace-tab-status"></span>
    <span class="workspace-tab-label">${formatBranchLabel(wt.branch)}</span>
    <button class="workspace-tab-switch" title="Switch Worktree">${SWITCH_ICON_SVG}</button>
    <button class="workspace-tab-commit-push" title="Commit &amp; Push (Ctrl+Alt+P)" style="display:none">${COMMIT_PUSH_ICON_SVG}</button>
    <button class="workspace-tab-create-pr" title="Create Pull Request (Ctrl+Alt+M)" style="display:none">${PR_ICON_SVG}</button>
    <button class="workspace-tab-complete-pr" title="Complete Pull Request" style="display:none">${COMPLETE_PR_ICON_SVG}</button>
    <button class="workspace-tab-close" title="Close (Ctrl+Alt+W)" style="display:none">&times;</button>
    <button class="workspace-tab-remove" title="Remove Worktree">${BIN_ICON_SVG}</button>
  `;

  tabEl._wtPath = wt.path;
  tabEl._wtBranch = wt.branch;
  tabEl._wtSourceBranch = wt.sourceBranch || getSourceBranch(wt.path);
  tabEl._wtTaskId = wt.taskId || getTaskId(wt.path) || extractTaskIdFromBranch(wt.branch);
  tabEl._workspaceId = null;
  tabEl._pollTimer = null;
  tabEl._wasWorking = false;
  tabEl._prData = null;
  tabEl._completePrState = null;

  const dotEl = document.createElement('button');
  dotEl.className = 'collapsed-dot';
  dotEl.dataset.status = 'idle';
  dotEl.title = wt.branch;
  dotEl.innerHTML = '<span class="collapsed-dot-indicator"></span>';
  dotEl.addEventListener('click', () => openWorktree(tabEl, wt));
  collapsedDotsEl.appendChild(dotEl);
  tabEl._dotEl = dotEl;

  tabEl.querySelector('.workspace-tab-switch').addEventListener('click', (e) => {
    e.stopPropagation();
    if (_showWorktreeSwitchDialog) {
      const groupEl = tabEl.closest('.repo-group');
      _showWorktreeSwitchDialog(tabEl, groupEl);
    }
  });

  tabEl.querySelector('.workspace-tab-remove').addEventListener('click', (e) => {
    e.stopPropagation();
    if (_showWorktreeRemoveDialog) {
      const groupEl = tabEl.closest('.repo-group');
      _showWorktreeRemoveDialog(tabEl, groupEl);
    }
  });

  tabEl.querySelector('.workspace-tab-commit-push').addEventListener('click', (e) => {
    e.stopPropagation();
    if (_showCommitPushDialog) {
      const groupEl = tabEl.closest('.repo-group');
      _showCommitPushDialog(tabEl, groupEl);
    }
  });

  tabEl.querySelector('.workspace-tab-create-pr').addEventListener('click', (e) => {
    e.stopPropagation();
    if (tabEl._existingPrUrl) {
      window.shellAPI.openExternal(tabEl._existingPrUrl);
    } else if (_showCreatePrDialog) {
      const groupEl = tabEl.closest('.repo-group');
      _showCreatePrDialog(tabEl, groupEl);
    }
  });

  tabEl.querySelector('.workspace-tab-complete-pr').addEventListener('click', async (e) => {
    e.stopPropagation();
    const btn = tabEl.querySelector('.workspace-tab-complete-pr');
    if (tabEl._completePrState === 'can-complete') {
      const d = tabEl._prData;
      if (!d) return;
      btn.disabled = true;
      const ok = await completePullRequest(d.org, d.project, d.auth, d.repoId, d.id, d.lastCommitId);
      btn.disabled = false;
      if (ok) {
        tabEl._completePrState = 'can-resolve';
        if (tabEl._wtTaskId) {
          btn.innerHTML = RESOLVE_TASK_ICON_SVG;
          btn.title = 'Resolve Azure Task';
        } else {
          btn.style.display = 'none';
          tabEl._completePrState = null;
        }
      }
    } else if (tabEl._completePrState === 'can-resolve') {
      const d = tabEl._prData;
      if (!d || !tabEl._wtTaskId) return;
      const ctx = { org: d.org, project: d.project, auth: d.auth, apiBase: `https://dev.azure.com/${encodeURIComponent(d.org)}/${encodeURIComponent(d.project)}/_apis` };
      const targetBranch = d.targetRefName || `refs/heads/${tabEl._wtSourceBranch || 'master'}`;
      const ok = await showResolveTaskDialog(ctx, tabEl._wtTaskId, { org: d.org, project: d.project, auth: d.auth, targetBranch });
      if (ok) {
        btn.style.display = 'none';
        tabEl._completePrState = null;
      }
    }
  });

  tabEl.addEventListener('click', (e) => {
    if (e.target.closest('.workspace-tab-close') || e.target.closest('.workspace-tab-switch') || e.target.closest('.workspace-tab-remove') || e.target.closest('.workspace-tab-commit-push') || e.target.closest('.workspace-tab-create-pr') || e.target.closest('.workspace-tab-complete-pr')) return;
    openWorktree(tabEl, wt);
  });

  tabEl.querySelector('.workspace-tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    if (tabEl._workspaceId !== null) {
      closeWorkspace(tabEl._workspaceId);
    }
  });

  tabEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, tabEl);
  });

  tabEl.setAttribute('draggable', 'true');

  tabEl.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    tabEl.classList.add('dragging');
    setTimeout(() => tabEl.classList.add('drag-ghost'), 0);
  });

  tabEl.addEventListener('dragend', (e) => {
    e.stopPropagation();
    tabEl.classList.remove('dragging', 'drag-ghost');
    const tabsEl = tabEl.closest('.repo-group-tabs');
    if (tabsEl) tabsEl.querySelectorAll('.workspace-tab.drag-over').forEach(el => el.classList.remove('drag-over'));
    rebuildCollapsedDots();
    if (_onStateChange) _onStateChange();
  });

  tabEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const tabsEl = tabEl.closest('.repo-group-tabs');
    if (!tabsEl) return;
    const dragging = tabsEl.querySelector('.workspace-tab.dragging');
    if (!dragging || dragging === tabEl) return;

    tabsEl.querySelectorAll('.workspace-tab.drag-over').forEach(el => el.classList.remove('drag-over'));
    tabEl.classList.add('drag-over');

    const rect = tabEl.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      tabsEl.insertBefore(dragging, tabEl);
    } else {
      tabsEl.insertBefore(dragging, tabEl.nextSibling);
    }
  });

  tabEl.addEventListener('dragleave', (e) => {
    e.stopPropagation();
    tabEl.classList.remove('drag-over');
  });

  return tabEl;
}

setInterval(() => {
  for (const tab of document.querySelectorAll('.workspace-tab')) {
    const btn = tab.querySelector('.workspace-tab-create-pr');
    if (btn && (btn.classList.contains('has-pr') || btn.classList.contains('has-pr-succeeded') || btn.classList.contains('has-pr-approved') || btn.classList.contains('has-pr-failed') || btn.classList.contains('has-pr-comments'))) {
      checkExistingPr(tab);
    }
  }
}, 60 * 1000);
