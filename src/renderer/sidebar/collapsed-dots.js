const repoGroupsEl = document.getElementById('repo-groups');
const collapsedDotsEl = document.getElementById('collapsed-dots');

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
  });
}

export { collapsedDotsEl };
