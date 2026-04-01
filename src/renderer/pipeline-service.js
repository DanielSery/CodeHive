import { savePipelineInstalled } from './storage.js';
import { getWtState } from './worktree-state.js';

export const pipeline = {
  open(tabEl) {
    const ws = getWtState(tabEl._wtPath);
    if (ws?.pipelineUrl) window.shellAPI.openExternal(ws.pipelineUrl);
  },

  // Enables pipeline monitoring for a tab. Only sets branch/time if not already known,
  // so a subsequent status refresh won't overwrite values set by an explicit PR completion.
  startMonitoring(tabEl, targetBranch, mergeTime) {
    const ws = getWtState(tabEl._wtPath);
    if (!ws) return;
    ws.canOpenPipeline = true;
    if (!ws.pipelineTargetBranch) {
      ws.pipelineTargetBranch = targetBranch;
      ws.pipelineMergeTime = mergeTime ?? null;
    }
  },

  markInstalled(tabEl) {
    const ws = getWtState(tabEl._wtPath);
    if (!ws) return;
    ws.pipelineInstalled = true;
    savePipelineInstalled(tabEl._wtPath, true);
  },
};
