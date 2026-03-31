import { syncTitlebarToTab } from '../workspace-manager.js';
import { parseAzureRemoteUrl, fetchPolicyEvaluations, fetchPrUnresolvedThreadCount, fetchWorkItemById, fetchLatestBuild, fetchBuildArtifacts } from '../azure-api.js';
import { PIPELINE_STATUS_CLASSES, PR_STATUS_CLASSES, INSTALL_BTN_SVG, INSTALL_PIPELINE_RUNNING_SVG } from './worktree-tab-icons.js';
import { updateDotState } from './worktree-tab-dot-state.js';

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

export function showFallbackSwitch(tabEl) {
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

export async function updatePipelineForTab(tabEl, { org, project, auth }) {
  const targetBranch = tabEl._pipelineTargetBranch;
  if (!targetBranch) return;

  const build = await fetchLatestBuild(org, project, auth, targetBranch, tabEl._pipelineMergeTime);
  const pipelineBtn = tabEl.querySelector('.workspace-tab-open-pipeline');
  const installBtn = tabEl.querySelector('.workspace-tab-install-btn');
  const resolveTaskBtn = tabEl.querySelector('.workspace-tab-resolve-task');
  const switchBtn = tabEl.querySelector('.workspace-tab-switch');
  const actionBtn = tabEl.querySelector('.workspace-tab-action');

  if (pipelineBtn) pipelineBtn.classList.remove(...PIPELINE_STATUS_CLASSES);

  if (!build) {
    tabEl._pipelineStatus = null;
    tabEl._pipelineUrl = null;
    if (pipelineBtn) { pipelineBtn.style.display = 'inline-flex'; pipelineBtn.title = 'Waiting for pipeline\u2026'; }
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
      if (pipelineBtn) pipelineBtn.style.display = 'none';
      if (installBtn) {
        installBtn.innerHTML = INSTALL_BTN_SVG;
        installBtn.classList.remove('pipeline-running');
        installBtn.style.color = '';
        installBtn.style.display = 'none';
      }
      if (tabEl._taskResolved) {
        if (resolveTaskBtn) resolveTaskBtn.style.display = 'none';
        showFallbackSwitch(tabEl);
      } else {
        tabEl._canResolveTask = true;
        if (resolveTaskBtn && tabEl._wtTaskId) { resolveTaskBtn.style.display = 'inline-flex'; resolveTaskBtn.title = 'Complete Azure Task'; }
        if (switchBtn) switchBtn.style.display = 'none';
      }
    } else {
      tabEl._pipelineStatus = 'failed';
      if (pipelineBtn) {
        pipelineBtn.classList.add('pipeline-failed');
        pipelineBtn.style.display = 'inline-flex';
        pipelineBtn.title = `Pipeline ${build.buildNumber} failed`;
      }
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
    // Pipeline is running
    tabEl._pipelineStatus = 'running';
    let pipelineColor = 'var(--accent)';
    if (pipelineBtn) {
      pipelineBtn.classList.add('pipeline-running');
      pipelineBtn.style.display = 'inline-flex';
      pipelineBtn.title = `Pipeline ${build.buildNumber} running\u2026`;
      if (pipelineBtn.classList.contains('pipeline-running')) pipelineColor = 'var(--yellow)';
      else if (pipelineBtn.classList.contains('pipeline-failed')) pipelineColor = 'var(--red)';
      else if (pipelineBtn.classList.contains('pipeline-succeeded')) pipelineColor = 'var(--green)';
    }

    if (tabEl._taskResolved) {
      // Task already completed — just keep monitoring pipeline
      if (installBtn) installBtn.style.display = 'none';
      if (resolveTaskBtn) resolveTaskBtn.style.display = 'none';
      if (actionBtn) actionBtn.style.display = '';
    } else if (tabEl._pipelineInstalled) {
      // Installed — show complete task alongside running pipeline
      if (installBtn) installBtn.style.display = 'none';
      if (actionBtn) actionBtn.style.display = '';
      tabEl._canResolveTask = true;
      if (resolveTaskBtn && tabEl._wtTaskId) { resolveTaskBtn.style.display = 'inline-flex'; resolveTaskBtn.title = `Complete Task`; }
      if (switchBtn) switchBtn.style.display = 'none';
    } else {
      // Not yet installed — check for artifact
      if (resolveTaskBtn) resolveTaskBtn.style.display = 'none';
      const artifacts = await fetchBuildArtifacts(org, project, auth, build.id, build.definitionId);
      if (artifacts.some(a => a.name === 'Setups')) {
        if (installBtn) {
          installBtn.innerHTML = INSTALL_PIPELINE_RUNNING_SVG;
          installBtn.classList.add('pipeline-running');
          installBtn.style.color = 'var(--accent)';
          installBtn.style.display = 'inline-flex';
          installBtn.title = `Download build ${build.buildNumber}`;
        }
        if (actionBtn) actionBtn.style.display = 'none';
      } else {
        if (installBtn) installBtn.style.display = 'none';
        if (actionBtn) actionBtn.style.display = '';
      }
    }
  }

  if (switchBtn && !(tabEl._pipelineStatus === 'succeeded' && tabEl._taskResolved)) switchBtn.style.display = 'none';
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
            const mergedPrUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(cPr.repository.name)}/pullrequest/${cPr.pullRequestId}`;
            tabEl._mergedPrUrl = mergedPrUrl;
            const taskCtx = { org, project, auth, apiBase: `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis` };
            const wi = await fetchWorkItemById(taskCtx, tabEl._wtTaskId);
            if (wi && ['Resolved', 'Closed', 'Done', 'Removed'].includes(wi.state)) {
              tabEl._taskResolved = true;
              tabEl._canResolveTask = false;
              if (completePrBtn) completePrBtn.style.display = 'none';
              if (resolveTaskBtn) resolveTaskBtn.style.display = 'none';
              if (createPrBtn) createPrBtn.style.display = 'none';
              tabEl._canOpenPipeline = true;
              if (!tabEl._pipelineTargetBranch) {
                tabEl._pipelineTargetBranch = cPr.targetRefName;
                tabEl._pipelineMergeTime = cPr.closedDate || null;
              }
              await updatePipelineForTab(tabEl, { org, project, auth });
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
    openPrBtn.title = `View Pull Request #${pr.pullRequestId}`;
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

export async function refreshTabStatus(tabEl) {
  try { await _refreshTabStatusInner(tabEl); } finally { updateDotState(tabEl); syncTitlebarToTab(); }
}
