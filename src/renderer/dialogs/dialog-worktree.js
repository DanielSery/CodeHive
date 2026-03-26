import { openWorktree } from '../workspace-manager.js';
import { createTerminal, showTerminal, showCloseButton, setTitle, closeTerminal } from '../terminal-panel.js';
import { getCachedBranchesFromState, saveBranchCache, saveSourceBranch, saveTaskId } from '../storage.js';
import { fetchAzureTasks, createAzureWorkItem, buildAzureTaskUrl } from '../azure-api.js';
import { inferWorkItemType, sanitizePathPart, nameToSlug, userToPrefix, nameToBranch, truncateToWords, loadStoredPat } from './utils.js';

const wtDialogOverlay = document.getElementById('worktree-dialog-overlay');
const wtBranchSearch = document.getElementById('wt-branch-search');
const wtBranchList = document.getElementById('wt-branch-list');
const wtNameInput = document.getElementById('wt-name-input');
const wtPreview = document.getElementById('wt-preview');
const wtTaskSearch = document.getElementById('wt-task-search');
const wtTaskList = document.getElementById('wt-task-list');
const wtTaskDescRow = document.getElementById('wt-task-desc-row');
const wtTaskDesc = document.getElementById('wt-task-desc');
const wtTaskTypeRow = document.getElementById('wt-task-type-row');
const wtTaskType = document.getElementById('wt-task-type');

let wtAllBranches = [];
let wtSelectedBranch = null;
let wtCurrentGroupEl = null;
let wtCurrentTabsEl = null;
let wtGitUser = '';
let wtHighlightIndex = -1;
let wtAllTasks = [];
let wtSelectedTask = null;
let wtTaskHighlightIndex = -1;
let wtAzureContext = null;

// Injected by index.js
let _createWorktreeTab = null;
let _rebuildCollapsedDots = null;

export function registerWorktreeSidebarFns(createWorktreeTab, rebuildCollapsedDots) {
  _createWorktreeTab = createWorktreeTab;
  _rebuildCollapsedDots = rebuildCollapsedDots;
}

function buildWtNames(name) {
  const namePart = sanitizePathPart(name).trim().replace(/\s+/g, '-');
  if (wtSelectedTask) {
    const prefix = `${wtSelectedTask.id}-`;
    return {
      dirName: (prefix + namePart).substring(0, 15),
      branchName: `${userToPrefix(wtGitUser)}/${prefix}${namePart}`
    };
  }
  return {
    dirName: nameToSlug(name),
    branchName: nameToBranch(wtGitUser, name)
  };
}

function updateWtPreview() {
  const name = wtNameInput.value.trim();
  if (!name || !wtSelectedBranch) { wtPreview.textContent = ''; return; }
  const { dirName, branchName } = buildWtNames(name);
  wtPreview.textContent = `Branch: ${branchName}  |  Dir: ${dirName}`;
}

function getFilteredTasks() {
  const q = (wtTaskSearch.value || '').toLowerCase();
  return wtAllTasks.filter(t => `#${t.id} ${t.title}`.toLowerCase().includes(q));
}

function renderTaskList(filter) {
  wtTaskList.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const filtered = wtAllTasks.filter(t => `#${t.id} ${t.title}`.toLowerCase().includes(q));
  if (filtered.length === 0) { wtTaskList.classList.remove('open'); wtTaskHighlightIndex = -1; return; }
  filtered.forEach((t, i) => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    if (wtSelectedTask && t.id === wtSelectedTask.id) item.classList.add('selected');
    if (i === wtTaskHighlightIndex) item.classList.add('highlighted');
    item.textContent = `#${t.id} ${t.title}`;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectWtTask(t); });
    wtTaskList.appendChild(item);
  });
  wtTaskList.classList.add('open');
}

function updateTaskDescVisibility() {
  const isNewTask = !wtSelectedTask && wtTaskSearch.value.trim().length > 0;
  wtTaskDescRow.style.display = isNewTask ? '' : 'none';
  wtTaskTypeRow.style.display = isNewTask ? '' : 'none';
  if (isNewTask) wtTaskType.value = inferWorkItemType(wtTaskSearch.value.trim());
}

function selectWtTask(task) {
  wtSelectedTask = task;
  wtTaskSearch.value = task ? `#${task.id} ${task.title}` : '';
  wtTaskList.classList.remove('open');
  wtTaskHighlightIndex = -1;
  if (task && !wtNameInput.value.trim()) { wtNameInput.value = truncateToWords(task.title, 40); updateWtPreview(); }
  updateTaskDescVisibility();
}

async function fetchTasksForDialog(barePath) {
  const focusTaskSearch = () => { if (wtDialogOverlay.classList.contains('visible')) wtTaskSearch.focus(); };
  const pat = loadStoredPat();
  const result = await fetchAzureTasks(barePath, pat);
  if (result.error === 'no-pat') { wtTaskSearch.placeholder = 'Enter PAT to load tasks'; wtTaskSearch.disabled = false; focusTaskSearch(); return; }
  if (result.error === 'not-azure') { wtTaskSearch.placeholder = 'Not an Azure DevOps repository'; wtTaskSearch.disabled = false; focusTaskSearch(); return; }
  if (result.error) { wtTaskSearch.placeholder = 'Could not load tasks'; wtTaskSearch.disabled = false; focusTaskSearch(); return; }
  wtAzureContext = result.azureContext;
  wtAllTasks = result.tasks;
  wtTaskSearch.placeholder = wtAllTasks.length === 0 ? 'No active tasks found' : 'Search tasks...';
  wtTaskSearch.disabled = false;
  focusTaskSearch();
}

function getFilteredBranches() {
  const q = (wtBranchSearch.value || '').toLowerCase();
  return wtAllBranches.filter(b => b.toLowerCase().includes(q));
}

function renderBranchList(filter) {
  wtBranchList.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const filtered = wtAllBranches.filter(b => b.toLowerCase().includes(q));
  if (filtered.length === 0) { wtBranchList.classList.remove('open'); wtHighlightIndex = -1; return; }
  filtered.forEach((b, i) => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    if (b === wtSelectedBranch) item.classList.add('selected');
    if (i === wtHighlightIndex) item.classList.add('highlighted');
    item.textContent = b;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectWtBranch(b); });
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
  if (!wtSelectedBranch && defaultBranch) { wtSelectedBranch = defaultBranch; wtBranchSearch.value = defaultBranch; }
  wtBranchSearch.placeholder = 'Search branches...';
  wtBranchSearch.disabled = false;
}

export async function showWorktreeDialog(groupEl, tabsEl) {
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
  wtSelectedTask = null;
  wtAllTasks = [];
  wtAzureContext = null;
  wtTaskSearch.value = '';
  wtTaskSearch.placeholder = 'Loading tasks...';
  wtTaskSearch.disabled = true;
  wtTaskList.innerHTML = '';
  wtTaskList.classList.remove('open');
  wtTaskDescRow.style.display = 'none';
  wtTaskDesc.value = '';

  wtDialogOverlay.classList.add('visible');

  const repoName = groupEl.dataset.repoName;
  const stateCache = getCachedBranchesFromState(repoName);
  if (stateCache.length > 0) applyBranches(stateCache);

  const [cached, user] = await Promise.all([
    window.reposAPI.cachedBranches(groupEl._barePath),
    window.reposAPI.gitUser(groupEl._barePath)
  ]);
  wtGitUser = user || 'user';

  if (cached.length > 0 && stateCache.length === 0) applyBranches(cached);

  window.reposAPI.fetchBranches(groupEl._barePath).then((fetched) => {
    if (!wtDialogOverlay.classList.contains('visible')) return;
    if (wtCurrentGroupEl !== groupEl) return;
    applyBranches(fetched);
    saveBranchCache(repoName, fetched);
    if (wtBranchList.classList.contains('open')) renderBranchList(wtBranchSearch.value);
  });

  fetchTasksForDialog(groupEl._barePath);
}

export function hideWorktreeDialog() {
  wtDialogOverlay.classList.remove('visible');
  wtBranchList.classList.remove('open');
  wtTaskList.classList.remove('open');
  wtTaskDescRow.style.display = 'none';
  wtTaskTypeRow.style.display = 'none';
  wtTaskDesc.value = '';
}

export async function confirmCreateWorktree() {
  if (!wtSelectedBranch || !wtNameInput.value.trim()) return;

  const isNewTask = !wtSelectedTask && wtTaskSearch.value.trim().length > 0;
  if (isNewTask) {
    if (!wtAzureContext) { alert('Azure DevOps connection not available. Cannot create task.'); return; }
    const taskTitle = wtTaskSearch.value.trim();
    const taskDescription = wtTaskDesc.value.trim();
    const workItemType = wtTaskType.value || 'Story';
    try {
      wtSelectedTask = await createAzureWorkItem(wtAzureContext, workItemType, taskTitle, taskDescription);
      window.shellAPI.openExternal(buildAzureTaskUrl(wtAzureContext, wtSelectedTask.id));
    } catch (err) { alert(`Failed to create task: ${err.message}`); return; }
  }

  const name = wtNameInput.value.trim();
  const { dirName, branchName } = buildWtNames(name);
  const groupEl = wtCurrentGroupEl;
  const tabsEl = wtCurrentTabsEl;
  const taskId = wtSelectedTask ? wtSelectedTask.id : null;

  hideWorktreeDialog();

  showTerminal(`Creating worktree: ${branchName}`);
  const xterm = createTerminal();

  window.worktreeAPI.removeListeners();
  window.worktreeAPI.onData((data) => { xterm.write(data); });

  const sourceBranch = wtSelectedBranch;
  window.worktreeAPI.onExit(({ exitCode, wtPath, branchName: branch, dirName: dir }) => {
    if (exitCode === 0) {
      xterm.writeln('');
      xterm.writeln('\x1b[32mWorktree created successfully!\x1b[0m');
      const wt = { path: wtPath, branch, name: dir, sourceBranch, taskId };
      saveSourceBranch(wtPath, sourceBranch);
      if (taskId) saveTaskId(wtPath, taskId);
      const tabEl = _createWorktreeTab(wt);
      tabsEl.appendChild(tabEl);
      if (_rebuildCollapsedDots) _rebuildCollapsedDots();
      setTimeout(async () => {
        closeTerminal();
        try { await openWorktree(tabEl, wt); } catch (err) { alert(`Worktree created but failed to open: ${err.message || err}`); }
      }, 800);
    } else {
      xterm.writeln('');
      xterm.writeln(`\x1b[31mWorktree creation failed with exit code ${exitCode}\x1b[0m`);
      setTitle(`Worktree creation failed`);
      showCloseButton();
    }
  });

  try {
    await window.worktreeAPI.start({ barePath: groupEl._barePath, repoDir: groupEl._repoDir, branchName, dirName, sourceBranch: wtSelectedBranch });
    window.worktreeAPI.ready();
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle(`Worktree creation failed`);
    showCloseButton();
  }
}

// Event listeners
wtBranchSearch.addEventListener('input', () => { wtSelectedBranch = null; wtHighlightIndex = -1; renderBranchList(wtBranchSearch.value); });
wtBranchSearch.addEventListener('focus', () => { wtBranchSearch.value = ''; wtHighlightIndex = -1; renderBranchList(''); });
wtBranchSearch.addEventListener('blur', () => { setTimeout(() => { wtBranchList.classList.remove('open'); if (wtSelectedBranch) wtBranchSearch.value = wtSelectedBranch; }, 200); });

document.querySelector('#worktree-dialog-overlay .combobox-arrow').addEventListener('click', () => {
  if (wtBranchList.classList.contains('open')) { wtBranchList.classList.remove('open'); }
  else { wtBranchSearch.value = ''; wtHighlightIndex = -1; renderBranchList(''); wtBranchSearch.focus(); }
});

wtBranchSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideWorktreeDialog(); return; }
  const filtered = getFilteredBranches();
  if (e.key === 'ArrowDown') { e.preventDefault(); wtHighlightIndex = Math.min(wtHighlightIndex + 1, filtered.length - 1); renderBranchList(wtBranchSearch.value); scrollHighlightedIntoView(wtBranchList); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); wtHighlightIndex = Math.max(wtHighlightIndex - 1, 0); renderBranchList(wtBranchSearch.value); scrollHighlightedIntoView(wtBranchList); }
  else if (e.key === 'Enter' && wtHighlightIndex >= 0 && wtHighlightIndex < filtered.length) { e.preventDefault(); selectWtBranch(filtered[wtHighlightIndex]); wtTaskSearch.focus(); }
});

wtNameInput.addEventListener('input', updateWtPreview);
wtNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmCreateWorktree(); if (e.key === 'Escape') hideWorktreeDialog(); });

wtTaskSearch.addEventListener('input', () => {
  wtSelectedTask = null; wtTaskHighlightIndex = -1; renderTaskList(wtTaskSearch.value); updateTaskDescVisibility();
  const typed = wtTaskSearch.value.trim();
  if (typed) { wtNameInput.value = truncateToWords(typed, 40); updateWtPreview(); }
});
wtTaskSearch.addEventListener('focus', () => { if (wtAllTasks.length > 0) { wtTaskHighlightIndex = -1; renderTaskList(wtTaskSearch.value); } });
wtTaskSearch.addEventListener('blur', () => {
  setTimeout(() => {
    wtTaskList.classList.remove('open');
    if (wtSelectedTask) { wtTaskSearch.value = `#${wtSelectedTask.id} ${wtSelectedTask.title}`; }
    else if (wtTaskSearch.value.trim()) { wtNameInput.value = truncateToWords(wtTaskSearch.value.trim(), 40); updateWtPreview(); }
    updateTaskDescVisibility();
  }, 200);
});

document.querySelector('#wt-task-combobox .combobox-arrow').addEventListener('click', () => {
  if (wtTaskList.classList.contains('open')) { wtTaskList.classList.remove('open'); }
  else if (wtAllTasks.length > 0) { wtTaskSearch.value = ''; wtTaskHighlightIndex = -1; renderTaskList(''); wtTaskSearch.focus(); }
});

wtTaskSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideWorktreeDialog(); return; }
  const filtered = getFilteredTasks();
  if (e.key === 'ArrowDown') { e.preventDefault(); wtTaskHighlightIndex = Math.min(wtTaskHighlightIndex + 1, filtered.length - 1); renderTaskList(wtTaskSearch.value); scrollHighlightedIntoView(wtTaskList); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); wtTaskHighlightIndex = Math.max(wtTaskHighlightIndex - 1, 0); renderTaskList(wtTaskSearch.value); scrollHighlightedIntoView(wtTaskList); }
  else if (e.key === 'Enter' && wtTaskHighlightIndex >= 0 && wtTaskHighlightIndex < filtered.length) { e.preventDefault(); selectWtTask(filtered[wtTaskHighlightIndex]); wtBranchSearch.focus(); }
});

wtTaskDesc.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideWorktreeDialog(); });
wtDialogOverlay.addEventListener('click', (e) => { if (e.target === wtDialogOverlay) hideWorktreeDialog(); });
document.getElementById('wt-cancel-btn').addEventListener('click', hideWorktreeDialog);
document.getElementById('wt-confirm-btn').addEventListener('click', confirmCreateWorktree);
