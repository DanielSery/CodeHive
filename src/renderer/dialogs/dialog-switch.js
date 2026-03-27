import { openWorktree } from '../workspace-manager.js';
import { stripHtml } from './dialog-worktree.js';
import { createTerminal, showTerminal, showCloseButton, setTitle, closeTerminal } from '../terminal-panel.js';
import { getCachedBranchesFromState, saveBranchCache, saveSourceBranch, saveTaskId } from '../storage.js';
import { fetchAzureTasks, fetchAzureFeatures, createAzureWorkItem, buildAzureTaskUrl, fetchWorkItemById, updateWorkItemState } from '../azure-api.js';
import { inferWorkItemType, sanitizePathPart, userToPrefix, nameToBranch, loadStoredPat, fuzzyMatch, fuzzyScore, getCachedFeatures, saveFeatureCache, getCachedTasks, saveTaskCache } from './utils.js';

const wtSwitchDialogOverlay = document.getElementById('wt-switch-dialog-overlay');
const wtSwitchTaskSearch = document.getElementById('wt-switch-task-search');
const wtSwitchTaskList = document.getElementById('wt-switch-task-list');
const wtSwitchTaskDescRow = document.getElementById('wt-switch-task-desc-row');
const wtSwitchTaskDesc = document.getElementById('wt-switch-task-desc');
const wtSwitchTaskTypeRow = document.getElementById('wt-switch-task-type-row');
const wtSwitchTaskType = document.getElementById('wt-switch-task-type');
const wtSwitchFeatureRow = document.getElementById('wt-switch-feature-row');
const wtSwitchFeatureSearch = document.getElementById('wt-switch-feature-search');
const wtSwitchFeatureList = document.getElementById('wt-switch-feature-list');
const wtSwitchBranchSearch = document.getElementById('wt-switch-branch-search');
const wtSwitchBranchList = document.getElementById('wt-switch-branch-list');
const wtSwitchTargetSearch = document.getElementById('wt-switch-target-search');
const wtSwitchTargetList = document.getElementById('wt-switch-target-list');
const wtSwitchPreview = document.getElementById('wt-switch-preview');

let wtSwitchAllBranches = [];
let wtSwitchSelectedBranch = null;
let wtSwitchHighlightIndex = -1;
let wtSwitchTabEl = null;
let wtSwitchGroupEl = null;
let wtSwitchGitUser = '';
let wtSwitchAllTasks = [];
let wtSwitchSelectedTask = null;
let wtSwitchTaskHighlightIndex = -1;
let wtSwitchAzureContext = null;
let wtSwitchAllFeatures = [];
let wtSwitchSelectedFeature = null;
let wtSwitchFeatureHighlightIndex = -1;
let wtSwitchTargetHighlightIndex = -1;
let wtSwitchSelectedTarget = null;
let wtSwitchFetchByIdTimer = null;

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
  if (wtSwitchSelectedTask) {
    const namePart = sanitizePathPart(name).trim().replace(/\s+/g, '-');
    return `${userToPrefix(wtSwitchGitUser)}/${wtSwitchSelectedTask.id}-${namePart}`;
  }
  return nameToBranch(wtSwitchGitUser, name);
}

function updateTargetFromTask() {
  const name = getTaskName();
  if (!name) return;
  const target = buildTargetFromTask(name);
  wtSwitchTargetSearch.value = target;
  wtSwitchSelectedTarget = null;
  updateWtSwitchPreview();
}

function getDirName() {
  const target = wtSwitchSelectedTarget || wtSwitchTargetSearch.value.trim();
  if (!target) return '';
  const parts = target.split('/');
  const last = parts[parts.length - 1];
  return last.substring(0, 15);
}

function updateWtSwitchPreview() {
  const target = wtSwitchSelectedTarget || wtSwitchTargetSearch.value.trim();
  if (!target || !wtSwitchSelectedBranch) { wtSwitchPreview.textContent = ''; return; }
  const dir = getDirName();
  wtSwitchPreview.textContent = `Dir: ${dir}`;
}

// --- Task combobox ---

function getFilteredSwitchTasks() {
  const q = (wtSwitchTaskSearch.value || '').toLowerCase();
  return wtSwitchAllTasks.filter(t => fuzzyMatch(`#${t.id} ${t.title}`, q)).sort((a, b) => fuzzyScore(`#${b.id} ${b.title}`, q) - fuzzyScore(`#${a.id} ${a.title}`, q));
}

function renderSwitchTaskList(filter) {
  wtSwitchTaskList.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const filtered = wtSwitchAllTasks.filter(t => fuzzyMatch(`#${t.id} ${t.title}`, q)).sort((a, b) => fuzzyScore(`#${b.id} ${b.title}`, q) - fuzzyScore(`#${a.id} ${a.title}`, q));
  if (filtered.length === 0) { wtSwitchTaskList.classList.remove('open'); wtSwitchTaskHighlightIndex = -1; return; }
  filtered.forEach((t, i) => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    if (wtSwitchSelectedTask && t.id === wtSwitchSelectedTask.id) item.classList.add('selected');
    if (i === wtSwitchTaskHighlightIndex) item.classList.add('highlighted');
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
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectWtSwitchTask(t); });
    wtSwitchTaskList.appendChild(item);
  });
  wtSwitchTaskList.classList.add('open');
}

function updateSwitchNewTaskFields() {
  const isNewTask = !wtSwitchSelectedTask && wtSwitchTaskSearch.value.trim().length > 0;
  wtSwitchTaskDescRow.style.display = isNewTask ? '' : 'none';
  wtSwitchTaskTypeRow.style.display = isNewTask ? '' : 'none';
  wtSwitchFeatureRow.style.display = isNewTask ? '' : 'none';
  if (isNewTask) wtSwitchTaskType.value = inferWorkItemType(wtSwitchTaskSearch.value.trim());
}

function selectWtSwitchTask(task) {
  wtSwitchSelectedTask = task;
  wtSwitchTaskSearch.value = task ? `#${task.id} ${task.title}` : '';
  wtSwitchTaskList.classList.remove('open');
  wtSwitchTaskHighlightIndex = -1;
  if (task) updateTargetFromTask();
  updateSwitchNewTaskFields();
}

function applyWtSwitchTasks(tasks, azureContext, focusTaskSearch) {
  wtSwitchAzureContext = azureContext;
  wtSwitchAllTasks = tasks;
  wtSwitchTaskSearch.placeholder = tasks.length === 0 ? 'No active tasks found' : 'Search or type new task...';
  wtSwitchTaskSearch.disabled = false;
  focusTaskSearch();
}

function applyWtSwitchFeatures(features) {
  wtSwitchAllFeatures = features;
  wtSwitchFeatureSearch.placeholder = features.length === 0 ? 'No features found' : 'Search features...';
  wtSwitchFeatureSearch.disabled = features.length === 0;
}

async function fetchSwitchTasksForDialog(barePath) {
  const focusTaskSearch = () => { if (wtSwitchDialogOverlay.classList.contains('visible')) wtSwitchTaskSearch.focus(); };
  const pat = loadStoredPat();

  // Apply caches immediately
  const cached = getCachedTasks(barePath);
  if (cached) {
    applyWtSwitchTasks(cached.tasks, cached.azureContext, focusTaskSearch);
    const cachedFeatures = getCachedFeatures(barePath);
    if (cachedFeatures) applyWtSwitchFeatures(cachedFeatures);
  }

  // Always refresh in background
  const result = await fetchAzureTasks(barePath, pat);
  if (result.error === 'no-pat') { if (!cached) { wtSwitchTaskSearch.placeholder = 'Enter PAT to load tasks'; wtSwitchTaskSearch.disabled = false; focusTaskSearch(); } return; }
  if (result.error === 'not-azure') { if (!cached) { wtSwitchTaskSearch.placeholder = 'Not an Azure DevOps repository'; wtSwitchTaskSearch.disabled = false; focusTaskSearch(); } return; }
  if (result.error) { if (!cached) { wtSwitchTaskSearch.placeholder = 'Could not load tasks'; wtSwitchTaskSearch.disabled = false; focusTaskSearch(); } return; }
  saveTaskCache(barePath, { tasks: result.tasks, azureContext: result.azureContext });
  applyWtSwitchTasks(result.tasks, result.azureContext, focusTaskSearch);

  fetchAzureFeatures(wtSwitchAzureContext).then(features => {
    saveFeatureCache(barePath, features);
    applyWtSwitchFeatures(features);
  });
}

// --- Feature combobox ---

function getFilteredSwitchFeatures() {
  const q = (wtSwitchFeatureSearch.value || '').toLowerCase();
  return wtSwitchAllFeatures.filter(f => fuzzyMatch(`#${f.id} ${f.title}`, q)).sort((a, b) => fuzzyScore(`#${b.id} ${b.title}`, q) - fuzzyScore(`#${a.id} ${a.title}`, q));
}

function renderSwitchFeatureList(filter) {
  wtSwitchFeatureList.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const filtered = wtSwitchAllFeatures.filter(f => fuzzyMatch(`#${f.id} ${f.title}`, q)).sort((a, b) => fuzzyScore(`#${b.id} ${b.title}`, q) - fuzzyScore(`#${a.id} ${a.title}`, q));
  if (filtered.length === 0) { wtSwitchFeatureList.classList.remove('open'); wtSwitchFeatureHighlightIndex = -1; return; }
  filtered.forEach((f, i) => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    if (wtSwitchSelectedFeature && f.id === wtSwitchSelectedFeature.id) item.classList.add('selected');
    if (i === wtSwitchFeatureHighlightIndex) item.classList.add('highlighted');
    const titleLine = document.createElement('div');
    titleLine.textContent = `#${f.id} ${f.title}`;
    item.appendChild(titleLine);
    if (f.description) {
      const desc = stripHtml(f.description).substring(0, 300);
      if (desc) {
        const descLine = document.createElement('div');
        descLine.className = 'combobox-item-desc';
        descLine.textContent = desc;
        item.appendChild(descLine);
      }
    }
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectWtSwitchFeature(f); });
    wtSwitchFeatureList.appendChild(item);
  });
  wtSwitchFeatureList.classList.add('open');
}

function selectWtSwitchFeature(f) {
  wtSwitchSelectedFeature = f;
  wtSwitchFeatureSearch.value = f ? `#${f.id} ${f.title}` : '';
  wtSwitchFeatureList.classList.remove('open');
  wtSwitchFeatureHighlightIndex = -1;
}

async function suggestSwitchFeatures() {
  if (wtSwitchAllFeatures.length === 0) return;
  const taskName = wtSwitchTaskSearch.value.trim();
  const taskDesc = wtSwitchTaskDesc.value.trim();
  if (!taskName) return;

  const featureListStr = wtSwitchAllFeatures.map(f => `${f.id}: ${f.title}`).join('\n');
  const prompt = `Given these Azure DevOps features:\n${featureListStr}\n\nWhich top 5 features best match this task?\nTask name: ${taskName}\nTask description: ${taskDesc || '(none)'}\n\nReturn ONLY a comma-separated list of feature IDs (numbers only), best match first. No explanation.`;

  try {
    const response = await window.claudeAPI.run(prompt);
    const ids = response.match(/\d+/g);
    if (!ids || ids.length === 0) return;

    const topIds = ids.slice(0, 5).map(Number);
    const topFeatures = [];
    const restFeatures = [];
    for (const f of wtSwitchAllFeatures) {
      if (topIds.includes(f.id)) topFeatures.push(f);
      else restFeatures.push(f);
    }
    topFeatures.sort((a, b) => topIds.indexOf(a.id) - topIds.indexOf(b.id));
    wtSwitchAllFeatures = [...topFeatures, ...restFeatures];

    if (topFeatures.length > 0) {
      if (wtSwitchFeatureList.classList.contains('open')) {
        wtSwitchSelectedFeature = topFeatures[0];
        renderSwitchFeatureList(wtSwitchFeatureSearch.value);
      } else {
        selectWtSwitchFeature(topFeatures[0]);
      }
    }
  } catch {
    // Claude CLI not available
  }
}

// --- Source branch combobox ---

function getSwitchFilteredBranches() {
  const q = (wtSwitchBranchSearch.value || '').toLowerCase();
  return wtSwitchAllBranches.filter(b => fuzzyMatch(b, q)).sort((a, b) => fuzzyScore(b, q) - fuzzyScore(a, q));
}

function renderSwitchBranchList(filter) {
  wtSwitchBranchList.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const filtered = wtSwitchAllBranches.filter(b => fuzzyMatch(b, q)).sort((a, b) => fuzzyScore(b, q) - fuzzyScore(a, q));
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
    const defaultBranch = branches.includes('develop') ? 'develop' : ['master', 'main'].find(b => branches.includes(b));
    if (defaultBranch) { wtSwitchSelectedBranch = defaultBranch; wtSwitchBranchSearch.value = defaultBranch; }
  }
  wtSwitchBranchSearch.placeholder = 'Search branches...';
  wtSwitchBranchSearch.disabled = false;
}

// --- Target branch combobox ---

function getSwitchFilteredTargets() {
  const q = (wtSwitchTargetSearch.value || '').toLowerCase();
  return wtSwitchAllBranches.filter(b => fuzzyMatch(b, q)).sort((a, b) => fuzzyScore(b, q) - fuzzyScore(a, q));
}

function renderSwitchTargetList(filter) {
  wtSwitchTargetList.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const filtered = wtSwitchAllBranches.filter(b => fuzzyMatch(b, q)).sort((a, b) => fuzzyScore(b, q) - fuzzyScore(a, q));
  if (filtered.length === 0) { wtSwitchTargetList.classList.remove('open'); wtSwitchTargetHighlightIndex = -1; return; }
  filtered.forEach((b, i) => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    if (b === wtSwitchSelectedTarget) item.classList.add('selected');
    if (i === wtSwitchTargetHighlightIndex) item.classList.add('highlighted');
    item.textContent = b;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectWtSwitchTarget(b); });
    wtSwitchTargetList.appendChild(item);
  });
  wtSwitchTargetList.classList.add('open');
}

function selectWtSwitchTarget(b) {
  wtSwitchSelectedTarget = b;
  wtSwitchTargetSearch.value = b;
  wtSwitchTargetList.classList.remove('open');
  wtSwitchTargetHighlightIndex = -1;
  updateWtSwitchPreview();
}

// --- Dialog show/hide/confirm ---

export async function showWorktreeSwitchDialog(tabEl, groupEl) {
  wtSwitchTabEl = tabEl;
  wtSwitchGroupEl = groupEl;
  wtSwitchSelectedBranch = null;
  wtSwitchAllBranches = [];
  wtSwitchBranchSearch.value = '';
  wtSwitchBranchSearch.placeholder = 'Fetching branches...';
  wtSwitchBranchSearch.disabled = true;
  wtSwitchTargetSearch.value = '';
  wtSwitchTargetList.innerHTML = '';
  wtSwitchTargetList.classList.remove('open');
  wtSwitchSelectedTarget = null;
  wtSwitchPreview.textContent = '';
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
  wtSwitchTaskTypeRow.style.display = 'none';
  wtSwitchFeatureRow.style.display = 'none';
  wtSwitchAllFeatures = [];
  wtSwitchSelectedFeature = null;
  wtSwitchFeatureSearch.value = '';
  wtSwitchFeatureSearch.placeholder = 'Loading features...';
  wtSwitchFeatureSearch.disabled = true;
  wtSwitchFeatureList.innerHTML = '';
  wtSwitchFeatureList.classList.remove('open');

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
    if (wtSwitchTargetList.classList.contains('open')) renderSwitchTargetList(wtSwitchTargetSearch.value);
  });

  fetchSwitchTasksForDialog(groupEl._barePath);
}

export function hideWorktreeSwitchDialog() {
  wtSwitchDialogOverlay.classList.remove('visible');
  wtSwitchBranchList.classList.remove('open');
  wtSwitchTaskList.classList.remove('open');
  wtSwitchFeatureList.classList.remove('open');
  wtSwitchTargetList.classList.remove('open');
  wtSwitchTaskDescRow.style.display = 'none';
  wtSwitchTaskTypeRow.style.display = 'none';
  wtSwitchFeatureRow.style.display = 'none';
  wtSwitchTaskDesc.value = '';
}

export async function confirmSwitchWorktree() {
  const targetBranch = wtSwitchSelectedTarget || wtSwitchTargetSearch.value.trim();
  if (!wtSwitchSelectedBranch || !targetBranch) return;
  if (!wtSwitchTabEl || !wtSwitchGroupEl) return;

  const isNewTask = !wtSwitchSelectedTask && wtSwitchTaskSearch.value.trim().length > 0;
  if (isNewTask) {
    if (!wtSwitchAzureContext) { alert('Azure DevOps connection not available. Cannot create task.'); return; }
    const taskTitle = wtSwitchTaskSearch.value.trim();
    const taskDescription = wtSwitchTaskDesc.value.trim();
    const workItemType = wtSwitchTaskType.value || 'Story';
    const parentId = wtSwitchSelectedFeature ? wtSwitchSelectedFeature.id : null;
    try {
      wtSwitchSelectedTask = await createAzureWorkItem(wtSwitchAzureContext, workItemType, taskTitle, taskDescription, parentId);
      window.shellAPI.openExternal(buildAzureTaskUrl(wtSwitchAzureContext, wtSwitchSelectedTask.id));
    } catch (err) { alert(`Failed to create task: ${err.message}`); return; }
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

// --- Event listeners: Task ---

wtSwitchTaskSearch.addEventListener('input', () => {
  wtSwitchSelectedTask = null; wtSwitchTaskHighlightIndex = wtSwitchTaskSearch.value.trim() ? 0 : -1; renderSwitchTaskList(wtSwitchTaskSearch.value); updateSwitchNewTaskFields();
  const typed = wtSwitchTaskSearch.value.trim();
  if (typed) updateTargetFromTask();
  clearTimeout(wtSwitchFetchByIdTimer);
  const idMatch = typed.match(/^#?(\d+)$/);
  if (idMatch && wtSwitchAzureContext && getFilteredSwitchTasks().length === 0) {
    const numId = parseInt(idMatch[1], 10);
    wtSwitchFetchByIdTimer = setTimeout(async () => {
      if (wtSwitchTaskSearch.value.trim() !== typed) return;
      const found = await fetchWorkItemById(wtSwitchAzureContext, numId);
      if (!found) return;
      if (wtSwitchTaskSearch.value.trim() !== typed) return;
      if (!wtSwitchAllTasks.some(t => t.id === found.id)) wtSwitchAllTasks = [found, ...wtSwitchAllTasks];
      renderSwitchTaskList(wtSwitchTaskSearch.value);
    }, 400);
  }
});
wtSwitchTaskSearch.addEventListener('focus', () => { if (wtSwitchAllTasks.length > 0) { wtSwitchTaskHighlightIndex = -1; renderSwitchTaskList(wtSwitchTaskSearch.value); } });
wtSwitchTaskSearch.addEventListener('blur', () => {
  setTimeout(() => {
    wtSwitchTaskList.classList.remove('open');
    if (wtSwitchSelectedTask) { wtSwitchTaskSearch.value = `#${wtSwitchSelectedTask.id} ${wtSwitchSelectedTask.title}`; }
    updateSwitchNewTaskFields();
    const isNewTask = !wtSwitchSelectedTask && wtSwitchTaskSearch.value.trim().length > 0;
    if (isNewTask && wtSwitchAllFeatures.length > 0) suggestSwitchFeatures();
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
  else if (e.key === 'Enter' && wtSwitchTaskHighlightIndex >= 0 && wtSwitchTaskHighlightIndex < filtered.length) { e.preventDefault(); selectWtSwitchTask(filtered[wtSwitchTaskHighlightIndex]); wtSwitchBranchSearch.focus(); }
});

// --- Event listeners: Task description ---

wtSwitchTaskDesc.addEventListener('blur', () => {
  setTimeout(() => {
    const isNewTask = !wtSwitchSelectedTask && wtSwitchTaskSearch.value.trim().length > 0;
    if (isNewTask && wtSwitchAllFeatures.length > 0) suggestSwitchFeatures();
  }, 200);
});
wtSwitchTaskDesc.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideWorktreeSwitchDialog(); });

// --- Event listeners: Feature ---

wtSwitchFeatureSearch.addEventListener('input', () => { wtSwitchSelectedFeature = null; wtSwitchFeatureHighlightIndex = wtSwitchFeatureSearch.value.trim() ? 0 : -1; renderSwitchFeatureList(wtSwitchFeatureSearch.value); });
wtSwitchFeatureSearch.addEventListener('focus', () => { if (wtSwitchAllFeatures.length > 0) { wtSwitchFeatureSearch.value = ''; wtSwitchFeatureHighlightIndex = -1; renderSwitchFeatureList(''); } });
wtSwitchFeatureSearch.addEventListener('blur', () => {
  setTimeout(() => {
    wtSwitchFeatureList.classList.remove('open');
    if (wtSwitchSelectedFeature) wtSwitchFeatureSearch.value = `#${wtSwitchSelectedFeature.id} ${wtSwitchSelectedFeature.title}`;
  }, 200);
});

document.querySelector('#wt-switch-feature-combobox .combobox-arrow').addEventListener('click', () => {
  if (wtSwitchFeatureList.classList.contains('open')) { wtSwitchFeatureList.classList.remove('open'); }
  else if (wtSwitchAllFeatures.length > 0) { wtSwitchFeatureSearch.value = ''; wtSwitchFeatureHighlightIndex = -1; renderSwitchFeatureList(''); wtSwitchFeatureSearch.focus(); }
});

wtSwitchFeatureSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideWorktreeSwitchDialog(); return; }
  const filtered = getFilteredSwitchFeatures();
  if (e.key === 'ArrowDown') { e.preventDefault(); wtSwitchFeatureHighlightIndex = Math.min(wtSwitchFeatureHighlightIndex + 1, filtered.length - 1); renderSwitchFeatureList(wtSwitchFeatureSearch.value); scrollHighlightedIntoView(wtSwitchFeatureList); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); wtSwitchFeatureHighlightIndex = Math.max(wtSwitchFeatureHighlightIndex - 1, 0); renderSwitchFeatureList(wtSwitchFeatureSearch.value); scrollHighlightedIntoView(wtSwitchFeatureList); }
  else if (e.key === 'Enter' && wtSwitchFeatureHighlightIndex >= 0 && wtSwitchFeatureHighlightIndex < filtered.length) { e.preventDefault(); selectWtSwitchFeature(filtered[wtSwitchFeatureHighlightIndex]); wtSwitchBranchSearch.focus(); }
});

// --- Event listeners: Source branch ---

wtSwitchBranchSearch.addEventListener('input', () => { wtSwitchSelectedBranch = null; wtSwitchHighlightIndex = wtSwitchBranchSearch.value.trim() ? 0 : -1; renderSwitchBranchList(wtSwitchBranchSearch.value); });
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
  else if (e.key === 'Enter' && wtSwitchHighlightIndex >= 0 && wtSwitchHighlightIndex < filtered.length) { e.preventDefault(); selectWtSwitchBranch(filtered[wtSwitchHighlightIndex]); wtSwitchTargetSearch.focus(); }
});

// --- Event listeners: Target branch ---

wtSwitchTargetSearch.addEventListener('input', () => { wtSwitchSelectedTarget = null; wtSwitchTargetHighlightIndex = wtSwitchTargetSearch.value.trim() ? 0 : -1; renderSwitchTargetList(wtSwitchTargetSearch.value); updateWtSwitchPreview(); });
wtSwitchTargetSearch.addEventListener('focus', () => { wtSwitchTargetHighlightIndex = -1; renderSwitchTargetList(wtSwitchTargetSearch.value); });
wtSwitchTargetSearch.addEventListener('blur', () => {
  setTimeout(() => {
    wtSwitchTargetList.classList.remove('open');
    if (wtSwitchSelectedTarget) wtSwitchTargetSearch.value = wtSwitchSelectedTarget;
    updateWtSwitchPreview();
  }, 200);
});

document.querySelector('#wt-switch-target-combobox .combobox-arrow').addEventListener('click', () => {
  if (wtSwitchTargetList.classList.contains('open')) { wtSwitchTargetList.classList.remove('open'); }
  else { wtSwitchTargetSearch.value = ''; wtSwitchTargetHighlightIndex = -1; renderSwitchTargetList(''); wtSwitchTargetSearch.focus(); }
});

wtSwitchTargetSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideWorktreeSwitchDialog(); return; }
  const filtered = getSwitchFilteredTargets();
  if (e.key === 'ArrowDown') { e.preventDefault(); wtSwitchTargetHighlightIndex = Math.min(wtSwitchTargetHighlightIndex + 1, filtered.length - 1); renderSwitchTargetList(wtSwitchTargetSearch.value); scrollHighlightedIntoView(wtSwitchTargetList); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); wtSwitchTargetHighlightIndex = Math.max(wtSwitchTargetHighlightIndex - 1, 0); renderSwitchTargetList(wtSwitchTargetSearch.value); scrollHighlightedIntoView(wtSwitchTargetList); }
  else if (e.key === 'Enter') {
    if (wtSwitchTargetHighlightIndex >= 0 && wtSwitchTargetHighlightIndex < filtered.length) { e.preventDefault(); selectWtSwitchTarget(filtered[wtSwitchTargetHighlightIndex]); }
    else { e.preventDefault(); confirmSwitchWorktree(); }
  }
});

// --- Dialog buttons ---

wtSwitchDialogOverlay.addEventListener('click', (e) => { if (e.target === wtSwitchDialogOverlay) hideWorktreeSwitchDialog(); });
document.getElementById('wt-switch-cancel-btn').addEventListener('click', hideWorktreeSwitchDialog);
document.getElementById('wt-switch-confirm-btn').addEventListener('click', confirmSwitchWorktree);
