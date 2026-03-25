import { getWorkspace, getActiveId } from './state.js';

const POLL_INTERVAL = 3000;

function setTabStatus(tabEl, status) {
  tabEl.dataset.status = status;
  if (tabEl._dotEl) tabEl._dotEl.dataset.status = status;
}

function startClaudePoll(id) {
  const ws = getWorkspace(id);
  if (!ws) return;
  ws.tabEl._pollTimer = setInterval(() => pollClaudeStatus(id), POLL_INTERVAL);
}

function stopClaudePoll(id) {
  const ws = getWorkspace(id);
  if (!ws || !ws.tabEl._pollTimer) return;
  clearInterval(ws.tabEl._pollTimer);
  ws.tabEl._pollTimer = null;
}

async function pollClaudeStatus(id) {
  const ws = getWorkspace(id);
  if (!ws || ws.tabEl._workspaceId === null || ws.tabEl.dataset.status === 'idle') return;

  try {
    const result = await window.reposAPI.checkClaudeActive(ws.folderPath);

    if (result === 'working') {
      setTabStatus(ws.tabEl, 'working');
      ws.tabEl._wasWorking = true;
    } else if (ws.tabEl._wasWorking && ws.tabEl.dataset.status === 'working') {
      ws.tabEl._wasWorking = false;
      setTabStatus(ws.tabEl, id === getActiveId() ? 'open' : 'done');
    }
  } catch {
    // Ignore errors
  }
}

export { setTabStatus, startClaudePoll, stopClaudePoll };
