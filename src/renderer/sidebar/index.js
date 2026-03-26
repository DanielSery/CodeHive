// Side-effect imports (attach event listeners, init resize handle)
import './sidebar-resize.js';
import './shortcuts.js';

export { addRepoGroup, clearAllGroups, removeRepoGroup, getRepoOrder } from './repo-group.js';
export { createWorktreeTab, showTabCloseButton, showTabRemoveButton, getWorktreeOrders, getOpenWorktreePaths } from './worktree-tab.js';
export { rebuildCollapsedDots } from './collapsed-dots.js';
export { registerWorktreeDialog, registerDeleteDialog, registerWorktreeRemoveDialog, registerWorktreeSwitchDialog, registerCommitPushDialog, registerCreatePrDialog, registerToggleTerminal, registerOnStateChange } from './registers.js';
