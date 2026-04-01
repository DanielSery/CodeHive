import { openWorktree, closeWorkspace } from '../workspace-manager.js';
import { _showWorktreeSwitchDialog, _showWorktreeRemoveDialog, _showCommitPushDialog, _showCreatePrDialog, _showWorktreeDialog, _showDeleteDialog, _showSetTaskDialog, _showRebaseDialog } from './registers.js';
import { toast } from '../toast.js';
import { pr } from '../pr-service.js';
import { pipeline } from '../pipeline-service.js';

const contextMenu = document.getElementById('wt-context-menu');
const projectContextMenu = document.getElementById('project-context-menu');

let _contextMenuTabEl = null;

export function showContextMenu(x, y, tabEl) {
  hideProjectContextMenu();
  _contextMenuTabEl = tabEl;

  const isOpen = tabEl._workspaceId !== null;
  const hasTask = !!tabEl._wtTaskId;
  const hasPr = !!tabEl._existingPrUrl;
  const hasMergedPr = !!tabEl._mergedPrUrl;
  const canComplete = !!tabEl._canCompletePr;
  const canResolve = !!tabEl._canResolveTask;
  const hasChanges = !!tabEl._hasUncommittedChanges;
  const hasPushed = !!tabEl._hasPushedCommits;
  const canOpenPipeline = !!tabEl._canOpenPipeline && !!tabEl._pipelineUrl && tabEl._pipelineStatus !== 'succeeded';
  const installBtn = tabEl.querySelector('.workspace-tab-install-btn');
  const canInstall = !!installBtn && installBtn.style.display !== 'none';
  // Create PR only when no uncommitted changes, pushed commits exist, no active PR or completion state
  const showCreatePr = !hasChanges && hasPushed && !hasPr && !canComplete && !canResolve;

  contextMenu.querySelector('[data-action="open-workspace"]').style.display = isOpen ? 'none' : '';
  contextMenu.querySelector('[data-action="switch"]').style.display = '';
  contextMenu.querySelector('[data-action="commit-push"]').style.display = hasChanges ? '' : 'none';
  contextMenu.querySelector('[data-action="create-pr"]').style.display = showCreatePr ? '' : 'none';
  contextMenu.querySelector('[data-action="complete-pr"]').style.display = !hasChanges && canComplete ? '' : 'none';
  contextMenu.querySelector('[data-action="open-pipeline"]').style.display = !hasChanges && canOpenPipeline ? '' : 'none';
  contextMenu.querySelector('[data-action="install"]').style.display = !hasChanges && canInstall ? '' : 'none';
  contextMenu.querySelector('[data-action="resolve-task"]').style.display = !hasChanges && canResolve ? '' : 'none';
  contextMenu.querySelector('[data-action="set-task"]').style.display = !hasTask ? '' : 'none';
  contextMenu.querySelector('[data-action="open-task"]').style.display = hasTask ? '' : 'none';
  contextMenu.querySelector('[data-action="open-pr"]').style.display = hasPr ? '' : 'none';
  contextMenu.querySelector('[data-action="open-merged-pr"]').style.display = hasMergedPr ? '' : 'none';
  contextMenu.querySelector('[data-action="close-editor"]').style.display = isOpen ? '' : 'none';
  contextMenu.querySelector('[data-action="remove"]').style.display = isOpen ? 'none' : '';

  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.classList.add('visible');

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

export function hideContextMenu() {
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
  } else if (action === 'open-git-app') {
    window.shellAPI.openInGitApp(tabEl._wtPath).then(result => {
      if (!result || !result.app) toast.error('No Git app found (Fork, SourceTree, GitKraken, Git Bash)');
    });
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
    pr.open(tabEl);
  } else if (action === 'open-merged-pr') {
    pr.openMerged(tabEl);
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
  } else if (action === 'complete-pr') {
    const btn = tabEl.querySelector('.workspace-tab-complete-pr');
    if (btn) btn.click();
  } else if (action === 'open-pipeline') {
    pipeline.open(tabEl);
  } else if (action === 'install') {
    const btn = tabEl.querySelector('.workspace-tab-install-btn');
    if (btn) btn.click();
  } else if (action === 'resolve-task') {
    const btn = tabEl.querySelector('.workspace-tab-resolve-task');
    if (btn) btn.click();
  } else if (action === 'set-task') {
    if (_showSetTaskDialog) _showSetTaskDialog(tabEl);
  } else if (action === 'rebase') {
    if (_showRebaseDialog) {
      const groupEl = tabEl.closest('.repo-group');
      _showRebaseDialog(tabEl, groupEl);
    }
  }
});

// ===== Project Context Menu =====

let _projectContextMenuGroupEl = null;
let _projectContextMenuTabsEl = null;

export function showProjectContextMenu(x, y, groupEl, tabsEl) {
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

export function hideProjectContextMenu() {
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
