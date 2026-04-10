import { syncTitlebarToTab } from '../workspace-manager.js';
import { parseAzureRemoteUrl, fetchPolicyEvaluations, fetchPrUnresolvedThreadCount, fetchWorkItemById, fetchLatestBuild, fetchBuildArtifacts, fetchActivePrsForBranch, fetchLatestCompletedPrForBranch } from '../azure-api.js';
import { pipeline } from '../pipeline-service.js';
import { PIPELINE_STATUS_CLASSES, PR_STATUS_CLASSES, INSTALL_BTN_SVG, DOT_SWITCH_SVG, DOT_SYNC_SVG, DOT_RESOLVE_TASK_SVG, DOT_COMPLETE_TASK_RUNNING_SVG } from './worktree-tab-icons.js';
import { updateDotState } from './worktree-tab-dot-state.js';
import { getWtState } from '../worktree-state.js';
import { saveTaskResolved } from '../storage.js';

function computeSyncState({ uncommitted, localAhead, localBehind, conflict }) {
  if (conflict) return 'conflict';
  if ((localAhead > 0 || uncommitted) && localBehind > 0) return 'diverged';
  if (uncommitted) return 'uncommitted';
  if (localAhead > 0) return 'ahead';
  if (localBehind > 0) return 'behind';
  return 'clean';
}

function updateSyncButton(btn, state) {
  if (!btn) return;
  if (state === 'clean') { btn.style.display = 'none'; return; }
  btn.style.display = '';
  const colors = { uncommitted: 'var(--green)', ahead: 'var(--green)', behind: 'var(--accent)', diverged: 'var(--peach)', conflict: 'var(--red)' };
  const icons = { uncommitted: DOT_SYNC_SVG, ahead: DOT_SYNC_SVG, behind: DOT_SYNC_SVG, diverged: DOT_SYNC_SVG, conflict: DOT_SYNC_SVG };
  const titles = { uncommitted: 'Commit & Push', ahead: 'Push', behind: 'Pull', diverged: 'Resolve Conflicts', conflict: 'Resolve Conflicts in Git App' };
  btn.innerHTML = icons[state] || '';
  btn.style.color = colors[state] || '';
  btn.title = titles[state] || '';
}

function setDisplay(el, show) {
  if (el) el.style.display = show ? 'inline-flex' : 'none';
}

/**
 * Determines the PR status CSS class based on policy evaluations and reviewer votes.
 */
function computePrStatusClass(reviewers, evaluations, unresolvedCount) {
  const reviewerRejected = (reviewers || []).some(r => r.vote <= -10);

  if (evaluations.length > 0 || reviewerRejected) {
    const nonCommentEvals = evaluations.filter(e => e.configuration?.type?.displayName !== 'Comment requirements');
    const failedEvals = nonCommentEvals.filter(e => e.status === 'rejected' || e.status === 'broken');
    const hasFailed = reviewerRejected || failedEvals.length > 0;
    if (hasFailed) {
      const onlyWorkItemLinkingFailed = !reviewerRejected && failedEvals.every(e => e.configuration?.type?.displayName === 'Work item linking');
      if (onlyWorkItemLinkingFailed) return 'has-pr-no-work-item';
      return 'has-pr-failed';
    }

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
  const ws = getWtState(tabEl._wtPath);
  const openPrBtn = tabEl.querySelector('.workspace-tab-open-pr');
  const completePrBtn = tabEl.querySelector('.workspace-tab-complete-pr');
  let actionShown = false;

  if (statusClass === 'has-pr-approved') {
    ws.canCompletePr = true;
    if (!ws.hasUncommittedChanges) {
      if (completePrBtn) completePrBtn.style.display = 'inline-flex';
      if (openPrBtn) openPrBtn.style.display = 'inline-flex';
      actionShown = true;
    } else {
      if (completePrBtn) completePrBtn.style.display = 'none';
      if (openPrBtn) openPrBtn.style.display = 'none';
    }
  } else {
    ws.canCompletePr = false;
    if (completePrBtn) completePrBtn.style.display = 'none';
    if (!ws.hasUncommittedChanges && ws.hasPushedCommits) {
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
  const ws = getWtState(tabEl._wtPath);
  if (ws?.hasUncommittedChanges) return;
  if (tabEl._workspaceId) return;
  const switchBtn = tabEl.querySelector('.workspace-tab-switch');
  if (!switchBtn) return;
  if (tabEl._wtTaskId && !ws?.taskResolved) {
    ws.switchMode = 'open-task';
  } else {
    ws.switchMode = 'switch';
  }
  switchBtn.style.display = '';
}

/**
 * Updates the action button's icon, color and title.
 * The action button is the single always-visible left button on each tab.
 */
function setActionState(tabEl, icon, color, title) {
  const actionBtn = tabEl.querySelector('.workspace-tab-action');
  if (!actionBtn) return;
  actionBtn.innerHTML = icon;
  actionBtn.style.color = color ?? '';
  actionBtn.title = title ?? '';
}

function resetActionState(tabEl) {
  setActionState(tabEl, DOT_SWITCH_SVG, '', '');
}

async function findSetupsArtifactBuild(allBuilds, org, project, auth) {
  const results = await Promise.all(
    allBuilds.map(b => fetchBuildArtifacts(org, project, auth, b.id, b.definitionId))
  );
  return allBuilds.find((_, i) => results[i].some(a => a.name === 'Setups')) ?? null;
}

/**
 * Applies pipeline-phase button state after the build status is known.
 * Handles taskResolved / pipelineInstalled / artifact-install / fallback uniformly
 * across succeeded, failed, and running build states.
 */
async function applyPostPipelineButtons(tabEl, { pipelineStatus, build, org, project, auth }) {
  const ws = getWtState(tabEl._wtPath);
  const pipelineBtn = tabEl.querySelector('.workspace-tab-open-pipeline');
  const installBtn = tabEl.querySelector('.workspace-tab-install-btn');
  const resolveTaskBtn = tabEl.querySelector('.workspace-tab-resolve-task');
  const switchBtn = tabEl.querySelector('.workspace-tab-switch');
  console.log('[applyPostPipelineButtons]', tabEl._wtPath, { taskResolved: ws.taskResolved, pipelineInstalled: ws.pipelineInstalled, pipelineStatus, canResolveTask: ws.canResolveTask });

  if (ws.taskResolved) {
    setDisplay(resolveTaskBtn, false);
    setDisplay(pipelineBtn, false);
    setDisplay(installBtn, false);
    resetActionState(tabEl);
    showFallbackSwitch(tabEl);
    return;
  }

  if (ws.pipelineInstalled) {
    setDisplay(pipelineBtn, false);
    setDisplay(installBtn, false);
    ws.canResolveTask = true;
    if (pipelineStatus === 'failed') {
      setActionState(tabEl, DOT_RESOLVE_TASK_SVG, 'var(--red)', 'Complete Azure Task (pipeline failed)');
    } else if (pipelineStatus === 'running') {
      setActionState(tabEl, DOT_COMPLETE_TASK_RUNNING_SVG, 'var(--yellow)', 'Complete Task (pipeline running)');
    } else {
      setActionState(tabEl, DOT_RESOLVE_TASK_SVG, 'var(--green)', 'Complete Azure Task');
    }
    if (resolveTaskBtn && tabEl._wtTaskId) {
      resolveTaskBtn.style.display = 'inline-flex';
      resolveTaskBtn.title = pipelineStatus === 'running' ? 'Complete Task' : 'Complete Azure Task';
    }
    setDisplay(switchBtn, false);
    return;
  }

  // Not installed — check for Setups artifact
  setDisplay(resolveTaskBtn, false);
  const ab = await findSetupsArtifactBuild(build.allBuilds, org, project, auth);
  if (ab) {
    ws.pipelineBuildId = ab.id;
    ws.pipelineDefinitionId = ab.definitionId;
    const installColor = { succeeded: 'var(--green)', failed: 'var(--red)', running: 'var(--yellow)' }[pipelineStatus];
    setActionState(tabEl, INSTALL_BTN_SVG, installColor, `Download build ${ab.buildNumber}`);
    setDisplay(pipelineBtn, false);
    if (installBtn) installBtn.style.display = 'inline-flex';
    setDisplay(switchBtn, false);
  } else if (pipelineStatus === 'succeeded') {
    // Pipeline succeeded but no artifact — skip install step
    resetActionState(tabEl);
    ws.canResolveTask = true;
    if (resolveTaskBtn && tabEl._wtTaskId) { resolveTaskBtn.style.display = 'inline-flex'; resolveTaskBtn.title = 'Complete Azure Task'; }
    setDisplay(switchBtn, false);
  } else {
    // Pipeline failed or running — show pipeline button so user can review
    if (pipelineBtn) pipelineBtn.style.display = 'inline-flex';
    setDisplay(installBtn, false);
    resetActionState(tabEl);
    setDisplay(switchBtn, false);
  }
}

export async function updatePipelineForTab(tabEl, { org, project, auth }) {
  const ws = getWtState(tabEl._wtPath);
  if (!ws) return;
  const targetBranch = ws.pipelineTargetBranch;
  if (!targetBranch) return;

  const build = await fetchLatestBuild(org, project, auth, targetBranch, ws.pipelineMergeTime);
  const pipelineBtn = tabEl.querySelector('.workspace-tab-open-pipeline');
  const installBtn = tabEl.querySelector('.workspace-tab-install-btn');
  const resolveTaskBtn = tabEl.querySelector('.workspace-tab-resolve-task');
  const switchBtn = tabEl.querySelector('.workspace-tab-switch');

  if (pipelineBtn) pipelineBtn.classList.remove(...PIPELINE_STATUS_CLASSES);

  if (!build) {
    ws.pipelineStatus = null;
    ws.pipelineUrl = null;
    setDisplay(installBtn, false);
    setDisplay(resolveTaskBtn, false);
    resetActionState(tabEl);
    if (ws.taskResolved) {
      showFallbackSwitch(tabEl);
    } else {
      if (pipelineBtn) { pipelineBtn.style.display = 'inline-flex'; pipelineBtn.title = 'Waiting for pipeline\u2026'; }
      setDisplay(switchBtn, false);
    }
    return;
  }

  ws.pipelineBuildId = build.id;
  ws.pipelineBuildNumber = build.buildNumber;
  ws.pipelineUrl = build.webUrl;
  if (build.definitionId) ws.pipelineDefinitionId = build.definitionId;

  const isSucceeded = build.status === 'completed' && (build.result === 'succeeded' || build.result === 'partiallySucceeded');
  const isFailed = build.status === 'completed' && !isSucceeded;

  if (isSucceeded) {
    ws.pipelineStatus = 'succeeded';
    setDisplay(pipelineBtn, false);
    setDisplay(installBtn, false);
  } else if (isFailed) {
    ws.pipelineStatus = 'failed';
    if (pipelineBtn) {
      pipelineBtn.classList.add('pipeline-failed');
      pipelineBtn.title = `Pipeline ${build.buildNumber} failed`;
    }
  } else {
    ws.pipelineStatus = 'running';
    if (pipelineBtn) {
      pipelineBtn.classList.add('pipeline-running');
      pipelineBtn.title = `Pipeline ${build.buildNumber} running\u2026`;
    }
  }

  await applyPostPipelineButtons(tabEl, { pipelineStatus: ws.pipelineStatus, build, org, project, auth });
}

async function _refreshTabStatusInner(tabEl) {
  const groupEl = tabEl.closest('.repo-group');
  if (!groupEl) return;
  const barePath = groupEl._barePath;
  const branch = tabEl._wtBranch;
  if (!barePath || !branch) return;

  const ws = getWtState(tabEl._wtPath);
  if (!ws) return;

  // Check sync status and pushed commits in parallel
  const commitPushBtn = tabEl.querySelector('.workspace-tab-commit-push');
  const switchBtn = tabEl.querySelector('.workspace-tab-switch');
  const isOpen = tabEl._workspaceId !== null;
  const sourceBranch = tabEl._wtSourceBranch || 'master';
  const [syncSettled, pcSettled] = await Promise.allSettled([
    window.reposAPI.getSyncStatus(tabEl._wtPath, branch, sourceBranch),
    window.reposAPI.hasPushedCommits(tabEl._wtPath, branch, sourceBranch)
  ]);
  if (syncSettled.status === 'fulfilled' && !syncSettled.value.error) {
    ws.hasUncommittedChanges = syncSettled.value.uncommitted;
    ws.syncState = computeSyncState(syncSettled.value);
    updateSyncButton(commitPushBtn, ws.syncState);
  } else {
    if (syncSettled.status === 'fulfilled' && syncSettled.value.error) {
      console.warn('[refreshTabStatus] getSyncStatus error:', syncSettled.value.message);
    }
    ws.hasUncommittedChanges = false;
    ws.syncState = 'clean';
    if (commitPushBtn) commitPushBtn.style.display = 'none';
  }
  if (pcSettled.status === 'fulfilled') {
    ws.hasPushedCommits = pcSettled.value.value;
    if (pcSettled.value.error) console.warn('[refreshTabStatus] hasPushedCommits error:', pcSettled.value.message);
  } else { ws.hasPushedCommits = false; }
  const syncShowing = ws.syncState && ws.syncState !== 'clean';
  if (syncShowing || isOpen) {
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
    ws.taskUrl = `https://dev.azure.com/${encodeURIComponent(parsed.org)}/${encodeURIComponent(parsed.project)}/_workitems/edit/${tabEl._wtTaskId}`;
  }

  const pat = await window.credentialsAPI.get('azure-pat');
  if (!pat) { showFallbackSwitch(tabEl); return; }

  const auth = btoa(':' + pat);
  const { org, project } = parsed;

  const activePrs = await fetchActivePrsForBranch(org, project, auth, branch);
  if (activePrs === null) { showFallbackSwitch(tabEl); return; }

  const createPrBtn = tabEl.querySelector('.workspace-tab-create-pr');
  const openPrBtn = tabEl.querySelector('.workspace-tab-open-pr');
  const completePrBtn = tabEl.querySelector('.workspace-tab-complete-pr');
  const resolveTaskBtn = tabEl.querySelector('.workspace-tab-resolve-task');

  // Reset PR-related buttons
  ws.existingPrUrl = null;
  if (openPrBtn) { openPrBtn.style.display = 'none'; openPrBtn.classList.remove(...PR_STATUS_CLASSES); }
  if (completePrBtn) completePrBtn.style.display = 'none';

  console.log('[refreshTabStatus]', tabEl._wtPath, { activePrs: activePrs.length, canResolveTask: ws.canResolveTask, canOpenPipeline: ws.canOpenPipeline, taskResolved: ws.taskResolved, pipelineInstalled: ws.pipelineInstalled });

  if (activePrs.length === 0) {
    // No active PR — check for completed PR (resolve task / pipeline flow)
    if (!ws.canResolveTask) {
      // If already in pipeline monitoring mode, just refresh the pipeline status
      if (ws.canOpenPipeline) {
        if (commitPushBtn) commitPushBtn.style.display = 'none';
        if (!ws.hasUncommittedChanges) {
          await updatePipelineForTab(tabEl, { org, project, auth });
        } else {
          const pipelineBtn = tabEl.querySelector('.workspace-tab-open-pipeline');
          const installBtn = tabEl.querySelector('.workspace-tab-install-btn');
          if (pipelineBtn) pipelineBtn.style.display = 'none';
          if (installBtn) installBtn.style.display = 'none';
          resetActionState(tabEl);
        }
        return;
      }
      try {
        const cPr = await fetchLatestCompletedPrForBranch(org, project, auth, branch);
        console.log('[refreshTabStatus] completedPr:', cPr ? `#${cPr.pullRequestId}` : 'none');
        if (cPr) {
          const mergedPrUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(cPr.repository.name)}/pullrequest/${cPr.pullRequestId}`;
          ws.mergedPrUrl = mergedPrUrl;
          let taskIsDone = !tabEl._wtTaskId;
          if (tabEl._wtTaskId) {
            const taskCtx = { org, project, auth, apiBase: `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis` };
            const wi = await fetchWorkItemById(taskCtx, tabEl._wtTaskId);
            console.log('[refreshTabStatus] workItem:', wi ? `state=${wi.state}` : 'null');
            taskIsDone = !!(wi && ['Resolved', 'Closed', 'Done', 'Removed'].includes(wi.state));
          }
          console.log('[refreshTabStatus] taskIsDone:', taskIsDone);
          if (taskIsDone) {
            ws.taskResolved = true;
            ws.canResolveTask = false;
            saveTaskResolved(tabEl._wtPath, true);
            if (completePrBtn) completePrBtn.style.display = 'none';
            if (resolveTaskBtn) resolveTaskBtn.style.display = 'none';
            if (createPrBtn) createPrBtn.style.display = 'none';
            if (commitPushBtn) commitPushBtn.style.display = 'none';
            pipeline.startMonitoring(tabEl, cPr.targetRefName, cPr.closedDate || null);
            await updatePipelineForTab(tabEl, { org, project, auth });
            return;
          }
          ws.prData = { id: cPr.pullRequestId, repoId: cPr.repository.id, lastCommitId: cPr.lastMergeSourceCommit?.commitId, org, project, auth, targetRefName: cPr.targetRefName, title: cPr.title };
          ws.canCompletePr = false;
          if (createPrBtn) createPrBtn.style.display = 'none';
          if (completePrBtn) completePrBtn.style.display = 'none';
          if (commitPushBtn) commitPushBtn.style.display = 'none';
          if (ws.hasUncommittedChanges) {
            if (resolveTaskBtn) resolveTaskBtn.style.display = 'none';
          } else {
            pipeline.startMonitoring(tabEl, cPr.targetRefName, cPr.closedDate || null);
            await updatePipelineForTab(tabEl, { org, project, auth });
          }
          return;
        }
      } catch (err) { console.warn('[refreshTabStatus] completed PR check error:', err); }
    }
    // No active PR, no completed PR — check if task was resolved directly in Azure DevOps
    if (tabEl._wtTaskId && !ws.taskResolved && !ws.canOpenPipeline) {
      try {
        const taskCtx = { org, project, auth, apiBase: `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis` };
        const wi = await fetchWorkItemById(taskCtx, tabEl._wtTaskId);
        if (wi && ['Resolved', 'Closed', 'Done', 'Removed'].includes(wi.state)) {
          ws.taskResolved = true;
          saveTaskResolved(tabEl._wtPath, true);
        }
      } catch {}
    }
    // Show Create PR only if pushed commits exist and no uncommitted changes
    const canShowCreatePr = !ws.hasUncommittedChanges && ws.hasPushedCommits;
    if (!ws.canResolveTask) {
      if (completePrBtn) completePrBtn.style.display = 'none';
      if (resolveTaskBtn) resolveTaskBtn.style.display = 'none';
      ws.canCompletePr = false;
      if (createPrBtn) {
        createPrBtn.style.display = canShowCreatePr ? '' : 'none';
        if (canShowCreatePr && switchBtn) switchBtn.style.display = 'none';
      }
      if (!canShowCreatePr) showFallbackSwitch(tabEl);
    }
    return;
  }

  // Active PR found
  const pr = activePrs[0];
  const prUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.pullRequestId}`;
  ws.existingPrUrl = prUrl;
  ws.prData = { id: pr.pullRequestId, repoId: pr.repository.id, lastCommitId: pr.lastMergeSourceCommit?.commitId, org, project, auth, targetRefName: pr.targetRefName, title: pr.title };

  // Hide create-pr since there's already an active PR
  if (createPrBtn) createPrBtn.style.display = 'none';
  if (resolveTaskBtn) resolveTaskBtn.style.display = 'none';
  ws.canResolveTask = false;

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

  // Active PR is being shown — clear any stale pipeline/install buttons and reset action icon
  const pipelineBtnActive = tabEl.querySelector('.workspace-tab-open-pipeline');
  const installBtnActive = tabEl.querySelector('.workspace-tab-install-btn');
  if (pipelineBtnActive) { pipelineBtnActive.style.display = 'none'; pipelineBtnActive.classList.remove(...PIPELINE_STATUS_CLASSES); }
  if (installBtnActive) installBtnActive.style.display = 'none';
  resetActionState(tabEl);
}

export async function refreshTabStatus(tabEl) {
  const ws = getWtState(tabEl._wtPath);
  if (!ws) return;
  if (ws.refreshInFlight) { ws.refreshPending = true; return; }
  ws.refreshInFlight = true;
  try {
    await _refreshTabStatusInner(tabEl);
  } finally {
    ws.refreshInFlight = false;
    updateDotState(tabEl);
    syncTitlebarToTab();
    if (ws.refreshPending) {
      ws.refreshPending = false;
      refreshTabStatus(tabEl);
    }
  }
}
