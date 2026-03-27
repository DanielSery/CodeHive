import { openWorktree } from '../workspace-manager.js';
import { createTerminal, showTerminal, showCloseButton, setTitle, closeTerminal } from '../terminal-panel.js';
import { getCachedBranchesFromState, saveBranchCache, saveSourceBranch, saveTaskId } from '../storage.js';
import { fetchAzureTasks, fetchAzureFeatures, createAzureWorkItem, buildAzureTaskUrl, fetchWorkItemById, updateWorkItemState } from '../azure-api.js';
import { inferWorkItemType, sanitizePathPart, userToPrefix, nameToBranch, loadStoredPat, fuzzyMatch, fuzzyScore, getCachedFeatures, saveFeatureCache, getCachedTasks, saveTaskCache } from './utils.js';

const wtDialogOverlay = document.getElementById('worktree-dialog-overlay');

export function stripHtml(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
const wtTaskSearch = document.getElementById('wt-task-search');
const wtTaskList = document.getElementById('wt-task-list');
const wtTaskDescRow = document.getElementById('wt-task-desc-row');
const wtTaskDesc = document.getElementById('wt-task-desc');
const wtTaskTypeRow = document.getElementById('wt-task-type-row');
const wtTaskType = document.getElementById('wt-task-type');
const wtFeatureRow = document.getElementById('wt-feature-row');
const wtFeatureSearch = document.getElementById('wt-feature-search');
const wtFeatureList = document.getElementById('wt-feature-list');
const wtBranchSearch = document.getElementById('wt-branch-search');
const wtBranchList = document.getElementById('wt-branch-list');
const wtTargetSearch = document.getElementById('wt-target-search');
const wtTargetList = document.getElementById('wt-target-list');
const wtPreview = document.getElementById('wt-preview');

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
let wtAllFeatures = [];
let wtSelectedFeature = null;
let wtFeatureHighlightIndex = -1;
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
  wtFeatureRow.style.display = isNewTask ? '' : 'none';
  if (isNewTask) wtTaskType.value = inferWorkItemType(wtTaskSearch.value.trim());
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

function applyWtFeatures(features) {
  wtAllFeatures = features;
  wtFeatureSearch.placeholder = features.length === 0 ? 'No features found' : 'Search features...';
  wtFeatureSearch.disabled = features.length === 0;
}

async function fetchTasksForDialog(barePath) {
  const focusTaskSearch = () => { if (wtDialogOverlay.classList.contains('visible')) wtTaskSearch.focus(); };
  const pat = loadStoredPat();

  // Apply caches immediately
  const cached = getCachedTasks(barePath);
  if (cached) {
    applyWtTasks(cached.tasks, cached.azureContext, focusTaskSearch);
    const cachedFeatures = getCachedFeatures(barePath);
    if (cachedFeatures) applyWtFeatures(cachedFeatures);
  }

  // Always refresh in background
  const result = await fetchAzureTasks(barePath, pat);
  if (result.error === 'no-pat') { if (!cached) { wtTaskSearch.placeholder = 'Enter PAT to load tasks'; wtTaskSearch.disabled = false; focusTaskSearch(); } return; }
  if (result.error === 'not-azure') { if (!cached) { wtTaskSearch.placeholder = 'Not an Azure DevOps repository'; wtTaskSearch.disabled = false; focusTaskSearch(); } return; }
  if (result.error) { if (!cached) { wtTaskSearch.placeholder = 'Could not load tasks'; wtTaskSearch.disabled = false; focusTaskSearch(); } return; }
  saveTaskCache(barePath, { tasks: result.tasks, azureContext: result.azureContext });
  applyWtTasks(result.tasks, result.azureContext, focusTaskSearch);

  fetchAzureFeatures(wtAzureContext).then(features => {
    saveFeatureCache(barePath, features);
    applyWtFeatures(features);
  });
}

// --- Feature combobox ---

function getFilteredFeatures() {
  const q = (wtFeatureSearch.value || '').toLowerCase();
  return wtAllFeatures.filter(f => fuzzyMatch(`#${f.id} ${f.title}`, q)).sort((a, b) => fuzzyScore(`#${b.id} ${b.title}`, q) - fuzzyScore(`#${a.id} ${a.title}`, q));
}

function renderFeatureList(filter) {
  wtFeatureList.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const filtered = wtAllFeatures.filter(f => fuzzyMatch(`#${f.id} ${f.title}`, q)).sort((a, b) => fuzzyScore(`#${b.id} ${b.title}`, q) - fuzzyScore(`#${a.id} ${a.title}`, q));
  if (filtered.length === 0) { wtFeatureList.classList.remove('open'); wtFeatureHighlightIndex = -1; return; }
  filtered.forEach((f, i) => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    if (wtSelectedFeature && f.id === wtSelectedFeature.id) item.classList.add('selected');
    if (i === wtFeatureHighlightIndex) item.classList.add('highlighted');
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
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectWtFeature(f); });
    wtFeatureList.appendChild(item);
  });
  wtFeatureList.classList.add('open');
}

function selectWtFeature(f) {
  wtSelectedFeature = f;
  wtFeatureSearch.value = f ? `#${f.id} ${f.title}` : '';
  wtFeatureList.classList.remove('open');
  wtFeatureHighlightIndex = -1;
}

async function suggestFeatures() {
  if (wtAllFeatures.length === 0) return;
  const taskName = wtTaskSearch.value.trim();
  const taskDesc = wtTaskDesc.value.trim();
  if (!taskName) return;

  const featureListStr = wtAllFeatures.map(f => {
    const desc = f.description ? stripHtml(f.description).substring(0, 300) : '';
    return desc ? `${f.id}: ${f.title}\n  ${desc}` : `${f.id}: ${f.title}`;
  }).join('\n');
  const prompt = `Given these Azure DevOps features:\n${featureListStr}\n\nWhich top 5 features best match this task?\nTask name: ${taskName}\nTask description: ${taskDesc || '(none)'}\n\nReturn ONLY a comma-separated list of feature IDs (numbers only), best match first. No explanation.`;

  try {
    const response = await window.claudeAPI.run(prompt);
    const ids = response.match(/\d+/g);
    if (!ids || ids.length === 0) return;

    const topIds = ids.slice(0, 5).map(Number);
    // Reorder: top matches first, then the rest
    const topFeatures = [];
    const restFeatures = [];
    for (const f of wtAllFeatures) {
      if (topIds.includes(f.id)) topFeatures.push(f);
      else restFeatures.push(f);
    }
    // Sort top features by their position in the AI response
    topFeatures.sort((a, b) => topIds.indexOf(a.id) - topIds.indexOf(b.id));
    wtAllFeatures = [...topFeatures, ...restFeatures];

    // Pre-select the best match, but don't close the list if user is actively browsing
    if (topFeatures.length > 0) {
      if (wtFeatureList.classList.contains('open')) {
        wtSelectedFeature = topFeatures[0];
        renderFeatureList(wtFeatureSearch.value);
      } else {
        selectWtFeature(topFeatures[0]);
      }
    }
  } catch {
    // Claude CLI not available, features remain in default order
  }
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
  wtFeatureRow.style.display = 'none';
  wtAllFeatures = [];
  wtSelectedFeature = null;
  wtFeatureSearch.value = '';
  wtFeatureSearch.placeholder = 'Loading features...';
  wtFeatureSearch.disabled = true;
  wtFeatureList.innerHTML = '';
  wtFeatureList.classList.remove('open');

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
  wtFeatureList.classList.remove('open');
  wtTargetList.classList.remove('open');
  wtTaskDescRow.style.display = 'none';
  wtTaskTypeRow.style.display = 'none';
  wtFeatureRow.style.display = 'none';
  wtTaskDesc.value = '';
}

export async function confirmCreateWorktree() {
  const targetBranch = wtSelectedTarget || wtTargetSearch.value.trim();
  if (!wtSelectedBranch || !targetBranch) return;

  const isNewTask = !wtSelectedTask && wtTaskSearch.value.trim().length > 0;
  if (isNewTask) {
    if (!wtAzureContext) { alert('Azure DevOps connection not available. Cannot create task.'); return; }
    const taskTitle = wtTaskSearch.value.trim();
    const taskDescription = wtTaskDesc.value.trim();
    const workItemType = wtTaskType.value || 'Story';
    const parentId = wtSelectedFeature ? wtSelectedFeature.id : null;
    try {
      wtSelectedTask = await createAzureWorkItem(wtAzureContext, workItemType, taskTitle, taskDescription, parentId);
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
    // Trigger feature suggestion when leaving task field with a new task name
    const isNewTask = !wtSelectedTask && wtTaskSearch.value.trim().length > 0;
    if (isNewTask && wtAllFeatures.length > 0) suggestFeatures();
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

wtTaskDesc.addEventListener('blur', () => {
  // Re-trigger feature suggestion when description changes
  setTimeout(() => {
    const isNewTask = !wtSelectedTask && wtTaskSearch.value.trim().length > 0;
    if (isNewTask && wtAllFeatures.length > 0) suggestFeatures();
  }, 200);
});
wtTaskDesc.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideWorktreeDialog(); });

// --- Event listeners: Feature ---

wtFeatureSearch.addEventListener('input', () => { wtSelectedFeature = null; wtFeatureHighlightIndex = wtFeatureSearch.value.trim() ? 0 : -1; renderFeatureList(wtFeatureSearch.value); });
wtFeatureSearch.addEventListener('focus', () => { if (wtAllFeatures.length > 0) { wtFeatureSearch.value = ''; wtFeatureHighlightIndex = -1; renderFeatureList(''); } });
wtFeatureSearch.addEventListener('blur', () => {
  setTimeout(() => {
    wtFeatureList.classList.remove('open');
    hideFeaturePopupNow();
    if (wtSelectedFeature) wtFeatureSearch.value = `#${wtSelectedFeature.id} ${wtSelectedFeature.title}`;
  }, 200);
});

document.querySelector('#wt-feature-combobox .combobox-arrow').addEventListener('click', () => {
  if (wtFeatureList.classList.contains('open')) { wtFeatureList.classList.remove('open'); }
  else if (wtAllFeatures.length > 0) { wtFeatureSearch.value = ''; wtFeatureHighlightIndex = -1; renderFeatureList(''); wtFeatureSearch.focus(); }
});

wtFeatureSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideWorktreeDialog(); return; }
  const filtered = getFilteredFeatures();
  if (e.key === 'ArrowDown') { e.preventDefault(); wtFeatureHighlightIndex = Math.min(wtFeatureHighlightIndex + 1, filtered.length - 1); renderFeatureList(wtFeatureSearch.value); scrollHighlightedIntoView(wtFeatureList); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); wtFeatureHighlightIndex = Math.max(wtFeatureHighlightIndex - 1, 0); renderFeatureList(wtFeatureSearch.value); scrollHighlightedIntoView(wtFeatureList); }
  else if (e.key === 'Enter' && wtFeatureHighlightIndex >= 0 && wtFeatureHighlightIndex < filtered.length) { e.preventDefault(); selectWtFeature(filtered[wtFeatureHighlightIndex]); wtBranchSearch.focus(); }
});

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
  const filtered = getFilteredTargets();
  if (e.key === 'ArrowDown') { e.preventDefault(); wtTargetHighlightIndex = Math.min(wtTargetHighlightIndex + 1, filtered.length - 1); renderTargetList(wtTargetSearch.value); scrollHighlightedIntoView(wtTargetList); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); wtTargetHighlightIndex = Math.max(wtTargetHighlightIndex - 1, 0); renderTargetList(wtTargetSearch.value); scrollHighlightedIntoView(wtTargetList); }
  else if (e.key === 'Enter') {
    if (wtTargetHighlightIndex >= 0 && wtTargetHighlightIndex < filtered.length) { e.preventDefault(); selectWtTarget(filtered[wtTargetHighlightIndex]); }
    else { e.preventDefault(); confirmCreateWorktree(); }
  }
});

// --- Dialog buttons ---

wtDialogOverlay.addEventListener('click', (e) => { if (e.target === wtDialogOverlay) hideWorktreeDialog(); });
document.getElementById('wt-cancel-btn').addEventListener('click', hideWorktreeDialog);
document.getElementById('wt-confirm-btn').addEventListener('click', confirmCreateWorktree);
