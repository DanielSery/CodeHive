import { fetchAzureTasks, createAzureWorkItem, buildAzureTaskUrl, fetchWorkItemById, updateWorkItemState } from '../azure-api.js';
import { inferWorkItemType, loadStoredPat, getCachedTasks, saveTaskCache, stripHtml } from './utils.js';
import { showPatDialog } from './dialog-pat.js';
import { saveTaskId } from '../storage.js';
import { toast } from '../toast.js';
import { createCombobox } from './combobox.js';
import { _refreshTabStatus } from '../sidebar/registers.js';

const overlay = document.getElementById('st-dialog-overlay');
const stTaskSearch = document.getElementById('st-task-search');
const stTaskList = document.getElementById('st-task-list');
const stTaskDescRow = document.getElementById('st-task-desc-row');
const stTaskDesc = document.getElementById('st-task-desc');
const stTaskTypeRow = document.getElementById('st-task-type-row');
const stTaskType = document.getElementById('st-task-type');
const stConfirmBtn = document.getElementById('st-confirm-btn');

let _tabEl = null;
let _barePath = null;
let _selectedTask = null;
let _azureContext = null;
let _fetchByIdTimer = null;
let _fetchRetryTimer = null;

function updateNewTaskFields() {
  const isNewTask = !_selectedTask && stTaskSearch.value.trim().length > 0;
  stTaskDescRow.style.display = isNewTask ? '' : 'none';
  stTaskTypeRow.style.display = isNewTask ? '' : 'none';
  if (isNewTask) stTaskType.value = inferWorkItemType(stTaskSearch.value.trim());
  stConfirmBtn.disabled = !_selectedTask && stTaskSearch.value.trim().length === 0;
}

function selectTask(task) {
  _selectedTask = task;
  stTaskSearch.value = task ? `#${task.id} ${task.title}` : '';
  taskCombobox.close();
  updateNewTaskFields();
  stConfirmBtn.disabled = false;
}

const WORK_ITEM_TYPE_SVGS = {
  'Bug':        '<svg width="12" height="12" viewBox="0 0 12 12"><rect width="12" height="12" rx="2" fill="#CC293D"/><path d="M3.5 3.5L8.5 8.5M8.5 3.5L3.5 8.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
  'Task':       '<svg width="12" height="12" viewBox="0 0 12 12"><rect width="12" height="12" rx="2" fill="#F2CB1D"/><path d="M2.5 6l2.5 2.5 4.5-5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  'User Story': '<svg width="12" height="12" viewBox="0 0 12 12"><rect width="12" height="12" rx="2" fill="#0078D4"/><circle cx="6" cy="3.8" r="1.7" fill="#fff"/><path d="M2 12C2 8.5 3.5 7 6 7C8.5 7 10 8.5 10 12Z" fill="#fff"/></svg>',
  'Feature':    '<svg width="12" height="12" viewBox="0 0 12 12"><rect width="12" height="12" rx="2" fill="#773B93"/><path d="M6 2.5L9.5 6L6 9.5L2.5 6Z" fill="#fff"/></svg>',
  'Epic':       '<svg width="12" height="12" viewBox="0 0 12 12"><rect width="12" height="12" rx="2" fill="#FF7B00"/><path d="M7.5 1.5L4 7h3.5L5 10.5l5.5-5H7Z" fill="#fff"/></svg>',
};

function renderTaskItem(el, t) {
  if (t.isMyNew) el.classList.add('combobox-item--my-new');
  const titleLine = document.createElement('div');
  titleLine.className = 'combobox-item-title';
  const svgStr = WORK_ITEM_TYPE_SVGS[t.type];
  if (svgStr) {
    const icon = document.createElement('span');
    icon.className = 'work-item-type-icon';
    icon.innerHTML = svgStr;
    titleLine.appendChild(icon);
  }
  const titleText = document.createElement('span');
  titleText.textContent = `#${t.id} ${t.title}`;
  titleLine.appendChild(titleText);
  if (t.isMyNew) {
    const badge = document.createElement('span');
    badge.className = 'task-my-new-badge';
    badge.textContent = 'Mine';
    titleLine.appendChild(badge);
  }
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
  inputEl: stTaskSearch,
  listEl: stTaskList,
  arrowSelector: '#st-task-combobox .combobox-arrow',
  onHide: () => hideSetTaskDialog(),
  getLabel: (t) => `#${t.id} ${t.title}`,
  isSelected: (t) => _selectedTask && t.id === _selectedTask.id,
  renderItemContent: renderTaskItem,
  prioritizeFn: (t) => !!t.isMyNew,
  onSelect: (task) => selectTask(task),
  onEnterMatch: (task) => { selectTask(task); confirmSetTask(); },
  onEnterNoMatch: () => confirmSetTask(),
  onInput: () => {
    _selectedTask = null;
    updateNewTaskFields();
    const typed = stTaskSearch.value.trim();

    clearTimeout(_fetchRetryTimer);
    if (typed && !_azureContext && taskCombobox.getItems().length === 0) {
      _fetchRetryTimer = setTimeout(() => {
        if (overlay.classList.contains('visible') && _barePath) fetchTasks(_barePath);
      }, 600);
    }

    clearTimeout(_fetchByIdTimer);
    const idMatch = typed.match(/^#?(\d+)$/);
    if (idMatch && _azureContext) {
      const numId = parseInt(idMatch[1], 10);
      if (!taskCombobox.getFiltered().some(t => t.id === numId)) {
        _fetchByIdTimer = setTimeout(async () => {
          if (stTaskSearch.value.trim() !== typed) return;
          const found = await fetchWorkItemById(_azureContext, numId);
          if (!found) return;
          if (stTaskSearch.value.trim() !== typed) return;
          const all = taskCombobox.getItems();
          if (!all.some(t => t.id === found.id)) taskCombobox.setItems([found, ...all]);
          taskCombobox.render(stTaskSearch.value);
        }, 400);
      }
    }
  },
  onBlur: () => {
    if (_selectedTask) stTaskSearch.value = `#${_selectedTask.id} ${_selectedTask.title}`;
    updateNewTaskFields();
  },
  openOnFocus: true,
});

function applyTasks(tasks, azureContext) {
  _azureContext = azureContext;
  const sorted = [...tasks].sort((a, b) => {
    if (a.isMyNew && !b.isMyNew) return -1;
    if (!a.isMyNew && b.isMyNew) return 1;
    return 0;
  });
  taskCombobox.setItems(sorted);
  stTaskSearch.placeholder = tasks.length === 0 ? 'No active tasks found' : 'Search or type new task...';
  stTaskSearch.disabled = false;
  if (overlay.classList.contains('visible')) stTaskSearch.focus();

  const typed = stTaskSearch.value.trim();
  if (typed) taskCombobox.render(stTaskSearch.value);

  const idMatch = typed.match(/^#?(\d+)$/);
  if (idMatch) {
    const numId = parseInt(idMatch[1], 10);
    if (taskCombobox.getFiltered().some(t => t.id === numId)) return;
    clearTimeout(_fetchByIdTimer);
    _fetchByIdTimer = setTimeout(async () => {
      if (stTaskSearch.value.trim() !== typed) return;
      const found = await fetchWorkItemById(_azureContext, numId);
      if (!found) return;
      if (stTaskSearch.value.trim() !== typed) return;
      const all = taskCombobox.getItems();
      if (!all.some(t => t.id === found.id)) taskCombobox.setItems([found, ...all]);
      taskCombobox.render(stTaskSearch.value);
    }, 400);
  }
}

async function fetchTasks(barePath) {
  const pat = await loadStoredPat();

  const cached = getCachedTasks(barePath);
  if (cached) applyTasks(cached.tasks, cached.azureContext);

  const result = await fetchAzureTasks(barePath, pat);
  if (result.error === 'no-pat') { if (!cached) { stTaskSearch.placeholder = 'Configure PAT to load tasks'; stTaskSearch.disabled = false; } return; }
  if (result.error === 'pat-invalid') { const newPat = await showPatDialog(); if (newPat) { await fetchTasks(barePath); } else if (!cached) { stTaskSearch.placeholder = 'PAT expired — configure to load tasks'; stTaskSearch.disabled = false; } return; }
  if (result.error === 'not-azure') { if (!cached) { stTaskSearch.placeholder = 'Not an Azure DevOps repository'; stTaskSearch.disabled = false; } return; }
  if (result.error) { if (!cached) { stTaskSearch.placeholder = 'Could not load tasks'; stTaskSearch.disabled = false; } return; }
  saveTaskCache(barePath, { tasks: result.tasks, azureContext: result.azureContext });
  applyTasks(result.tasks, result.azureContext);
}

export function showSetTaskDialog(tabEl) {
  _tabEl = tabEl;
  _selectedTask = null;
  _azureContext = null;
  clearTimeout(_fetchByIdTimer);
  clearTimeout(_fetchRetryTimer);

  stTaskSearch.value = '';
  stTaskSearch.placeholder = 'Loading tasks...';
  stTaskSearch.disabled = true;
  stTaskDescRow.style.display = 'none';
  stTaskDesc.value = '';
  stTaskTypeRow.style.display = 'none';
  stConfirmBtn.disabled = true;

  taskCombobox.setItems([]);
  taskCombobox.close();

  overlay.classList.add('visible');

  const groupEl = tabEl.closest('.repo-group');
  _barePath = groupEl ? groupEl._barePath : null;
  if (_barePath) fetchTasks(_barePath);
}

export function hideSetTaskDialog() {
  overlay.classList.remove('visible');
  taskCombobox.close();
  stTaskDescRow.style.display = 'none';
  stTaskTypeRow.style.display = 'none';
  stTaskDesc.value = '';
  clearTimeout(_fetchByIdTimer);
  clearTimeout(_fetchRetryTimer);
  _tabEl = null;
}

async function confirmSetTask() {
  if (!_tabEl) return;
  const isNewTask = !_selectedTask && stTaskSearch.value.trim().length > 0;

  if (isNewTask && _azureContext) {
    const taskTitle = stTaskSearch.value.trim();
    const taskDescription = stTaskDesc.value.trim();
    const workItemType = stTaskType.value || 'User Story';
    try {
      _selectedTask = await createAzureWorkItem(_azureContext, workItemType, taskTitle, taskDescription, null);
      window.shellAPI.openExternal(buildAzureTaskUrl(_azureContext, _selectedTask.id));
    } catch (err) { toast.error(`Failed to create task: ${err.message}`); return; }
  }

  if (!_selectedTask) return;

  if (_azureContext) updateWorkItemState(_azureContext, _selectedTask.id, 'Active');

  const tabEl = _tabEl;
  tabEl._wtTaskId = _selectedTask.id;
  saveTaskId(tabEl._wtPath, _selectedTask.id);
  if (_refreshTabStatus) _refreshTabStatus(tabEl);

  hideSetTaskDialog();
}

document.getElementById('st-cancel-btn').addEventListener('click', hideSetTaskDialog);
stConfirmBtn.addEventListener('click', confirmSetTask);

stTaskDesc.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideSetTaskDialog();
  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) confirmSetTask();
});

overlay.addEventListener('mousedown', (e) => {
  if (e.target === overlay) hideSetTaskDialog();
});
