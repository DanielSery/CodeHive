import { _showWorktreeDialog } from './registers.js';

const repoGroupsEl = document.getElementById('repo-groups');
const collapsedDotsEl = document.getElementById('collapsed-dots');

function createCollapsedAddBtn(groupEl) {
  const btn = document.createElement('button');
  btn.className = 'collapsed-dot collapsed-add-worktree';
  btn.title = `Add Worktree — ${groupEl.dataset.repoName}`;
  btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>`;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const tabsEl = groupEl.querySelector('.repo-group-tabs');
    if (_showWorktreeDialog) _showWorktreeDialog(groupEl, tabsEl);
  });
  return btn;
}

export function rebuildCollapsedDots() {
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
    collapsedDotsEl.appendChild(createCollapsedAddBtn(groupEl));
  });
}

export { collapsedDotsEl, createCollapsedAddBtn };
