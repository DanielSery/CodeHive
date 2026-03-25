import { openWorktree } from './workspace-manager.js';
import { createTerminal, showTerminal, showCloseButton, setTitle, closeTerminal } from './terminal-panel.js';

// Injected by renderer.js to avoid circular dependency
let _addRepoGroup = null;
let _createWorktreeTab = null;
let _cloneReposDir = null;

function setCloneReposDir(dir) {
  _cloneReposDir = dir;
}

function registerSidebarFns(addRepoGroup, createWorktreeTab) {
  _addRepoGroup = addRepoGroup;
  _createWorktreeTab = createWorktreeTab;
}

// ===== Worktree Dialog =====

const wtDialogOverlay = document.getElementById('worktree-dialog-overlay');
const wtBranchSearch = document.getElementById('wt-branch-search');
const wtBranchList = document.getElementById('wt-branch-list');
const wtNameInput = document.getElementById('wt-name-input');
const wtPreview = document.getElementById('wt-preview');

let wtAllBranches = [];
let wtSelectedBranch = null;
let wtCurrentGroupEl = null;
let wtCurrentTabsEl = null;
let wtGitUser = '';
let wtHighlightIndex = -1;

function nameToSlug(name) {
  return name.trim().replace(/\s+/g, '-').substring(0, 15);
}

function userToPrefix(fullName) {
  const parts = fullName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().split(/\s+/);
  if (parts.length === 0) return 'user';
  if (parts.length === 1) return parts[0];
  return parts[0][0] + parts[parts.length - 1];
}

function nameToBranch(user, name) {
  return `${userToPrefix(user)}/${name.trim().replace(/\s+/g, '-')}`;
}

function updateWtPreview() {
  const name = wtNameInput.value.trim();
  if (!name || !wtSelectedBranch) {
    wtPreview.textContent = '';
    return;
  }
  const slug = nameToSlug(name);
  const branch = nameToBranch(wtGitUser, name);
  wtPreview.textContent = `Branch: ${branch}  |  Dir: ${slug}`;
}

function getFilteredBranches() {
  const q = (wtBranchSearch.value || '').toLowerCase();
  return wtAllBranches.filter(b => b.toLowerCase().includes(q));
}

function renderBranchList(filter) {
  wtBranchList.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const filtered = wtAllBranches.filter(b => b.toLowerCase().includes(q));
  if (filtered.length === 0) {
    wtBranchList.classList.remove('open');
    wtHighlightIndex = -1;
    return;
  }
  filtered.forEach((b, i) => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    if (b === wtSelectedBranch) item.classList.add('selected');
    if (i === wtHighlightIndex) item.classList.add('highlighted');
    item.textContent = b;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectWtBranch(b);
    });
    wtBranchList.appendChild(item);
  });
  wtBranchList.classList.add('open');
}

function selectWtBranch(b) {
  wtSelectedBranch = b;
  wtBranchSearch.value = b;
  wtBranchList.classList.remove('open');
  wtHighlightIndex = -1;
  updateWtPreview();
}

function scrollHighlightedIntoView(listEl) {
  const el = listEl.querySelector('.highlighted');
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function applyBranches(branches) {
  wtAllBranches = branches;
  const defaultBranch = ['master', 'main', 'develop'].find(b => branches.includes(b));
  if (!wtSelectedBranch && defaultBranch) {
    wtSelectedBranch = defaultBranch;
    wtBranchSearch.value = defaultBranch;
  }
  wtBranchSearch.placeholder = 'Search branches...';
  wtBranchSearch.disabled = false;
}

async function showWorktreeDialog(groupEl, tabsEl) {
  wtCurrentGroupEl = groupEl;
  wtCurrentTabsEl = tabsEl;
  wtSelectedBranch = null;
  wtAllBranches = [];
  wtBranchSearch.value = '';
  wtBranchSearch.placeholder = 'Fetching branches...';
  wtBranchSearch.disabled = true;
  wtNameInput.value = '';
  wtPreview.textContent = '';
  wtBranchList.innerHTML = '';
  wtBranchList.classList.remove('open');

  wtDialogOverlay.classList.add('visible');

  // Use app state cache for instant display
  const repoName = groupEl.dataset.repoName;
  const stateCache = _getCachedBranches ? _getCachedBranches(repoName) : [];
  if (stateCache.length > 0) {
    applyBranches(stateCache);
    if (wtSelectedBranch) {
      wtNameInput.focus();
    } else {
      wtBranchSearch.focus();
    }
  }

  // Load git cached branches + git user
  const [cached, user] = await Promise.all([
    window.reposAPI.cachedBranches(groupEl._barePath),
    window.reposAPI.gitUser(groupEl._barePath)
  ]);
  wtGitUser = user || 'user';

  if (cached.length > 0 && stateCache.length === 0) {
    applyBranches(cached);
    if (wtSelectedBranch) {
      wtNameInput.focus();
    } else {
      wtBranchSearch.focus();
    }
  }

  // Fetch fresh branches in background
  window.reposAPI.fetchBranches(groupEl._barePath).then((fetched) => {
    if (!wtDialogOverlay.classList.contains('visible')) return;
    if (wtCurrentGroupEl !== groupEl) return;
    const prevSelected = wtSelectedBranch;
    applyBranches(fetched);
    if (_saveBranchCache) _saveBranchCache(repoName, fetched);
    // If the combobox list is open, refresh it
    if (wtBranchList.classList.contains('open')) {
      renderBranchList(wtBranchSearch.value);
    }
    // If we had no branches before, now focus appropriately
    if (cached.length === 0) {
      if (wtSelectedBranch) {
        wtNameInput.focus();
      } else {
        wtBranchSearch.focus();
      }
    }
  });
}

function hideWorktreeDialog() {
  wtDialogOverlay.classList.remove('visible');
  wtBranchList.classList.remove('open');
}

async function confirmCreateWorktree() {
  if (!wtSelectedBranch || !wtNameInput.value.trim()) return;

  const name = wtNameInput.value.trim();
  const dirName = nameToSlug(name);
  const branchName = nameToBranch(wtGitUser, name);
  const groupEl = wtCurrentGroupEl;
  const tabsEl = wtCurrentTabsEl;

  hideWorktreeDialog();

  showTerminal(`Creating worktree: ${branchName}`);
  const xterm = createTerminal();


  window.worktreeAPI.removeListeners();
  window.worktreeAPI.onData((data) => {
    xterm.write(data);
  });

  const sourceBranch = wtSelectedBranch;
  window.worktreeAPI.onExit(({ exitCode, wtPath, branchName: branch, dirName: dir }) => {
    if (exitCode === 0) {
      xterm.writeln('');
      xterm.writeln('\x1b[32mWorktree created successfully!\x1b[0m');

      const wt = { path: wtPath, branch, name: dir, sourceBranch };
      if (_saveSourceBranch) _saveSourceBranch(wtPath, sourceBranch);
      const tabEl = _createWorktreeTab(wt);
      tabsEl.appendChild(tabEl);

      setTimeout(async () => {
        closeTerminal();
        try {
          await openWorktree(tabEl, wt);
        } catch (err) {
          console.error('Failed to open worktree:', err);
          alert(`Worktree created but failed to open: ${err.message || err}`);
        }
      }, 800);
    } else {
      xterm.writeln('');
      xterm.writeln(`\x1b[31mWorktree creation failed with exit code ${exitCode}\x1b[0m`);
      setTitle(`Worktree creation failed`);

      showCloseButton();
    }
  });

  try {
    await window.worktreeAPI.start({
      barePath: groupEl._barePath,
      repoDir: groupEl._repoDir,
      branchName,
      dirName,
      sourceBranch: wtSelectedBranch
    });
    window.worktreeAPI.ready();
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle(`Worktree creation failed`);
    setTerminalStatus('error');
    showCloseButton();
  }
}

// Worktree dialog event listeners
wtBranchSearch.addEventListener('input', () => {
  wtSelectedBranch = null;
  wtHighlightIndex = -1;
  renderBranchList(wtBranchSearch.value);
});

wtBranchSearch.addEventListener('focus', () => {
  wtBranchSearch.value = '';
  wtHighlightIndex = -1;
  renderBranchList('');
});

wtBranchSearch.addEventListener('blur', () => {
  setTimeout(() => {
    wtBranchList.classList.remove('open');
    if (wtSelectedBranch) wtBranchSearch.value = wtSelectedBranch;
  }, 200);
});

document.querySelector('#worktree-dialog-overlay .combobox-arrow').addEventListener('click', () => {
  if (wtBranchList.classList.contains('open')) {
    wtBranchList.classList.remove('open');
  } else {
    wtBranchSearch.value = '';
    wtHighlightIndex = -1;
    renderBranchList('');
    wtBranchSearch.focus();
  }
});

wtBranchSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideWorktreeDialog(); return; }
  const filtered = getFilteredBranches();
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    wtHighlightIndex = Math.min(wtHighlightIndex + 1, filtered.length - 1);
    renderBranchList(wtBranchSearch.value);
    scrollHighlightedIntoView(wtBranchList);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    wtHighlightIndex = Math.max(wtHighlightIndex - 1, 0);
    renderBranchList(wtBranchSearch.value);
    scrollHighlightedIntoView(wtBranchList);
  } else if (e.key === 'Enter' && wtHighlightIndex >= 0 && wtHighlightIndex < filtered.length) {
    e.preventDefault();
    selectWtBranch(filtered[wtHighlightIndex]);
    wtNameInput.focus();
  }
});

wtNameInput.addEventListener('input', updateWtPreview);
wtNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmCreateWorktree();
  if (e.key === 'Escape') hideWorktreeDialog();
});

wtDialogOverlay.addEventListener('click', (e) => {
  if (e.target === wtDialogOverlay) hideWorktreeDialog();
});
document.getElementById('wt-cancel-btn').addEventListener('click', hideWorktreeDialog);
document.getElementById('wt-confirm-btn').addEventListener('click', confirmCreateWorktree);

// ===== Clone Dialog =====

const cloneDialogOverlay = document.getElementById('clone-dialog-overlay');
const cloneUrlInput = document.getElementById('clone-url-input');

function showCloneDialog() {
  cloneUrlInput.value = '';
  cloneDialogOverlay.classList.add('visible');
  setTimeout(() => cloneUrlInput.focus(), 50);
}

function hideCloneDialog() {
  cloneDialogOverlay.classList.remove('visible');
}

function parseRepoName(url) {
  const cleaned = url.replace(/\.git\/?$/, '').replace(/\/$/, '');
  return cleaned.split('/').pop();
}

async function startClone() {
  const url = cloneUrlInput.value.trim();
  if (!url) return;

  hideCloneDialog();

  const reposDir = _cloneReposDir;
  if (!reposDir) {
    alert('Please open a directory first.');
    return;
  }
  const repoName = parseRepoName(url);

  showTerminal(`Cloning ${repoName}...`);
  const xterm = createTerminal();


  window.cloneAPI.removeListeners();
  window.cloneAPI.onData((data) => {
    xterm.write(data);
  });

  window.cloneAPI.onExit(async ({ exitCode, repoName: name, repoDir, bareDir, reposDir: rDir }) => {
    if (exitCode === 0) {
      xterm.writeln('');
      xterm.writeln('\x1b[32mRepository cloned successfully!\x1b[0m');
      setTitle(`Clone complete: ${name}`);


      const repos = await window.reposAPI.scanDirectory(rDir);
      const newRepo = repos.find(r => r.name === name);
      if (newRepo && _addRepoGroup) {
        _addRepoGroup(newRepo);
      }
      if (_onCloneComplete) _onCloneComplete(rDir);
    } else {
      xterm.writeln('');
      xterm.writeln(`\x1b[31mClone failed with exit code ${exitCode}\x1b[0m`);
      setTitle(`Clone failed: ${name}`);

    }
    showCloseButton();
  });

  try {
    await window.cloneAPI.start(url, reposDir);
    window.cloneAPI.ready();
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle(`Clone failed: ${repoName}`);
    setTerminalStatus('error');
    showCloseButton();
  }
}

cloneDialogOverlay.addEventListener('click', (e) => {
  if (e.target === cloneDialogOverlay) hideCloneDialog();
});
document.getElementById('clone-cancel-btn').addEventListener('click', hideCloneDialog);
document.getElementById('clone-confirm-btn').addEventListener('click', startClone);

cloneUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startClone();
  if (e.key === 'Escape') hideCloneDialog();
});

// ===== Delete Dialog =====

const deleteDialogOverlay = document.getElementById('delete-dialog-overlay');
const deleteDialogPath = document.getElementById('delete-dialog-path');

let _deleteGroupEl = null;
let _removeRepoGroup = null;

function registerRemoveRepoGroup(fn) {
  _removeRepoGroup = fn;
}

function showDeleteDialog(groupEl) {
  _deleteGroupEl = groupEl;
  deleteDialogPath.textContent = groupEl._repoDir;
  deleteDialogOverlay.classList.add('visible');
}

function hideDeleteDialog() {
  deleteDialogOverlay.classList.remove('visible');
  _deleteGroupEl = null;
}

async function confirmDeleteRepo() {
  if (!_deleteGroupEl) return;
  const groupEl = _deleteGroupEl;
  const repoName = groupEl.dataset.repoName;
  hideDeleteDialog();

  showTerminal(`Deleting ${repoName}...`);
  const xterm = createTerminal();


  window.deleteAPI.removeListeners();
  window.deleteAPI.onData((data) => {
    xterm.write(data);
  });

  window.deleteAPI.onExit(({ exitCode }) => {
    if (exitCode === 0) {
      xterm.writeln('');
      xterm.writeln('\x1b[32mProject deleted successfully!\x1b[0m');
      if (_removeRepoGroup) _removeRepoGroup(groupEl);
      setTimeout(() => closeTerminal(), 1200);
    } else {
      xterm.writeln('');
      xterm.writeln(`\x1b[31mDelete failed with exit code ${exitCode}\x1b[0m`);
      setTitle(`Delete failed: ${repoName}`);

      showCloseButton();
    }
  });

  try {
    await window.deleteAPI.start(groupEl._repoDir);
    window.deleteAPI.ready();
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle(`Delete failed: ${repoName}`);
    setTerminalStatus('error');
    showCloseButton();
  }
}

deleteDialogOverlay.addEventListener('click', (e) => {
  if (e.target === deleteDialogOverlay) hideDeleteDialog();
});
document.getElementById('delete-cancel-btn').addEventListener('click', hideDeleteDialog);
document.getElementById('delete-confirm-btn').addEventListener('click', confirmDeleteRepo);

// ===== Worktree Remove Dialog =====

const wtRemoveDialogOverlay = document.getElementById('wt-remove-dialog-overlay');
const wtRemoveDialogPath = document.getElementById('wt-remove-dialog-path');

let _removeTabEl = null;
let _removeGroupEl = null;

function showWorktreeRemoveDialog(tabEl, groupEl) {
  _removeTabEl = tabEl;
  _removeGroupEl = groupEl;
  wtRemoveDialogPath.textContent = tabEl._wtPath;
  wtRemoveDialogOverlay.classList.add('visible');
}

function hideWorktreeRemoveDialog() {
  wtRemoveDialogOverlay.classList.remove('visible');
  _removeTabEl = null;
  _removeGroupEl = null;
}

async function confirmRemoveWorktree() {
  if (!_removeTabEl || !_removeGroupEl) return;
  const tabEl = _removeTabEl;
  const groupEl = _removeGroupEl;
  const wtPath = tabEl._wtPath;
  const branchLabel = tabEl._wtBranch;
  hideWorktreeRemoveDialog();

  showTerminal(`Removing worktree: ${branchLabel}`);
  const xterm = createTerminal();


  window.worktreeRemoveAPI.removeListeners();
  window.worktreeRemoveAPI.onData((data) => {
    xterm.write(data);
  });

  window.worktreeRemoveAPI.onExit(({ exitCode }) => {
    if (exitCode === 0) {
      xterm.writeln('');
      xterm.writeln('\x1b[32mWorktree removed successfully!\x1b[0m');
      // Remove the tab from sidebar
      if (tabEl._dotEl) tabEl._dotEl.remove();
      tabEl.remove();
      setTimeout(() => closeTerminal(), 1200);
    } else {
      xterm.writeln('');
      xterm.writeln(`\x1b[31mWorktree removal failed with exit code ${exitCode}\x1b[0m`);
      setTitle(`Worktree removal failed`);

      showCloseButton();
    }
  });

  try {
    await window.worktreeRemoveAPI.start({
      barePath: groupEl._barePath,
      wtPath
    });
    window.worktreeRemoveAPI.ready();
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle(`Worktree removal failed`);
    setTerminalStatus('error');
    showCloseButton();
  }
}

wtRemoveDialogOverlay.addEventListener('click', (e) => {
  if (e.target === wtRemoveDialogOverlay) hideWorktreeRemoveDialog();
});
document.getElementById('wt-remove-cancel-btn').addEventListener('click', hideWorktreeRemoveDialog);
document.getElementById('wt-remove-confirm-btn').addEventListener('click', confirmRemoveWorktree);

// ===== Worktree Switch Dialog =====

const wtSwitchDialogOverlay = document.getElementById('wt-switch-dialog-overlay');
const wtSwitchBranchSearch = document.getElementById('wt-switch-branch-search');
const wtSwitchBranchList = document.getElementById('wt-switch-branch-list');
const wtSwitchNameInput = document.getElementById('wt-switch-name-input');
const wtSwitchPreview = document.getElementById('wt-switch-preview');

let wtSwitchAllBranches = [];
let wtSwitchSelectedBranch = null;
let wtSwitchTabEl = null;
let wtSwitchGroupEl = null;
let wtSwitchGitUser = '';
let wtSwitchHighlightIndex = -1;

function updateWtSwitchPreview() {
  const name = wtSwitchNameInput.value.trim();
  if (!name || !wtSwitchSelectedBranch) {
    wtSwitchPreview.textContent = '';
    return;
  }
  const branch = nameToBranch(wtSwitchGitUser, name);
  wtSwitchPreview.textContent = `Branch: ${branch}`;
}

function getSwitchFilteredBranches() {
  const q = (wtSwitchBranchSearch.value || '').toLowerCase();
  return wtSwitchAllBranches.filter(b => b.toLowerCase().includes(q));
}

function renderSwitchBranchList(filter) {
  wtSwitchBranchList.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const filtered = wtSwitchAllBranches.filter(b => b.toLowerCase().includes(q));
  if (filtered.length === 0) {
    wtSwitchBranchList.classList.remove('open');
    wtSwitchHighlightIndex = -1;
    return;
  }
  filtered.forEach((b, i) => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    if (b === wtSwitchSelectedBranch) item.classList.add('selected');
    if (i === wtSwitchHighlightIndex) item.classList.add('highlighted');
    item.textContent = b;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectWtSwitchBranch(b);
    });
    wtSwitchBranchList.appendChild(item);
  });
  wtSwitchBranchList.classList.add('open');
}

function selectWtSwitchBranch(b) {
  wtSwitchSelectedBranch = b;
  wtSwitchBranchSearch.value = b;
  wtSwitchBranchList.classList.remove('open');
  wtSwitchHighlightIndex = -1;
  updateWtSwitchPreview();
}

function applySwitchBranches(branches, preselect) {
  wtSwitchAllBranches = branches;
  if (preselect && branches.includes(preselect) && !wtSwitchSelectedBranch) {
    wtSwitchSelectedBranch = preselect;
    wtSwitchBranchSearch.value = preselect;
  } else if (!wtSwitchSelectedBranch) {
    const defaultBranch = ['master', 'main', 'develop'].find(b => branches.includes(b));
    if (defaultBranch) {
      wtSwitchSelectedBranch = defaultBranch;
      wtSwitchBranchSearch.value = defaultBranch;
    }
  }
  wtSwitchBranchSearch.placeholder = 'Search branches...';
  wtSwitchBranchSearch.disabled = false;
}

async function showWorktreeSwitchDialog(tabEl, groupEl) {
  wtSwitchTabEl = tabEl;
  wtSwitchGroupEl = groupEl;
  wtSwitchSelectedBranch = null;
  wtSwitchAllBranches = [];
  wtSwitchBranchSearch.value = '';
  wtSwitchBranchSearch.placeholder = 'Fetching branches...';
  wtSwitchBranchSearch.disabled = true;
  wtSwitchNameInput.value = '';
  wtSwitchPreview.textContent = '';
  wtSwitchBranchList.innerHTML = '';
  wtSwitchBranchList.classList.remove('open');

  wtSwitchDialogOverlay.classList.add('visible');

  const repoName = groupEl.dataset.repoName;
  const preselect = tabEl._wtSourceBranch || null;

  // Use app state cache for instant display
  const stateCache = _getCachedBranches ? _getCachedBranches(repoName) : [];

  const [cached, user] = await Promise.all([
    window.reposAPI.cachedBranches(groupEl._barePath),
    window.reposAPI.gitUser(groupEl._barePath)
  ]);
  wtSwitchGitUser = user || 'user';

  const initialBranches = cached.length > 0 ? cached : stateCache;
  if (initialBranches.length > 0) {
    applySwitchBranches(initialBranches, preselect);
    wtSwitchNameInput.focus();
  }

  // Fetch fresh branches in background
  window.reposAPI.fetchBranches(groupEl._barePath).then((fetched) => {
    if (!wtSwitchDialogOverlay.classList.contains('visible')) return;
    if (wtSwitchGroupEl !== groupEl) return;
    applySwitchBranches(fetched, preselect);
    if (_saveBranchCache) _saveBranchCache(repoName, fetched);
    if (wtSwitchBranchList.classList.contains('open')) {
      renderSwitchBranchList(wtSwitchBranchSearch.value);
    }
    if (cached.length === 0) {
      if (wtSwitchSelectedBranch) {
        wtSwitchNameInput.focus();
      } else {
        wtSwitchBranchSearch.focus();
      }
    }
  });
}

function hideWorktreeSwitchDialog() {
  wtSwitchDialogOverlay.classList.remove('visible');
  wtSwitchBranchList.classList.remove('open');
}

async function confirmSwitchWorktree() {
  if (!wtSwitchSelectedBranch || !wtSwitchNameInput.value.trim()) return;
  if (!wtSwitchTabEl || !wtSwitchGroupEl) return;

  const name = wtSwitchNameInput.value.trim();
  const branchName = nameToBranch(wtSwitchGitUser, name);
  const tabEl = wtSwitchTabEl;
  const groupEl = wtSwitchGroupEl;
  const oldWtPath = tabEl._wtPath;
  const tabsEl = tabEl.parentElement;

  hideWorktreeSwitchDialog();

  showTerminal(`Switching worktree: ${branchName}`);
  const xterm = createTerminal();


  window.worktreeSwitchAPI.removeListeners();
  window.worktreeSwitchAPI.onData((data) => {
    xterm.write(data);
  });

  window.worktreeSwitchAPI.onExit(({ exitCode, wtPath, branchName: branch, dirName: dir }) => {
    if (exitCode === 0) {
      xterm.writeln('');
      xterm.writeln('\x1b[32mWorktree switched successfully!\x1b[0m');

      // Remove old tab and dot
      if (tabEl._dotEl) tabEl._dotEl.remove();
      tabEl.remove();

      // Create new tab — same directory, new branch
      const switchSource = wtSwitchSelectedBranch;
      const wt = { path: wtPath, branch, name: dir, sourceBranch: switchSource };
      if (_saveSourceBranch) _saveSourceBranch(wtPath, switchSource);
      const newTabEl = _createWorktreeTab(wt);
      tabsEl.appendChild(newTabEl);

      setTimeout(async () => {
        closeTerminal();
        try {
          await openWorktree(newTabEl, wt);
        } catch (err) {
          console.error('Failed to open switched worktree:', err);
        }
      }, 800);
    } else {
      xterm.writeln('');
      xterm.writeln(`\x1b[31mWorktree switch failed with exit code ${exitCode}\x1b[0m`);
      setTitle(`Worktree switch failed`);

      showCloseButton();
    }
  });

  try {
    await window.worktreeSwitchAPI.start({
      barePath: groupEl._barePath,
      oldWtPath,
      branchName,
      sourceBranch: wtSwitchSelectedBranch
    });
    window.worktreeSwitchAPI.ready();
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle(`Worktree switch failed`);
    setTerminalStatus('error');
    showCloseButton();
  }
}

// Switch dialog event listeners
wtSwitchBranchSearch.addEventListener('input', () => {
  wtSwitchSelectedBranch = null;
  wtSwitchHighlightIndex = -1;
  renderSwitchBranchList(wtSwitchBranchSearch.value);
});

wtSwitchBranchSearch.addEventListener('focus', () => {
  wtSwitchBranchSearch.value = '';
  wtSwitchHighlightIndex = -1;
  renderSwitchBranchList('');
});

wtSwitchBranchSearch.addEventListener('blur', () => {
  setTimeout(() => {
    wtSwitchBranchList.classList.remove('open');
    if (wtSwitchSelectedBranch) wtSwitchBranchSearch.value = wtSwitchSelectedBranch;
  }, 200);
});

document.querySelector('#wt-switch-combobox .combobox-arrow').addEventListener('click', () => {
  if (wtSwitchBranchList.classList.contains('open')) {
    wtSwitchBranchList.classList.remove('open');
  } else {
    wtSwitchBranchSearch.value = '';
    wtSwitchHighlightIndex = -1;
    renderSwitchBranchList('');
    wtSwitchBranchSearch.focus();
  }
});

wtSwitchBranchSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideWorktreeSwitchDialog(); return; }
  const filtered = getSwitchFilteredBranches();
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    wtSwitchHighlightIndex = Math.min(wtSwitchHighlightIndex + 1, filtered.length - 1);
    renderSwitchBranchList(wtSwitchBranchSearch.value);
    scrollHighlightedIntoView(wtSwitchBranchList);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    wtSwitchHighlightIndex = Math.max(wtSwitchHighlightIndex - 1, 0);
    renderSwitchBranchList(wtSwitchBranchSearch.value);
    scrollHighlightedIntoView(wtSwitchBranchList);
  } else if (e.key === 'Enter' && wtSwitchHighlightIndex >= 0 && wtSwitchHighlightIndex < filtered.length) {
    e.preventDefault();
    selectWtSwitchBranch(filtered[wtSwitchHighlightIndex]);
    wtSwitchNameInput.focus();
  }
});

wtSwitchNameInput.addEventListener('input', updateWtSwitchPreview);
wtSwitchNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmSwitchWorktree();
  if (e.key === 'Escape') hideWorktreeSwitchDialog();
});

wtSwitchDialogOverlay.addEventListener('click', (e) => {
  if (e.target === wtSwitchDialogOverlay) hideWorktreeSwitchDialog();
});
document.getElementById('wt-switch-cancel-btn').addEventListener('click', hideWorktreeSwitchDialog);
document.getElementById('wt-switch-confirm-btn').addEventListener('click', confirmSwitchWorktree);

let _onCloneComplete = null;
let _getCachedBranches = null;
let _saveBranchCache = null;
let _saveSourceBranch = null;

function registerOnCloneComplete(fn) {
  _onCloneComplete = fn;
}

function registerBranchCache(getCached, saveCached) {
  _getCachedBranches = getCached;
  _saveBranchCache = saveCached;
}

function registerSaveSourceBranch(fn) {
  _saveSourceBranch = fn;
}

export { showWorktreeDialog, showCloneDialog, showDeleteDialog, showWorktreeRemoveDialog, showWorktreeSwitchDialog, setCloneReposDir, registerSidebarFns, registerRemoveRepoGroup, registerOnCloneComplete, registerBranchCache, registerSaveSourceBranch };
