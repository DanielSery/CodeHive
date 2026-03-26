import { closeWorkspace } from '../workspace-manager.js';
import { rebuildCollapsedDots, collapsedDotsEl } from './collapsed-dots.js';
import { showProjectContextMenu } from './context-menu.js';
import { createWorktreeTab, checkExistingPr } from './worktree-tab.js';
import { _showWorktreeDialog, _showDeleteDialog, _onStateChange } from './registers.js';

const repoGroupsEl = document.getElementById('repo-groups');

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
    <button class="repo-group-add" title="Add Worktree (Ctrl+Alt+N)">+</button>
    <button class="repo-group-delete" title="Delete Project"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12M5.3 4V2.7a1 1 0 011-1h3.4a1 1 0 011 1V4M6.5 7.3v4.4M9.5 7.3v4.4"/><path d="M3.5 4l.7 9.3a1 1 0 001 .9h5.6a1 1 0 001-.9L12.5 4"/></svg></button>
  `;

  const tabsEl = document.createElement('div');
  tabsEl.className = 'repo-group-tabs';

  let collapsed = false;

  headerEl.querySelector('.repo-group-add').addEventListener('click', (e) => {
    e.stopPropagation();
    if (_showWorktreeDialog) _showWorktreeDialog(groupEl, tabsEl);
  });

  headerEl.querySelector('.repo-group-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    if (_showDeleteDialog) _showDeleteDialog(groupEl);
  });

  headerEl.addEventListener('click', (e) => {
    if (e.target.closest('.repo-group-add') || e.target.closest('.repo-group-delete')) return;
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
    checkExistingPr(tab);
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
