import { fetchAzureTasks, createAzureWorkItem, buildAzureTaskUrl, fetchWorkItemById, updateWorkItemState } from '../azure-api.js';
import { inferWorkItemType, loadStoredPat, getCachedTasks, saveTaskCache, stripHtml } from './utils.js';
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
  inputEl: stTaskSearch,
  listEl: stTaskList,
  arrowSelector: '#st-task-combobox .combobox-arrow',
  onHide: () => hideSetTaskDialog(),
  getLabel: (t) => `#${t.id} ${t.title}`,
  isSelected: (t) => _selectedTask && t.id === _selectedTask.id,
  renderItemContent: renderTaskItem,
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
  taskCombobox.setItems(tasks);
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
