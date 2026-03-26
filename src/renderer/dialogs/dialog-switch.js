import { openWorktree } from '../workspace-manager.js';
import { createTerminal, showTerminal, showCloseButton, setTitle, closeTerminal } from '../terminal-panel.js';
import { getCachedBranchesFromState, saveBranchCache, saveSourceBranch, saveTaskId } from '../storage.js';
import { fetchAzureTasks, createAzureWorkItem, buildAzureTaskUrl } from '../azure-api.js';
import { inferWorkItemType, sanitizePathPart, userToPrefix, nameToBranch, truncateToWords, loadStoredPat } from './utils.js';

const wtSwitchDialogOverlay = document.getElementById('wt-switch-dialog-overlay');
const wtSwitchBranchSearch = document.getElementById('wt-switch-branch-search');
const wtSwitchBranchList = document.getElementById('wt-switch-branch-list');
const wtSwitchNameInput = document.getElementById('wt-switch-name-input');
const wtSwitchPreview = document.getElementById('wt-switch-preview');
const wtSwitchTaskSearch = document.getElementById('wt-switch-task-search');
const wtSwitchTaskList = document.getElementById('wt-switch-task-list');
const wtSwitchTaskDescRow = document.getElementById('wt-switch-task-desc-row');
const wtSwitchTaskDesc = document.getElementById('wt-switch-task-desc');
const wtSwitchTaskTypeRow = document.getElementById('wt-switch-task-type-row');
const wtSwitchTaskType = document.getElementById('wt-switch-task-type');

let wtSwitchAllBranches = [];
let wtSwitchSelectedBranch = null;
let wtSwitchTabEl = null;
let wtSwitchGroupEl = null;
let wtSwitchGitUser = '';
let wtSwitchHighlightIndex = -1;
let wtSwitchAllTasks = [];
let wtSwitchSelectedTask = null;
let wtSwitchTaskHighlightIndex = -1;
let wtSwitchAzureContext = null;

// Injected by index.js
let _createWorktreeTab = null;
let _rebuildCollapsedDots = null;

export function registerSwitchSidebarFns(createWorktreeTab, rebuildCollapsedDots) {
  _createWorktreeTab = createWorktreeTab;
  _rebuildCollapsedDots = rebuildCollapsedDots;
}

function updateWtSwitchPreview() {
  const name = wtSwitchNameInput.value.trim();
  if (!name || !wtSwitchSelectedBranch) { wtSwitchPreview.textContent = ''; return; }
  const namePart = sanitizePathPart(name).trim().replace(/\s+/g, '-');
  const branch = wtSwitchSelectedTask
    ? `${userToPrefix(wtSwitchGitUser)}/${wtSwitchSelectedTask.id}-${namePart}`
    : nameToBranch(wtSwitchGitUser, name);
  wtSwitchPreview.textContent = `Branch: ${branch}`;
}

function getFilteredSwitchTasks() {
  const q = (wtSwitchTaskSearch.value || '').toLowerCase();
  return wtSwitchAllTasks.filter(t => `#${t.id} ${t.title}`.toLowerCase().includes(q));
}

function renderSwitchTaskList(filter) {
  wtSwitchTaskList.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const filtered = wtSwitchAllTasks.filter(t => `#${t.id} ${t.title}`.toLowerCase().includes(q));
  if (filtered.length === 0) { wtSwitchTaskList.classList.remove('open'); wtSwitchTaskHighlightIndex = -1; return; }
  filtered.forEach((t, i) => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    if (wtSwitchSelectedTask && t.id === wtSwitchSelectedTask.id) item.classList.add('selected');
    if (i === wtSwitchTaskHighlightIndex) item.classList.add('highlighted');
    item.textContent = `#${t.id} ${t.title}`;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectWtSwitchTask(t); });
    wtSwitchTaskList.appendChild(item);
  });
  wtSwitchTaskList.classList.add('open');
}

function updateSwitchTaskDescVisibility() {
  const isNewTask = !wtSwitchSelectedTask && wtSwitchTaskSearch.value.trim().length > 0;
  wtSwitchTaskDescRow.style.display = isNewTask ? '' : 'none';
  wtSwitchTaskTypeRow.style.display = isNewTask ? '' : 'none';
  if (isNewTask) wtSwitchTaskType.value = inferWorkItemType(wtSwitchTaskSearch.value.trim());
}

function selectWtSwitchTask(task) {
  wtSwitchSelectedTask = task;
  wtSwitchTaskSearch.value = task ? `#${task.id} ${task.title}` : '';
  wtSwitchTaskList.classList.remove('open');
  wtSwitchTaskHighlightIndex = -1;
  if (task && !wtSwitchNameInput.value.trim()) { wtSwitchNameInput.value = truncateToWords(task.title, 40); updateWtSwitchPreview(); }
  updateSwitchTaskDescVisibility();
}

async function fetchSwitchTasksForDialog(barePath) {
  const focusTaskSearch = () => { if (wtSwitchDialogOverlay.classList.contains('visible')) wtSwitchTaskSearch.focus(); };
  const pat = loadStoredPat();
  const result = await fetchAzureTasks(barePath, pat);
  if (result.error === 'no-pat') { wtSwitchTaskSearch.placeholder = 'Enter PAT to load tasks'; wtSwitchTaskSearch.disabled = false; focusTaskSearch(); return; }
  if (result.error === 'not-azure') { wtSwitchTaskSearch.placeholder = 'Not an Azure DevOps repository'; wtSwitchTaskSearch.disabled = false; focusTaskSearch(); return; }
  if (result.error) { wtSwitchTaskSearch.placeholder = 'Could not load tasks'; wtSwitchTaskSearch.disabled = false; focusTaskSearch(); return; }
  wtSwitchAzureContext = result.azureContext;
  wtSwitchAllTasks = result.tasks;
  wtSwitchTaskSearch.placeholder = wtSwitchAllTasks.length === 0 ? 'No active tasks found' : 'Search tasks...';
  wtSwitchTaskSearch.disabled = false;
  focusTaskSearch();
}

function getSwitchFilteredBranches() {
  const q = (wtSwitchBranchSearch.value || '').toLowerCase();
  return wtSwitchAllBranches.filter(b => b.toLowerCase().includes(q));
}

function renderSwitchBranchList(filter) {
  wtSwitchBranchList.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const filtered = wtSwitchAllBranches.filter(b => b.toLowerCase().includes(q));
  if (filtered.length === 0) { wtSwitchBranchList.classList.remove('open'); wtSwitchHighlightIndex = -1; return; }
  filtered.forEach((b, i) => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    if (b === wtSwitchSelectedBranch) item.classList.add('selected');
    if (i === wtSwitchHighlightIndex) item.classList.add('highlighted');
    item.textContent = b;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectWtSwitchBranch(b); });
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

function scrollHighlightedIntoView(listEl) {
  const el = listEl.querySelector('.highlighted');
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function applySwitchBranches(branches, preselect) {
  wtSwitchAllBranches = branches;
  if (preselect && branches.includes(preselect) && !wtSwitchSelectedBranch) {
    wtSwitchSelectedBranch = preselect;
    wtSwitchBranchSearch.value = preselect;
  } else if (!wtSwitchSelectedBranch) {
    const defaultBranch = ['master', 'main', 'develop'].find(b => branches.includes(b));
    if (defaultBranch) { wtSwitchSelectedBranch = defaultBranch; wtSwitchBranchSearch.value = defaultBranch; }
  }
  wtSwitchBranchSearch.placeholder = 'Search branches...';
  wtSwitchBranchSearch.disabled = false;
}

export async function showWorktreeSwitchDialog(tabEl, groupEl) {
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
  wtSwitchSelectedTask = null;
  wtSwitchAllTasks = [];
  wtSwitchAzureContext = null;
  wtSwitchTaskSearch.value = '';
  wtSwitchTaskSearch.placeholder = 'Loading tasks...';
  wtSwitchTaskSearch.disabled = true;
  wtSwitchTaskList.innerHTML = '';
  wtSwitchTaskList.classList.remove('open');
  wtSwitchTaskDescRow.style.display = 'none';
  wtSwitchTaskDesc.value = '';

  wtSwitchDialogOverlay.classList.add('visible');

  const repoName = groupEl.dataset.repoName;
  const preselect = tabEl._wtSourceBranch || null;
  const stateCache = getCachedBranchesFromState(repoName);

  const [cached, user] = await Promise.all([
    window.reposAPI.cachedBranches(groupEl._barePath),
    window.reposAPI.gitUser(groupEl._barePath)
  ]);
  wtSwitchGitUser = user || 'user';

  const initialBranches = cached.length > 0 ? cached : stateCache;
  if (initialBranches.length > 0) applySwitchBranches(initialBranches, preselect);

  window.reposAPI.fetchBranches(groupEl._barePath).then((fetched) => {
    if (!wtSwitchDialogOverlay.classList.contains('visible')) return;
    if (wtSwitchGroupEl !== groupEl) return;
    applySwitchBranches(fetched, preselect);
    saveBranchCache(repoName, fetched);
    if (wtSwitchBranchList.classList.contains('open')) renderSwitchBranchList(wtSwitchBranchSearch.value);
  });

  fetchSwitchTasksForDialog(groupEl._barePath);
}

export function hideWorktreeSwitchDialog() {
  wtSwitchDialogOverlay.classList.remove('visible');
  wtSwitchBranchList.classList.remove('open');
  wtSwitchTaskList.classList.remove('open');
  wtSwitchTaskDescRow.style.display = 'none';
  wtSwitchTaskTypeRow.style.display = 'none';
  wtSwitchTaskDesc.value = '';
}

export async function confirmSwitchWorktree() {
  if (!wtSwitchSelectedBranch || !wtSwitchNameInput.value.trim()) return;
  if (!wtSwitchTabEl || !wtSwitchGroupEl) return;

  const isNewTask = !wtSwitchSelectedTask && wtSwitchTaskSearch.value.trim().length > 0;
  if (isNewTask) {
    if (!wtSwitchAzureContext) { alert('Azure DevOps connection not available. Cannot create task.'); return; }
    const taskTitle = wtSwitchTaskSearch.value.trim();
    const taskDescription = wtSwitchTaskDesc.value.trim();
    const workItemType = wtSwitchTaskType.value || 'Story';
    try {
      wtSwitchSelectedTask = await createAzureWorkItem(wtSwitchAzureContext, workItemType, taskTitle, taskDescription);
      window.shellAPI.openExternal(buildAzureTaskUrl(wtSwitchAzureContext, wtSwitchSelectedTask.id));
    } catch (err) { alert(`Failed to create task: ${err.message}`); return; }
  }

  const name = wtSwitchNameInput.value.trim();
  const namePart = sanitizePathPart(name).trim().replace(/\s+/g, '-');
  const branchName = wtSwitchSelectedTask
    ? `${userToPrefix(wtSwitchGitUser)}/${wtSwitchSelectedTask.id}-${namePart}`
    : nameToBranch(wtSwitchGitUser, name);
  const taskId = wtSwitchSelectedTask ? wtSwitchSelectedTask.id : null;
  const tabEl = wtSwitchTabEl;
  const groupEl = wtSwitchGroupEl;
  const oldWtPath = tabEl._wtPath;
  const tabsEl = tabEl.parentElement;

  hideWorktreeSwitchDialog();

  showTerminal(`Switching worktree: ${branchName}`);
  const xterm = createTerminal();

  window.worktreeSwitchAPI.removeListeners();
  window.worktreeSwitchAPI.onData((data) => { xterm.write(data); });

  const switchSource = wtSwitchSelectedBranch;
  window.worktreeSwitchAPI.onExit(({ exitCode, wtPath, branchName: branch, dirName: dir }) => {
    if (exitCode === 0) {
      xterm.writeln('');
      xterm.writeln('\x1b[32mWorktree switched successfully!\x1b[0m');
      if (tabEl._dotEl) tabEl._dotEl.remove();
      tabEl.remove();
      const wt = { path: wtPath, branch, name: dir, sourceBranch: switchSource, taskId };
      saveSourceBranch(wtPath, switchSource);
      if (taskId) saveTaskId(wtPath, taskId);
      const newTabEl = _createWorktreeTab(wt);
      tabsEl.appendChild(newTabEl);
      if (_rebuildCollapsedDots) _rebuildCollapsedDots();
      setTimeout(async () => {
        closeTerminal();
        try { await openWorktree(newTabEl, wt); } catch (err) { console.error('Failed to open switched worktree:', err); }
      }, 800);
    } else {
      xterm.writeln('');
      xterm.writeln(`\x1b[31mWorktree switch failed with exit code ${exitCode}\x1b[0m`);
      setTitle(`Worktree switch failed`);
      showCloseButton();
    }
  });

  try {
    await window.worktreeSwitchAPI.start({ oldWtPath, branchName, sourceBranch: wtSwitchSelectedBranch });
    window.worktreeSwitchAPI.ready();
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle(`Worktree switch failed`);
    showCloseButton();
  }
}

// Event listeners
wtSwitchBranchSearch.addEventListener('input', () => { wtSwitchSelectedBranch = null; wtSwitchHighlightIndex = -1; renderSwitchBranchList(wtSwitchBranchSearch.value); });
wtSwitchBranchSearch.addEventListener('focus', () => { wtSwitchBranchSearch.value = ''; wtSwitchHighlightIndex = -1; renderSwitchBranchList(''); });
wtSwitchBranchSearch.addEventListener('blur', () => { setTimeout(() => { wtSwitchBranchList.classList.remove('open'); if (wtSwitchSelectedBranch) wtSwitchBranchSearch.value = wtSwitchSelectedBranch; }, 200); });

document.querySelector('#wt-switch-combobox .combobox-arrow').addEventListener('click', () => {
  if (wtSwitchBranchList.classList.contains('open')) { wtSwitchBranchList.classList.remove('open'); }
  else { wtSwitchBranchSearch.value = ''; wtSwitchHighlightIndex = -1; renderSwitchBranchList(''); wtSwitchBranchSearch.focus(); }
});

wtSwitchBranchSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideWorktreeSwitchDialog(); return; }
  const filtered = getSwitchFilteredBranches();
  if (e.key === 'ArrowDown') { e.preventDefault(); wtSwitchHighlightIndex = Math.min(wtSwitchHighlightIndex + 1, filtered.length - 1); renderSwitchBranchList(wtSwitchBranchSearch.value); scrollHighlightedIntoView(wtSwitchBranchList); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); wtSwitchHighlightIndex = Math.max(wtSwitchHighlightIndex - 1, 0); renderSwitchBranchList(wtSwitchBranchSearch.value); scrollHighlightedIntoView(wtSwitchBranchList); }
  else if (e.key === 'Enter' && wtSwitchHighlightIndex >= 0 && wtSwitchHighlightIndex < filtered.length) { e.preventDefault(); selectWtSwitchBranch(filtered[wtSwitchHighlightIndex]); wtSwitchTaskSearch.focus(); }
});

wtSwitchNameInput.addEventListener('input', updateWtSwitchPreview);
wtSwitchNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmSwitchWorktree(); if (e.key === 'Escape') hideWorktreeSwitchDialog(); });

wtSwitchTaskSearch.addEventListener('input', () => {
  wtSwitchSelectedTask = null; wtSwitchTaskHighlightIndex = -1; renderSwitchTaskList(wtSwitchTaskSearch.value); updateSwitchTaskDescVisibility();
  const typed = wtSwitchTaskSearch.value.trim();
  if (typed) { wtSwitchNameInput.value = truncateToWords(typed, 40); updateWtSwitchPreview(); }
});
wtSwitchTaskSearch.addEventListener('focus', () => { if (wtSwitchAllTasks.length > 0) { wtSwitchTaskHighlightIndex = -1; renderSwitchTaskList(wtSwitchTaskSearch.value); } });
wtSwitchTaskSearch.addEventListener('blur', () => {
  setTimeout(() => {
    wtSwitchTaskList.classList.remove('open');
    if (wtSwitchSelectedTask) { wtSwitchTaskSearch.value = `#${wtSwitchSelectedTask.id} ${wtSwitchSelectedTask.title}`; }
    else if (wtSwitchTaskSearch.value.trim()) { wtSwitchNameInput.value = truncateToWords(wtSwitchTaskSearch.value.trim(), 40); updateWtSwitchPreview(); }
    updateSwitchTaskDescVisibility();
  }, 200);
});

document.querySelector('#wt-switch-task-combobox .combobox-arrow').addEventListener('click', () => {
  if (wtSwitchTaskList.classList.contains('open')) { wtSwitchTaskList.classList.remove('open'); }
  else if (wtSwitchAllTasks.length > 0) { wtSwitchTaskSearch.value = ''; wtSwitchTaskHighlightIndex = -1; renderSwitchTaskList(''); wtSwitchTaskSearch.focus(); }
});

wtSwitchTaskSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideWorktreeSwitchDialog(); return; }
  const filtered = getFilteredSwitchTasks();
  if (e.key === 'ArrowDown') { e.preventDefault(); wtSwitchTaskHighlightIndex = Math.min(wtSwitchTaskHighlightIndex + 1, filtered.length - 1); renderSwitchTaskList(wtSwitchTaskSearch.value); scrollHighlightedIntoView(wtSwitchTaskList); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); wtSwitchTaskHighlightIndex = Math.max(wtSwitchTaskHighlightIndex - 1, 0); renderSwitchTaskList(wtSwitchTaskSearch.value); scrollHighlightedIntoView(wtSwitchTaskList); }
  else if (e.key === 'Enter' && wtSwitchTaskHighlightIndex >= 0 && wtSwitchTaskHighlightIndex < filtered.length) { e.preventDefault(); selectWtSwitchTask(filtered[wtSwitchTaskHighlightIndex]); wtSwitchNameInput.focus(); }
});

wtSwitchTaskDesc.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideWorktreeSwitchDialog(); });
wtSwitchDialogOverlay.addEventListener('click', (e) => { if (e.target === wtSwitchDialogOverlay) hideWorktreeSwitchDialog(); });
document.getElementById('wt-switch-cancel-btn').addEventListener('click', hideWorktreeSwitchDialog);
document.getElementById('wt-switch-confirm-btn').addEventListener('click', confirmSwitchWorktree);
