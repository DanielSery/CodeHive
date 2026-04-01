import {
  PR_STATUS_CLASSES,
  DOT_COMMIT_PUSH_SVG, DOT_CREATE_PR_SVG, DOT_OPEN_PR_SVG, DOT_COMPLETE_PR_SVG,
  DOT_RESOLVE_TASK_SVG, DOT_OPEN_TASK_SVG, DOT_SWITCH_SVG, DOT_DONE_SWITCH_SVG,
  DOT_PIPELINE_SVG, DOT_COMPLETE_TASK_RUNNING_SVG, DOT_TASK_DONE_RUNNING_SVG, INSTALL_BTN_SVG,
} from './worktree-tab-icons.js';

export function formatBranchLabel(branch) {
  let name = branch.includes('/') ? branch.substring(branch.indexOf('/') + 1) : branch;
  name = name.replace(/^\d+-/, '');
  return name.replace(/-/g, ' ');
}

export function extractTaskIdFromBranch(branch) {
  const afterSlash = branch.includes('/') ? branch.substring(branch.indexOf('/') + 1) : branch;
  const m = afterSlash.match(/^(\d+)-/);
  return m ? m[1] : null;
}

export function hasPrStatusClass(btn) {
  return PR_STATUS_CLASSES.some(cls => btn.classList.contains(cls));
}

export function isButtonVisible(btn) {
  return btn && btn.style.display !== 'none';
}

/**
 * Computes the collapsed-dot icon and color from the tab's current button state.
 */
export function getTabDotState(tabEl) {
  const commitPushBtn = tabEl.querySelector('.workspace-tab-commit-push');
  const completePrBtn = tabEl.querySelector('.workspace-tab-complete-pr');
  const pipelineBtn = tabEl.querySelector('.workspace-tab-open-pipeline');
  const installBtn = tabEl.querySelector('.workspace-tab-install-btn');
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
    let pipelineColor = 'var(--accent)';
    if (pipelineBtn.classList.contains('pipeline-running')) pipelineColor = 'var(--yellow)';
    else if (pipelineBtn.classList.contains('pipeline-failed')) pipelineColor = 'var(--red)';
    return { icon: DOT_PIPELINE_SVG, color: pipelineColor };
  }
  if (isButtonVisible(installBtn)) {
    let color = 'var(--green)';
    if (tabEl._pipelineStatus === 'running') color = 'var(--accent)';
    else if (tabEl._pipelineStatus === 'failed') color = 'var(--red)';
    return { icon: INSTALL_BTN_SVG, color };
  }
  if (isButtonVisible(resolveTaskBtn)) {
    let color = 'var(--green)';
    if (tabEl._pipelineStatus === 'running') color = 'var(--accent)';
    else if (tabEl._pipelineStatus === 'failed') color = 'var(--red)';
    return { icon: DOT_RESOLVE_TASK_SVG, color };
  }
  if (isButtonVisible(openPrBtn)) {
    let color = 'var(--yellow)';
    if (openPrBtn.classList.contains('has-pr-approved')) color = 'var(--green)';
    else if (openPrBtn.classList.contains('has-pr-succeeded')) color = 'var(--green)';
    else if (openPrBtn.classList.contains('has-pr-failed')) color = 'var(--red)';
    else if (openPrBtn.classList.contains('has-pr-comments')) color = 'var(--peach)';
    return { icon: DOT_OPEN_PR_SVG, color };
  }
  if (isButtonVisible(createPrBtn)) {
    return { icon: DOT_CREATE_PR_SVG, color: 'var(--green)' };
  }
  if (isButtonVisible(switchBtn)) {
    if (tabEl._switchMode === 'open-task') return { icon: DOT_OPEN_TASK_SVG, color: 'var(--text-muted)' };
    if (tabEl._taskResolved) {
      let color = 'var(--text-muted)';
      if (tabEl._pipelineStatus === 'running') color = 'var(--yellow)';
      else if (tabEl._pipelineStatus === 'failed') color = 'var(--red)';
      return { icon: DOT_DONE_SWITCH_SVG, color };
    }
    return { icon: DOT_SWITCH_SVG, color: 'var(--text-muted)' };
  }
  if (tabEl._taskResolved) {
    let color = 'var(--text-muted)';
    if (tabEl._pipelineStatus === 'failed') color = 'var(--red)';
    return { icon: DOT_DONE_SWITCH_SVG, color };
  }
  return { icon: DOT_SWITCH_SVG, color: 'var(--text-muted)' };
}

export function getTabActionTitle(tabEl) {
  const commitPushBtn = tabEl.querySelector('.workspace-tab-commit-push');
  const completePrBtn = tabEl.querySelector('.workspace-tab-complete-pr');
  const pipelineBtn = tabEl.querySelector('.workspace-tab-open-pipeline');
  const installBtn = tabEl.querySelector('.workspace-tab-install-btn');
  const resolveTaskBtn = tabEl.querySelector('.workspace-tab-resolve-task');
  const openPrBtn = tabEl.querySelector('.workspace-tab-open-pr');
  const createPrBtn = tabEl.querySelector('.workspace-tab-create-pr');
  const switchBtn = tabEl.querySelector('.workspace-tab-switch');

  if (isButtonVisible(commitPushBtn)) return 'Commit & Push';
  if (isButtonVisible(completePrBtn)) return 'Complete Pull Request';
  if (isButtonVisible(pipelineBtn)) {
    const num = tabEl._pipelineBuildNumber ? ` ${tabEl._pipelineBuildNumber}` : '';
    if (tabEl._pipelineStatus === 'running') return `Pipeline${num} running\u2026`;
    if (tabEl._pipelineStatus === 'failed') return `Pipeline${num} failed`;
    return `Open Pipeline${num}`;
  }
  if (isButtonVisible(installBtn)) {
    const num = tabEl._pipelineBuildNumber ? ` ${tabEl._pipelineBuildNumber}` : '';
    if (tabEl._pipelineStatus === 'running') return `Pipeline${num} running \u2014 Download build`;
    if (tabEl._pipelineStatus === 'failed') return `Pipeline${num} failed \u2014 Download build`;
    return `Download build${num}`;
  }
  if (isButtonVisible(resolveTaskBtn)) {
    const num = tabEl._pipelineBuildNumber ? ` ${tabEl._pipelineBuildNumber}` : '';
    if (tabEl._pipelineStatus === 'running') return `Pipeline${num} running \u2014 Complete Task`;
    if (tabEl._pipelineStatus === 'failed') return `Pipeline${num} failed \u2014 Complete Task`;
    return 'Complete Azure Task';
  }
  if (isButtonVisible(openPrBtn)) return 'View Pull Request';
  if (isButtonVisible(createPrBtn)) return 'Create Pull Request';
  if (isButtonVisible(switchBtn)) {
    if (tabEl._switchMode === 'open-task') return 'Open Task';
    if (tabEl._taskResolved) {
      if (tabEl._pipelineStatus === 'running') {
        const num = tabEl._pipelineBuildNumber ? ` ${tabEl._pipelineBuildNumber}` : '';
        return `Pipeline${num} running \u2014 Task done`;
      }
      return 'Task Complete \u2014 Switch Worktree';
    }
    return 'Switch Worktree';
  }
  if (tabEl._taskResolved) return 'Task Complete \u2014 Switch Worktree';
  return 'Switch Worktree';
}

export function updateDotState(tabEl) {
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
