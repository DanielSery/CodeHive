import { createTerminal, showTerminal, showCloseButton, setTitle } from '../terminal-panel.js';
import { getCachedBranchesFromState, saveBranchCache } from '../storage.js';
import { toast } from '../toast.js';
import { createCombobox } from './combobox.js';

const rebaseDialogOverlay = document.getElementById('rebase-dialog-overlay');
const rebasePushConfirmOverlay = document.getElementById('rebase-push-confirm-overlay');
const rebaseBaseSearch = document.getElementById('rebase-base-search');
const rebaseBaseList = document.getElementById('rebase-base-list');
const rebaseCommitsList = document.getElementById('rebase-commits-list');
const rebaseNoCommits = document.getElementById('rebase-no-commits');
const rebaseLoadingCommits = document.getElementById('rebase-loading-commits');
const rebaseCommitHint = document.getElementById('rebase-commit-hint');
const rebaseConfirmBtn = document.getElementById('rebase-confirm-btn');
const rebaseBulkToolbar = document.getElementById('rebase-bulk-toolbar');
const rebaseBulkCount = document.getElementById('rebase-bulk-count');

let rebaseTabEl = null;
let rebaseGroupEl = null;
let rebaseSelectedBranch = null;
let rebaseCommits = []; // { action, hash, message }
let selectedIndices = new Set();
let lastClickedIndex = null;
let _activeForcePushXterm = null;

// ---- Branch combobox ----

const baseBranchCombobox = createCombobox({
  inputEl: rebaseBaseSearch,
  listEl: rebaseBaseList,
  arrowSelector: '#rebase-base-combobox .combobox-arrow',
  onHide: () => hideRebaseDialog(),
  getLabel: (b) => b,
  isSelected: (b) => b === rebaseSelectedBranch,
  dashForSpace: true,
  onSelect: (b) => {
    rebaseSelectedBranch = b;
    rebaseBaseSearch.value = b;
    loadCommitsForBranch(b);
  },
  onEnterMatch: (b) => {
    rebaseSelectedBranch = b;
    rebaseBaseSearch.value = b;
    baseBranchCombobox.close();
    loadCommitsForBranch(b);
  },
  onInput: () => {
    rebaseSelectedBranch = null;
    rebaseCommits = [];
    renderCommits();
  },
  onBlur: () => {
    if (rebaseSelectedBranch) rebaseBaseSearch.value = rebaseSelectedBranch;
  },
});

function applyBranches(branches, preselect) {
  baseBranchCombobox.setItems(branches);
  if (preselect && branches.includes(preselect) && !rebaseSelectedBranch) {
    rebaseSelectedBranch = preselect;
    rebaseBaseSearch.value = preselect;
    loadCommitsForBranch(preselect);
  } else if (!rebaseSelectedBranch) {
    const def = branches.includes('develop') ? 'develop' : ['master', 'main'].find(b => branches.includes(b));
    if (def) {
      rebaseSelectedBranch = def;
      rebaseBaseSearch.value = def;
      loadCommitsForBranch(def);
    }
  }
  rebaseBaseSearch.placeholder = 'Search branches...';
  rebaseBaseSearch.disabled = false;
}

// ---- Commit loading ----

let _loadingBranch = null;

async function loadCommitsForBranch(branch) {
  if (!rebaseTabEl) return;
  _loadingBranch = branch;

  rebaseCommits = [];
  renderCommits();
  rebaseNoCommits.style.display = 'none';
  rebaseLoadingCommits.style.display = '';
  rebaseConfirmBtn.disabled = true;

  const wtPath = rebaseTabEl._wtPath;
  const raw = await window.reposAPI.rebaseCommits(wtPath, branch);

  if (_loadingBranch !== branch) return; // stale response

  rebaseLoadingCommits.style.display = 'none';

  if (!raw || raw.length === 0) {
    rebaseNoCommits.style.display = '';
    rebaseCommitHint.textContent = '';
    return;
  }

  rebaseCommits = raw.map(c => ({ action: 'pick', hash: c.hash, message: c.message })).reverse();
  renderCommits();
  updateConfirmState();
}

// ---- Selection ----

function updateBulkToolbar() {
  const count = selectedIndices.size;
  rebaseBulkToolbar.style.display = count > 0 ? '' : 'none';
  rebaseBulkCount.textContent = `${count} selected:`;
}

function setRowSelected(index, selected) {
  if (selected) selectedIndices.add(index); else selectedIndices.delete(index);
  const el = rebaseCommitsList.querySelector(`.rebase-commit-item[data-index="${index}"]`);
  if (el) el.classList.toggle('selected', selected);
}

function clearSelection() {
  selectedIndices.forEach(i => setRowSelected(i, false));
  selectedIndices.clear();
  updateBulkToolbar();
}

function applyBulkAction(action) {
  selectedIndices.forEach(index => {
    rebaseCommits[index].action = action;
    const el = rebaseCommitsList.querySelector(`.rebase-commit-item[data-index="${index}"]`);
    if (!el) return;
    el.dataset.action = action;
    const sel = el.querySelector('.rebase-action-select');
    sel.value = action;
    sel.dataset.action = action;
    // sync reword input visibility
    const msgSpan = el.querySelector('.rebase-commit-message');
    const msgInput = el.querySelector('.rebase-commit-message-input');
    const isEditable = action === 'reword' || action === 'squash';
    msgSpan.style.display = isEditable ? 'none' : '';
    msgInput.style.display = isEditable ? '' : 'none';
  });
  clearSelection();
  updateConfirmState();
}

document.getElementById('rebase-bulk-toolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('.rebase-bulk-btn');
  if (btn) applyBulkAction(btn.dataset.action);
});

// ---- Commit list rendering ----

function renderCommits() {
  rebaseCommitsList.innerHTML = '';
  selectedIndices.clear();
  updateBulkToolbar();

  if (rebaseCommits.length === 0) {
    rebaseCommitHint.textContent = '';
    return;
  }

  rebaseCommitHint.textContent = `(${rebaseCommits.length} commit${rebaseCommits.length === 1 ? '' : 's'})`;

  for (let i = 0; i < rebaseCommits.length; i++) {
    const item = buildCommitRow(i);
    rebaseCommitsList.appendChild(item);
  }
}

function buildCommitRow(index) {
  const c = rebaseCommits[index];
  const item = document.createElement('div');
  item.className = 'rebase-commit-item';
  item.dataset.index = String(index);
  item.dataset.action = c.action;
  item.draggable = true;

  const handle = document.createElement('span');
  handle.className = 'rebase-drag-handle';
  handle.textContent = '⠿';
  handle.title = 'Drag to reorder';

  const actionIcons = { pick: '✔', reword: '✎', squash: '⊕', fixup: '⊖', drop: '✖' };
  const actionTitles = {
    pick:   'Keep this commit as-is',
    reword: 'Keep commit, edit its message',
    squash: 'Combine into older commit, merging messages',
    fixup:  'Combine into older commit, discarding this message',
    drop:   'Remove this commit from history',
  };

  const select = document.createElement('select');
  select.className = 'rebase-action-select';
  select.dataset.action = c.action;
  select.title = actionTitles[c.action];
  for (const opt of ['pick', 'reword', 'squash', 'fixup', 'drop']) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = `${actionIcons[opt]} ${opt}`;
    if (opt === c.action) o.selected = true;
    select.appendChild(o);
  }
  const msg = document.createElement('span');
  msg.className = 'rebase-commit-message';
  msg.textContent = c.message;
  msg.title = c.message;

  const msgInput = document.createElement('input');
  msgInput.type = 'text';
  msgInput.className = 'rebase-commit-message-input';
  msgInput.value = c.message;
  msgInput.spellcheck = false;
  msgInput.addEventListener('input', () => { rebaseCommits[index].message = msgInput.value; });
  msgInput.addEventListener('dragstart', (e) => e.stopPropagation());

  function applyAction(action) {
    const isEditable = action === 'reword' || action === 'squash';
    msg.style.display = isEditable ? 'none' : '';
    msgInput.style.display = isEditable ? '' : 'none';
    if (isEditable) setTimeout(() => msgInput.focus(), 0);
  }

  select.addEventListener('change', () => {
    rebaseCommits[index].action = select.value;
    select.dataset.action = select.value;
    select.title = actionTitles[select.value];
    item.dataset.action = select.value;
    applyAction(select.value);
    updateConfirmState();
  });

  applyAction(c.action);

  item.appendChild(handle);
  item.appendChild(select);
  item.appendChild(msg);
  item.appendChild(msgInput);

  // ---- Selection ----
  item.addEventListener('click', (e) => {
    if (e.target.closest('select, input')) return;
    if (e.shiftKey && lastClickedIndex !== null) {
      const lo = Math.min(lastClickedIndex, index);
      const hi = Math.max(lastClickedIndex, index);
      for (let i = lo; i <= hi; i++) setRowSelected(i, true);
    } else if (e.ctrlKey || e.metaKey) {
      setRowSelected(index, !selectedIndices.has(index));
    } else {
      const wasOnlySelected = selectedIndices.size === 1 && selectedIndices.has(index);
      clearSelection();
      if (!wasOnlySelected) setRowSelected(index, true);
    }
    lastClickedIndex = index;
    updateBulkToolbar();
  });

  // ---- Drag-and-drop ----
  item.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    item.classList.add('dragging');
  });

  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    rebaseCommitsList.querySelectorAll('.rebase-commit-item').forEach(el => el.classList.remove('drag-over'));
  });

  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    rebaseCommitsList.querySelectorAll('.rebase-commit-item').forEach(el => el.classList.remove('drag-over'));
    item.classList.add('drag-over');
  });

  item.addEventListener('dragleave', () => {
    item.classList.remove('drag-over');
  });

  item.addEventListener('drop', (e) => {
    e.preventDefault();
    item.classList.remove('drag-over');
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    const toIndex = parseInt(item.dataset.index, 10);
    if (fromIndex === toIndex) return;
    const [moved] = rebaseCommits.splice(fromIndex, 1);
    rebaseCommits.splice(toIndex, 0, moved);
    renderCommits();
    updateConfirmState();
  });

  return item;
}

function updateConfirmState() {
  const hasPickable = rebaseCommits.some(c => c.action !== 'drop');
  rebaseConfirmBtn.disabled = !rebaseSelectedBranch || rebaseCommits.length === 0 || !hasPickable;
}

// ---- Show / hide ----

export async function showRebaseDialog(tabEl, groupEl) {
  rebaseTabEl = tabEl;
  rebaseGroupEl = groupEl;
  rebaseSelectedBranch = null;
  rebaseCommits = [];
  _loadingBranch = null;

  rebaseBaseSearch.value = '';
  rebaseBaseSearch.placeholder = 'Fetching branches...';
  rebaseBaseSearch.disabled = true;
  rebaseCommitsList.innerHTML = '';
  rebaseNoCommits.style.display = 'none';
  rebaseLoadingCommits.style.display = 'none';
  rebaseCommitHint.textContent = '';
  rebaseConfirmBtn.disabled = true;

  baseBranchCombobox.setItems([]);
  baseBranchCombobox.close();

  rebaseDialogOverlay.classList.add('visible');

  const repoName = groupEl.dataset.repoName;
  const preselect = tabEl._wtSourceBranch || null;
  const stateCache = getCachedBranchesFromState(repoName);

  const cachedResult = await window.reposAPI.cachedBranches(groupEl._barePath);
  const cached = cachedResult.value;

  const initial = cached.length > 0 ? cached : stateCache;
  if (initial.length > 0) applyBranches(initial, preselect);

  window.reposAPI.fetchBranches(groupEl._barePath).then((fetchResult) => {
    if (!rebaseDialogOverlay.classList.contains('visible')) return;
    if (rebaseGroupEl !== groupEl) return;
    const fetched = fetchResult.value;
    applyBranches(fetched, preselect);
    saveBranchCache(repoName, fetched);
    if (rebaseBaseList.classList.contains('open')) baseBranchCombobox.render(rebaseBaseSearch.value);
  });
}

export function hideRebaseDialog() {
  rebaseDialogOverlay.classList.remove('visible');
  baseBranchCombobox.close();
  _loadingBranch = null;
}

// ---- Confirm ----

export async function confirmRebase() {
  if (!rebaseSelectedBranch || rebaseCommits.length === 0) return;
  if (!rebaseTabEl || !rebaseGroupEl) return;

  const hasPickable = rebaseCommits.some(c => c.action !== 'drop');
  if (!hasPickable) return;

  // Reverse back to oldest-first order that git rebase -i expects
  const commits = [...rebaseCommits].reverse().map(c => ({ action: c.action, hash: c.hash, message: c.message }));
  const sourceBranch = rebaseSelectedBranch;
  const wtPath = rebaseTabEl._wtPath;

  hideRebaseDialog();

  showTerminal(`Rebasing onto ${sourceBranch}...`);
  const xterm = createTerminal();

  window.rebaseAPI.removeListeners();
  window.rebaseAPI.onData((data) => { xterm.write(data); });

  window.rebaseAPI.onExit(({ exitCode }) => {
    if (exitCode === 0) {
      xterm.writeln('');
      xterm.writeln('\x1b[32mRebase completed successfully!\x1b[0m');
      setTitle('Rebase complete');
      _activeForcePushXterm = xterm;
      _forcePushWtPath = wtPath;
      rebasePushConfirmOverlay.classList.add('visible');
    } else {
      xterm.writeln('');
      xterm.writeln('\x1b[31mRebase failed — aborting...\x1b[0m');
      setTitle('Rebase failed');
      toast.error('Rebase failed — aborted');
      showCloseButton();
    }
  });

  try {
    await window.rebaseAPI.start({ wtPath, sourceBranch, commits });
    window.rebaseAPI.ready();
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle('Rebase failed');
    toast.error('Rebase failed — see terminal');
    showCloseButton();
  }
}

// ---- Force push ----

let _forcePushWtPath = null;

function hidePushConfirm() {
  rebasePushConfirmOverlay.classList.remove('visible');
  _forcePushWtPath = null;
}

document.getElementById('rebase-push-skip-btn').addEventListener('click', () => {
  hidePushConfirm();
  showCloseButton();
});

document.getElementById('rebase-push-confirm-btn').addEventListener('click', async () => {
  const wtPath = _forcePushWtPath;
  hidePushConfirm();
  setTitle('Force pushing...');

  window.rebaseAPI.onForcePushData((data) => { _activeForcePushXterm?.write(data); });
  window.rebaseAPI.onForcePushExit(({ exitCode }) => {
    if (exitCode === 0) {
      _activeForcePushXterm?.writeln('\x1b[32mForce push complete!\x1b[0m');
      setTitle('Force push complete');
    } else {
      _activeForcePushXterm?.writeln('\x1b[31mForce push failed.\x1b[0m');
      setTitle('Force push failed');
      toast.error('Force push failed — see terminal');
    }
    showCloseButton();
  });

  try {
    await window.rebaseAPI.forcePushStart({ wtPath });
    window.rebaseAPI.forcePushReady();
  } catch (err) {
    _activeForcePushXterm?.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle('Force push failed');
    toast.error('Force push failed — see terminal');
    showCloseButton();
  }
});

// ---- Event listeners ----

document.getElementById('rebase-cancel-btn').addEventListener('click', hideRebaseDialog);
rebaseConfirmBtn.addEventListener('click', confirmRebase);

rebaseBaseSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideRebaseDialog();
});
