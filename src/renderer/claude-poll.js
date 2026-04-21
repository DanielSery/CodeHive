import { getWorkspace, getActiveId } from './state.js';
import { _refreshTabStatus } from './sidebar/registers.js';
import { getWtState } from './worktree-state.js';

// Map folderPath → workspace id for routing pushed status events
const pathToId = new Map();

function setTabStatus(tabEl, status) {
  tabEl.dataset.status = status;
  if (tabEl._dotEl) tabEl._dotEl.dataset.status = status;
}

function startClaudePoll(id) {
  const ws = getWorkspace(id);
  if (!ws) return;
  pathToId.set(ws.folderPath, id);
  window.reposAPI.watchClaude(ws.folderPath);
  window.reposAPI.watchGit(ws.folderPath);
}

function stopClaudePoll(id) {
  const ws = getWorkspace(id);
  if (!ws) return;
  pathToId.delete(ws.folderPath);
  window.reposAPI.unwatchClaude(ws.folderPath);
  window.reposAPI.unwatchGit(ws.folderPath);
}

// Listen for pushed status updates from the main process
window.reposAPI.onClaudeStatus((wtPath, status) => {
  const id = pathToId.get(wtPath);
  if (id == null) return;
  const ws = getWorkspace(id);
  if (!ws || ws.tabEl._workspaceId === null || ws.tabEl.dataset.status === 'idle') return;
  const wtState = getWtState(ws.tabEl._wtPath);
  if (!wtState) return;

  if (status === 'working') {
    setTabStatus(ws.tabEl, 'working');
    wtState.wasWorking = true;
  } else if (status === 'waiting') {
    if (id !== getActiveId()) {
      setTabStatus(ws.tabEl, 'waiting');
    }
    wtState.wasWorking = true;
  } else if (status === 'error') {
    setTabStatus(ws.tabEl, 'error');
    wtState.wasWorking = true;
  } else if (wtState.wasWorking) {
    wtState.wasWorking = false;
    setTabStatus(ws.tabEl, id === getActiveId() ? 'open' : 'done');
    // Refresh git state and button visibility after Claude finishes
    if (_refreshTabStatus) _refreshTabStatus(ws.tabEl);
  }
});

window.reposAPI.onGitChanged((wtPath) => {
  const id = pathToId.get(wtPath);
  if (id == null) return;
  const ws = getWorkspace(id);
  if (!ws || ws.tabEl._workspaceId === null) return;
  if (_refreshTabStatus) _refreshTabStatus(ws.tabEl);
});

export { setTabStatus, startClaudePoll, stopClaudePoll };
