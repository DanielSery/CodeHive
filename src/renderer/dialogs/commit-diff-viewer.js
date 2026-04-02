/**
 * Renders a unified diff string into a container element with syntax highlighting.
 */
export function renderFileDiff(panel, diff) {
  panel.innerHTML = '';
  if (!diff || !diff.trim()) {
    panel.innerHTML = '<div class="commit-diff-line commit-diff-meta">No diff available</div>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const line of diff.split('\n')) {
    const el = document.createElement('div');
    el.className = 'commit-diff-line';
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('Binary')) {
      el.classList.add('commit-diff-meta');
    } else if (line.startsWith('+')) {
      el.classList.add('commit-diff-add');
    } else if (line.startsWith('-')) {
      el.classList.add('commit-diff-del');
    } else if (line.startsWith('@@')) {
      el.classList.add('commit-diff-hunk');
    }
    el.textContent = line;
    fragment.appendChild(el);
  }
  panel.appendChild(fragment);
}
