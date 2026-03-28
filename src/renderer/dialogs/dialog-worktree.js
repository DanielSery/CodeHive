import { openWorktree } from '../workspace-manager.js';
import { createTerminal, showTerminal, showCloseButton, setTitle, closeTerminal } from '../terminal-panel.js';
import { getCachedBranchesFromState, saveBranchCache, saveSourceBranch, saveTaskId } from '../storage.js';
import { fetchAzureTasks, createAzureWorkItem, buildAzureTaskUrl, fetchWorkItemById, updateWorkItemState } from '../azure-api.js';
import { inferWorkItemType, sanitizePathPart, userToPrefix, nameToBranch, loadStoredPat, getCachedTasks, saveTaskCache, stripHtml } from './utils.js';
import { toast } from '../toast.js';
import { createCombobox } from './combobox.js';

const wtDialogOverlay = document.getElementById('worktree-dialog-overlay');
const wtTaskSearch = document.getElementById('wt-task-search');
const wtTaskList = document.getElementById('wt-task-list');
const wtTaskDescRow = document.getElementById('wt-task-desc-row');
const wtTaskDesc = document.getElementById('wt-task-desc');
const wtTaskTypeRow = document.getElementById('wt-task-type-row');
const wtTaskType = document.getElementById('wt-task-type');
const wtChangeName = document.getElementById('wt-change-name');
const wtBranchSearch = document.getElementById('wt-branch-search');
const wtBranchList = document.getElementById('wt-branch-list');
const wtTargetSearch = document.getElementById('wt-target-search');
const wtTargetList = document.getElementById('wt-target-list');
const wtPreview = document.getElementById('wt-preview');
const wtSkipTaskBtn = document.getElementById('wt-skip-task-btn');
const wtConfirmBtn = document.getElementById('wt-confirm-btn');

let wtCurrentGroupEl = null;
let wtCurrentTabsEl = null;
let wtGitUser = '';
let wtSelectedTask = null;
let wtAzureContext = null;
let wtFetchByIdTimer = null;
let wtChangeNameEdited = false;
let wtSelectedBranch = null;
let wtSelectedTarget = null;

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
  let result;
  if (wtSelectedTask) {
    const namePart = sanitizePathPart(name).trim().replace(/\s+/g, '-');
    result = `${userToPrefix(wtGitUser)}/${wtSelectedTask.id}-${namePart}`;
  } else {
    result = nameToBranch(wtGitUser, name);
  }
  return result.substring(0, 30).replace(/-+$/, '');
}

function updateTargetFromTask() {
  const name = wtChangeName.value.trim() || getTaskName();
  if (!name) return;
  const target = buildTargetFromTask(name);
  wtTargetSearch.value = target;
  wtSelectedTarget = null;
  updateWtPreview();
}

function syncChangeNameFromTask() {
  if (wtChangeNameEdited) return;
  wtChangeName.value = getTaskName();
}

function getDirName() {
  const target = wtSelectedTarget || wtTargetSearch.value.trim();
  if (!target) return '';
  const parts = target.split('/');
  const last = parts[parts.length - 1];
  return last.substring(0, 15);
}

function updateWtPreview() {
  const target = wtSelectedTarget || wtTargetSearch.value.trim();
  if (!target || !wtSelectedBranch) { wtPreview.textContent = ''; return; }
  const dir = getDirName();
  wtPreview.textContent = `Dir: ${dir}`;
  updateConfirmState();
}

function updateConfirmState() {
  const target = wtSelectedTarget || wtTargetSearch.value.trim();
  wtConfirmBtn.disabled = !wtSelectedBranch || !target;
}

// --- Task combobox ---

function renderTaskItem(el, t) {
  const titleLine = document.createElement('div');
  titleLine.textContent = `#${t.id} ${t.title}`;
  el.appendChild(titleLine);
  if (t.description) {
    const desc = stripHtml(t.description).substring(0, 300);
    if (desc) {
      const descLine = document.createElement('div');
      descLine.className = 'combobox-item-desc';
      descLine.textContent = desc;
      el.appendChild(descLine);
    }
  }
}

const taskCombobox = createCombobox({
  inputEl: wtTaskSearch,
  listEl: wtTaskList,
  arrowSelector: '#wt-task-combobox .combobox-arrow',
  onHide: () => hideWorktreeDialog(),
  getLabel: (t) => `#${t.id} ${t.title}`,
  isSelected: (t) => wtSelectedTask && t.id === wtSelectedTask.id,
  renderItemContent: renderTaskItem,
  onSelect: (task) => selectWtTask(task),
  onEnterMatch: (task) => { selectWtTask(task); wtChangeName.focus(); },
  onInput: () => {
    wtSelectedTask = null;
    updateNewTaskFields();
    const typed = wtTaskSearch.value.trim();
    syncChangeNameFromTask();
    if (typed) updateTargetFromTask();

    // Fallback: if query looks like an ID and no matches found, fetch directly
    clearTimeout(wtFetchByIdTimer);
    const idMatch = typed.match(/^#?(\d+)$/);
    if (idMatch && wtAzureContext && taskCombobox.getFiltered().length === 0) {
      const numId = parseInt(idMatch[1], 10);
      wtFetchByIdTimer = setTimeout(async () => {
        if (wtTaskSearch.value.trim() !== typed) return;
        const found = await fetchWorkItemById(wtAzureContext, numId);
        if (!found) return;
        if (wtTaskSearch.value.trim() !== typed) return;
        const allTasks = taskCombobox.getItems();
        if (!allTasks.some(t => t.id === found.id)) taskCombobox.setItems([found, ...allTasks]);
        taskCombobox.render(wtTaskSearch.value);
      }, 400);
    }
  },
  onBlur: () => {
    if (wtSelectedTask) { wtTaskSearch.value = `#${wtSelectedTask.id} ${wtSelectedTask.title}`; }
    updateNewTaskFields();
  },
  openOnFocus: true,
});

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
  taskCombobox.close();
  if (task) {
    wtChangeNameEdited = false;
    wtChangeName.value = task.title;
    updateTargetFromTask();
  }
  updateNewTaskFields();
}

function applyWtTasks(tasks, azureContext, focusTaskSearch) {
  wtAzureContext = azureContext;
  taskCombobox.setItems(tasks);
  wtTaskSearch.placeholder = tasks.length === 0 ? 'No active tasks found' : 'Search or type new task...';
  wtTaskSearch.disabled = false;
  focusTaskSearch();
}

async function fetchTasksForDialog(barePath) {
  const focusTaskSearch = () => { if (wtDialogOverlay.classList.contains('visible')) wtTaskSearch.focus(); };
  const pat = await loadStoredPat();

  const cached = getCachedTasks(barePath);
  if (cached) applyWtTasks(cached.tasks, cached.azureContext, focusTaskSearch);

  const result = await fetchAzureTasks(barePath, pat);
  if (result.error === 'no-pat') { if (!cached) { wtTaskSearch.placeholder = 'Configure PAT to load tasks'; wtTaskSearch.disabled = false; focusTaskSearch(); } return; }
  if (result.error === 'not-azure') { if (!cached) { wtTaskSearch.placeholder = 'Not an Azure DevOps repository'; wtTaskSearch.disabled = false; focusTaskSearch(); } return; }
  if (result.error) { if (!cached) { wtTaskSearch.placeholder = 'Could not load tasks'; wtTaskSearch.disabled = false; focusTaskSearch(); } return; }
  saveTaskCache(barePath, { tasks: result.tasks, azureContext: result.azureContext });
  applyWtTasks(result.tasks, result.azureContext, focusTaskSearch);
}

// --- Source branch combobox ---

const sourceBranchCombobox = createCombobox({
  inputEl: wtBranchSearch,
  listEl: wtBranchList,
  arrowSelector: '#wt-source-combobox .combobox-arrow',
  onHide: () => hideWorktreeDialog(),
  getLabel: (b) => b,
  isSelected: (b) => b === wtSelectedBranch,
  dashForSpace: true,
  onSelect: (b) => {
    wtSelectedBranch = b;
    wtBranchSearch.value = b;
    updateWtPreview();
  },
  onEnterMatch: (b) => {
    wtSelectedBranch = b;
    wtBranchSearch.value = b;
    sourceBranchCombobox.close();
    updateWtPreview();
    wtTargetSearch.focus();
  },
  onInput: () => { wtSelectedBranch = null; updateConfirmState(); },
  onBlur: () => { if (wtSelectedBranch) wtBranchSearch.value = wtSelectedBranch; },
});

// --- Target branch combobox ---

const targetBranchCombobox = createCombobox({
  inputEl: wtTargetSearch,
  listEl: wtTargetList,
  arrowSelector: '#wt-target-combobox .combobox-arrow',
  onHide: () => hideWorktreeDialog(),
  getLabel: (b) => b,
  isSelected: (b) => b === wtSelectedTarget,
  dashForSpace: true,
  onSelect: (b) => {
    wtSelectedTarget = b;
    wtTargetSearch.value = b;
    updateWtPreview();
  },
  onEnterMatch: (b) => {
    wtSelectedTarget = b;
    wtTargetSearch.value = b;
    targetBranchCombobox.close();
    updateWtPreview();
  },
  onEnterNoMatch: () => confirmCreateWorktree(),
  onInput: () => { wtSelectedTarget = null; updateWtPreview(); },
  onBlur: () => {
    if (wtSelectedTarget) wtTargetSearch.value = wtSelectedTarget;
    updateWtPreview();
  },
});

function applyBranches(branches) {
  sourceBranchCombobox.setItems(branches);
  targetBranchCombobox.setItems(branches);
  const defaultBranch = branches.includes('develop') ? 'develop' : ['master', 'main'].find(b => branches.includes(b));
  if (!wtSelectedBranch && defaultBranch) { wtSelectedBranch = defaultBranch; wtBranchSearch.value = defaultBranch; }
  wtBranchSearch.placeholder = 'Search branches...';
  wtBranchSearch.disabled = false;
  updateConfirmState();
}

// --- Dialog show/hide/confirm ---

export async function showWorktreeDialog(groupEl, tabsEl) {
  // Reset all state
  wtCurrentGroupEl = groupEl;
  wtCurrentTabsEl = tabsEl;
  wtSelectedBranch = null;
  wtSelectedTarget = null;
  wtSelectedTask = null;
  wtAzureContext = null;
  wtChangeNameEdited = false;
  clearTimeout(wtFetchByIdTimer);

  wtBranchSearch.value = '';
  wtBranchSearch.placeholder = 'Fetching branches...';
  wtBranchSearch.disabled = true;
  wtTargetSearch.value = '';
  wtPreview.textContent = '';
  wtTaskSearch.value = '';
  wtTaskSearch.placeholder = 'Loading tasks...';
  wtTaskSearch.disabled = true;
  wtTaskDescRow.style.display = 'none';
  wtTaskDesc.value = '';
  wtTaskTypeRow.style.display = 'none';
  wtChangeName.value = '';
  wtConfirmBtn.disabled = true;

  sourceBranchCombobox.setItems([]);
  sourceBranchCombobox.close();
  targetBranchCombobox.setItems([]);
  targetBranchCombobox.close();
  taskCombobox.setItems([]);
  taskCombobox.close();

  wtDialogOverlay.classList.add('visible');

  const repoName = groupEl.dataset.repoName;
  const stateCache = getCachedBranchesFromState(repoName);
  if (stateCache.length > 0) applyBranches(stateCache);

  const [cachedResult, user] = await Promise.all([
    window.reposAPI.cachedBranches(groupEl._barePath),
    window.reposAPI.gitUser(groupEl._barePath)
  ]);
  const cached = cachedResult.value;
  wtGitUser = user || 'user';

  if (cached.length > 0 && stateCache.length === 0) applyBranches(cached);

  window.reposAPI.fetchBranches(groupEl._barePath).then((fetchResult) => {
    const fetched = fetchResult.value;
    if (!wtDialogOverlay.classList.contains('visible')) return;
    if (wtCurrentGroupEl !== groupEl) return;
    applyBranches(fetched);
    saveBranchCache(repoName, fetched);
    if (wtBranchList.classList.contains('open')) sourceBranchCombobox.render(wtBranchSearch.value);
    if (wtTargetList.classList.contains('open')) targetBranchCombobox.render(wtTargetSearch.value);
  });

  fetchTasksForDialog(groupEl._barePath);
}

export function hideWorktreeDialog() {
  wtDialogOverlay.classList.remove('visible');
  sourceBranchCombobox.close();
  targetBranchCombobox.close();
  taskCombobox.close();
  wtTaskDescRow.style.display = 'none';
  wtTaskTypeRow.style.display = 'none';
  wtTaskDesc.value = '';
  clearTimeout(wtFetchByIdTimer);
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
    } catch (err) { toast.error(`Failed to create task: ${err.message}`); return; }
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
      setTitle('Worktree created');
      const wt = { path: wtPath, branch, name: dir, sourceBranch, taskId };
      saveSourceBranch(wtPath, sourceBranch);
      if (taskId) saveTaskId(wtPath, taskId);
      const tabEl = _createWorktreeTab(wt);
      tabsEl.appendChild(tabEl);
      if (_rebuildCollapsedDots) _rebuildCollapsedDots();
      setTimeout(async () => {
        closeTerminal();
        try { await openWorktree(tabEl, wt); } catch (err) { toast.error(`Worktree created but failed to open: ${err.message || err}`); }
      }, 800);
    } else {
      xterm.writeln('');
      xterm.writeln(`\x1b[31mWorktree creation failed with exit code ${exitCode}\x1b[0m`);
      setTitle('Worktree creation failed');
      toast.error('Worktree creation failed — see terminal');
      showCloseButton();
    }
  });

  try {
    await window.worktreeAPI.start({ barePath: groupEl._barePath, repoDir: groupEl._repoDir, branchName, dirName, sourceBranch: wtSelectedBranch });
    window.worktreeAPI.ready();
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle('Worktree creation failed');
    toast.error('Worktree creation failed — see terminal');
    showCloseButton();
  }
}

// --- Event listeners: Change name ---

wtChangeName.addEventListener('focus', () => { wtChangeName.select(); });
wtChangeName.addEventListener('input', () => {
  wtChangeNameEdited = true;
  updateTargetFromTask();
});
wtChangeName.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideWorktreeDialog(); });

// --- Event listeners: Task description ---

wtTaskDesc.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideWorktreeDialog(); });

// --- Dialog buttons ---

document.getElementById('wt-cancel-btn').addEventListener('click', hideWorktreeDialog);
wtSkipTaskBtn.addEventListener('click', () => { wtSelectedTask = null; wtTaskSearch.value = ''; updateNewTaskFields(); confirmCreateWorktree(); });
wtConfirmBtn.addEventListener('click', confirmCreateWorktree);
