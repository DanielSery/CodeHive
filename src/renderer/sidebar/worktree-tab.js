import { setTabStatus } from '../claude-poll.js';
import { openWorktree, closeWorkspace } from '../workspace-manager.js';
import { getSourceBranch, getTaskId } from '../storage.js';
import { rebuildCollapsedDots, collapsedDotsEl } from './collapsed-dots.js';
import { showContextMenu } from './context-menu.js';
import { _showWorktreeSwitchDialog, _showWorktreeRemoveDialog, _showCommitPushDialog, _showCreatePrDialog, _onStateChange } from './registers.js';
import { completePullRequest } from '../azure-api.js';
import { showResolveTaskDialog } from '../dialogs/dialog-resolve.js';
import { showInstallDialog } from '../dialogs/dialog-verify.js';
import { showCompletePrDialog } from '../dialogs/dialog-complete-pr.js';
import { BIN_ICON_SVG, DOT_SWITCH_SVG, INSTALL_BTN_SVG } from './worktree-tab-icons.js';
import { formatBranchLabel, extractTaskIdFromBranch, hasPrStatusClass } from './worktree-tab-dot-state.js';
import { refreshTabStatus, showFallbackSwitch } from './worktree-tab-status.js';

export { refreshTabStatus } from './worktree-tab-status.js';

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
  if (installBtn) installBtn.style.display = 'none';
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
    <button class="workspace-tab-resolve-task" style="display:none"></button>
    <button class="workspace-tab-open-pr" style="display:none"></button>
    <button class="workspace-tab-create-pr" style="display:none"></button>
    <button class="workspace-tab-switch"></button>
    <span class="workspace-tab-label">${formatBranchLabel(wt.branch)}</span>
    <button class="workspace-tab-close" title="Close (Alt+W)" style="display:none">&times;</button>
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
  tabEl._mergedPrUrl = null;
  tabEl._canCompletePr = false;
  tabEl._canResolveTask = false;
  tabEl._canOpenPipeline = false;
  tabEl._pipelineTargetBranch = null;
  tabEl._pipelineMergeTime = null;
  tabEl._pipelineBuildId = null;
  tabEl._pipelineBuildNumber = null;
  tabEl._pipelineStatus = null;
  tabEl._pipelineUrl = null;
  tabEl._pipelineInstalled = false;
  tabEl._refreshInFlight = false;
  tabEl._refreshPending = false;

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
      '.workspace-tab-resolve-task',
      '.workspace-tab-open-pipeline',
      '.workspace-tab-install-btn',
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
      '.workspace-tab-resolve-task',
      '.workspace-tab-open-pipeline',
      '.workspace-tab-install-btn',
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
    const result = await completePullRequest(d.org, d.project, d.auth, d.repoId, d.id, d.lastCommitId);
    btn.disabled = false;
    if (result) {
      btn.style.display = 'none';
      tabEl._canCompletePr = false;
      if (tabEl._wtTaskId) {
        tabEl._canOpenPipeline = true;
        tabEl._pipelineTargetBranch = d.targetRefName;
        tabEl._pipelineMergeTime = result.closedDate || new Date().toISOString();
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
    const result = await showInstallDialog(d.org, d.project, d.auth, tabEl._pipelineBuildId, tabEl._pipelineBuildNumber, tabEl._pipelineStatus === 'succeeded', tabEl._pipelineDefinitionId);
    if (result === 'installed' || result === 'skipped') {
      tabEl._pipelineInstalled = true;
    }
    refreshTabStatus(tabEl);
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

// Periodic refresh: open workspaces, tabs with active PRs, or pipeline monitoring
setInterval(() => {
  for (const tab of document.querySelectorAll('.workspace-tab')) {
    const isOpen = tab._workspaceId !== null;
    const openPrBtn = tab.querySelector('.workspace-tab-open-pr');
    const hasPrStatus = openPrBtn && hasPrStatusClass(openPrBtn);
    const watchingPipeline = tab._canOpenPipeline && tab._pipelineStatus !== 'succeeded' && tab._pipelineStatus !== 'failed';
    if (isOpen || hasPrStatus || watchingPipeline) {
      refreshTabStatus(tab);
    }
  }
}, 30 * 1000);
