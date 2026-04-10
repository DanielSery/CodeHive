import { setTabStatus } from '../claude-poll.js';
import { openWorktree, closeWorkspace } from '../workspace-manager.js';
import { getSourceBranch, getTaskId, getPipelineInstalled, getTaskResolved, saveTaskResolved } from '../storage.js';
import { pipeline } from '../pipeline-service.js';
import { rebuildCollapsedDots, collapsedDotsEl } from './collapsed-dots.js';
import { showContextMenu } from './context-menu.js';
import { _showWorktreeSwitchDialog, _showWorktreeRemoveDialog, _showCommitPushDialog, _showCreatePrDialog, _onStateChange } from './registers.js';
import { pr } from '../pr-service.js';
import { showResolveTaskDialog } from '../dialogs/dialog-resolve.js';
import { showInstallDialog } from '../dialogs/dialog-verify.js';
import { BIN_ICON_SVG, DOT_SWITCH_SVG, INSTALL_BTN_SVG } from './worktree-tab-icons.js';
import { toast } from '../toast.js';
import { formatBranchLabel, extractTaskIdFromBranch, hasPrStatusClass } from './worktree-tab-dot-state.js';
import { refreshTabStatus, showFallbackSwitch } from './worktree-tab-status.js';
import { initWtState, getWtState } from '../worktree-state.js';

export { refreshTabStatus } from './worktree-tab-status.js';

export function setReorderDropTarget(tabsEl, insertBefore) {
  _reorderTabsEl = tabsEl;
  _reorderInsertBefore = insertBefore;
}

// Module-level state for cross-tab drag reorder
let _dragSourceTabEl = null;
let _reorderTabsEl = null;
let _reorderInsertBefore = undefined; // undefined = no pending reorder, null = append

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
  const ws = getWtState(tabEl._wtPath);
  if (ws) ws.hasUncommittedChanges = false;
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

  // Identity fields — set once, never change
  tabEl._wtPath = wt.path;
  tabEl._wtBranch = wt.branch;
  tabEl._wtSourceBranch = wt.sourceBranch || getSourceBranch(wt.path);
  tabEl._wtTaskId = wt.taskId !== undefined ? wt.taskId : (getTaskId(wt.path) || extractTaskIdFromBranch(wt.branch));
  tabEl._workspaceId = null;

  // All volatile business state lives in the state store
  const initialTaskResolved = getTaskResolved(wt.path);
  const initialPipelineInstalled = getPipelineInstalled(wt.path);
  console.log('[createWorktreeTab]', wt.path, { taskResolved: initialTaskResolved, pipelineInstalled: initialPipelineInstalled });
  initWtState(wt.path, { pipelineInstalled: initialPipelineInstalled, taskResolved: initialTaskResolved });

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
    tabEl.querySelector('.workspace-tab-switch')?.click();
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
    tabEl.querySelector('.workspace-tab-switch')?.click();
  });

  tabEl.querySelector('.workspace-tab-switch').addEventListener('click', (e) => {
    e.stopPropagation();
    const ws = getWtState(tabEl._wtPath);
    if (ws?.switchMode === 'open-task' && ws?.taskUrl) {
      window.shellAPI.openExternal(ws.taskUrl);
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
    const ws = getWtState(tabEl._wtPath);
    if (ws?.syncState === 'conflict') {
      window.shellAPI.openInGitApp(tabEl._wtPath).then(result => {
        if (!result || !result.app) toast.error('No Git app found (Fork, SourceTree, GitKraken, Git Bash)');
      });
      return;
    }
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
    pr.open(tabEl);
  });

  tabEl.querySelector('.workspace-tab-complete-pr').addEventListener('click', async (e) => {
    e.stopPropagation();
    const btn = tabEl.querySelector('.workspace-tab-complete-pr');
    btn.disabled = true;
    const result = await pr.complete(tabEl);
    btn.disabled = false;
    if (result) {
      btn.style.display = 'none';
      if (tabEl._wtTaskId) {
        const switchBtn = tabEl.querySelector('.workspace-tab-switch');
        if (switchBtn) switchBtn.style.display = 'none';
      }
      refreshTabStatus(tabEl);
    }
  });

  tabEl.querySelector('.workspace-tab-resolve-task').addEventListener('click', async (e) => {
    e.stopPropagation();
    const ws = getWtState(tabEl._wtPath);
    const d = ws?.prData;
    console.log('[resolve-task click]', tabEl._wtPath, { hasPrData: !!d, taskId: tabEl._wtTaskId, taskResolved: ws?.taskResolved, canResolveTask: ws?.canResolveTask });
    if (!d || !tabEl._wtTaskId) return;
    const ctx = { org: d.org, project: d.project, auth: d.auth, apiBase: `https://dev.azure.com/${encodeURIComponent(d.org)}/${encodeURIComponent(d.project)}/_apis` };
    const targetBranch = d.targetRefName || `refs/heads/${tabEl._wtSourceBranch || 'master'}`;
    const result = await showResolveTaskDialog(ctx, tabEl._wtTaskId, { org: d.org, project: d.project, auth: d.auth, targetBranch, mergeTime: ws.pipelineMergeTime, pipelineStatus: ws.pipelineStatus });
    if (result === 'resolved') {
      ws.taskResolved = true;
      ws.canResolveTask = false;
      saveTaskResolved(tabEl._wtPath, true);
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
    pipeline.open(tabEl);
  });

  tabEl.querySelector('.workspace-tab-install-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const ws = getWtState(tabEl._wtPath);
    const d = ws?.prData;
    if (!d || !ws?.pipelineBuildId) return;
    const result = await showInstallDialog(d.org, d.project, d.auth, ws.pipelineBuildId, ws.pipelineBuildNumber, ws.pipelineStatus === 'succeeded', ws.pipelineDefinitionId, ws.taskUrl || null);
    if (result === 'installed' || result === 'skipped') {
      pipeline.markInstalled(tabEl);
    }
    refreshTabStatus(tabEl);
  });

  tabEl.addEventListener('click', (e) => {
    if (e.target.closest('.workspace-tab-close') || e.target.closest('.workspace-tab-switch') || e.target.closest('.workspace-tab-remove') || e.target.closest('.workspace-tab-commit-push') || e.target.closest('.workspace-tab-create-pr') || e.target.closest('.workspace-tab-open-pr') || e.target.closest('.workspace-tab-complete-pr') || e.target.closest('.workspace-tab-open-pipeline') || e.target.closest('.workspace-tab-verify') || e.target.closest('.workspace-tab-resolve-task') || e.target.closest('.workspace-tab-action') || e.target.closest('.workspace-tab-install-btn')) return;
    openWorktree(tabEl, wt);
  });

  tabEl.addEventListener('dblclick', (e) => {
    if (e.target.closest('.workspace-tab-close') || e.target.closest('.workspace-tab-switch') || e.target.closest('.workspace-tab-remove')) return;
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
    _dragSourceTabEl = tabEl;
    tabEl.classList.add('dragging');
    setTimeout(() => tabEl.classList.add('drag-ghost'), 0);
  });

  tabEl.addEventListener('dragend', (e) => {
    e.stopPropagation();
    tabEl.classList.remove('dragging', 'drag-ghost');
    const tabsEl = tabEl.closest('.repo-group-tabs');
    if (tabsEl) {
      tabsEl.querySelectorAll('.workspace-tab.drag-over').forEach(el => el.classList.remove('drag-over'));
      tabsEl.querySelectorAll('.workspace-tab.drag-drop-above').forEach(el => el.classList.remove('drag-drop-above'));
      tabsEl.querySelectorAll('.workspace-tab.drag-drop-below').forEach(el => el.classList.remove('drag-drop-below'));
      // Ensure "Add worktree" button always stays last
      const addBtn = tabsEl.querySelector('.repo-group-tabs-add');
      if (addBtn) tabsEl.appendChild(addBtn);
    }

    // Apply the pending reorder on drop
    if (_reorderTabsEl && _reorderInsertBefore !== undefined && _dragSourceTabEl) {
      // When appending (null), insert before the first placeholder to keep worktrees above placeholders
      const insertTarget = _reorderInsertBefore === null
        ? (_reorderTabsEl.querySelector('.repo-group-tabs-placeholder') || null)
        : _reorderInsertBefore;
      _reorderTabsEl.insertBefore(_dragSourceTabEl, insertTarget);
      const addBtn2 = _reorderTabsEl.querySelector('.repo-group-tabs-add');
      if (addBtn2) _reorderTabsEl.appendChild(addBtn2);
    }
    _dragSourceTabEl = null;
    _reorderTabsEl = null;
    _reorderInsertBefore = undefined;
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

    const rect = tabEl.getBoundingClientRect();

    tabsEl.querySelectorAll('.workspace-tab.drag-over').forEach(el => el.classList.remove('drag-over'));

    // Reorder mode: show drop indicator without moving the DOM
    _reorderTabsEl = tabsEl;
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      _reorderInsertBefore = tabEl;
      tabEl.classList.add('drag-drop-above');
    } else {
      // insertBefore the next sibling (or null to append)
      const next = tabEl.nextSibling;
      _reorderInsertBefore = (next && next.classList && next.classList.contains('workspace-tab')) ? next : null;
      tabEl.classList.add('drag-drop-below');
    }
  });

  tabEl.addEventListener('dragleave', (e) => {
    e.stopPropagation();
    tabEl.classList.remove('drag-over', 'drag-drop-above', 'drag-drop-below');
  });

  return tabEl;
}

// Periodic refresh: open workspaces, tabs with active PRs, or pipeline monitoring
setInterval(() => {
  for (const tab of document.querySelectorAll('.workspace-tab')) {
    const isOpen = tab._workspaceId !== null;
    const openPrBtn = tab.querySelector('.workspace-tab-open-pr');
    const hasPrStatus = openPrBtn && hasPrStatusClass(openPrBtn);
    const ws = getWtState(tab._wtPath);
    const watchingPipeline = ws?.canOpenPipeline && ws?.pipelineStatus !== 'succeeded' && ws?.pipelineStatus !== 'failed';
    if (isOpen || hasPrStatus || watchingPipeline) {
      refreshTabStatus(tab);
    }
  }
}, 30 * 1000);
