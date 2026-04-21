import { terminal, registerPtyApi } from '../terminal-panel.js';
import { runPty } from './pty-runner.js';

registerPtyApi(window.prCreateAPI);
import { getCachedBranchesFromState, saveBranchCache } from '../storage.js';
import { parseAzureRemoteUrl, buildAzureContext, fetchWorkItemTitle } from '../azure-api.js';
import { loadStoredPat, AZURE_PAT_KEY } from './utils.js';
import { toast } from '../toast.js';
import { createCombobox } from './combobox.js';
import { _refreshTabStatus } from '../sidebar/registers.js';
import { renderCommitFileList } from './commit-file-tree.js';

const createPrDialogOverlay = document.getElementById('create-pr-dialog-overlay');
const prBranchSearch = document.getElementById('pr-branch-search');
const prBranchList = document.getElementById('pr-branch-list');
const prTitleInput = document.getElementById('pr-title-input');
const prDescInput = document.getElementById('pr-desc-input');
const prDraftBtn = document.getElementById('pr-draft-btn');
const prConfirmBtn = document.getElementById('pr-confirm-btn');
const prFileList = document.getElementById('pr-file-list');

let prSelectedBranch = null;
let _prTabEl = null;
let _prGroupEl = null;
let _prAutoTitle = null;

// --- Branch combobox ---

const branchCombobox = createCombobox({
  inputEl: prBranchSearch,
  listEl: prBranchList,
  arrowSelector: '#pr-branch-combobox .combobox-arrow',
  onHide: () => hideCreatePrDialog(),
  getLabel: (b) => b,
  isSelected: (b) => b === prSelectedBranch,
  onSelect: (b) => {
    prSelectedBranch = b;
    prBranchSearch.value = b;
    updateConfirmState();
    loadPrDiff(b);
  },
  onEnterMatch: (b) => {
    prSelectedBranch = b;
    prBranchSearch.value = b;
    branchCombobox.close();
    updateConfirmState();
    loadPrDiff(b);
    prTitleInput.focus();
  },
  onInput: () => { prSelectedBranch = null; prFileList.innerHTML = ''; updateConfirmState(); },
  onBlur: () => { if (prSelectedBranch) prBranchSearch.value = prSelectedBranch; },
});

function updateConfirmState() {
  const enabled = !!prSelectedBranch && !!prTitleInput.value.trim();
  prConfirmBtn.disabled = !enabled;
  prDraftBtn.disabled = !enabled;
}

async function loadPrDiff(targetBranch) {
  if (!_prTabEl || !targetBranch) { prFileList.innerHTML = ''; return; }
  prFileList.innerHTML = '<span class="commit-file-list-empty">Loading…</span>';
  const wtPath = _prTabEl._wtPath;
  const files = await window.reposAPI.gitBranchDiffStat(wtPath, targetBranch);
  if (!createPrDialogOverlay.classList.contains('visible')) return;
  renderCommitFileList(prFileList, files, wtPath, {
    showRevert: false,
    onLoadDiff: (wt, fp) => window.reposAPI.gitBranchFileDiff(wt, fp, targetBranch, 3),
  });
}

function applyPrBranches(branches, preselect) {
  branchCombobox.setItems(branches);
  const prevBranch = prSelectedBranch;
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
  updateConfirmState();
  if (prSelectedBranch && prSelectedBranch !== prevBranch) loadPrDiff(prSelectedBranch);
}

export async function showCreatePrDialog(tabEl, groupEl) {
  // Reset all state
  _prTabEl = tabEl;
  _prGroupEl = groupEl;
  prSelectedBranch = null;
  _prAutoTitle = null;

  prBranchSearch.value = '';
  prBranchSearch.placeholder = 'Fetching branches...';
  prBranchSearch.disabled = true;
  prTitleInput.value = '';
  prDescInput.value = '';
  prConfirmBtn.disabled = true;
  prFileList.innerHTML = '';

  branchCombobox.setItems([]);
  branchCombobox.close();

  createPrDialogOverlay.classList.add('visible');

  const sourceBranch = tabEl._wtSourceBranch;
  if (sourceBranch) {
    window.reposAPI.firstBranchCommit(tabEl._wtPath, sourceBranch).then(msg => {
      if (msg && !prTitleInput.value && createPrDialogOverlay.classList.contains('visible') && _prTabEl === tabEl) {
        prTitleInput.value = msg;
        _prAutoTitle = msg;
        updateConfirmState();
      }
    });
  }

  const taskId = tabEl._wtTaskId;
  if (taskId) {
    (async () => {
      try {
        const remoteUrl = await window.reposAPI.remoteUrl(groupEl._barePath);
        const parsed = parseAzureRemoteUrl(remoteUrl);
        const pat = await loadStoredPat();
        if (parsed && pat) {
          const ctx = buildAzureContext(parsed, pat);
          const taskTitle = await fetchWorkItemTitle(ctx, taskId);
          if (taskTitle && createPrDialogOverlay.classList.contains('visible') && _prTabEl === tabEl) {
            if (!prTitleInput.value || prTitleInput.value === _prAutoTitle) {
              prTitleInput.value = `#${taskId}: ${taskTitle}`;
              _prAutoTitle = prTitleInput.value;
              updateConfirmState();
            }
          }
        }
      } catch {}
    })();
  }

  const repoName = groupEl.dataset.repoName;
  const preselect = tabEl._wtSourceBranch || null;

  const stateCache = getCachedBranchesFromState(repoName);

  const [cachedResult] = await Promise.all([
    window.reposAPI.cachedBranches(groupEl._barePath),
    window.reposAPI.gitUser(groupEl._barePath)
  ]);
  const cached = cachedResult.value;

  const initialBranches = cached.length > 0 ? cached : stateCache;
  if (initialBranches.length > 0) {
    applyPrBranches(initialBranches, preselect);
    prTitleInput.focus();
  }

  window.reposAPI.fetchBranches(groupEl._barePath).then((fetchResult) => {
    const fetched = fetchResult.value;
    if (!createPrDialogOverlay.classList.contains('visible')) return;
    if (_prGroupEl !== groupEl) return;
    applyPrBranches(fetched, preselect);
    saveBranchCache(repoName, fetched);
    if (prBranchList.classList.contains('open')) {
      branchCombobox.render(prBranchSearch.value);
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
  branchCombobox.close();
  _prTabEl = null;
  _prGroupEl = null;
  _prAutoTitle = null;
}

async function confirmCreatePr(draft = false) {
  const title = prTitleInput.value.trim();
  if (!title || !prSelectedBranch || !_prTabEl) return;

  const desc = prDescInput.value.trim();
  const pat = await loadStoredPat();
  const tabEl = _prTabEl;
  const groupEl = _prGroupEl;
  const wtPath = tabEl._wtPath;
  const sourceBranch = tabEl._wtBranch;
  const targetBranch = prSelectedBranch;
  const workItemId = tabEl._wtTaskId || null;

  hideCreatePrDialog();

  terminal.show(`Creating PR: ${sourceBranch} → ${targetBranch}`);

  window.prCreateAPI.removeListeners();
  const disposeData = runPty(window.prCreateAPI, {
    successMsg: 'Pull request created successfully',
    failMsg: 'Pull request creation failed — check your PAT and try again',
    onSuccess: () => {
      terminal.setTitle('Pull request created');
      if (_refreshTabStatus) _refreshTabStatus(tabEl);
      setTimeout(() => terminal.close(), 1200);
    },
    onError: () => terminal.setTitle('Pull request creation failed'),
  });

  try {
    await window.prCreateAPI.start({ wtPath, sourceBranch, targetBranch, title, description: desc, draft, pat, workItemId });
    window.prCreateAPI.ready();
  } catch (err) {
    disposeData();
    terminal.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    terminal.setTitle('Pull request creation failed');
    toast.error('Pull request creation failed — see terminal');
    terminal.showCloseButton();
  }
}

// PR title/desc event listeners
prTitleInput.addEventListener('input', () => updateConfirmState());
prTitleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmCreatePr();
  if (e.key === 'Escape') hideCreatePrDialog();
});
prDescInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideCreatePrDialog();
});

document.getElementById('pr-cancel-btn').addEventListener('click', hideCreatePrDialog);
prDraftBtn.addEventListener('click', () => confirmCreatePr(true));
prConfirmBtn.addEventListener('click', () => confirmCreatePr(false));
