/**
 * Worktree state store.
 * All volatile business-logic state for a worktree tab is stored here,
 * keyed by wtPath. This decouples state from the DOM element so it can be
 * read without querying the sidebar, is visible in devtools, and is cleaned
 * up in a single call when a worktree is removed.
 *
 * Identity fields (set once, never change) stay on the DOM element:
 *   tabEl._wtPath, _wtBranch, _wtSourceBranch, _wtTaskId, _dotEl, _workspaceId
 */

const _states = new Map();

export function initWtState(wtPath, initial = {}) {
  _states.set(wtPath, {
    // Claude poll
    wasWorking: false,
    // PR
    prData: null,
    existingPrUrl: null,
    mergedPrUrl: null,
    canCompletePr: false,
    // Task
    canResolveTask: false,
    taskResolved: false,
    taskUrl: null,
    // Pipeline
    pipelineInstalled: false,
    canOpenPipeline: false,
    pipelineTargetBranch: null,
    pipelineMergeTime: null,
    pipelineBuildId: null,
    pipelineBuildNumber: null,
    pipelineDefinitionId: null,
    pipelineStatus: null,
    pipelineUrl: null,
    // Git
    hasUncommittedChanges: false,
    hasPushedCommits: false,
    syncState: 'clean',
    // UI
    switchMode: null,
    // Refresh guard
    refreshInFlight: false,
    refreshPending: false,
    ...initial,
  });
}

export function getWtState(wtPath) {
  return _states.get(wtPath);
}

export function removeWtState(wtPath) {
  _states.delete(wtPath);
}
