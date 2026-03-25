import { openWorktree } from './workspace-manager.js';
import { createTerminal, showTerminal, showCloseButton, setTitle, closeTerminal } from './terminal-panel.js';

// Injected by renderer.js to avoid circular dependency
let _addRepoGroup = null;
let _createWorktreeTab = null;

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

function renderBranchList(filter) {
  wtBranchList.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const filtered = wtAllBranches.filter(b => b.toLowerCase().includes(q));
  if (filtered.length === 0) {
    wtBranchList.classList.remove('open');
    return;
  }
  for (const b of filtered) {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    if (b === wtSelectedBranch) item.classList.add('selected');
    item.textContent = b;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      wtSelectedBranch = b;
      wtBranchSearch.value = b;
      wtBranchList.classList.remove('open');
      updateWtPreview();
    });
    wtBranchList.appendChild(item);
  }
  wtBranchList.classList.add('open');
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

  // Load cached branches + git user immediately
  const [cached, user] = await Promise.all([
    window.reposAPI.cachedBranches(groupEl._barePath),
    window.reposAPI.gitUser(groupEl._barePath)
  ]);
  wtGitUser = user || 'user';

  if (cached.length > 0) {
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

  window.worktreeAPI.resize(xterm.cols, xterm.rows);

  window.worktreeAPI.removeListeners();
  window.worktreeAPI.onData((data) => {
    xterm.write(data);
  });

  window.worktreeAPI.onExit(({ exitCode, wtPath, branchName: branch, dirName: dir }) => {
    if (exitCode === 0) {
      xterm.writeln('');
      xterm.writeln('\x1b[32mWorktree created successfully!\x1b[0m');

      const wt = { path: wtPath, branch, name: dir };
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
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle(`Worktree creation failed`);
    showCloseButton();
  }
}

// Worktree dialog event listeners
wtBranchSearch.addEventListener('input', () => {
  wtSelectedBranch = null;
  renderBranchList(wtBranchSearch.value);
});

wtBranchSearch.addEventListener('focus', () => {
  renderBranchList(wtBranchSearch.value);
});

wtBranchSearch.addEventListener('blur', () => {
  setTimeout(() => wtBranchList.classList.remove('open'), 200);
});

document.querySelector('#worktree-dialog-overlay .combobox-arrow').addEventListener('click', () => {
  if (wtBranchList.classList.contains('open')) {
    wtBranchList.classList.remove('open');
  } else {
    renderBranchList(wtBranchSearch.value);
    wtBranchSearch.focus();
  }
});

wtBranchSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideWorktreeDialog();
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

  const reposDir = 'C:/Repos';
  const repoName = parseRepoName(url);

  showTerminal(`Cloning ${repoName}...`);
  const xterm = createTerminal();

  window.cloneAPI.resize(xterm.cols, xterm.rows);

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
    } else {
      xterm.writeln('');
      xterm.writeln(`\x1b[31mClone failed with exit code ${exitCode}\x1b[0m`);
      setTitle(`Clone failed: ${name}`);
    }
    showCloseButton();
  });

  try {
    await window.cloneAPI.start(url, reposDir);
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle(`Clone failed: ${repoName}`);
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

  window.deleteAPI.resize(xterm.cols, xterm.rows);

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
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle(`Delete failed: ${repoName}`);
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

  window.worktreeRemoveAPI.resize(xterm.cols, xterm.rows);

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
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle(`Worktree removal failed`);
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

function updateWtSwitchPreview() {
  const name = wtSwitchNameInput.value.trim();
  if (!name || !wtSwitchSelectedBranch) {
    wtSwitchPreview.textContent = '';
    return;
  }
  const slug = nameToSlug(name);
  const branch = nameToBranch(wtSwitchGitUser, name);
  wtSwitchPreview.textContent = `Branch: ${branch}  |  Dir: ${slug}`;
}

function renderSwitchBranchList(filter) {
  wtSwitchBranchList.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const filtered = wtSwitchAllBranches.filter(b => b.toLowerCase().includes(q));
  if (filtered.length === 0) {
    wtSwitchBranchList.classList.remove('open');
    return;
  }
  for (const b of filtered) {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    if (b === wtSwitchSelectedBranch) item.classList.add('selected');
    item.textContent = b;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      wtSwitchSelectedBranch = b;
      wtSwitchBranchSearch.value = b;
      wtSwitchBranchList.classList.remove('open');
      updateWtSwitchPreview();
    });
    wtSwitchBranchList.appendChild(item);
  }
  wtSwitchBranchList.classList.add('open');
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

  const wtBranch = tabEl._wtBranch || '';

  const [cached, user, sourceBranch] = await Promise.all([
    window.reposAPI.cachedBranches(groupEl._barePath),
    window.reposAPI.gitUser(groupEl._barePath),
    window.reposAPI.worktreeSourceBranch(groupEl._barePath, wtBranch)
  ]);
  wtSwitchGitUser = user || 'user';

  let preselect = sourceBranch || null;

  if (cached.length > 0) {
    applySwitchBranches(cached, preselect);
    wtSwitchNameInput.focus();
  }

  // Fetch fresh branches in background
  window.reposAPI.fetchBranches(groupEl._barePath).then((fetched) => {
    if (!wtSwitchDialogOverlay.classList.contains('visible')) return;
    if (wtSwitchGroupEl !== groupEl) return;
    applySwitchBranches(fetched, preselect);
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
  const dirName = nameToSlug(name);
  const branchName = nameToBranch(wtSwitchGitUser, name);
  const tabEl = wtSwitchTabEl;
  const groupEl = wtSwitchGroupEl;
  const oldWtPath = tabEl._wtPath;
  const tabsEl = tabEl.parentElement;

  hideWorktreeSwitchDialog();

  // Close workspace if open
  if (tabEl._workspaceId !== null) {
    const { closeWorkspace } = await import('./workspace-manager.js');
    closeWorkspace(tabEl._workspaceId);
  }

  showTerminal(`Switching worktree: ${branchName}`);
  const xterm = createTerminal();

  window.worktreeSwitchAPI.resize(xterm.cols, xterm.rows);

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

      // Create new tab for the switched worktree
      const wt = { path: wtPath, branch, name: dir };
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
      repoDir: groupEl._repoDir,
      oldWtPath,
      branchName,
      dirName,
      sourceBranch: wtSwitchSelectedBranch
    });
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle(`Worktree switch failed`);
    showCloseButton();
  }
}

// Switch dialog event listeners
wtSwitchBranchSearch.addEventListener('input', () => {
  wtSwitchSelectedBranch = null;
  renderSwitchBranchList(wtSwitchBranchSearch.value);
});

wtSwitchBranchSearch.addEventListener('focus', () => {
  renderSwitchBranchList(wtSwitchBranchSearch.value);
});

wtSwitchBranchSearch.addEventListener('blur', () => {
  setTimeout(() => wtSwitchBranchList.classList.remove('open'), 200);
});

document.querySelector('#wt-switch-combobox .combobox-arrow').addEventListener('click', () => {
  if (wtSwitchBranchList.classList.contains('open')) {
    wtSwitchBranchList.classList.remove('open');
  } else {
    renderSwitchBranchList(wtSwitchBranchSearch.value);
    wtSwitchBranchSearch.focus();
  }
});

wtSwitchBranchSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideWorktreeSwitchDialog();
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

export { showWorktreeDialog, showCloneDialog, showDeleteDialog, showWorktreeRemoveDialog, showWorktreeSwitchDialog, registerSidebarFns, registerRemoveRepoGroup };
