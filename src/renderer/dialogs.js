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

  const [branches, user] = await Promise.all([
    window.reposAPI.remoteBranches(groupEl._barePath),
    window.reposAPI.gitUser(groupEl._barePath)
  ]);
  wtAllBranches = branches;
  wtGitUser = user || 'user';

  wtBranchSearch.placeholder = 'Search branches...';
  wtBranchSearch.disabled = false;
  renderBranchList('');
  wtBranchSearch.focus();
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

document.querySelector('.combobox-arrow').addEventListener('click', () => {
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

export { showWorktreeDialog, showCloneDialog, registerSidebarFns };
