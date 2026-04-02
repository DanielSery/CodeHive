import { completePullRequest } from './azure-api.js';
import { showCompletePrDialog } from './dialogs/dialog-complete-pr.js';
import { pipeline } from './pipeline-service.js';
import { getWtState } from './worktree-state.js';

export const pr = {
  open(tabEl) {
    const ws = getWtState(tabEl._wtPath);
    if (ws?.existingPrUrl) window.shellAPI.openExternal(ws.existingPrUrl);
  },

  openMerged(tabEl) {
    const ws = getWtState(tabEl._wtPath);
    if (ws?.mergedPrUrl) window.shellAPI.openExternal(ws.mergedPrUrl);
  },

  async complete(tabEl) {
    const ws = getWtState(tabEl._wtPath);
    if (!ws?.prData) return null;
    const d = ws.prData;
    const confirmed = await showCompletePrDialog(d.title, d.targetRefName, ws.existingPrUrl);
    if (!confirmed) return null;
    const result = await completePullRequest(d.org, d.project, d.auth, d.repoId, d.id, d.lastCommitId);
    if (result) {
      ws.canCompletePr = false;
      if (tabEl._wtTaskId) {
        pipeline.startMonitoring(tabEl, d.targetRefName, result.closedDate || new Date().toISOString());
      }
    }
    return result;
  },
};
