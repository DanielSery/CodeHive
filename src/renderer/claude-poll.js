import { getWorkspace, getActiveId } from './state.js';
import { _refreshTabStatus } from './sidebar/registers.js';

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
}

function stopClaudePoll(id) {
  const ws = getWorkspace(id);
  if (!ws) return;
  pathToId.delete(ws.folderPath);
  window.reposAPI.unwatchClaude(ws.folderPath);
}

// Listen for pushed status updates from the main process
window.reposAPI.onClaudeStatus((wtPath, status) => {
  const id = pathToId.get(wtPath);
  if (id == null) return;
  const ws = getWorkspace(id);
  if (!ws || ws.tabEl._workspaceId === null || ws.tabEl.dataset.status === 'idle') return;

  if (status === 'working') {
    setTabStatus(ws.tabEl, 'working');
    ws.tabEl._wasWorking = true;
  } else if (status === 'waiting') {
    setTabStatus(ws.tabEl, 'waiting');
    ws.tabEl._wasWorking = true;
  } else if (status === 'error') {
    setTabStatus(ws.tabEl, 'error');
    ws.tabEl._wasWorking = true;
  } else if (ws.tabEl._wasWorking) {
    ws.tabEl._wasWorking = false;
    setTabStatus(ws.tabEl, id === getActiveId() ? 'open' : 'done');
    // Refresh git state and button visibility after Claude finishes
    if (_refreshTabStatus) _refreshTabStatus(ws.tabEl);
  }
});

export { setTabStatus, startClaudePoll, stopClaudePoll };
