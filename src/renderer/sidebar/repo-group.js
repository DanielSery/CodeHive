import { closeWorkspace } from '../workspace-manager.js';
import { rebuildCollapsedDots, collapsedDotsEl, createCollapsedAddBtn } from './collapsed-dots.js';
import { showProjectContextMenu } from './context-menu.js';
import { createWorktreeTab, refreshTabStatus } from './worktree-tab.js';
import { _showWorktreeDialog, _showDeleteDialog, _onStateChange } from './registers.js';
import { getTaskPlaceholdersEnabled, getNewTasksCache, saveNewTasksCache } from '../storage.js';
import { fetchNewAzureTasks } from '../azure-api.js';
import { loadStoredPat } from '../dialogs/utils.js';
import { DOT_OPEN_TASK_SVG, WORK_ITEM_TYPE_ICON_SVGS } from './worktree-tab-icons.js';

const repoGroupsEl = document.getElementById('repo-groups');

function createPlaceholderButton(groupEl, tabsEl, task) {
  const btn = document.createElement('button');
  btn.className = 'repo-group-tabs-add repo-group-tabs-placeholder';
  btn.setAttribute('draggable', 'false');
  btn.title = `#${task.id} ${task.title}`;
  const taskIcon = WORK_ITEM_TYPE_ICON_SVGS[task.type] || DOT_OPEN_TASK_SVG;
  btn.innerHTML = `<span class="repo-group-tabs-add-icon">${taskIcon}</span><span class="repo-group-tabs-add-label">${task.title}</span>`;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_showWorktreeDialog) _showWorktreeDialog(groupEl, tabsEl, task);
  });
  return btn;
}

function applyPlaceholderTasks(groupEl, tabsEl, tasks) {
  tabsEl.querySelectorAll('.repo-group-tabs-placeholder').forEach(el => el.remove());
  if (!tasks || tasks.length === 0) return;
  const addBtn = tabsEl.querySelector('.repo-group-tabs-add:not(.repo-group-tabs-placeholder)');
  for (const task of tasks) {
    tabsEl.insertBefore(createPlaceholderButton(groupEl, tabsEl, task), addBtn);
  }
}

async function refreshTaskPlaceholders(groupEl, tabsEl) {
  if (!getTaskPlaceholdersEnabled()) { tabsEl.querySelectorAll('.repo-group-tabs-placeholder').forEach(el => el.remove()); return; }

  const cached = getNewTasksCache(groupEl._barePath);
  if (cached) applyPlaceholderTasks(groupEl, tabsEl, cached);

  const pat = await loadStoredPat();
  const result = await fetchNewAzureTasks(groupEl._barePath, pat);
  if (result.error) return;
  saveNewTasksCache(groupEl._barePath, result.tasks || []);
  applyPlaceholderTasks(groupEl, tabsEl, result.tasks);
}

export async function refreshAllPlaceholders() {
  const groups = repoGroupsEl.querySelectorAll('.repo-group');
  for (const groupEl of groups) {
    const tabsEl = groupEl.querySelector('.repo-group-tabs');
    if (tabsEl) await refreshTaskPlaceholders(groupEl, tabsEl);
  }
}

export function clearAllPlaceholders() {
  repoGroupsEl.querySelectorAll('.repo-group-tabs-placeholder').forEach(el => el.remove());
}

export function addRepoGroup(repo) {
  if (repoGroupsEl.querySelector(`[data-repo-name="${CSS.escape(repo.name)}"]`)) return;

  const groupEl = document.createElement('div');
  groupEl.className = 'repo-group';
  groupEl.dataset.repoName = repo.name;

  groupEl._barePath = repo.barePath;
  groupEl._repoDir = repo.barePath.replace(/[\\/]Bare$/, '');

  const headerEl = document.createElement('div');
  headerEl.className = 'repo-group-header';
  headerEl.innerHTML = `
    <span class="repo-group-chevron">&#x25B6;</span>
    <span class="repo-group-name">${repo.name}</span>
  `;

  const tabsEl = document.createElement('div');
  tabsEl.className = 'repo-group-tabs';

  let collapsed = false;

  headerEl.addEventListener('click', () => {
    collapsed = !collapsed;
    tabsEl.classList.toggle('expanded', !collapsed);
    headerEl.querySelector('.repo-group-chevron').innerHTML = collapsed ? '&#x25B6;' : '&#x25BC;';
  });

  headerEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showProjectContextMenu(e.clientX, e.clientY, groupEl, tabsEl);
  });

  if (collapsedDotsEl.children.length > 0) {
    const sep = document.createElement('hr');
    sep.className = 'collapsed-dots-separator';
    collapsedDotsEl.appendChild(sep);
  }

  repo.worktrees.forEach((wt) => {
    const tabEl = createWorktreeTab(wt);
    tabsEl.appendChild(tabEl);
  });

  // Inline add-worktree button at bottom of tabs list
  const addBtn = document.createElement('button');
  addBtn.className = 'repo-group-tabs-add';
  addBtn.title = 'Add Worktree (Alt+N)';
  addBtn.innerHTML = `<span class="repo-group-tabs-add-icon"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg></span><span class="repo-group-tabs-add-label">Add worktree</span>`;
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_showWorktreeDialog) _showWorktreeDialog(groupEl, tabsEl);
  });
  // Prevent the add button from being dragged and ensure tabs dropped near it stay above it
  addBtn.setAttribute('draggable', 'false');
  addBtn.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const dragging = tabsEl.querySelector('.workspace-tab.dragging');
    if (dragging) tabsEl.insertBefore(dragging, addBtn);
  });
  tabsEl.appendChild(addBtn);

  if (getTaskPlaceholdersEnabled()) refreshTaskPlaceholders(groupEl, tabsEl);

  // Collapsed-view add-worktree button (after all dots for this group)
  collapsedDotsEl.appendChild(createCollapsedAddBtn(groupEl));

  groupEl.setAttribute('draggable', 'true');

  groupEl.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    groupEl.classList.add('dragging');
    setTimeout(() => groupEl.classList.add('drag-ghost'), 0);
  });

  groupEl.addEventListener('dragend', () => {
    groupEl.classList.remove('dragging', 'drag-ghost');
    document.querySelectorAll('.repo-group.drag-over').forEach(el => el.classList.remove('drag-over'));
    rebuildCollapsedDots();
    if (_onStateChange) _onStateChange();
  });

  groupEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const dragging = repoGroupsEl.querySelector('.repo-group.dragging');
    if (!dragging || dragging === groupEl) return;

    const rect = groupEl.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;

    document.querySelectorAll('.repo-group.drag-over').forEach(el => el.classList.remove('drag-over'));
    groupEl.classList.add('drag-over');

    if (e.clientY < midY) {
      repoGroupsEl.insertBefore(dragging, groupEl);
    } else {
      repoGroupsEl.insertBefore(dragging, groupEl.nextSibling);
    }
  });

  groupEl.addEventListener('dragleave', () => {
    groupEl.classList.remove('drag-over');
  });

  tabsEl.classList.add('expanded');
  headerEl.querySelector('.repo-group-chevron').innerHTML = '&#x25BC;';

  groupEl.appendChild(headerEl);
  groupEl.appendChild(tabsEl);
  repoGroupsEl.appendChild(groupEl);

  for (const tab of tabsEl.querySelectorAll('.workspace-tab')) {
    refreshTabStatus(tab);
  }
}

export function clearAllGroups() {
  const groups = repoGroupsEl.querySelectorAll('.repo-group');
  for (const groupEl of groups) {
    const tabs = groupEl.querySelectorAll('.workspace-tab');
    for (const tab of tabs) {
      if (tab._workspaceId !== null) {
        closeWorkspace(tab._workspaceId);
      }
      if (tab._dotEl) tab._dotEl.remove();
    }
    groupEl.remove();
  }
  collapsedDotsEl.innerHTML = '';
}

export function removeRepoGroup(groupEl) {
  const tabs = groupEl.querySelectorAll('.workspace-tab');
  for (const tab of tabs) {
    if (tab._workspaceId !== null) {
      closeWorkspace(tab._workspaceId);
    }
    if (tab._dotEl) tab._dotEl.remove();
  }
  groupEl.remove();
  rebuildCollapsedDots();
}

export function getRepoOrder() {
  return Array.from(repoGroupsEl.querySelectorAll('.repo-group'))
    .map(el => el.dataset.repoName);
}
