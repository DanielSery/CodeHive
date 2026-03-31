import { openWorktree } from '../workspace-manager.js';
import { createTerminal, showTerminal, showCloseButton, setTitle, closeTerminal } from '../terminal-panel.js';
import { getCachedBranchesFromState, saveBranchCache, saveSourceBranch, saveTaskId, saveDeleteBranchPref, getDeleteBranchPref } from '../storage.js';
import { fetchAzureTasks, createAzureWorkItem, buildAzureTaskUrl, fetchWorkItemById, updateWorkItemState } from '../azure-api.js';
import { inferWorkItemType, sanitizePathPart, userToPrefix, nameToBranch, loadStoredPat, getCachedTasks, saveTaskCache, stripHtml } from './utils.js';
import { toast } from '../toast.js';
import { createCombobox } from './combobox.js';

const wtSwitchDialogOverlay = document.getElementById('wt-switch-dialog-overlay');
const wtSwitchTaskSearch = document.getElementById('wt-switch-task-search');
const wtSwitchTaskList = document.getElementById('wt-switch-task-list');
const wtSwitchTaskDescRow = document.getElementById('wt-switch-task-desc-row');
const wtSwitchTaskDesc = document.getElementById('wt-switch-task-desc');
const wtSwitchTaskTypeRow = document.getElementById('wt-switch-task-type-row');
const wtSwitchTaskType = document.getElementById('wt-switch-task-type');
const wtSwitchChangeName = document.getElementById('wt-switch-change-name');
const wtSwitchBranchSearch = document.getElementById('wt-switch-branch-search');
const wtSwitchBranchList = document.getElementById('wt-switch-branch-list');
const wtSwitchTargetSearch = document.getElementById('wt-switch-target-search');
const wtSwitchTargetList = document.getElementById('wt-switch-target-list');
const wtSwitchPreview = document.getElementById('wt-switch-preview');
const wtSwitchSkipTaskBtn = document.getElementById('wt-switch-skip-task-btn');
const wtSwitchConfirmBtn = document.getElementById('wt-switch-confirm-btn');
const wtSwitchDeleteBranchCheckbox = document.getElementById('wt-switch-delete-branch');

let wtSwitchTabEl = null;
let wtSwitchGroupEl = null;
let wtSwitchCurrentBarePath = null;
let wtSwitchGitUser = '';
let wtSwitchSelectedTask = null;
let wtSwitchAzureContext = null;
let wtSwitchFetchByIdTimer = null;
let wtSwitchFetchRetryTimer = null;
let wtSwitchChangeNameEdited = false;
let wtSwitchSelectedBranch = null;
let wtSwitchSelectedTarget = null;

// Injected by index.js
let _createWorktreeTab = null;
let _rebuildCollapsedDots = null;

export function registerSwitchSidebarFns(createWorktreeTab, rebuildCollapsedDots) {
  _createWorktreeTab = createWorktreeTab;
  _rebuildCollapsedDots = rebuildCollapsedDots;
}

// --- Target branch helpers ---

function getTaskName() {
  if (wtSwitchSelectedTask) return wtSwitchSelectedTask.title;
  return wtSwitchTaskSearch.value.trim();
}

function buildTargetFromTask(name) {
  if (!name) return '';
  let result;
  if (wtSwitchSelectedTask) {
    const namePart = sanitizePathPart(name).trim().replace(/\s+/g, '-');
    result = `${userToPrefix(wtSwitchGitUser)}/${wtSwitchSelectedTask.id}-${namePart}`;
  } else {
    result = nameToBranch(wtSwitchGitUser, name);
  }
  return result.substring(0, 50).replace(/-+$/, '');
}

function updateTargetFromTask() {
  const name = wtSwitchChangeName.value.trim() || getTaskName();
  if (!name) return;
  const target = buildTargetFromTask(name);
  wtSwitchTargetSearch.value = target;
  wtSwitchSelectedTarget = null;
  updateWtSwitchPreview();
}

function syncSwitchChangeNameFromTask() {
  if (wtSwitchChangeNameEdited) return;
  wtSwitchChangeName.value = getTaskName();
}

function updateWtSwitchPreview() {
  wtSwitchPreview.textContent = '';
  updateConfirmState();
}

function updateConfirmState() {
  const target = wtSwitchSelectedTarget || wtSwitchTargetSearch.value.trim();
  wtSwitchConfirmBtn.disabled = !wtSwitchSelectedBranch || !target;
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
  inputEl: wtSwitchTaskSearch,
  listEl: wtSwitchTaskList,
  arrowSelector: '#wt-switch-task-combobox .combobox-arrow',
  onHide: () => hideWorktreeSwitchDialog(),
  getLabel: (t) => `#${t.id} ${t.title}`,
  isSelected: (t) => wtSwitchSelectedTask && t.id === wtSwitchSelectedTask.id,
  renderItemContent: renderTaskItem,
  onSelect: (task) => selectWtSwitchTask(task),
  onEnterMatch: (task) => { selectWtSwitchTask(task); wtSwitchChangeName.focus(); },
  onInput: () => {
    wtSwitchSelectedTask = null;
    updateSwitchNewTaskFields();
    const typed = wtSwitchTaskSearch.value.trim();
    syncSwitchChangeNameFromTask();
    if (typed) updateTargetFromTask();

    // Retry fetch if tasks haven't loaded yet
    clearTimeout(wtSwitchFetchRetryTimer);
    if (typed && !wtSwitchAzureContext && taskCombobox.getItems().length === 0) {
      wtSwitchFetchRetryTimer = setTimeout(() => {
        if (wtSwitchDialogOverlay.classList.contains('visible') && wtSwitchCurrentBarePath) fetchSwitchTasksForDialog(wtSwitchCurrentBarePath);
      }, 600);
    }

    clearTimeout(wtSwitchFetchByIdTimer);
    const idMatch = typed.match(/^#?(\d+)$/);
    if (idMatch && wtSwitchAzureContext) {
      const numId = parseInt(idMatch[1], 10);
      if (!taskCombobox.getFiltered().some(t => t.id === numId)) {
        wtSwitchFetchByIdTimer = setTimeout(async () => {
          if (wtSwitchTaskSearch.value.trim() !== typed) return;
          const found = await fetchWorkItemById(wtSwitchAzureContext, numId);
          if (!found) return;
          if (wtSwitchTaskSearch.value.trim() !== typed) return;
          const allTasks = taskCombobox.getItems();
          if (!allTasks.some(t => t.id === found.id)) taskCombobox.setItems([found, ...allTasks]);
          taskCombobox.render(wtSwitchTaskSearch.value);
        }, 400);
      }
    }
  },
  onBlur: () => {
    if (wtSwitchSelectedTask) { wtSwitchTaskSearch.value = `#${wtSwitchSelectedTask.id} ${wtSwitchSelectedTask.title}`; }
    updateSwitchNewTaskFields();
  },
  openOnFocus: true,
});

function updateSwitchNewTaskFields() {
  const isNewTask = !wtSwitchSelectedTask && wtSwitchTaskSearch.value.trim().length > 0;
  wtSwitchTaskDescRow.style.display = isNewTask ? '' : 'none';
  wtSwitchTaskTypeRow.style.display = isNewTask ? '' : 'none';
  if (isNewTask) wtSwitchTaskType.value = inferWorkItemType(wtSwitchTaskSearch.value.trim());
  wtSwitchSkipTaskBtn.style.display = 'none';
}

function selectWtSwitchTask(task) {
  wtSwitchSelectedTask = task;
  wtSwitchTaskSearch.value = task ? `#${task.id} ${task.title}` : '';
  taskCombobox.close();
  if (task) {
    wtSwitchChangeNameEdited = false;
    wtSwitchChangeName.value = task.title;
    updateTargetFromTask();
  }
  updateSwitchNewTaskFields();
}

function applyWtSwitchTasks(tasks, azureContext, focusTaskSearch) {
  wtSwitchAzureContext = azureContext;
  taskCombobox.setItems(tasks);
  wtSwitchTaskSearch.placeholder = tasks.length === 0 ? 'No active tasks found' : 'Search or type new task...';
  wtSwitchTaskSearch.disabled = false;
  focusTaskSearch();

  // Re-render if the user already typed something (focus event won't re-fire if input is already focused)
  const typed = wtSwitchTaskSearch.value.trim();
  if (typed) taskCombobox.render(wtSwitchTaskSearch.value);

  // If the user already typed an ID and that exact ID isn't in results, fetch it specifically
  const idMatch = typed.match(/^#?(\d+)$/);
  if (idMatch) {
    const numId = parseInt(idMatch[1], 10);
    if (taskCombobox.getFiltered().some(t => t.id === numId)) return;
    clearTimeout(wtSwitchFetchByIdTimer);
    wtSwitchFetchByIdTimer = setTimeout(async () => {
      if (wtSwitchTaskSearch.value.trim() !== typed) return;
      const found = await fetchWorkItemById(wtSwitchAzureContext, numId);
      if (!found) return;
      if (wtSwitchTaskSearch.value.trim() !== typed) return;
      const allTasks = taskCombobox.getItems();
      if (!allTasks.some(t => t.id === found.id)) taskCombobox.setItems([found, ...allTasks]);
      taskCombobox.render(wtSwitchTaskSearch.value);
    }, 400);
  }
}

async function fetchSwitchTasksForDialog(barePath) {
  const focusTaskSearch = () => { if (wtSwitchDialogOverlay.classList.contains('visible')) wtSwitchTaskSearch.focus(); };
  const pat = await loadStoredPat();

  const cached = getCachedTasks(barePath);
  if (cached) applyWtSwitchTasks(cached.tasks, cached.azureContext, focusTaskSearch);

  const result = await fetchAzureTasks(barePath, pat);
  if (result.error === 'no-pat') { if (!cached) { wtSwitchTaskSearch.placeholder = 'Configure PAT to load tasks'; wtSwitchTaskSearch.disabled = false; focusTaskSearch(); } return; }
  if (result.error === 'not-azure') { if (!cached) { wtSwitchTaskSearch.placeholder = 'Not an Azure DevOps repository'; wtSwitchTaskSearch.disabled = false; focusTaskSearch(); } return; }
  if (result.error) { if (!cached) { wtSwitchTaskSearch.placeholder = 'Could not load tasks'; wtSwitchTaskSearch.disabled = false; focusTaskSearch(); } return; }
  saveTaskCache(barePath, { tasks: result.tasks, azureContext: result.azureContext });
  applyWtSwitchTasks(result.tasks, result.azureContext, focusTaskSearch);
}

// --- Source branch combobox ---

const sourceBranchCombobox = createCombobox({
  inputEl: wtSwitchBranchSearch,
  listEl: wtSwitchBranchList,
  arrowSelector: '#wt-switch-combobox .combobox-arrow',
  onHide: () => hideWorktreeSwitchDialog(),
  getLabel: (b) => b,
  isSelected: (b) => b === wtSwitchSelectedBranch,
  dashForSpace: true,
  onSelect: (b) => {
    wtSwitchSelectedBranch = b;
    wtSwitchBranchSearch.value = b;
    updateWtSwitchPreview();
  },
  onEnterMatch: (b) => {
    wtSwitchSelectedBranch = b;
    wtSwitchBranchSearch.value = b;
    sourceBranchCombobox.close();
    updateWtSwitchPreview();
    wtSwitchTargetSearch.focus();
  },
  onInput: () => { wtSwitchSelectedBranch = null; updateConfirmState(); },
  onBlur: () => { if (wtSwitchSelectedBranch) wtSwitchBranchSearch.value = wtSwitchSelectedBranch; },
});

// --- Target branch combobox ---

const targetBranchCombobox = createCombobox({
  inputEl: wtSwitchTargetSearch,
  listEl: wtSwitchTargetList,
  arrowSelector: '#wt-switch-target-combobox .combobox-arrow',
  onHide: () => hideWorktreeSwitchDialog(),
  getLabel: (b) => b,
  isSelected: (b) => b === wtSwitchSelectedTarget,
  dashForSpace: true,
  onSelect: (b) => {
    wtSwitchSelectedTarget = b;
    wtSwitchTargetSearch.value = b;
    updateWtSwitchPreview();
  },
  onEnterMatch: (b) => {
    wtSwitchSelectedTarget = b;
    wtSwitchTargetSearch.value = b;
    targetBranchCombobox.close();
    updateWtSwitchPreview();
  },
  onEnterNoMatch: () => confirmSwitchWorktree(),
  onInput: () => { wtSwitchSelectedTarget = null; updateWtSwitchPreview(); },
  onBlur: () => {
    if (wtSwitchSelectedTarget) wtSwitchTargetSearch.value = wtSwitchSelectedTarget;
    updateWtSwitchPreview();
  },
});

function applySwitchBranches(branches, preselect) {
  sourceBranchCombobox.setItems(branches);
  targetBranchCombobox.setItems(branches);
  if (preselect && branches.includes(preselect) && !wtSwitchSelectedBranch) {
    wtSwitchSelectedBranch = preselect;
    wtSwitchBranchSearch.value = preselect;
  } else if (!wtSwitchSelectedBranch) {
    const defaultBranch = branches.includes('develop') ? 'develop' : ['master', 'main'].find(b => branches.includes(b));
    if (defaultBranch) { wtSwitchSelectedBranch = defaultBranch; wtSwitchBranchSearch.value = defaultBranch; }
  }
  wtSwitchBranchSearch.placeholder = 'Search branches...';
  wtSwitchBranchSearch.disabled = false;
  updateConfirmState();
}

// --- Dialog show/hide/confirm ---

export async function showWorktreeSwitchDialog(tabEl, groupEl) {
  // Reset all state
  wtSwitchTabEl = tabEl;
  wtSwitchGroupEl = groupEl;
  wtSwitchCurrentBarePath = groupEl._barePath;
  wtSwitchSelectedBranch = null;
  wtSwitchSelectedTarget = null;
  wtSwitchSelectedTask = null;
  wtSwitchAzureContext = null;
  wtSwitchChangeNameEdited = false;
  clearTimeout(wtSwitchFetchByIdTimer);
  clearTimeout(wtSwitchFetchRetryTimer);

  wtSwitchDeleteBranchCheckbox.checked = getDeleteBranchPref('switchDeleteBranch');
  wtSwitchBranchSearch.value = '';
  wtSwitchBranchSearch.placeholder = 'Fetching branches...';
  wtSwitchBranchSearch.disabled = true;
  wtSwitchTargetSearch.value = '';
  wtSwitchPreview.textContent = '';
  wtSwitchTaskSearch.value = '';
  wtSwitchTaskSearch.placeholder = 'Loading tasks...';
  wtSwitchTaskSearch.disabled = true;
  wtSwitchTaskDescRow.style.display = 'none';
  wtSwitchTaskDesc.value = '';
  wtSwitchTaskTypeRow.style.display = 'none';
  wtSwitchChangeName.value = '';
  wtSwitchConfirmBtn.disabled = true;

  sourceBranchCombobox.setItems([]);
  sourceBranchCombobox.close();
  targetBranchCombobox.setItems([]);
  targetBranchCombobox.close();
  taskCombobox.setItems([]);
  taskCombobox.close();

  wtSwitchDialogOverlay.classList.add('visible');

  const repoName = groupEl.dataset.repoName;
  const preselect = tabEl._wtSourceBranch || null;
  const stateCache = getCachedBranchesFromState(repoName);

  const [cachedResult, user] = await Promise.all([
    window.reposAPI.cachedBranches(groupEl._barePath),
    window.reposAPI.gitUser(groupEl._barePath)
  ]);
  const cached = cachedResult.value;
  wtSwitchGitUser = user || 'user';

  const initialBranches = cached.length > 0 ? cached : stateCache;
  if (initialBranches.length > 0) applySwitchBranches(initialBranches, preselect);

  window.reposAPI.fetchBranches(groupEl._barePath).then((fetchResult) => {
    const fetched = fetchResult.value;
    if (!wtSwitchDialogOverlay.classList.contains('visible')) return;
    if (wtSwitchGroupEl !== groupEl) return;
    applySwitchBranches(fetched, preselect);
    saveBranchCache(repoName, fetched);
    if (wtSwitchBranchList.classList.contains('open')) sourceBranchCombobox.render(wtSwitchBranchSearch.value);
    if (wtSwitchTargetList.classList.contains('open')) targetBranchCombobox.render(wtSwitchTargetSearch.value);
  });

  fetchSwitchTasksForDialog(groupEl._barePath);
}

export function hideWorktreeSwitchDialog() {
  wtSwitchDialogOverlay.classList.remove('visible');
  sourceBranchCombobox.close();
  targetBranchCombobox.close();
  taskCombobox.close();
  wtSwitchTaskDescRow.style.display = 'none';
  wtSwitchTaskTypeRow.style.display = 'none';
  wtSwitchTaskDesc.value = '';
  clearTimeout(wtSwitchFetchByIdTimer);
  clearTimeout(wtSwitchFetchRetryTimer);
}

export async function confirmSwitchWorktree() {
  const targetBranch = wtSwitchSelectedTarget || wtSwitchTargetSearch.value.trim();
  if (!wtSwitchSelectedBranch) return;
  if (!targetBranch) { wtSwitchTargetSearch.focus(); return; }
  if (!wtSwitchTabEl || !wtSwitchGroupEl) return;

  const isNewTask = !wtSwitchSelectedTask && wtSwitchTaskSearch.value.trim().length > 0;
  if (isNewTask && wtSwitchAzureContext) {
    const taskTitle = wtSwitchTaskSearch.value.trim();
    const taskDescription = wtSwitchTaskDesc.value.trim();
    const workItemType = wtSwitchTaskType.value || 'User Story';
    try {
      wtSwitchSelectedTask = await createAzureWorkItem(wtSwitchAzureContext, workItemType, taskTitle, taskDescription, null);
      window.shellAPI.openExternal(buildAzureTaskUrl(wtSwitchAzureContext, wtSwitchSelectedTask.id));
    } catch (err) { toast.error(`Failed to create task: ${err.message}`); return; }
  }

  if (wtSwitchSelectedTask && wtSwitchAzureContext) {
    updateWorkItemState(wtSwitchAzureContext, wtSwitchSelectedTask.id, 'Active');
  }

  const branchName = targetBranch;
  const taskId = wtSwitchSelectedTask ? wtSwitchSelectedTask.id : null;
  const tabEl = wtSwitchTabEl;
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
      setTitle('Worktree switched');
      if (tabEl._dotEl) tabEl._dotEl.remove();
      tabEl.remove();
      const wt = { path: wtPath, branch, name: dir, sourceBranch: switchSource, taskId };
      saveSourceBranch(wtPath, switchSource);
      if (taskId) saveTaskId(wtPath, taskId);
      const newTabEl = _createWorktreeTab(wt);
      const addBtn = tabsEl.querySelector('.repo-group-tabs-add');
      tabsEl.insertBefore(newTabEl, addBtn);
      if (_rebuildCollapsedDots) _rebuildCollapsedDots();
      setTimeout(async () => {
        closeTerminal();
        try { await openWorktree(newTabEl, wt); } catch (err) { console.error('Failed to open switched worktree:', err); }
      }, 800);
    } else {
      xterm.writeln('');
      xterm.writeln(`\x1b[31mWorktree switch failed with exit code ${exitCode}\x1b[0m`);
      setTitle('Worktree switch failed');
      toast.error('Worktree switch failed — see terminal');
      showCloseButton();
    }
  });

  try {
    const deleteBranch = wtSwitchDeleteBranchCheckbox.checked;
    saveDeleteBranchPref('switchDeleteBranch', deleteBranch);
    await window.worktreeSwitchAPI.start({ oldWtPath, branchName, sourceBranch: wtSwitchSelectedBranch, oldBranch: tabEl._wtBranch, deleteBranch });
    window.worktreeSwitchAPI.ready();
  } catch (err) {
    xterm.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    setTitle('Worktree switch failed');
    toast.error('Worktree switch failed — see terminal');
    showCloseButton();
  }
}

// --- Event listeners: Change name ---

wtSwitchChangeName.addEventListener('focus', () => { wtSwitchChangeName.select(); });
wtSwitchChangeName.addEventListener('input', () => {
  wtSwitchChangeNameEdited = true;
  updateTargetFromTask();
});
wtSwitchChangeName.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideWorktreeSwitchDialog();
  else if (e.key === 'Enter') confirmSwitchWorktree();
});

// --- Event listeners: Task description ---

wtSwitchTaskDesc.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideWorktreeSwitchDialog();
  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) confirmSwitchWorktree();
});

// --- Dialog buttons ---

document.getElementById('wt-switch-cancel-btn').addEventListener('click', hideWorktreeSwitchDialog);
wtSwitchSkipTaskBtn.addEventListener('click', () => { wtSwitchSelectedTask = null; wtSwitchTaskSearch.value = ''; updateSwitchNewTaskFields(); confirmSwitchWorktree(); });
wtSwitchConfirmBtn.addEventListener('click', confirmSwitchWorktree);
