import { createTerminal, showTerminal, showCloseButton, setTitle, closeTerminal } from '../terminal-panel.js';
import { getCachedBranchesFromState, saveBranchCache } from '../storage.js';
import { parseAzureRemoteUrl, buildAzureContext, fetchWorkItemTitle } from '../azure-api.js';
import { loadStoredPat, AZURE_PAT_KEY } from './utils.js';
import { toast } from '../toast.js';
import { createCombobox } from './combobox.js';
import { _refreshTabStatus } from '../sidebar/registers.js';

const createPrDialogOverlay = document.getElementById('create-pr-dialog-overlay');
const prBranchSearch = document.getElementById('pr-branch-search');
const prBranchList = document.getElementById('pr-branch-list');
const prTitleInput = document.getElementById('pr-title-input');
const prDescInput = document.getElementById('pr-desc-input');
const prConfirmBtn = document.getElementById('pr-confirm-btn');

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
  },
  onEnterMatch: (b) => {
    prSelectedBranch = b;
    prBranchSearch.value = b;
    branchCombobox.close();
    updateConfirmState();
    prTitleInput.focus();
  },
  onInput: () => { prSelectedBranch = null; updateConfirmState(); },
  onBlur: () => { if (prSelectedBranch) prBranchSearch.value = prSelectedBranch; },
});

function updateConfirmState() {
  prConfirmBtn.disabled = !prSelectedBranch || !prTitleInput.value.trim();
}

function applyPrBranches(branches, preselect) {
  branchCombobox.setItems(branches);
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

async function confirmCreatePr() {
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
      toast.success('Pull request created');
      if (_refreshTabStatus) _refreshTabStatus(tabEl);
      setTimeout(() => closeTerminal(), 1200);
    } else {
      xterm.writeln('');
      xterm.writeln(`\x1b[31mPull request creation failed with exit code ${exitCode}\x1b[0m`);
      setTitle('Pull request creation failed');
      toast.error('Pull request creation failed — check your PAT and try again');
      showCloseButton();
    }
  });

  try {
    await window.prCreateAPI.start({ wtPath, sourceBranch, targetBranch, title, description: desc, pat, workItemId });
    window.prCreateAPI.ready();
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle('Pull request creation failed');
    toast.error('Pull request creation failed — see terminal');
    showCloseButton();
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
prConfirmBtn.addEventListener('click', confirmCreatePr);
