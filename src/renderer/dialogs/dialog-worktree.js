import { openWorktree } from '../workspace-manager.js';
import { createTerminal, showTerminal, showCloseButton, setTitle, closeTerminal } from '../terminal-panel.js';
import { getCachedBranchesFromState, saveBranchCache, saveSourceBranch, saveTaskId } from '../storage.js';
import { fetchAzureTasks, createAzureWorkItem, buildAzureTaskUrl, fetchWorkItemById, updateWorkItemState } from '../azure-api.js';
import { inferWorkItemType, sanitizePathPart, userToPrefix, nameToBranch, loadStoredPat, fuzzyMatch, fuzzyScore, getCachedTasks, saveTaskCache } from './utils.js';

const wtDialogOverlay = document.getElementById('worktree-dialog-overlay');

export function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
const wtTaskSearch = document.getElementById('wt-task-search');
const wtTaskList = document.getElementById('wt-task-list');
const wtTaskDescRow = document.getElementById('wt-task-desc-row');
const wtTaskDesc = document.getElementById('wt-task-desc');
const wtTaskTypeRow = document.getElementById('wt-task-type-row');
const wtTaskType = document.getElementById('wt-task-type');
const wtBranchSearch = document.getElementById('wt-branch-search');
const wtBranchList = document.getElementById('wt-branch-list');
const wtTargetSearch = document.getElementById('wt-target-search');
const wtTargetList = document.getElementById('wt-target-list');
const wtPreview = document.getElementById('wt-preview');
const wtSkipTaskBtn = document.getElementById('wt-skip-task-btn');

let wtAllBranches = [];
let wtSelectedBranch = null;
let wtHighlightIndex = -1;
let wtCurrentGroupEl = null;
let wtCurrentTabsEl = null;
let wtGitUser = '';
let wtAllTasks = [];
let wtSelectedTask = null;
let wtTaskHighlightIndex = -1;
let wtAzureContext = null;
let wtTargetHighlightIndex = -1;
let wtSelectedTarget = null;
let wtFetchByIdTimer = null;

// Injected by index.js
let _createWorktreeTab = null;
let _rebuildCollapsedDots = null;

export function registerWorktreeSidebarFns(createWorktreeTab, rebuildCollapsedDots) {
  _createWorktreeTab = createWorktreeTab;
  _rebuildCollapsedDots = rebuildCollapsedDots;
}

// --- Target branch helpers ---

function getTaskName() {
  if (wtSelectedTask) return wtSelectedTask.title;
  return wtTaskSearch.value.trim();
}

function buildTargetFromTask(name) {
  if (!name) return '';
  if (wtSelectedTask) {
    const namePart = sanitizePathPart(name).trim().replace(/\s+/g, '-');
    return `${userToPrefix(wtGitUser)}/${wtSelectedTask.id}-${namePart}`;
  }
  return nameToBranch(wtGitUser, name);
}

function updateTargetFromTask() {
  const name = getTaskName();
  if (!name) return;
  const target = buildTargetFromTask(name);
  wtTargetSearch.value = target;
  wtSelectedTarget = null;
  updateWtPreview();
}

function getDirName() {
  const target = wtSelectedTarget || wtTargetSearch.value.trim();
  if (!target) return '';
  // Use last segment after '/' as base, truncate to 15 chars
  const parts = target.split('/');
  const last = parts[parts.length - 1];
  return last.substring(0, 15);
}

function updateWtPreview() {
  const target = wtSelectedTarget || wtTargetSearch.value.trim();
  if (!target || !wtSelectedBranch) { wtPreview.textContent = ''; return; }
  const dir = getDirName();
  wtPreview.textContent = `Dir: ${dir}`;
}

// --- Task combobox ---

function getFilteredTasks() {
  const q = (wtTaskSearch.value || '').toLowerCase();
  return wtAllTasks.filter(t => fuzzyMatch(`#${t.id} ${t.title}`, q)).sort((a, b) => fuzzyScore(`#${b.id} ${b.title}`, q) - fuzzyScore(`#${a.id} ${a.title}`, q));
}

function renderTaskList(filter) {
  wtTaskList.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const filtered = wtAllTasks.filter(t => fuzzyMatch(`#${t.id} ${t.title}`, q)).sort((a, b) => fuzzyScore(`#${b.id} ${b.title}`, q) - fuzzyScore(`#${a.id} ${a.title}`, q));
  if (filtered.length === 0) { wtTaskList.classList.remove('open'); wtTaskHighlightIndex = -1; return; }
  filtered.forEach((t, i) => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    if (wtSelectedTask && t.id === wtSelectedTask.id) item.classList.add('selected');
    if (i === wtTaskHighlightIndex) item.classList.add('highlighted');
    const titleLine = document.createElement('div');
    titleLine.textContent = `#${t.id} ${t.title}`;
    item.appendChild(titleLine);
    if (t.description) {
      const desc = stripHtml(t.description).substring(0, 300);
      if (desc) {
        const descLine = document.createElement('div');
        descLine.className = 'combobox-item-desc';
        descLine.textContent = desc;
        item.appendChild(descLine);
      }
    }
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectWtTask(t); });
    wtTaskList.appendChild(item);
  });
  wtTaskList.classList.add('open');
}

function updateNewTaskFields() {
  const isNewTask = !wtSelectedTask && wtTaskSearch.value.trim().length > 0;
  wtTaskDescRow.style.display = isNewTask ? '' : 'none';
  wtTaskTypeRow.style.display = isNewTask ? '' : 'none';
  if (isNewTask) wtTaskType.value = inferWorkItemType(wtTaskSearch.value.trim());
  wtSkipTaskBtn.style.display = (isNewTask && wtAzureContext) ? '' : 'none';
}

function selectWtTask(task) {
  wtSelectedTask = task;
  wtTaskSearch.value = task ? `#${task.id} ${task.title}` : '';
  wtTaskList.classList.remove('open');
  wtTaskHighlightIndex = -1;
  if (task) updateTargetFromTask();
  updateNewTaskFields();
}

function applyWtTasks(tasks, azureContext, focusTaskSearch) {
  wtAzureContext = azureContext;
  wtAllTasks = tasks;
  wtTaskSearch.placeholder = tasks.length === 0 ? 'No active tasks found' : 'Search or type new task...';
  wtTaskSearch.disabled = false;
  focusTaskSearch();
}

async function fetchTasksForDialog(barePath) {
  const focusTaskSearch = () => { if (wtDialogOverlay.classList.contains('visible')) wtTaskSearch.focus(); };
  const pat = loadStoredPat();

  // Apply caches immediately
  const cached = getCachedTasks(barePath);
  if (cached) applyWtTasks(cached.tasks, cached.azureContext, focusTaskSearch);

  // Always refresh in background
  const result = await fetchAzureTasks(barePath, pat);
  if (result.error === 'no-pat') { if (!cached) { wtTaskSearch.placeholder = 'Configure PAT to load tasks'; wtTaskSearch.disabled = false; focusTaskSearch(); } return; }
  if (result.error === 'not-azure') { if (!cached) { wtTaskSearch.placeholder = 'Not an Azure DevOps repository'; wtTaskSearch.disabled = false; focusTaskSearch(); } return; }
  if (result.error) { if (!cached) { wtTaskSearch.placeholder = 'Could not load tasks'; wtTaskSearch.disabled = false; focusTaskSearch(); } return; }
  saveTaskCache(barePath, { tasks: result.tasks, azureContext: result.azureContext });
  applyWtTasks(result.tasks, result.azureContext, focusTaskSearch);
}

// --- Source branch combobox ---

function getFilteredBranches() {
  const q = (wtBranchSearch.value || '').toLowerCase();
  return wtAllBranches.filter(b => fuzzyMatch(b, q)).sort((a, b) => fuzzyScore(b, q) - fuzzyScore(a, q));
}

function renderBranchList(filter) {
  wtBranchList.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const filtered = wtAllBranches.filter(b => fuzzyMatch(b, q)).sort((a, b) => fuzzyScore(b, q) - fuzzyScore(a, q));
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

function insertDashForSpace(e) {
  if (e.key !== ' ') return false;
  e.preventDefault();
  const input = e.target;
  const s = input.selectionStart, end = input.selectionEnd;
  input.value = input.value.substring(0, s) + '-' + input.value.substring(end);
  input.selectionStart = input.selectionEnd = s + 1;
  input.dispatchEvent(new Event('input'));
  return true;
}

function applyBranches(branches) {
  wtAllBranches = branches;
  const defaultBranch = branches.includes('develop') ? 'develop' : ['master', 'main'].find(b => branches.includes(b));
  if (!wtSelectedBranch && defaultBranch) { wtSelectedBranch = defaultBranch; wtBranchSearch.value = defaultBranch; }
  wtBranchSearch.placeholder = 'Search branches...';
  wtBranchSearch.disabled = false;
}

// --- Target branch combobox ---

function getFilteredTargets() {
  const q = (wtTargetSearch.value || '').toLowerCase();
  return wtAllBranches.filter(b => fuzzyMatch(b, q)).sort((a, b) => fuzzyScore(b, q) - fuzzyScore(a, q));
}

function renderTargetList(filter) {
  wtTargetList.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const filtered = wtAllBranches.filter(b => fuzzyMatch(b, q)).sort((a, b) => fuzzyScore(b, q) - fuzzyScore(a, q));
  if (filtered.length === 0) { wtTargetList.classList.remove('open'); wtTargetHighlightIndex = -1; return; }
  filtered.forEach((b, i) => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    if (b === wtSelectedTarget) item.classList.add('selected');
    if (i === wtTargetHighlightIndex) item.classList.add('highlighted');
    item.textContent = b;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectWtTarget(b); });
    wtTargetList.appendChild(item);
  });
  wtTargetList.classList.add('open');
}

function selectWtTarget(b) {
  wtSelectedTarget = b;
  wtTargetSearch.value = b;
  wtTargetList.classList.remove('open');
  wtTargetHighlightIndex = -1;
  updateWtPreview();
}

// --- Dialog show/hide/confirm ---

export async function showWorktreeDialog(groupEl, tabsEl) {
  wtCurrentGroupEl = groupEl;
  wtCurrentTabsEl = tabsEl;
  wtSelectedBranch = null;
  wtAllBranches = [];
  wtBranchSearch.value = '';
  wtBranchSearch.placeholder = 'Fetching branches...';
  wtBranchSearch.disabled = true;
  wtTargetSearch.value = '';
  wtTargetList.innerHTML = '';
  wtTargetList.classList.remove('open');
  wtSelectedTarget = null;
  wtPreview.textContent = '';
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
  wtTaskTypeRow.style.display = 'none';

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
    if (wtTargetList.classList.contains('open')) renderTargetList(wtTargetSearch.value);
  });

  fetchTasksForDialog(groupEl._barePath);
}

export function hideWorktreeDialog() {
  wtDialogOverlay.classList.remove('visible');
  wtBranchList.classList.remove('open');
  wtTaskList.classList.remove('open');
  wtTargetList.classList.remove('open');
  wtTaskDescRow.style.display = 'none';
  wtTaskTypeRow.style.display = 'none';
  wtTaskDesc.value = '';
}

export async function confirmCreateWorktree() {
  const targetBranch = wtSelectedTarget || wtTargetSearch.value.trim();
  if (!wtSelectedBranch) return;
  if (!targetBranch) { wtTargetSearch.focus(); return; }

  const isNewTask = !wtSelectedTask && wtTaskSearch.value.trim().length > 0;
  if (isNewTask && wtAzureContext) {
    const taskTitle = wtTaskSearch.value.trim();
    const taskDescription = wtTaskDesc.value.trim();
    const workItemType = wtTaskType.value || 'User Story';
    try {
      wtSelectedTask = await createAzureWorkItem(wtAzureContext, workItemType, taskTitle, taskDescription, null);
      window.shellAPI.openExternal(buildAzureTaskUrl(wtAzureContext, wtSelectedTask.id));
    } catch (err) { alert(`Failed to create task: ${err.message}`); return; }
  }

  if (wtSelectedTask && wtAzureContext) {
    updateWorkItemState(wtAzureContext, wtSelectedTask.id, 'Active');
  }

  const branchName = targetBranch;
  const dirName = getDirName();
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

// --- Event listeners: Task ---

wtTaskSearch.addEventListener('input', () => {
  wtSelectedTask = null; wtTaskHighlightIndex = wtTaskSearch.value.trim() ? 0 : -1; renderTaskList(wtTaskSearch.value); updateNewTaskFields();
  const typed = wtTaskSearch.value.trim();
  if (typed) updateTargetFromTask();
  // Fallback: if query looks like an ID and no matches found, fetch directly
  clearTimeout(wtFetchByIdTimer);
  const idMatch = typed.match(/^#?(\d+)$/);
  if (idMatch && wtAzureContext && getFilteredTasks().length === 0) {
    const numId = parseInt(idMatch[1], 10);
    wtFetchByIdTimer = setTimeout(async () => {
      if (wtTaskSearch.value.trim() !== typed) return;
      const found = await fetchWorkItemById(wtAzureContext, numId);
      if (!found) return;
      if (wtTaskSearch.value.trim() !== typed) return;
      if (!wtAllTasks.some(t => t.id === found.id)) wtAllTasks = [found, ...wtAllTasks];
      renderTaskList(wtTaskSearch.value);
    }, 400);
  }
});
wtTaskSearch.addEventListener('focus', () => { if (wtAllTasks.length > 0) { wtTaskHighlightIndex = -1; renderTaskList(wtTaskSearch.value); } });
wtTaskSearch.addEventListener('blur', () => {
  setTimeout(() => {
    wtTaskList.classList.remove('open');
    if (wtSelectedTask) { wtTaskSearch.value = `#${wtSelectedTask.id} ${wtSelectedTask.title}`; }
    updateNewTaskFields();
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
  else if (e.key === 'Tab' && !e.shiftKey) { /* natural tab to next field */ }
});

// --- Event listeners: Task description ---

wtTaskDesc.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideWorktreeDialog(); });

// --- Event listeners: Source branch ---

wtBranchSearch.addEventListener('input', () => { wtSelectedBranch = null; wtHighlightIndex = wtBranchSearch.value.trim() ? 0 : -1; renderBranchList(wtBranchSearch.value); });
wtBranchSearch.addEventListener('focus', () => { wtBranchSearch.value = ''; wtHighlightIndex = -1; renderBranchList(''); });
wtBranchSearch.addEventListener('blur', () => { setTimeout(() => { wtBranchList.classList.remove('open'); if (wtSelectedBranch) wtBranchSearch.value = wtSelectedBranch; }, 200); });

document.querySelector('#wt-source-combobox .combobox-arrow').addEventListener('click', () => {
  if (wtBranchList.classList.contains('open')) { wtBranchList.classList.remove('open'); }
  else { wtBranchSearch.value = ''; wtHighlightIndex = -1; renderBranchList(''); wtBranchSearch.focus(); }
});

wtBranchSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideWorktreeDialog(); return; }
  if (insertDashForSpace(e)) return;
  const filtered = getFilteredBranches();
  if (e.key === 'ArrowDown') { e.preventDefault(); wtHighlightIndex = Math.min(wtHighlightIndex + 1, filtered.length - 1); renderBranchList(wtBranchSearch.value); scrollHighlightedIntoView(wtBranchList); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); wtHighlightIndex = Math.max(wtHighlightIndex - 1, 0); renderBranchList(wtBranchSearch.value); scrollHighlightedIntoView(wtBranchList); }
  else if (e.key === 'Enter' && wtHighlightIndex >= 0 && wtHighlightIndex < filtered.length) { e.preventDefault(); selectWtBranch(filtered[wtHighlightIndex]); wtTargetSearch.focus(); }
});

// --- Event listeners: Target branch ---

wtTargetSearch.addEventListener('input', () => { wtSelectedTarget = null; wtTargetHighlightIndex = wtTargetSearch.value.trim() ? 0 : -1; renderTargetList(wtTargetSearch.value); updateWtPreview(); });
wtTargetSearch.addEventListener('focus', () => { wtTargetHighlightIndex = -1; renderTargetList(wtTargetSearch.value); });
wtTargetSearch.addEventListener('blur', () => {
  setTimeout(() => {
    wtTargetList.classList.remove('open');
    if (wtSelectedTarget) wtTargetSearch.value = wtSelectedTarget;
    updateWtPreview();
  }, 200);
});

document.querySelector('#wt-target-combobox .combobox-arrow').addEventListener('click', () => {
  if (wtTargetList.classList.contains('open')) { wtTargetList.classList.remove('open'); }
  else { wtTargetSearch.value = ''; wtTargetHighlightIndex = -1; renderTargetList(''); wtTargetSearch.focus(); }
});

wtTargetSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideWorktreeDialog(); return; }
  if (insertDashForSpace(e)) return;
  const filtered = getFilteredTargets();
  if (e.key === 'ArrowDown') { e.preventDefault(); wtTargetHighlightIndex = Math.min(wtTargetHighlightIndex + 1, filtered.length - 1); renderTargetList(wtTargetSearch.value); scrollHighlightedIntoView(wtTargetList); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); wtTargetHighlightIndex = Math.max(wtTargetHighlightIndex - 1, 0); renderTargetList(wtTargetSearch.value); scrollHighlightedIntoView(wtTargetList); }
  else if (e.key === 'Enter') {
    if (wtTargetHighlightIndex >= 0 && wtTargetHighlightIndex < filtered.length) { e.preventDefault(); selectWtTarget(filtered[wtTargetHighlightIndex]); }
    else { e.preventDefault(); confirmCreateWorktree(); }
  }
});

// --- Dialog buttons ---

document.getElementById('wt-cancel-btn').addEventListener('click', hideWorktreeDialog);
wtSkipTaskBtn.addEventListener('click', () => { wtSelectedTask = null; wtTaskSearch.value = ''; updateNewTaskFields(); confirmCreateWorktree(); });
document.getElementById('wt-confirm-btn').addEventListener('click', confirmCreateWorktree);
