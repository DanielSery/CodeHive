export { showWorktreeDialog, hideWorktreeDialog, registerWorktreeSidebarFns } from './dialog-worktree.js';
export { showWorktreeSwitchDialog, hideWorktreeSwitchDialog, registerSwitchSidebarFns } from './dialog-switch.js';
export { showCloneDialog, setCloneReposDir, registerCloneSidebarFns, registerOnCloneComplete } from './dialog-clone.js';
export { showDeleteDialog, registerRemoveRepoGroup } from './dialog-delete.js';
export { showWorktreeRemoveDialog } from './dialog-wt-remove.js';
export { showWorktreeDisconnectDialog } from './dialog-wt-disconnect.js';
export { showCommitPushDialog } from './dialog-commit-push.js';
export { showCreatePrDialog } from './dialog-create-pr.js';
export { showResolveTaskDialog } from './dialog-resolve.js';
export { showInstallDialog, showVerifyDialog } from './dialog-verify.js';
export { showCompletePrDialog } from './dialog-complete-pr.js';
export { showSetTaskDialog } from './dialog-set-task.js';
import { registerWorktreeSidebarFns } from './dialog-worktree.js';
import { registerSwitchSidebarFns } from './dialog-switch.js';
import { registerCloneSidebarFns } from './dialog-clone.js';

// Combined registration matching the old dialogs.js registerSidebarFns signature
export function registerSidebarFns(addRepoGroup, createWorktreeTab, rebuildCollapsedDots) {
  registerWorktreeSidebarFns(createWorktreeTab, rebuildCollapsedDots);
  registerSwitchSidebarFns(createWorktreeTab, rebuildCollapsedDots);
  registerCloneSidebarFns(addRepoGroup);
}
