import { setTabStatus } from './claude-poll.js';
import { openWorktree, closeWorkspace } from './workspace-manager.js';
import { getActive } from './state.js';

const BIN_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12M5.3 4V2.7a1 1 0 011-1h3.4a1 1 0 011 1V4M6.5 7.3v4.4M9.5 7.3v4.4"/><path d="M3.5 4l.7 9.3a1 1 0 001 .9h5.6a1 1 0 001-.9L12.5 4"/></svg>';
const SWITCH_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 1l3 3-3 3"/><path d="M14 4H5"/><path d="M5 15l-3-3 3-3"/><path d="M2 12h9"/></svg>';
const COMMIT_PUSH_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12V3"/><path d="M4 7l4-4 4 4"/><circle cx="8" cy="14" r="1.5"/></svg>';
const PR_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="4" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="4" cy="12" r="2"/><path d="M4 6v4"/><path d="M12 10V6c0-1.1-.9-2-2-2H8"/><path d="M10 2L8 4l2 2"/></svg>';
const repoGroupsEl = document.getElementById('repo-groups');
const collapsedDotsEl = document.getElementById('collapsed-dots');
const sidebar = document.getElementById('sidebar');
const resizeHandle = document.getElementById('sidebar-resize-handle');
const contextMenu = document.getElementById('wt-context-menu');
const projectContextMenu = document.getElementById('project-context-menu');

// Lazy references to avoid circular import with dialogs.js
let _showWorktreeDialog = null;
let _showDeleteDialog = null;
let _showWorktreeRemoveDialog = null;
let _showWorktreeSwitchDialog = null;
let _showCommitPushDialog = null;
let _showCreatePrDialog = null;
let _onStateChange = null;
let _getCachedBranches = null;
let _saveBranchCache = null;
let _getSourceBranch = null;
let _getTaskId = null;

function registerOnStateChange(fn) {
  _onStateChange = fn;
}

function registerSidebarBranchCache(getCached, saveCached) {
  _getCachedBranches = getCached;
  _saveBranchCache = saveCached;
}

function registerSourceBranchLookup(fn) {
  _getSourceBranch = fn;
}

function registerTaskIdLookup(fn) {
  _getTaskId = fn;
}

function registerWorktreeDialog(fn) {
  _showWorktreeDialog = fn;
}

function registerDeleteDialog(fn) {
  _showDeleteDialog = fn;
}

function registerWorktreeRemoveDialog(fn) {
  _showWorktreeRemoveDialog = fn;
}

function registerWorktreeSwitchDialog(fn) {
  _showWorktreeSwitchDialog = fn;
}

function registerCommitPushDialog(fn) {
  _showCommitPushDialog = fn;
}

function registerCreatePrDialog(fn) {
  _showCreatePrDialog = fn;
}

let _toggleTerminal = null;
function registerToggleTerminal(fn) {
  _toggleTerminal = fn;
}

function formatBranchLabel(branch) {
  let name = branch.includes('/') ? branch.substring(branch.indexOf('/') + 1) : branch;
  name = name.replace(/^\d+-/, '');
  return name.replace(/-/g, ' ');
}

// ===== Repo Groups =====

function addRepoGroup(repo) {
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

  // Drag-and-drop reordering
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
    const dragging = repoGroupsEl.querySelector('.dragging');
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

function createWorktreeTab(wt) {
  const tabEl = document.createElement('div');
  tabEl.className = 'workspace-tab';
  tabEl.title = 'Open Workspace (Ctrl+Alt+O)';
  setTabStatus(tabEl, 'idle');
  tabEl.innerHTML = `
    <span class="workspace-tab-status"></span>
    <span class="workspace-tab-label">${formatBranchLabel(wt.branch)}</span>
    <button class="workspace-tab-switch" title="Switch Worktree">${SWITCH_ICON_SVG}</button>
    <button class="workspace-tab-commit-push" title="Commit &amp; Push (Ctrl+Alt+P)" style="display:none">${COMMIT_PUSH_ICON_SVG}</button>
    <button class="workspace-tab-create-pr" title="Create Pull Request (Ctrl+Alt+M)" style="display:none">${PR_ICON_SVG}</button>
    <button class="workspace-tab-close" title="Close (Ctrl+Alt+W)" style="display:none">&times;</button>
    <button class="workspace-tab-remove" title="Remove Worktree">${BIN_ICON_SVG}</button>
  `;

  tabEl._wtPath = wt.path;
  tabEl._wtBranch = wt.branch;
  tabEl._wtSourceBranch = wt.sourceBranch || (_getSourceBranch ? _getSourceBranch(wt.path) : null);
  tabEl._wtTaskId = wt.taskId || (_getTaskId ? _getTaskId(wt.path) : null);
  tabEl._workspaceId = null;
  tabEl._pollTimer = null;
  tabEl._wasWorking = false;

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

  tabEl.addEventListener('click', (e) => {
    if (e.target.closest('.workspace-tab-close') || e.target.closest('.workspace-tab-switch') || e.target.closest('.workspace-tab-remove') || e.target.closest('.workspace-tab-commit-push') || e.target.closest('.workspace-tab-create-pr')) return;
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

  // Drag-and-drop reordering within the group
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

async function checkExistingPr(tabEl) {
  const groupEl = tabEl.closest('.repo-group');
  if (!groupEl) return;
  const barePath = groupEl._barePath;
  const branch = tabEl._wtBranch;
  if (!barePath || !branch) return;

  let remoteUrl;
  try { remoteUrl = await window.reposAPI.remoteUrl(barePath); } catch { return; }
  if (!remoteUrl) return;

  let org, project;
  const m = remoteUrl.match(/https?:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\//);
  if (m) { org = decodeURIComponent(m[1]); project = decodeURIComponent(m[2]); }
  else {
    const m2 = remoteUrl.match(/https?:\/\/(?:[^@/]+@)?([^.]+)\.visualstudio\.com\/([^/]+)\/_git\//);
    if (m2) { org = m2[1]; project = decodeURIComponent(m2[2]); }
  }
  if (!org || !project) return;

  const pat = localStorage.getItem('codehive-azure-pat');
  if (!pat) return;

  const auth = btoa(':' + pat);
  const sourceRef = `refs/heads/${branch}`;
  const apiUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/pullrequests?searchCriteria.sourceRefName=${encodeURIComponent(sourceRef)}&searchCriteria.status=active&api-version=7.0`;

  let data;
  try {
    const resp = await fetch(apiUrl, { headers: { Authorization: `Basic ${auth}` } });
    if (!resp.ok) return;
    data = await resp.json();
  } catch { return; }

  if (!data.value || data.value.length === 0) return;

  const pr = data.value[0];
  const prUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.pullRequestId}`;
  tabEl._existingPrUrl = prUrl;

  const createPrBtn = tabEl.querySelector('.workspace-tab-create-pr');
  if (!createPrBtn) return;

  // Determine status class: failed > approved > default
  let statusClass = 'has-pr';

  // Check pipeline statuses
  const statusesUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(pr.repository.id)}/pullRequests/${pr.pullRequestId}/statuses?api-version=7.0`;
  try {
    const sResp = await fetch(statusesUrl, { headers: { Authorization: `Basic ${auth}` } });
    if (sResp.ok) {
      const sData = await sResp.json();
      const statuses = sData.value || [];
      // Deduplicate: keep latest status per context key
      const latest = {};
      for (const s of statuses) {
        const key = `${s.context?.genre}/${s.context?.name}`;
        if (!latest[key] || s.id > latest[key].id) latest[key] = s;
      }
      const latestVals = Object.values(latest);
      const hasFailed = latestVals.some(s => s.state === 'failed' || s.state === 'error');
      if (hasFailed) {
        const maxFailedId = Math.max(...latestVals.filter(s => s.state === 'failed' || s.state === 'error').map(s => s.id));
        const hasPendingNewer = latestVals.some(s => s.state === 'pending' && s.id > maxFailedId);
        if (!hasPendingNewer) {
          // Also check Builds API — a manually re-triggered build won't post a pending PR status.
          // PR-triggered builds run on refs/pull/<id>/merge, not on the source branch ref.
          let hasActiveBuild = false;
          try {
            const prMergeRef = `refs/pull/${pr.pullRequestId}/merge`;
            const [bResp1, bResp2] = await Promise.all([
              fetch(`https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/build/builds?branchName=${encodeURIComponent(pr.sourceRefName)}&$top=5&api-version=7.0`, { headers: { Authorization: `Basic ${auth}` } }),
              fetch(`https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/build/builds?branchName=${encodeURIComponent(prMergeRef)}&$top=5&api-version=7.0`, { headers: { Authorization: `Basic ${auth}` } })
            ]);
            const isActive = b => b.status === 'inProgress' || b.status === 'notStarted';
            if (bResp1.ok) {
              const bData = await bResp1.json();
              hasActiveBuild = (bData.value || []).some(isActive);
            }
            if (!hasActiveBuild && bResp2.ok) {
              const bData = await bResp2.json();
              hasActiveBuild = (bData.value || []).some(isActive);
            }
          } catch { /* ignore */ }
          if (!hasActiveBuild) statusClass = 'has-pr-failed';
        }
      }
    }
  } catch { /* ignore */ }

  // Check reviewer approval (only if pipeline not failed)
  if (statusClass === 'has-pr') {
    const reviewers = pr.reviewers || [];
    const approved = reviewers.some(r => r.vote >= 10);
    const rejected = reviewers.some(r => r.vote <= -10);
    if (approved && !rejected) statusClass = 'has-pr-approved';
  }

  createPrBtn.classList.remove('has-pr', 'has-pr-approved', 'has-pr-failed');
  createPrBtn.classList.add(statusClass);
  createPrBtn.style.display = '';
  createPrBtn.title = `View Pull Request #${pr.pullRequestId} (Ctrl+Alt+M)`;
}

function showTabCloseButton(tabEl) {
  const switchBtn = tabEl.querySelector('.workspace-tab-switch');
  const removeBtn = tabEl.querySelector('.workspace-tab-remove');
  const commitPushBtn = tabEl.querySelector('.workspace-tab-commit-push');
  const createPrBtn = tabEl.querySelector('.workspace-tab-create-pr');
  const closeBtn = tabEl.querySelector('.workspace-tab-close');
  if (switchBtn) switchBtn.style.display = 'none';
  if (removeBtn) removeBtn.style.display = 'none';
  if (commitPushBtn) commitPushBtn.style.display = '';
  if (createPrBtn) createPrBtn.style.display = '';
  if (closeBtn) closeBtn.style.display = '';
  checkExistingPr(tabEl);
}

function showTabRemoveButton(tabEl) {
  const switchBtn = tabEl.querySelector('.workspace-tab-switch');
  const removeBtn = tabEl.querySelector('.workspace-tab-remove');
  const commitPushBtn = tabEl.querySelector('.workspace-tab-commit-push');
  const createPrBtn = tabEl.querySelector('.workspace-tab-create-pr');
  const closeBtn = tabEl.querySelector('.workspace-tab-close');
  if (switchBtn) switchBtn.style.display = '';
  if (removeBtn) removeBtn.style.display = '';
  if (commitPushBtn) commitPushBtn.style.display = 'none';
  if (createPrBtn) createPrBtn.style.display = tabEl._existingPrUrl ? '' : 'none';
  if (closeBtn) closeBtn.style.display = 'none';
  checkExistingPr(tabEl);
}

// ===== Sidebar Resize =====

const COLLAPSE_THRESHOLD = 60;
const MIN_WIDTH = 120;
const DEFAULT_WIDTH = 220;
let preCollapseWidth = DEFAULT_WIDTH;

resizeHandle.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = sidebar.getBoundingClientRect().width;
  const wasCollapsed = sidebar.classList.contains('collapsed');
  let rafId = null;
  let lastX = startX;

  resizeHandle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;cursor:col-resize;';
  document.body.appendChild(overlay);

  function applyWidth() {
    const delta = lastX - startX;
    let newWidth = (wasCollapsed ? 40 : startWidth) + delta;

    if (newWidth < COLLAPSE_THRESHOLD) {
      sidebar.style.width = '40px';
      sidebar.classList.add('collapsed');
    } else {
      if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH;
      sidebar.style.width = newWidth + 'px';
      sidebar.classList.remove('collapsed');
    }
    rafId = null;
  }

  function onMouseMove(e) {
    lastX = e.clientX;
    if (!rafId) rafId = requestAnimationFrame(applyWidth);
  }

  function onMouseUp() {
    if (rafId) { cancelAnimationFrame(rafId); applyWidth(); }
    overlay.remove();
    resizeHandle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    if (!sidebar.classList.contains('collapsed')) {
      preCollapseWidth = sidebar.getBoundingClientRect().width;
    }
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
});

resizeHandle.addEventListener('dblclick', () => {
  if (sidebar.classList.contains('collapsed')) {
    sidebar.style.width = preCollapseWidth + 'px';
    sidebar.classList.remove('collapsed');
  } else {
    preCollapseWidth = sidebar.getBoundingClientRect().width;
    sidebar.style.width = '40px';
    sidebar.classList.add('collapsed');
  }
});

// ===== Collapsed Dots Rebuild =====

function rebuildCollapsedDots() {
  collapsedDotsEl.innerHTML = '';
  const groups = repoGroupsEl.querySelectorAll('.repo-group');
  groups.forEach((groupEl, i) => {
    if (i > 0) {
      const sep = document.createElement('hr');
      sep.className = 'collapsed-dots-separator';
      collapsedDotsEl.appendChild(sep);
    }
    const tabs = groupEl.querySelectorAll('.workspace-tab');
    for (const tab of tabs) {
      if (tab._dotEl) collapsedDotsEl.appendChild(tab._dotEl);
    }
  });
}

// ===== Context Menu =====

let _contextMenuTabEl = null;

function showContextMenu(x, y, tabEl) {
  hideProjectContextMenu();
  _contextMenuTabEl = tabEl;

  const isOpen = tabEl._workspaceId !== null;
  const hasTask = !!tabEl._wtTaskId;
  const hasPr = !!tabEl._existingPrUrl;

  contextMenu.querySelector('[data-action="open-workspace"]').style.display = isOpen ? 'none' : '';
  contextMenu.querySelector('[data-action="switch"]').style.display = isOpen ? 'none' : '';
  contextMenu.querySelector('[data-action="commit-push"]').style.display = '';
  contextMenu.querySelector('[data-action="create-pr"]').style.display = hasPr ? 'none' : '';
  contextMenu.querySelector('[data-action="open-task"]').style.display = hasTask ? '' : 'none';
  contextMenu.querySelector('[data-action="open-pr"]').style.display = hasPr ? '' : 'none';
  contextMenu.querySelector('[data-action="close-editor"]').style.display = isOpen ? '' : 'none';
  contextMenu.querySelector('[data-action="remove"]').style.display = isOpen ? 'none' : '';

  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.classList.add('visible');

  // Adjust if overflowing viewport
  requestAnimationFrame(() => {
    const rect = contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      contextMenu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      contextMenu.style.top = (window.innerHeight - rect.height - 4) + 'px';
    }
  });
}

function hideContextMenu() {
  contextMenu.classList.remove('visible');
  _contextMenuTabEl = null;
}

document.addEventListener('click', hideContextMenu);
document.addEventListener('contextmenu', (e) => {
  if (!contextMenu.contains(e.target)) hideContextMenu();
});

contextMenu.addEventListener('click', (e) => {
  const item = e.target.closest('.context-menu-item');
  if (!item || !_contextMenuTabEl) return;
  const tabEl = _contextMenuTabEl;
  const action = item.dataset.action;
  hideContextMenu();

  if (action === 'open-workspace') {
    openWorktree(tabEl, { path: tabEl._wtPath, branch: tabEl._wtBranch });
  } else if (action === 'open-explorer') {
    window.shellAPI.openInExplorer(tabEl._wtPath);
  } else if (action === 'open-task') {
    const taskId = tabEl._wtTaskId;
    if (taskId) {
      const groupEl = tabEl.closest('.repo-group');
      const barePath = groupEl ? groupEl._barePath : null;
      (async () => {
        let url = null;
        if (barePath) {
          try {
            const remoteUrl = await window.reposAPI.remoteUrl(barePath);
            const m = remoteUrl && remoteUrl.match(/https?:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\//);
            if (m) {
              url = `https://dev.azure.com/${encodeURIComponent(decodeURIComponent(m[1]))}/${encodeURIComponent(decodeURIComponent(m[2]))}/_workitems/edit/${taskId}`;
            } else {
              const m2 = remoteUrl && remoteUrl.match(/https?:\/\/(?:[^@/]+@)?([^.]+)\.visualstudio\.com\/([^/]+)\/_git\//);
              if (m2) {
                url = `https://dev.azure.com/${encodeURIComponent(m2[1])}/${encodeURIComponent(decodeURIComponent(m2[2]))}/_workitems/edit/${taskId}`;
              }
            }
          } catch {}
        }
        if (url) window.shellAPI.openExternal(url);
      })();
    }
  } else if (action === 'open-pr') {
    if (tabEl._existingPrUrl) window.shellAPI.openExternal(tabEl._existingPrUrl);
  } else if (action === 'close-editor') {
    if (tabEl._workspaceId !== null) {
      closeWorkspace(tabEl._workspaceId);
    }
  } else if (action === 'switch') {
    if (_showWorktreeSwitchDialog) {
      const groupEl = tabEl.closest('.repo-group');
      _showWorktreeSwitchDialog(tabEl, groupEl);
    }
  } else if (action === 'remove') {
    if (_showWorktreeRemoveDialog) {
      const groupEl = tabEl.closest('.repo-group');
      _showWorktreeRemoveDialog(tabEl, groupEl);
    }
  } else if (action === 'commit-push') {
    if (_showCommitPushDialog) {
      const groupEl = tabEl.closest('.repo-group');
      _showCommitPushDialog(tabEl, groupEl);
    }
  } else if (action === 'create-pr') {
    if (_showCreatePrDialog) {
      const groupEl = tabEl.closest('.repo-group');
      _showCreatePrDialog(tabEl, groupEl);
    }
  }
});

// ===== Project Context Menu =====

let _projectContextMenuGroupEl = null;
let _projectContextMenuTabsEl = null;

function showProjectContextMenu(x, y, groupEl, tabsEl) {
  hideContextMenu();
  _projectContextMenuGroupEl = groupEl;
  _projectContextMenuTabsEl = tabsEl;
  projectContextMenu.style.left = x + 'px';
  projectContextMenu.style.top = y + 'px';
  projectContextMenu.classList.add('visible');

  requestAnimationFrame(() => {
    const rect = projectContextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      projectContextMenu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      projectContextMenu.style.top = (window.innerHeight - rect.height - 4) + 'px';
    }
  });
}

function hideProjectContextMenu() {
  projectContextMenu.classList.remove('visible');
  _projectContextMenuGroupEl = null;
  _projectContextMenuTabsEl = null;
}

document.addEventListener('click', hideProjectContextMenu);
document.addEventListener('contextmenu', (e) => {
  if (!projectContextMenu.contains(e.target)) hideProjectContextMenu();
});

projectContextMenu.addEventListener('click', (e) => {
  const item = e.target.closest('.context-menu-item');
  if (!item || !_projectContextMenuGroupEl) return;
  const groupEl = _projectContextMenuGroupEl;
  const tabsEl = _projectContextMenuTabsEl;
  const action = item.dataset.action;
  hideProjectContextMenu();

  if (action === 'open-explorer') {
    window.shellAPI.openInExplorer(groupEl._repoDir);
  } else if (action === 'add-worktree') {
    if (_showWorktreeDialog) _showWorktreeDialog(groupEl, tabsEl);
  } else if (action === 'delete-project') {
    if (_showDeleteDialog) _showDeleteDialog(groupEl);
  }
});

function clearAllGroups() {
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

function removeRepoGroup(groupEl) {
  // Close all open workspaces in this group
  const tabs = groupEl.querySelectorAll('.workspace-tab');
  for (const tab of tabs) {
    if (tab._workspaceId !== null) {
      closeWorkspace(tab._workspaceId);
    }
    if (tab._dotEl) tab._dotEl.remove();
  }
  groupEl.remove();
}

function getRepoOrder() {
  return Array.from(repoGroupsEl.querySelectorAll('.repo-group'))
    .map(el => el.dataset.repoName);
}

function getWorktreeOrders() {
  const orders = {};
  for (const groupEl of repoGroupsEl.querySelectorAll('.repo-group')) {
    const repoName = groupEl.dataset.repoName;
    orders[repoName] = Array.from(groupEl.querySelectorAll('.workspace-tab'))
      .map(tab => tab._wtPath);
  }
  return orders;
}

function getOpenWorktreePaths() {
  const paths = [];
  for (const tab of document.querySelectorAll('.workspace-tab')) {
    if (tab._workspaceId !== null) {
      paths.push(tab._wtPath);
    }
  }
  return paths;
}

// ===== Keyboard Shortcuts (Ctrl+Alt+…) =====

const SHORTCUT_HOLD_DELAY = 300; // ms before number badges appear
let _shortcutHoldTimer = null;
let _shortcutBadgesVisible = false;
let _ctrlHeld = false;
let _altHeld = false;

function showShortcutBadges() {
  const tabs = Array.from(document.querySelectorAll('.repo-group-tabs.expanded .workspace-tab'));
  const digits = ['1','2','3','4','5','6','7','8','9','0'];
  tabs.forEach((tab, i) => {
    if (i >= digits.length) return;
    let badge = tab.querySelector('.workspace-tab-shortcut-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'workspace-tab-shortcut-badge';
      tab.insertBefore(badge, tab.firstChild);
    }
    badge.textContent = digits[i];
  });
  repoGroupsEl.classList.add('show-shortcut-numbers');
  _shortcutBadgesVisible = true;
}

function hideShortcutBadges() {
  repoGroupsEl.classList.remove('show-shortcut-numbers');
  _shortcutBadgesVisible = false;
  _shortcutHoldTimer = null;
}

function cancelShortcutHold() {
  if (_shortcutHoldTimer) {
    clearTimeout(_shortcutHoldTimer);
    _shortcutHoldTimer = null;
  }
  if (_shortcutBadgesVisible) hideShortcutBadges();
}

function _activeTab() {
  return getActive()?.tabEl ?? null;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Control') _ctrlHeld = true;
  if (e.key === 'Alt') _altHeld = true;

  if (!(_ctrlHeld && _altHeld)) return;

  // Start hold timer for number badges when both modifier keys are first held
  if (!_shortcutBadgesVisible && !_shortcutHoldTimer && (e.key === 'Control' || e.key === 'Alt')) {
    _shortcutHoldTimer = setTimeout(showShortcutBadges, SHORTCUT_HOLD_DELAY);
  }

  // Ctrl+Alt+1…9,0 — switch to worktree by position
  const digits = ['1','2','3','4','5','6','7','8','9','0'];
  const digitIdx = digits.indexOf(e.key);
  if (digitIdx !== -1) {
    e.preventDefault();
    const tabs = Array.from(document.querySelectorAll('.repo-group-tabs.expanded .workspace-tab'));
    const tab = tabs[digitIdx];
    if (tab) openWorktree(tab, { path: tab._wtPath, branch: tab._wtBranch });
    cancelShortcutHold();
    return;
  }

  const key = e.key.toLowerCase();

  // Ctrl+Alt+T — toggle terminal
  if (key === 't') {
    e.preventDefault();
    if (_toggleTerminal) _toggleTerminal();
    return;
  }

  // Ctrl+Alt+W — close active worktree
  if (key === 'w') {
    e.preventDefault();
    const ws = getActive();
    if (ws) closeWorkspace(ws.tabEl._workspaceId);
    return;
  }

  // Ctrl+Alt+O — open (activate) the active worktree
  if (key === 'o') {
    e.preventDefault();
    const tabEl = _activeTab();
    if (tabEl) openWorktree(tabEl, { path: tabEl._wtPath, branch: tabEl._wtBranch });
    return;
  }

  // Ctrl+Alt+P — commit & push for active worktree
  if (key === 'p') {
    e.preventDefault();
    const tabEl = _activeTab();
    if (tabEl && _showCommitPushDialog) {
      _showCommitPushDialog(tabEl, tabEl.closest('.repo-group'));
    }
    return;
  }

  // Ctrl+Alt+M — open or create pull request for active worktree
  if (key === 'm') {
    e.preventDefault();
    const tabEl = _activeTab();
    if (!tabEl) return;
    if (tabEl._existingPrUrl) {
      window.shellAPI.openExternal(tabEl._existingPrUrl);
    } else if (_showCreatePrDialog) {
      _showCreatePrDialog(tabEl, tabEl.closest('.repo-group'));
    }
    return;
  }

  // Ctrl+Alt+N — add worktree to the active worktree's project
  if (key === 'n') {
    e.preventDefault();
    const tabEl = _activeTab();
    const groupEl = tabEl ? tabEl.closest('.repo-group') : repoGroupsEl.querySelector('.repo-group');
    if (groupEl && _showWorktreeDialog) {
      _showWorktreeDialog(groupEl, groupEl.querySelector('.repo-group-tabs'));
    }
    return;
  }

  // Ctrl+Alt+E — open active worktree folder in Explorer
  if (key === 'e') {
    e.preventDefault();
    const tabEl = _activeTab();
    if (tabEl) window.shellAPI.openInExplorer(tabEl._wtPath);
    return;
  }

  // Ctrl+Alt+A — open Azure DevOps task for active worktree
  if (key === 'a') {
    e.preventDefault();
    const tabEl = _activeTab();
    if (!tabEl) return;
    const taskId = tabEl._wtTaskId;
    if (!taskId) return;
    const groupEl = tabEl.closest('.repo-group');
    const barePath = groupEl ? groupEl._barePath : null;
    (async () => {
      let url = null;
      if (barePath) {
        try {
          const remoteUrl = await window.reposAPI.remoteUrl(barePath);
          const m = remoteUrl && remoteUrl.match(/https?:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\//);
          if (m) {
            url = `https://dev.azure.com/${encodeURIComponent(decodeURIComponent(m[1]))}/${encodeURIComponent(decodeURIComponent(m[2]))}/_workitems/edit/${taskId}`;
          } else {
            const m2 = remoteUrl && remoteUrl.match(/https?:\/\/(?:[^@/]+@)?([^.]+)\.visualstudio\.com\/([^/]+)\/_git\//);
            if (m2) {
              url = `https://dev.azure.com/${encodeURIComponent(m2[1])}/${encodeURIComponent(decodeURIComponent(m2[2]))}/_workitems/edit/${taskId}`;
            }
          }
        } catch {}
      }
      if (url) window.shellAPI.openExternal(url);
    })();
    return;
  }
});

document.addEventListener('keyup', (e) => {
  if (e.key === 'Control') { _ctrlHeld = false; cancelShortcutHold(); }
  if (e.key === 'Alt') { _altHeld = false; cancelShortcutHold(); }
});

setInterval(() => {
  for (const tab of document.querySelectorAll('.workspace-tab')) {
    const btn = tab.querySelector('.workspace-tab-create-pr');
    if (btn && (btn.classList.contains('has-pr') || btn.classList.contains('has-pr-approved') || btn.classList.contains('has-pr-failed'))) {
      checkExistingPr(tab);
    }
  }
}, 5 * 60 * 1000);

export { addRepoGroup, clearAllGroups, createWorktreeTab, rebuildCollapsedDots, registerWorktreeDialog, registerDeleteDialog, registerWorktreeRemoveDialog, registerWorktreeSwitchDialog, registerCommitPushDialog, registerCreatePrDialog, registerToggleTerminal, registerOnStateChange, registerSidebarBranchCache, registerSourceBranchLookup, registerTaskIdLookup, removeRepoGroup, showTabCloseButton, showTabRemoveButton, getRepoOrder, getWorktreeOrders, getOpenWorktreePaths };
