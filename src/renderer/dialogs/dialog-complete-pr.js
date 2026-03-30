const overlay = document.getElementById('complete-pr-dialog-overlay');
const titleEl = document.getElementById('complete-pr-dialog-title');
const branchEl = document.getElementById('complete-pr-dialog-branch');
let _resolve = null;

export function showCompletePrDialog(prTitle, targetRefName) {
  titleEl.textContent = prTitle || '';
  const branch = targetRefName ? targetRefName.replace(/^refs\/heads\//, '') : '';
  branchEl.textContent = branch ? `into ${branch}` : '';
  overlay.classList.add('visible');
  return new Promise(resolve => { _resolve = resolve; });
}

function hide(result) {
  overlay.classList.remove('visible');
  if (_resolve) { _resolve(result); _resolve = null; }
}

document.getElementById('complete-pr-confirm-btn').addEventListener('click', () => hide(true));
document.getElementById('complete-pr-cancel-btn').addEventListener('click', () => hide(false));
overlay.addEventListener('keydown', e => {
  if (e.key === 'Escape') hide(false);
  if (e.key === 'Enter') hide(true);
});
