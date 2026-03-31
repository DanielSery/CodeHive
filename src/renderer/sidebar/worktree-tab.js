import { setTabStatus } from '../claude-poll.js';
import { openWorktree, closeWorkspace, syncTitlebarToTab } from '../workspace-manager.js';
import { getSourceBranch, getTaskId } from '../storage.js';
import { rebuildCollapsedDots, collapsedDotsEl } from './collapsed-dots.js';
import { showContextMenu } from './context-menu.js';
import { _showWorktreeSwitchDialog, _showWorktreeRemoveDialog, _showCommitPushDialog, _showCreatePrDialog, _onStateChange } from './registers.js';
import { parseAzureRemoteUrl, fetchPolicyEvaluations, fetchPrUnresolvedThreadCount, completePullRequest, fetchWorkItemById, fetchLatestBuild, fetchBuildArtifacts } from '../azure-api.js';
import { showResolveTaskDialog } from '../dialogs/dialog-resolve.js';
import { showInstallDialog, showVerifyDialog } from '../dialogs/dialog-verify.js';
import { showCompletePrDialog } from '../dialogs/dialog-complete-pr.js';

const BIN_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12M5.3 4V2.7a1 1 0 011-1h3.4a1 1 0 011 1V4M6.5 7.3v4.4M9.5 7.3v4.4"/><path d="M3.5 4l.7 9.3a1 1 0 001 .9h5.6a1 1 0 001-.9L12.5 4"/></svg>';

// Collapsed-dot action icons (14x14)
const DOT_COMMIT_PUSH_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12V3"/><path d="M4 7l4-4 4 4"/><circle cx="8" cy="14" r="1.5"/></svg>';
const DOT_CREATE_PR_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="4" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="4" cy="12" r="2"/><path d="M4 6v4"/><path d="M12 10V6c0-1.1-.9-2-2-2H8"/><path d="M10 2L8 4l2 2"/></svg>';
const DOT_OPEN_PR_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="4" r="2"/><circle cx="4" cy="12" r="2"/><path d="M4 6v4"/><path d="M9 3h4v4"/><path d="M13 3L8 8"/></svg>';
const DOT_COMPLETE_PR_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="4" r="2"/><circle cx="4" cy="12" r="2"/><path d="M4 6v4"/><path d="M9 8l2 2 3.5-3.5"/></svg>';
const DOT_RESOLVE_TASK_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M5.5 8l2 2 3-3"/></svg>';
const DOT_OPEN_TASK_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M6 6h4M6 9h3"/></svg>';
const DOT_SWITCH_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 1l3 3-3 3"/><path d="M14 4H5"/><path d="M5 15l-3-3 3-3"/><path d="M2 12h9"/></svg>';
const DOT_DONE_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.5 3.5 6.5-8"/></svg>';
const DOT_PIPELINE_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="2.5" cy="8" r="1.5"/><line x1="4" y1="8" x2="6" y2="8"/><circle cx="7.5" cy="8" r="1.5"/><line x1="9" y1="8" x2="11" y2="8"/><path d="M11 6l3 2-3 2"/></svg>';
const DOT_VERIFY_RUNNING_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="2" cy="7.5" r="1.5"/><line x1="3.5" y1="7.5" x2="5.5" y2="7.5"/><circle cx="7" cy="7.5" r="1.5"/><path d="M12 3v6"/><path d="M10 7.5l2 2 2-2"/><line x1="10" y1="12" x2="14" y2="12"/></svg>';
const DOT_VERIFY_DONE_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 7.5l2.5 2.5 4-5"/><path d="M12 3v6"/><path d="M10 7.5l2 2 2-2"/><line x1="10" y1="12" x2="14" y2="12"/></svg>';
const INSTALL_BTN_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v7"/><path d="M5 8l3 3 3-3"/><path d="M3 13h10"/></svg>';
const INSTALL_PIPELINE_RUNNING_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="2" cy="7.5" r="1.5"/><line x1="3.5" y1="7.5" x2="5.5" y2="7.5"/><circle cx="7" cy="7.5" r="1.5"/><path d="M12 3v6"/><path d="M10 7.5l2 2 2-2"/><line x1="10" y1="13" x2="14" y2="13"/></svg>';

const PIPELINE_STATUS_CLASSES = ['pipeline-running', 'pipeline-failed', 'pipeline-succeeded'];

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

const PR_STATUS_CLASSES = ['has-pr', 'has-pr-succeeded', 'has-pr-approved', 'has-pr-failed', 'has-pr-comments'];

function hasPrStatusClass(btn) {
  return PR_STATUS_CLASSES.some(cls => btn.classList.contains(cls));
}

function isButtonVisible(btn) {
  return btn && btn.style.display !== 'none';
}

/**
 * Computes the collapsed-dot icon and color from the tab's current button state.
 */
function getTabDotState(tabEl) {
  const commitPushBtn = tabEl.querySelector('.workspace-tab-commit-push');
  const completePrBtn = tabEl.querySelector('.workspace-tab-complete-pr');
  const pipelineBtn = tabEl.querySelector('.workspace-tab-open-pipeline');
  const verifyBtn = tabEl.querySelector('.workspace-tab-verify');
  const resolveTaskBtn = tabEl.querySelector('.workspace-tab-resolve-task');
  const openPrBtn = tabEl.querySelector('.workspace-tab-open-pr');
  const createPrBtn = tabEl.querySelector('.workspace-tab-create-pr');
  const switchBtn = tabEl.querySelector('.workspace-tab-switch');

  if (isButtonVisible(commitPushBtn)) {
    return { icon: DOT_COMMIT_PUSH_SVG, color: 'var(--green)' };
  }
  if (isButtonVisible(completePrBtn)) {
    return { icon: DOT_COMPLETE_PR_SVG, color: 'var(--green)' };
  }
  if (isButtonVisible(pipelineBtn)) {
    let color = 'var(--accent)';
    if (pipelineBtn.classList.contains('pipeline-running')) color = 'var(--yellow)';
    else if (pipelineBtn.classList.contains('pipeline-failed')) color = 'var(--red)';
    else if (pipelineBtn.classList.contains('pipeline-succeeded')) color = 'var(--green)';
    return { icon: DOT_PIPELINE_SVG, color };
  }
  if (isButtonVisible(verifyBtn)) {
    if (tabEl._pipelineStatus === 'running') return { icon: DOT_VERIFY_RUNNING_SVG, color: 'var(--yellow)' };
    return { icon: DOT_VERIFY_DONE_SVG, color: 'var(--green)' };
  }
  if (isButtonVisible(resolveTaskBtn)) {
    return { icon: DOT_RESOLVE_TASK_SVG, color: 'var(--green)' };
  }
  if (isButtonVisible(openPrBtn)) {
    let color = 'var(--accent)';
    if (openPrBtn.classList.contains('has-pr-approved')) color = 'var(--green)';
    else if (openPrBtn.classList.contains('has-pr-failed')) color = 'var(--red)';
    else if (openPrBtn.classList.contains('has-pr-comments')) color = 'var(--peach)';
    else if (openPrBtn.classList.contains('has-pr-succeeded')) color = 'var(--yellow)';
    return { icon: DOT_OPEN_PR_SVG, color };
  }
  if (isButtonVisible(createPrBtn)) {
    return { icon: DOT_CREATE_PR_SVG, color: 'var(--accent)' };
  }
  if (isButtonVisible(switchBtn)) {
    return tabEl._switchMode === 'open-task'
      ? { icon: DOT_OPEN_TASK_SVG, color: 'var(--accent)' }
      : { icon: DOT_SWITCH_SVG, color: 'var(--text-muted)' };
  }
  if (tabEl._taskResolved) {
    return { icon: DOT_DONE_SVG, color: 'var(--green)' };
  }
  return { icon: DOT_SWITCH_SVG, color: 'var(--text-muted)' };
}

function getTabActionTitle(tabEl) {
  const commitPushBtn = tabEl.querySelector('.workspace-tab-commit-push');
  const completePrBtn = tabEl.querySelector('.workspace-tab-complete-pr');
  const pipelineBtn = tabEl.querySelector('.workspace-tab-open-pipeline');
  const installBtn = tabEl.querySelector('.workspace-tab-install-btn');
  const verifyBtn = tabEl.querySelector('.workspace-tab-verify');
  const resolveTaskBtn = tabEl.querySelector('.workspace-tab-resolve-task');
  const openPrBtn = tabEl.querySelector('.workspace-tab-open-pr');
  const createPrBtn = tabEl.querySelector('.workspace-tab-create-pr');
  const switchBtn = tabEl.querySelector('.workspace-tab-switch');

  if (isButtonVisible(commitPushBtn)) return 'Commit & Push (Ctrl+Alt+P)';
  if (isButtonVisible(completePrBtn)) return 'Complete Pull Request';
  if (isButtonVisible(pipelineBtn)) {
    const num = tabEl._pipelineBuildNumber ? ` ${tabEl._pipelineBuildNumber}` : '';
    if (tabEl._pipelineStatus === 'running') return `Pipeline${num} running\u2026`;
    if (tabEl._pipelineStatus === 'failed') return `Pipeline${num} failed`;
    return `Open Pipeline${num}`;
  }
  if (isButtonVisible(installBtn) && installBtn.classList.contains('pipeline-running')) {
    const num = tabEl._pipelineBuildNumber ? ` ${tabEl._pipelineBuildNumber}` : '';
    return `Pipeline${num} running \u2014 Install build`;
  }
  if (isButtonVisible(verifyBtn)) return 'Verify Build';
  if (isButtonVisible(resolveTaskBtn)) return 'Resolve Azure Task';
  if (isButtonVisible(openPrBtn)) return 'View Pull Request (Ctrl+Alt+M)';
  if (isButtonVisible(createPrBtn)) return 'Create Pull Request (Ctrl+Alt+M)';
  if (isButtonVisible(switchBtn)) {
    return tabEl._switchMode === 'open-task' ? 'Open Task (Ctrl+Alt+A)' : 'Switch Worktree';
  }
  if (tabEl._taskResolved) return 'Done';
  return 'Switch Worktree';
}

function updateDotState(tabEl) {
  const { icon, color } = getTabDotState(tabEl);
  const dotEl = tabEl._dotEl;
  if (dotEl) {
    dotEl.innerHTML = icon;
    dotEl.style.color = color;
  }
  const actionBtn = tabEl.querySelector('.workspace-tab-action');
  if (actionBtn) {
    actionBtn.innerHTML = icon;
    actionBtn.style.color = color;
    actionBtn.title = getTabActionTitle(tabEl);
  }
}

/**
 * Determines the PR status CSS class based on policy evaluations and reviewer votes.
 */
function computePrStatusClass(reviewers, evaluations, unresolvedCount) {
  const reviewerRejected = (reviewers || []).some(r => r.vote <= -10);

  if (evaluations.length > 0 || reviewerRejected) {
    const hasFailed = reviewerRejected || evaluations.some(e => e.status === 'rejected' || e.status === 'broken');
    if (hasFailed) return 'has-pr-failed';

    const buildEvals = evaluations.filter(e => e.context?.buildId);
    const nonBuildEvals = evaluations.filter(e => !e.context?.buildId);
    const allBuildsApproved = buildEvals.length > 0 && buildEvals.every(e => e.status === 'approved');
    const allApproved = evaluations.every(e => e.status === 'approved');

    if (allApproved && unresolvedCount === 0) return 'has-pr-approved';
    if (unresolvedCount > 0) return 'has-pr-comments';
    if (allBuildsApproved && nonBuildEvals.some(e => e.status === 'queued' || e.status === 'running')) return 'has-pr-succeeded';
  } else if (unresolvedCount > 0) {
    return 'has-pr-comments';
  }
  return 'has-pr';
}

/**
 * Applies the primary action button visibility for a tab.
 * Only one primary action is shown at a time (priority: commit > complete/resolve > PR > switch).
 */
function applyActionButtonVisibility(tabEl, { statusClass, switchBtn }) {
  const openPrBtn = tabEl.querySelector('.workspace-tab-open-pr');
  const completePrBtn = tabEl.querySelector('.workspace-tab-complete-pr');
  let actionShown = false;

  if (statusClass === 'has-pr-approved') {
    tabEl._canCompletePr = true;
    if (!tabEl._hasUncommittedChanges) {
      if (completePrBtn) completePrBtn.style.display = 'inline-flex';
      if (openPrBtn) openPrBtn.style.display = 'inline-flex';
      actionShown = true;
    } else {
      if (completePrBtn) completePrBtn.style.display = 'none';
      if (openPrBtn) openPrBtn.style.display = 'none';
    }
  } else {
    tabEl._canCompletePr = false;
    if (completePrBtn) completePrBtn.style.display = 'none';
    if (!tabEl._hasUncommittedChanges) {
      if (openPrBtn) openPrBtn.style.display = 'inline-flex';
      actionShown = true;
    } else {
      if (openPrBtn) openPrBtn.style.display = 'none';
    }
  }

  if (actionShown) {
    if (switchBtn) switchBtn.style.display = 'none';
  } else {
    showFallbackSwitch(tabEl);
  }
}

function showFallbackSwitch(tabEl) {
  if (tabEl._hasUncommittedChanges) return;
  const switchBtn = tabEl.querySelector('.workspace-tab-switch');
  if (!switchBtn) return;
  if (tabEl._wtTaskId && !tabEl._taskResolved) {
    tabEl._switchMode = 'open-task';
  } else {
    tabEl._switchMode = 'switch';
  }
  switchBtn.style.display = '';
}

async function updatePipelineForTab(tabEl, { org, project, auth }) {
  const targetBranch = tabEl._pipelineTargetBranch;
  if (!targetBranch) return;

  const build = await fetchLatestBuild(org, project, auth, targetBranch, tabEl._pipelineMergeTime);
  const pipelineBtn = tabEl.querySelector('.workspace-tab-open-pipeline');
  const verifyBtn = tabEl.querySelector('.workspace-tab-verify');
  const installBtn = tabEl.querySelector('.workspace-tab-install-btn');
  const resolveTaskBtn = tabEl.querySelector('.workspace-tab-resolve-task');
  const switchBtn = tabEl.querySelector('.workspace-tab-switch');
  const actionBtn = tabEl.querySelector('.workspace-tab-action');

  if (pipelineBtn) pipelineBtn.classList.remove(...PIPELINE_STATUS_CLASSES);

  if (!build) {
    tabEl._pipelineStatus = null;
    tabEl._pipelineUrl = null;
    if (pipelineBtn) { pipelineBtn.style.display = 'inline-flex'; pipelineBtn.title = 'Waiting for pipeline\u2026'; }
    if (verifyBtn) verifyBtn.style.display = 'none';
    if (installBtn) {
      installBtn.innerHTML = INSTALL_BTN_SVG;
      installBtn.classList.remove('pipeline-running');
      installBtn.style.color = '';
      installBtn.style.display = 'none';
    }
    if (actionBtn) actionBtn.style.display = '';
    if (resolveTaskBtn) resolveTaskBtn.style.display = 'none';
    if (switchBtn) switchBtn.style.display = 'none';
    return;
  }

  tabEl._pipelineBuildId = build.id;
  tabEl._pipelineBuildNumber = build.buildNumber;
  tabEl._pipelineUrl = build.webUrl;
  if (build.definitionId) tabEl._pipelineDefinitionId = build.definitionId;

  if (build.status === 'completed') {
    if (build.result === 'succeeded' || build.result === 'partiallySucceeded') {
      tabEl._pipelineStatus = 'succeeded';
      tabEl._canVerify = true;
      if (tabEl._pipelineVerified) {
        if (pipelineBtn) pipelineBtn.style.display = 'none';
        if (verifyBtn) verifyBtn.style.display = 'none';
        if (installBtn) installBtn.style.display = 'none';
        if (!tabEl._taskResolved) {
          tabEl._canResolveTask = true;
          if (resolveTaskBtn && tabEl._wtTaskId) { resolveTaskBtn.style.display = 'inline-flex'; }
        }
      } else {
        if (pipelineBtn) pipelineBtn.style.display = 'none';
        if (installBtn) {
          installBtn.innerHTML = INSTALL_BTN_SVG;
          installBtn.classList.remove('pipeline-running');
          installBtn.style.color = '';
          installBtn.style.display = 'inline-flex';
          installBtn.title = `Install build ${build.buildNumber}`;
        }
        if (actionBtn) actionBtn.style.display = '';
        if (verifyBtn) { verifyBtn.style.display = 'inline-flex'; verifyBtn.title = `Verify build ${build.buildNumber}`; }
        if (resolveTaskBtn) resolveTaskBtn.style.display = 'none';
      }
    } else {
      tabEl._pipelineStatus = 'failed';
      tabEl._canVerify = false;
      if (pipelineBtn) {
        pipelineBtn.classList.add('pipeline-failed');
        pipelineBtn.style.display = 'inline-flex';
        pipelineBtn.title = `Pipeline ${build.buildNumber} failed`;
      }
      if (verifyBtn) verifyBtn.style.display = 'none';
      if (installBtn) {
        installBtn.innerHTML = INSTALL_BTN_SVG;
        installBtn.classList.remove('pipeline-running');
        installBtn.style.color = '';
        installBtn.style.display = 'none';
      }
      if (actionBtn) actionBtn.style.display = '';
      if (resolveTaskBtn) resolveTaskBtn.style.display = 'none';
    }
  } else {
    tabEl._pipelineStatus = 'running';
    if (resolveTaskBtn) resolveTaskBtn.style.display = 'none';
    if (!tabEl._pipelineVerified) {
      tabEl._canVerify = true;
      if (verifyBtn) { verifyBtn.style.display = 'inline-flex'; verifyBtn.title = `Verify build ${build.buildNumber}`; }
      const artifacts = await fetchBuildArtifacts(org, project, auth, build.id, build.definitionId);
      if (artifacts.some(a => a.name === 'Setups')) {
        if (pipelineBtn) pipelineBtn.style.display = 'none';
        if (installBtn) {
          installBtn.innerHTML = INSTALL_PIPELINE_RUNNING_SVG;
          installBtn.classList.add('pipeline-running');
          installBtn.style.color = 'var(--yellow)';
          installBtn.style.display = 'inline-flex';
          installBtn.title = `Pipeline ${build.buildNumber} running — Install build`;
        }
        if (actionBtn) actionBtn.style.display = 'none';
      } else {
        if (pipelineBtn) {
          pipelineBtn.classList.add('pipeline-running');
          pipelineBtn.style.display = 'inline-flex';
          pipelineBtn.title = `Pipeline ${build.buildNumber} running\u2026`;
        }
        if (installBtn) installBtn.style.display = 'none';
        if (actionBtn) actionBtn.style.display = '';
      }
    } else {
      tabEl._canVerify = false;
      if (verifyBtn) verifyBtn.style.display = 'none';
      if (installBtn) installBtn.style.display = 'none';
      if (actionBtn) actionBtn.style.display = '';
      if (pipelineBtn) {
        pipelineBtn.classList.add('pipeline-running');
        pipelineBtn.style.display = 'inline-flex';
        pipelineBtn.title = `Pipeline ${build.buildNumber} running\u2026`;
      }
    }
  }

  if (switchBtn) switchBtn.style.display = 'none';
}

export async function refreshTabStatus(tabEl) {
  try { await _refreshTabStatusInner(tabEl); } finally { updateDotState(tabEl); syncTitlebarToTab(); }
}

async function _refreshTabStatusInner(tabEl) {
  const groupEl = tabEl.closest('.repo-group');
  if (!groupEl) return;
  const barePath = groupEl._barePath;
  const branch = tabEl._wtBranch;
  if (!barePath || !branch) return;

  // Check for uncommitted changes and pushed commits
  const commitPushBtn = tabEl.querySelector('.workspace-tab-commit-push');
  const switchBtn = tabEl.querySelector('.workspace-tab-switch');
  const isOpen = tabEl._workspaceId !== null;
  try {
    const ucResult = await window.reposAPI.hasUncommittedChanges(tabEl._wtPath);
    tabEl._hasUncommittedChanges = ucResult.value;
    if (ucResult.error) console.warn('[refreshTabStatus] hasUncommittedChanges error:', ucResult.message);
  } catch { tabEl._hasUncommittedChanges = false; }
  const sourceBranch = tabEl._wtSourceBranch || 'master';
  try {
    const pcResult = await window.reposAPI.hasPushedCommits(tabEl._wtPath, branch, sourceBranch);
    tabEl._hasPushedCommits = pcResult.value;
    if (pcResult.error) console.warn('[refreshTabStatus] hasPushedCommits error:', pcResult.message);
  } catch { tabEl._hasPushedCommits = false; }
  if (commitPushBtn) commitPushBtn.style.display = tabEl._hasUncommittedChanges ? '' : 'none';
  if (isOpen || tabEl._hasUncommittedChanges) {
    if (switchBtn) switchBtn.style.display = 'none';
  }

  let remoteUrl;
  try { remoteUrl = await window.reposAPI.remoteUrl(barePath); } catch { showFallbackSwitch(tabEl); return; }
  if (!remoteUrl) { showFallbackSwitch(tabEl); return; }

  const parsed = parseAzureRemoteUrl(remoteUrl);
  if (!parsed) {
    const createPrBtn = tabEl.querySelector('.workspace-tab-create-pr');
    const openPrBtn = tabEl.querySelector('.workspace-tab-open-pr');
    const completePrBtn = tabEl.querySelector('.workspace-tab-complete-pr');
    const resolveTaskBtn = tabEl.querySelector('.workspace-tab-resolve-task');
    if (createPrBtn) createPrBtn.style.display = 'none';
    if (openPrBtn) openPrBtn.style.display = 'none';
    if (completePrBtn) completePrBtn.style.display = 'none';
    if (resolveTaskBtn) resolveTaskBtn.style.display = 'none';
    showFallbackSwitch(tabEl);
    return;
  }

  if (tabEl._wtTaskId) {
    tabEl._taskUrl = `https://dev.azure.com/${encodeURIComponent(parsed.org)}/${encodeURIComponent(parsed.project)}/_workitems/edit/${tabEl._wtTaskId}`;
  }

  const pat = await window.credentialsAPI.get('azure-pat');
  if (!pat) { showFallbackSwitch(tabEl); return; }

  const auth = btoa(':' + pat);
  const { org, project } = parsed;
  const sourceRef = `refs/heads/${branch}`;
  const apiUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/pullrequests?searchCriteria.sourceRefName=${encodeURIComponent(sourceRef)}&searchCriteria.status=active&api-version=7.0`;

  let data;
  try {
    const resp = await fetch(apiUrl, { headers: { Authorization: `Basic ${auth}` } });
    if (!resp.ok) { showFallbackSwitch(tabEl); return; }
    data = await resp.json();
  } catch { showFallbackSwitch(tabEl); return; }

  const createPrBtn = tabEl.querySelector('.workspace-tab-create-pr');
  const openPrBtn = tabEl.querySelector('.workspace-tab-open-pr');
  const completePrBtn = tabEl.querySelector('.workspace-tab-complete-pr');
  const resolveTaskBtn = tabEl.querySelector('.workspace-tab-resolve-task');

  // Reset PR-related buttons
  tabEl._existingPrUrl = null;
  if (openPrBtn) { openPrBtn.style.display = 'none'; openPrBtn.classList.remove(...PR_STATUS_CLASSES); }

  if (!data.value || data.value.length === 0) {
    // No active PR — check for completed PR (resolve task flow)
    if (tabEl._wtTaskId && !tabEl._canResolveTask) {
      // If already in pipeline monitoring mode, just refresh the pipeline status
      if (tabEl._canOpenPipeline) {
        if (!tabEl._hasUncommittedChanges) {
          await updatePipelineForTab(tabEl, { org, project, auth });
        } else {
          const pipelineBtn = tabEl.querySelector('.workspace-tab-open-pipeline');
          const verifyBtn = tabEl.querySelector('.workspace-tab-verify');
          const installBtn = tabEl.querySelector('.workspace-tab-install-btn');
          if (pipelineBtn) pipelineBtn.style.display = 'none';
          if (verifyBtn) verifyBtn.style.display = 'none';
          if (installBtn) installBtn.style.display = 'none';
        }
        return;
      }
      const completedUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/pullrequests?searchCriteria.sourceRefName=${encodeURIComponent(sourceRef)}&searchCriteria.status=completed&$top=1&api-version=7.0`;
      try {
        const cResp = await fetch(completedUrl, { headers: { Authorization: `Basic ${auth}` } });
        if (cResp.ok) {
          const cData = await cResp.json();
          if (cData.value && cData.value.length > 0) {
            const cPr = cData.value[0];
            const taskCtx = { org, project, auth, apiBase: `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis` };
            const wi = await fetchWorkItemById(taskCtx, tabEl._wtTaskId);
            if (wi && ['Resolved', 'Closed', 'Done', 'Removed'].includes(wi.state)) {
              tabEl._taskResolved = true;
              tabEl._canResolveTask = false;
              if (completePrBtn) completePrBtn.style.display = 'none';
              if (resolveTaskBtn) resolveTaskBtn.style.display = 'none';
              if (createPrBtn) createPrBtn.style.display = 'none';
              showFallbackSwitch(tabEl);
              return;
            }
            tabEl._prData = { id: cPr.pullRequestId, repoId: cPr.repository.id, lastCommitId: cPr.lastMergeSourceCommit?.commitId, org, project, auth, targetRefName: cPr.targetRefName, title: cPr.title };
            tabEl._canCompletePr = false;
            if (createPrBtn) createPrBtn.style.display = 'none';
            if (completePrBtn) completePrBtn.style.display = 'none';
            if (tabEl._hasUncommittedChanges) {
              if (resolveTaskBtn) resolveTaskBtn.style.display = 'none';
            } else {
              tabEl._canOpenPipeline = true;
              if (!tabEl._pipelineTargetBranch) {
                tabEl._pipelineTargetBranch = cPr.targetRefName;
                tabEl._pipelineMergeTime = cPr.closedDate || null;
              }
              await updatePipelineForTab(tabEl, { org, project, auth });
            }
            return;
          }
        }
      } catch (err) { console.warn('[refreshTabStatus] completed PR check error:', err); }
    }
    // No active PR, no completed PR — show Create PR only if pushed commits exist and no uncommitted changes
    const canShowCreatePr = !tabEl._hasUncommittedChanges && tabEl._hasPushedCommits;
    if (!tabEl._canResolveTask) {
      if (completePrBtn) completePrBtn.style.display = 'none';
      if (resolveTaskBtn) resolveTaskBtn.style.display = 'none';
      tabEl._canCompletePr = false;
      if (createPrBtn) {
        createPrBtn.style.display = canShowCreatePr ? '' : 'none';
        if (canShowCreatePr && switchBtn) switchBtn.style.display = 'none';
      }
      if (!canShowCreatePr) showFallbackSwitch(tabEl);
    }
    return;
  }

  // Active PR found
  const pr = data.value[0];
  const prUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.pullRequestId}`;
  tabEl._existingPrUrl = prUrl;
  tabEl._prData = { id: pr.pullRequestId, repoId: pr.repository.id, lastCommitId: pr.lastMergeSourceCommit?.commitId, org, project, auth, targetRefName: pr.targetRefName, title: pr.title };

  // Hide create-pr since there's already an active PR
  if (createPrBtn) createPrBtn.style.display = 'none';
  if (resolveTaskBtn) resolveTaskBtn.style.display = 'none';
  tabEl._canResolveTask = false;

  const [evaluations, unresolvedCount] = await Promise.all([
    fetchPolicyEvaluations(org, project, auth, pr.repository.project.id, pr.pullRequestId),
    fetchPrUnresolvedThreadCount(org, project, auth, pr.repository.id, pr.pullRequestId),
  ]);
  const statusClass = computePrStatusClass(pr.reviewers, evaluations, unresolvedCount);

  // Show open-pr button with status coloring
  if (openPrBtn) {
    openPrBtn.classList.remove(...PR_STATUS_CLASSES);
    openPrBtn.classList.add(statusClass);
    openPrBtn.title = `View Pull Request #${pr.pullRequestId} (Ctrl+Alt+M)`;
  }

  applyActionButtonVisibility(tabEl, { statusClass, switchBtn });

  // Active PR is being shown — clear any stale pipeline/install/verify buttons
  const pipelineBtnActive = tabEl.querySelector('.workspace-tab-open-pipeline');
  const verifyBtnActive = tabEl.querySelector('.workspace-tab-verify');
  const installBtnActive = tabEl.querySelector('.workspace-tab-install-btn');
  if (pipelineBtnActive) { pipelineBtnActive.style.display = 'none'; pipelineBtnActive.classList.remove(...PIPELINE_STATUS_CLASSES); }
  if (verifyBtnActive) verifyBtnActive.style.display = 'none';
  if (installBtnActive) {
    installBtnActive.innerHTML = INSTALL_BTN_SVG;
    installBtnActive.classList.remove('pipeline-running');
    installBtnActive.style.color = '';
    installBtnActive.style.display = 'none';
  }
  const actionBtnActive = tabEl.querySelector('.workspace-tab-action');
  if (actionBtnActive) actionBtnActive.style.display = '';
}

export function showTabCloseButton(tabEl) {
  const switchBtn = tabEl.querySelector('.workspace-tab-switch');
  const removeBtn = tabEl.querySelector('.workspace-tab-remove');
  const closeBtn = tabEl.querySelector('.workspace-tab-close');
  if (switchBtn) switchBtn.style.display = 'none';
  if (removeBtn) removeBtn.style.display = 'none';
  if (closeBtn) closeBtn.style.display = '';
  refreshTabStatus(tabEl);
}

export function showTabRemoveButton(tabEl) {
  const switchBtn = tabEl.querySelector('.workspace-tab-switch');
  const removeBtn = tabEl.querySelector('.workspace-tab-remove');
  const commitPushBtn = tabEl.querySelector('.workspace-tab-commit-push');
  const createPrBtn = tabEl.querySelector('.workspace-tab-create-pr');
  const openPrBtn = tabEl.querySelector('.workspace-tab-open-pr');
  const completePrBtn = tabEl.querySelector('.workspace-tab-complete-pr');
  const pipelineBtn = tabEl.querySelector('.workspace-tab-open-pipeline');
  const verifyBtn = tabEl.querySelector('.workspace-tab-verify');
  const installBtn = tabEl.querySelector('.workspace-tab-install-btn');
  const resolveTaskBtn = tabEl.querySelector('.workspace-tab-resolve-task');
  const closeBtn = tabEl.querySelector('.workspace-tab-close');
  if (switchBtn) switchBtn.style.display = 'none';
  if (removeBtn) removeBtn.style.display = '';
  if (commitPushBtn) commitPushBtn.style.display = 'none';
  if (createPrBtn) createPrBtn.style.display = 'none';
  if (openPrBtn) openPrBtn.style.display = 'none';
  if (completePrBtn) completePrBtn.style.display = 'none';
  if (pipelineBtn) pipelineBtn.style.display = 'none';
  if (verifyBtn) verifyBtn.style.display = 'none';
  if (installBtn) {
    installBtn.innerHTML = INSTALL_BTN_SVG;
    installBtn.classList.remove('pipeline-running');
    installBtn.style.color = '';
    installBtn.style.display = 'none';
  }
  const actionBtnReset = tabEl.querySelector('.workspace-tab-action');
  if (actionBtnReset) actionBtnReset.style.display = '';
  if (resolveTaskBtn) resolveTaskBtn.style.display = 'none';
  if (closeBtn) closeBtn.style.display = 'none';
  tabEl._hasUncommittedChanges = false;
  refreshTabStatus(tabEl);
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
    <button class="workspace-tab-action" title="Switch Worktree">${DOT_SWITCH_SVG}</button>
    <button class="workspace-tab-install-btn" style="display:none" title="Install Build">${INSTALL_BTN_SVG}</button>
    <button class="workspace-tab-commit-push" style="display:none"></button>
    <button class="workspace-tab-complete-pr" style="display:none"></button>
    <button class="workspace-tab-open-pipeline" style="display:none"></button>
    <button class="workspace-tab-verify" style="display:none"></button>
    <button class="workspace-tab-resolve-task" style="display:none"></button>
    <button class="workspace-tab-open-pr" style="display:none"></button>
    <button class="workspace-tab-create-pr" style="display:none"></button>
    <button class="workspace-tab-switch"></button>
    <span class="workspace-tab-label">${formatBranchLabel(wt.branch)}</span>
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
  tabEl._canCompletePr = false;
  tabEl._canResolveTask = false;
  tabEl._canOpenPipeline = false;
  tabEl._pipelineTargetBranch = null;
  tabEl._pipelineMergeTime = null;
  tabEl._pipelineBuildId = null;
  tabEl._pipelineBuildNumber = null;
  tabEl._pipelineStatus = null;
  tabEl._pipelineUrl = null;
  tabEl._canVerify = false;
  tabEl._pipelineVerified = false;

  const dotEl = document.createElement('button');
  dotEl.className = 'collapsed-dot';
  dotEl.dataset.status = 'idle';
  dotEl.title = wt.branch;
  dotEl.innerHTML = DOT_SWITCH_SVG;
  dotEl.style.color = 'var(--text-muted)';
  dotEl.addEventListener('click', () => openWorktree(tabEl, wt));
  dotEl.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const actionSels = [
      '.workspace-tab-commit-push',
      '.workspace-tab-complete-pr',
      '.workspace-tab-open-pipeline',
      '.workspace-tab-verify',
      '.workspace-tab-resolve-task',
      '.workspace-tab-create-pr',
      '.workspace-tab-open-pr',
      '.workspace-tab-switch'
    ];
    for (const sel of actionSels) {
      const btn = tabEl.querySelector(sel);
      if (btn && btn.style.display !== 'none') {
        btn.click();
        return;
      }
    }
  });
  dotEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, tabEl);
  });
  collapsedDotsEl.appendChild(dotEl);
  tabEl._dotEl = dotEl;

  tabEl.querySelector('.workspace-tab-action').addEventListener('click', (e) => {
    e.stopPropagation();
    const actionSels = [
      '.workspace-tab-commit-push',
      '.workspace-tab-complete-pr',
      '.workspace-tab-open-pipeline',
      '.workspace-tab-verify',
      '.workspace-tab-resolve-task',
      '.workspace-tab-open-pr',
      '.workspace-tab-create-pr',
      '.workspace-tab-switch'
    ];
    for (const sel of actionSels) {
      const btn = tabEl.querySelector(sel);
      if (btn && btn.style.display !== 'none') {
        btn.click();
        return;
      }
    }
  });

  tabEl.querySelector('.workspace-tab-switch').addEventListener('click', (e) => {
    e.stopPropagation();
    if (tabEl._switchMode === 'open-task' && tabEl._taskUrl) {
      window.shellAPI.openExternal(tabEl._taskUrl);
    } else if (_showWorktreeSwitchDialog) {
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
    if (_showCreatePrDialog) {
      const groupEl = tabEl.closest('.repo-group');
      _showCreatePrDialog(tabEl, groupEl);
    }
  });

  tabEl.querySelector('.workspace-tab-open-pr').addEventListener('click', (e) => {
    e.stopPropagation();
    if (tabEl._existingPrUrl) {
      window.shellAPI.openExternal(tabEl._existingPrUrl);
    }
  });

  tabEl.querySelector('.workspace-tab-complete-pr').addEventListener('click', async (e) => {
    e.stopPropagation();
    const btn = tabEl.querySelector('.workspace-tab-complete-pr');
    const d = tabEl._prData;
    if (!d) return;
    const confirmed = await showCompletePrDialog(d.title, d.targetRefName);
    if (!confirmed) return;
    btn.disabled = true;
    const ok = await completePullRequest(d.org, d.project, d.auth, d.repoId, d.id, d.lastCommitId);
    btn.disabled = false;
    if (ok) {
      btn.style.display = 'none';
      tabEl._canCompletePr = false;
      if (tabEl._wtTaskId) {
        tabEl._canOpenPipeline = true;
        tabEl._pipelineTargetBranch = d.targetRefName;
        tabEl._pipelineMergeTime = new Date().toISOString();
        const switchBtn = tabEl.querySelector('.workspace-tab-switch');
        if (switchBtn) switchBtn.style.display = 'none';
      }
      refreshTabStatus(tabEl);
    }
  });

  tabEl.querySelector('.workspace-tab-resolve-task').addEventListener('click', async (e) => {
    e.stopPropagation();
    const d = tabEl._prData;
    if (!d || !tabEl._wtTaskId) return;
    const ctx = { org: d.org, project: d.project, auth: d.auth, apiBase: `https://dev.azure.com/${encodeURIComponent(d.org)}/${encodeURIComponent(d.project)}/_apis` };
    const targetBranch = d.targetRefName || `refs/heads/${tabEl._wtSourceBranch || 'master'}`;
    const result = await showResolveTaskDialog(ctx, tabEl._wtTaskId, { org: d.org, project: d.project, auth: d.auth, targetBranch, mergeTime: tabEl._pipelineMergeTime });
    if (result === 'resolved') {
      tabEl._taskResolved = true;
      tabEl._canResolveTask = false;
    }
    if (result === 'resolved' || result === 'commented') {
      const resolveBtn = tabEl.querySelector('.workspace-tab-resolve-task');
      if (resolveBtn) resolveBtn.style.display = 'none';
      showFallbackSwitch(tabEl);
    }
    refreshTabStatus(tabEl);
  });

  tabEl.querySelector('.workspace-tab-open-pipeline').addEventListener('click', (e) => {
    e.stopPropagation();
    if (tabEl._pipelineUrl) window.shellAPI.openExternal(tabEl._pipelineUrl);
  });

  tabEl.querySelector('.workspace-tab-install-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const d = tabEl._prData;
    if (!d || !tabEl._pipelineBuildId) return;
    await showInstallDialog(d.org, d.project, d.auth, tabEl._pipelineBuildId, tabEl._pipelineBuildNumber, tabEl._pipelineStatus === 'succeeded', tabEl._pipelineDefinitionId);
  });

  tabEl.querySelector('.workspace-tab-verify').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!tabEl._pipelineBuildId) return;
    const result = await showVerifyDialog(tabEl._pipelineBuildNumber);
    if (result === 'verified') {
      tabEl._pipelineVerified = true;
      tabEl._canVerify = false;
      const verifyBtn = tabEl.querySelector('.workspace-tab-verify');
      const installBtn = tabEl.querySelector('.workspace-tab-install-btn');
      if (verifyBtn) verifyBtn.style.display = 'none';
      if (installBtn) installBtn.style.display = 'none';
      if (tabEl._wtTaskId && tabEl._pipelineStatus === 'succeeded') {
        tabEl._canResolveTask = true;
        const resolveBtn = tabEl.querySelector('.workspace-tab-resolve-task');
        if (resolveBtn) resolveBtn.style.display = 'inline-flex';
        const switchBtn = tabEl.querySelector('.workspace-tab-switch');
        if (switchBtn) switchBtn.style.display = 'none';
      }
      updateDotState(tabEl);
      syncTitlebarToTab();
    }
  });

  tabEl.addEventListener('click', (e) => {
    if (e.target.closest('.workspace-tab-close') || e.target.closest('.workspace-tab-switch') || e.target.closest('.workspace-tab-remove') || e.target.closest('.workspace-tab-commit-push') || e.target.closest('.workspace-tab-create-pr') || e.target.closest('.workspace-tab-open-pr') || e.target.closest('.workspace-tab-complete-pr') || e.target.closest('.workspace-tab-open-pipeline') || e.target.closest('.workspace-tab-verify') || e.target.closest('.workspace-tab-resolve-task') || e.target.closest('.workspace-tab-action') || e.target.closest('.workspace-tab-install-btn')) return;
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
    if (tabsEl) {
      tabsEl.querySelectorAll('.workspace-tab.drag-over').forEach(el => el.classList.remove('drag-over'));
      // Ensure "Add worktree" button always stays last
      const addBtn = tabsEl.querySelector('.repo-group-tabs-add');
      if (addBtn) tabsEl.appendChild(addBtn);
    }
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
    // Ensure "Add worktree" button always stays last
    const addBtn = tabsEl.querySelector('.repo-group-tabs-add');
    if (addBtn) tabsEl.appendChild(addBtn);
  });

  tabEl.addEventListener('dragleave', (e) => {
    e.stopPropagation();
    tabEl.classList.remove('drag-over');
  });

  return tabEl;
}

setInterval(() => {
  for (const tab of document.querySelectorAll('.workspace-tab')) {
    const isOpen = tab._workspaceId !== null;
    const openPrBtn = tab.querySelector('.workspace-tab-open-pr');
    const hasPrStatus = openPrBtn && hasPrStatusClass(openPrBtn);
    const watchingPipeline = tab._canOpenPipeline && !tab._pipelineVerified;
    if (isOpen || hasPrStatus || watchingPipeline) {
      refreshTabStatus(tab);
    }
  }
}, 30 * 1000);
