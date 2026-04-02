const overlay = document.getElementById('complete-pr-dialog-overlay');
const titleEl = document.getElementById('complete-pr-dialog-title');
const branchEl = document.getElementById('complete-pr-dialog-branch');
const prLink = document.getElementById('complete-pr-link');
let _resolve = null;

export function showCompletePrDialog(prTitle, targetRefName, prUrl) {
  titleEl.textContent = prTitle || '';
  const branch = targetRefName ? targetRefName.replace(/^refs\/heads\//, '') : '';
  branchEl.textContent = branch ? `into ${branch}` : '';
  if (prUrl) {
    prLink.href = prUrl;
    prLink.style.display = '';
  } else {
    prLink.style.display = 'none';
  }
  overlay.classList.add('visible');
  return new Promise(resolve => { _resolve = resolve; });
}

function hide(result) {
  overlay.classList.remove('visible');
  if (_resolve) { _resolve(result); _resolve = null; }
}

prLink.addEventListener('click', (e) => { e.preventDefault(); window.shellAPI.openExternal(prLink.href); });
document.getElementById('complete-pr-confirm-btn').addEventListener('click', () => hide(true));
document.getElementById('complete-pr-cancel-btn').addEventListener('click', () => hide(false));
overlay.addEventListener('keydown', e => {
  if (e.key === 'Escape') hide(false);
  if (e.key === 'Enter') hide(true);
});
