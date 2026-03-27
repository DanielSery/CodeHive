import { createTerminal, showTerminal, showCloseButton, setTitle, closeTerminal } from '../terminal-panel.js';
import { getCachedBranchesFromState, saveBranchCache } from '../storage.js';
import { parseAzureRemoteUrl, buildAzureContext, fetchWorkItemTitle } from '../azure-api.js';
import { loadStoredPat, AZURE_PAT_KEY, fuzzyMatch, fuzzyScore } from './utils.js';
import { showPatDialog } from './dialog-pat.js';

const createPrDialogOverlay = document.getElementById('create-pr-dialog-overlay');
const prBranchSearch = document.getElementById('pr-branch-search');
const prBranchList = document.getElementById('pr-branch-list');
const prTitleInput = document.getElementById('pr-title-input');
const prDescInput = document.getElementById('pr-desc-input');

let prAllBranches = [];
let prSelectedBranch = null;
let prHighlightIndex = -1;
let _prTabEl = null;
let _prGroupEl = null;
let _prAutoTitle = null;

function getPrFilteredBranches() {
  const q = (prBranchSearch.value || '').toLowerCase();
  return prAllBranches.filter(b => fuzzyMatch(b, q)).sort((a, b) => fuzzyScore(b, q) - fuzzyScore(a, q));
}

function renderPrBranchList(filter) {
  prBranchList.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const filtered = prAllBranches.filter(b => fuzzyMatch(b, q)).sort((a, b) => fuzzyScore(b, q) - fuzzyScore(a, q));
  if (filtered.length === 0) {
    prBranchList.classList.remove('open');
    prHighlightIndex = -1;
    return;
  }
  filtered.forEach((b, i) => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    if (b === prSelectedBranch) item.classList.add('selected');
    if (i === prHighlightIndex) item.classList.add('highlighted');
    item.textContent = b;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectPrBranch(b);
    });
    prBranchList.appendChild(item);
  });
  prBranchList.classList.add('open');
}

function selectPrBranch(b) {
  prSelectedBranch = b;
  prBranchSearch.value = b;
  prBranchList.classList.remove('open');
  prHighlightIndex = -1;
}

function applyPrBranches(branches, preselect) {
  prAllBranches = branches;
  if (preselect && branches.includes(preselect) && !prSelectedBranch) {
    prSelectedBranch = preselect;
    prBranchSearch.value = preselect;
  } else if (!prSelectedBranch) {
    const defaultBranch = ['master', 'main', 'develop'].find(b => branches.includes(b));
    if (defaultBranch) {
      prSelectedBranch = defaultBranch;
      prBranchSearch.value = defaultBranch;
    }
  }
  prBranchSearch.placeholder = 'Search branches...';
  prBranchSearch.disabled = false;
}

export async function showCreatePrDialog(tabEl, groupEl) {
  _prTabEl = tabEl;
  _prGroupEl = groupEl;
  prSelectedBranch = null;
  prAllBranches = [];
  _prAutoTitle = null;
  prBranchSearch.value = '';
  prBranchSearch.placeholder = 'Fetching branches...';
  prBranchSearch.disabled = true;
  prTitleInput.value = '';
  prDescInput.value = '';
  prBranchList.innerHTML = '';
  prBranchList.classList.remove('open');

  createPrDialogOverlay.classList.add('visible');

  const sourceBranch = tabEl._wtSourceBranch;
  if (sourceBranch) {
    window.reposAPI.firstBranchCommit(tabEl._wtPath, sourceBranch).then(msg => {
      if (msg && !prTitleInput.value && createPrDialogOverlay.classList.contains('visible') && _prTabEl === tabEl) {
        prTitleInput.value = msg;
        _prAutoTitle = msg;
      }
    });
  }

  const taskId = tabEl._wtTaskId;
  if (taskId) {
    (async () => {
      try {
        const remoteUrl = await window.reposAPI.remoteUrl(groupEl._barePath);
        const parsed = parseAzureRemoteUrl(remoteUrl);
        const pat = loadStoredPat();
        if (parsed && pat) {
          const ctx = buildAzureContext(parsed, pat);
          const taskTitle = await fetchWorkItemTitle(ctx, taskId);
          if (taskTitle && createPrDialogOverlay.classList.contains('visible') && _prTabEl === tabEl) {
            if (!prTitleInput.value || prTitleInput.value === _prAutoTitle) {
              prTitleInput.value = `#${taskId}: ${taskTitle}`;
              _prAutoTitle = prTitleInput.value;
            }
          }
        }
      } catch {}
    })();
  }

  const repoName = groupEl.dataset.repoName;
  const preselect = tabEl._wtSourceBranch || null;

  const stateCache = getCachedBranchesFromState(repoName);

  const [cached, user] = await Promise.all([
    window.reposAPI.cachedBranches(groupEl._barePath),
    window.reposAPI.gitUser(groupEl._barePath)
  ]);

  const initialBranches = cached.length > 0 ? cached : stateCache;
  if (initialBranches.length > 0) {
    applyPrBranches(initialBranches, preselect);
    prTitleInput.focus();
  }

  window.reposAPI.fetchBranches(groupEl._barePath).then((fetched) => {
    if (!createPrDialogOverlay.classList.contains('visible')) return;
    if (_prGroupEl !== groupEl) return;
    applyPrBranches(fetched, preselect);
    saveBranchCache(repoName, fetched);
    if (prBranchList.classList.contains('open')) {
      renderPrBranchList(prBranchSearch.value);
    }
    if (cached.length === 0) {
      if (prSelectedBranch) {
        prTitleInput.focus();
      } else {
        prBranchSearch.focus();
      }
    }
  });
}

function hideCreatePrDialog() {
  createPrDialogOverlay.classList.remove('visible');
  prBranchList.classList.remove('open');
  _prTabEl = null;
  _prGroupEl = null;
  _prAutoTitle = null;
}

async function confirmCreatePr() {
  const title = prTitleInput.value.trim();
  if (!title || !prSelectedBranch || !_prTabEl) return;

  const desc = prDescInput.value.trim();
  let pat = loadStoredPat();
  if (!pat) {
    pat = await showPatDialog();
    if (!pat) return;
  }
  const tabEl = _prTabEl;
  const groupEl = _prGroupEl;
  const wtPath = tabEl._wtPath;
  const sourceBranch = tabEl._wtBranch;
  const targetBranch = prSelectedBranch;
  const workItemId = tabEl._wtTaskId || null;

  hideCreatePrDialog();

  showTerminal(`Creating PR: ${sourceBranch} → ${targetBranch}`);
  const xterm = createTerminal();

  window.prCreateAPI.removeListeners();
  window.prCreateAPI.onData((data) => {
    xterm.write(data);
  });

  window.prCreateAPI.onExit(({ exitCode }) => {
    if (exitCode === 0) {
      xterm.writeln('');
      xterm.writeln('\x1b[32mPull request created successfully!\x1b[0m');
      setTitle('Pull request created');
      setTimeout(() => closeTerminal(), 1200);
    } else {
      localStorage.removeItem(AZURE_PAT_KEY);
      xterm.writeln('');
      xterm.writeln(`\x1b[31mPull request creation failed with exit code ${exitCode}\x1b[0m`);
      setTitle('Pull request creation failed');
      showCloseButton();
    }
  });

  try {
    await window.prCreateAPI.start({ wtPath, sourceBranch, targetBranch, title, description: desc, pat, workItemId });
    window.prCreateAPI.ready();
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle('Pull request creation failed');
    showCloseButton();
  }
}

// PR dialog event listeners
prBranchSearch.addEventListener('input', () => {
  prSelectedBranch = null;
  prHighlightIndex = prBranchSearch.value.trim() ? 0 : -1;
  renderPrBranchList(prBranchSearch.value);
});

prBranchSearch.addEventListener('focus', () => {
  prBranchSearch.value = '';
  prHighlightIndex = -1;
  renderPrBranchList('');
});

prBranchSearch.addEventListener('blur', () => {
  setTimeout(() => {
    prBranchList.classList.remove('open');
    if (prSelectedBranch) prBranchSearch.value = prSelectedBranch;
  }, 200);
});

document.querySelector('#pr-branch-combobox .combobox-arrow').addEventListener('click', () => {
  if (prBranchList.classList.contains('open')) {
    prBranchList.classList.remove('open');
  } else {
    prBranchSearch.value = '';
    prHighlightIndex = -1;
    renderPrBranchList('');
    prBranchSearch.focus();
  }
});

prBranchSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideCreatePrDialog(); return; }
  const filtered = getPrFilteredBranches();
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    prHighlightIndex = Math.min(prHighlightIndex + 1, filtered.length - 1);
    renderPrBranchList(prBranchSearch.value);
    const el = prBranchList.querySelector('.highlighted');
    if (el) el.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    prHighlightIndex = Math.max(prHighlightIndex - 1, 0);
    renderPrBranchList(prBranchSearch.value);
    const el = prBranchList.querySelector('.highlighted');
    if (el) el.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && prHighlightIndex >= 0 && prHighlightIndex < filtered.length) {
    e.preventDefault();
    selectPrBranch(filtered[prHighlightIndex]);
    prTitleInput.focus();
  }
});

prTitleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmCreatePr();
  if (e.key === 'Escape') hideCreatePrDialog();
});
prDescInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideCreatePrDialog();
});

createPrDialogOverlay.addEventListener('click', (e) => {
  if (e.target === createPrDialogOverlay) hideCreatePrDialog();
});
document.getElementById('pr-cancel-btn').addEventListener('click', hideCreatePrDialog);
document.getElementById('pr-confirm-btn').addEventListener('click', confirmCreatePr);
