import { terminal } from '../terminal-panel.js';
import { runPty } from './pty-runner.js';
import { toast } from '../toast.js';
import { runPushFlow } from '../push-flow.js';

const cherryPickDialogOverlay = document.getElementById('cherrypick-dialog-overlay');
const cherryPickSourceLabel = document.getElementById('cherrypick-source-branch');
const cherryPickTargetLabel = document.getElementById('cherrypick-target-branch');
const cherryPickCommitsList = document.getElementById('cherrypick-commits-list');
const cherryPickNoCommits = document.getElementById('cherrypick-no-commits');
const cherryPickLoadingCommits = document.getElementById('cherrypick-loading-commits');
const cherryPickCommitHint = document.getElementById('cherrypick-commit-hint');
const cherryPickConfirmBtn = document.getElementById('cherrypick-confirm-btn');
const cherryPickBulkToolbar = document.getElementById('cherrypick-bulk-toolbar');
const cherryPickBulkCount = document.getElementById('cherrypick-bulk-count');

let cpSourceTabEl = null;
let cpTargetTabEl = null;
let cpCommits = []; // { action: 'pick'|'drop', hash, message }
let selectedIndices = new Set();
let lastClickedIndex = null;

// ---- Selection ----

function updateBulkToolbar() {
  const count = selectedIndices.size;
  cherryPickBulkToolbar.style.display = count > 0 ? '' : 'none';
  cherryPickBulkCount.textContent = `${count} selected:`;
}

function setRowSelected(index, selected) {
  if (selected) selectedIndices.add(index); else selectedIndices.delete(index);
  const el = cherryPickCommitsList.querySelector(`.rebase-commit-item[data-index="${index}"]`);
  if (el) el.classList.toggle('selected', selected);
}

function clearSelection() {
  selectedIndices.forEach(i => setRowSelected(i, false));
  selectedIndices.clear();
  updateBulkToolbar();
}

function applyBulkAction(action) {
  selectedIndices.forEach(index => {
    cpCommits[index].action = action;
    const el = cherryPickCommitsList.querySelector(`.rebase-commit-item[data-index="${index}"]`);
    if (!el) return;
    el.dataset.action = action;
    const sel = el.querySelector('.rebase-action-select');
    sel.value = action;
    sel.dataset.action = action;
  });
  clearSelection();
  updateConfirmState();
}

document.getElementById('cherrypick-bulk-toolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('.rebase-bulk-btn');
  if (btn) applyBulkAction(btn.dataset.action);
});

// ---- Commit list rendering ----

function renderCommits() {
  cherryPickCommitsList.innerHTML = '';
  selectedIndices.clear();
  updateBulkToolbar();

  if (cpCommits.length === 0) {
    cherryPickCommitHint.textContent = '';
    return;
  }

  cherryPickCommitHint.textContent = `(${cpCommits.length} commit${cpCommits.length === 1 ? '' : 's'})`;

  for (let i = 0; i < cpCommits.length; i++) {
    cherryPickCommitsList.appendChild(buildCommitRow(i));
  }
}

function buildCommitRow(index) {
  const c = cpCommits[index];
  const item = document.createElement('div');
  item.className = 'rebase-commit-item';
  item.dataset.index = String(index);
  item.dataset.action = c.action;
  item.draggable = true;

  const handle = document.createElement('span');
  handle.className = 'rebase-drag-handle';
  handle.textContent = '⠿';
  handle.title = 'Drag to reorder';

  const select = document.createElement('select');
  select.className = 'rebase-action-select';
  select.dataset.action = c.action;
  for (const [val, label, title] of [
    ['pick', '✔ pick', 'Cherry-pick this commit'],
    ['drop', '✖ drop', 'Skip this commit'],
  ]) {
    const o = document.createElement('option');
    o.value = val;
    o.textContent = label;
    o.title = title;
    if (val === c.action) o.selected = true;
    select.appendChild(o);
  }

  select.addEventListener('change', () => {
    cpCommits[index].action = select.value;
    select.dataset.action = select.value;
    item.dataset.action = select.value;
    updateConfirmState();
  });

  const hashEl = document.createElement('span');
  hashEl.className = 'rebase-commit-hash';
  hashEl.textContent = c.hash.slice(0, 7);

  const msg = document.createElement('span');
  msg.className = 'rebase-commit-message';
  msg.textContent = c.message;
  msg.title = c.message;

  item.appendChild(handle);
  item.appendChild(select);
  item.appendChild(hashEl);
  item.appendChild(msg);

  // ---- Selection ----
  item.addEventListener('click', (e) => {
    if (e.target.closest('select')) return;
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
    cherryPickCommitsList.querySelectorAll('.rebase-commit-item').forEach(el => el.classList.remove('drag-over'));
  });

  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    cherryPickCommitsList.querySelectorAll('.rebase-commit-item').forEach(el => el.classList.remove('drag-over'));
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
    const [moved] = cpCommits.splice(fromIndex, 1);
    cpCommits.splice(toIndex, 0, moved);
    renderCommits();
    updateConfirmState();
  });

  return item;
}

function updateConfirmState() {
  const hasPickable = cpCommits.some(c => c.action === 'pick');
  cherryPickConfirmBtn.disabled = cpCommits.length === 0 || !hasPickable;
}

// ---- Show / hide ----

export async function showCherryPickDialog(sourceTabEl, targetTabEl) {
  cpSourceTabEl = sourceTabEl;
  cpTargetTabEl = targetTabEl;
  cpCommits = [];

  cherryPickSourceLabel.textContent = sourceTabEl._wtBranch;
  cherryPickTargetLabel.textContent = targetTabEl._wtBranch;
  cherryPickCommitsList.innerHTML = '';
  cherryPickNoCommits.style.display = 'none';
  cherryPickLoadingCommits.style.display = '';
  cherryPickCommitHint.textContent = '';
  cherryPickConfirmBtn.disabled = true;

  cherryPickDialogOverlay.classList.add('visible');

  const sourceWtPath = sourceTabEl._wtPath;
  const targetBranch = targetTabEl._wtBranch;
  const raw = await window.reposAPI.cherryPickCommits(sourceWtPath, targetBranch);

  if (!cherryPickDialogOverlay.classList.contains('visible')) return;
  if (cpSourceTabEl !== sourceTabEl) return;

  cherryPickLoadingCommits.style.display = 'none';

  if (!raw || raw.length === 0) {
    cherryPickNoCommits.style.display = '';
    return;
  }

  // oldest-first (rebaseCommits returns oldest-first already since --reverse)
  cpCommits = raw.map(c => ({ action: 'pick', hash: c.hash, message: c.message }));
  renderCommits();
  updateConfirmState();
}

export function hideCherryPickDialog() {
  cherryPickDialogOverlay.classList.remove('visible');
}

// ---- Confirm ----

async function confirmCherryPick() {
  if (!cpSourceTabEl || !cpTargetTabEl) return;
  const pickableCommits = cpCommits.filter(c => c.action === 'pick');
  if (pickableCommits.length === 0) return;

  const commits = pickableCommits.map(c => c.hash);
  const sourceBranch = cpSourceTabEl._wtBranch;
  const targetBranch = cpTargetTabEl._wtBranch;
  const wtPath = cpTargetTabEl._wtPath;

  hideCherryPickDialog();

  terminal.show(`Cherry-picking ${commits.length} commit(s) onto ${targetBranch}...`);

  const disposeData = runPty(window.cherryPickAPI, {
    onSuccess: () => {
      terminal.writeln('\x1b[32mCherry-pick completed successfully!\x1b[0m');
      terminal.setTitle('Cherry-pick complete');
      runPushFlow(wtPath);
    },
    onError: () => {
      terminal.writeln('\x1b[31mCherry-pick failed.\x1b[0m');
      terminal.setTitle('Cherry-pick failed');
      toast.error('Cherry-pick failed — see terminal');
    },
  });

  try {
    await window.cherryPickAPI.start({ wtPath, sourceBranch, targetBranch, commits });
    window.cherryPickAPI.ready();
  } catch (err) {
    disposeData();
    terminal.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    terminal.setTitle('Cherry-pick failed');
    toast.error('Cherry-pick failed — see terminal');
    terminal.showCloseButton();
  }
}

// ---- Event listeners ----

document.getElementById('cherrypick-cancel-btn').addEventListener('click', hideCherryPickDialog);
cherryPickConfirmBtn.addEventListener('click', confirmCherryPick);

document.getElementById('cherrypick-dialog-overlay').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideCherryPickDialog();
});
