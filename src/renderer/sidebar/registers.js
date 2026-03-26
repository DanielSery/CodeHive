// Lazy references injected by renderer.js to avoid circular imports with dialogs.js
export let _showWorktreeDialog = null;
export let _showDeleteDialog = null;
export let _showWorktreeRemoveDialog = null;
export let _showWorktreeSwitchDialog = null;
export let _showCommitPushDialog = null;
export let _showCreatePrDialog = null;
export let _onStateChange = null;
export let _toggleTerminal = null;

export function registerWorktreeDialog(fn) { _showWorktreeDialog = fn; }
export function registerDeleteDialog(fn) { _showDeleteDialog = fn; }
export function registerWorktreeRemoveDialog(fn) { _showWorktreeRemoveDialog = fn; }
export function registerWorktreeSwitchDialog(fn) { _showWorktreeSwitchDialog = fn; }
export function registerCommitPushDialog(fn) { _showCommitPushDialog = fn; }
export function registerCreatePrDialog(fn) { _showCreatePrDialog = fn; }
export function registerOnStateChange(fn) { _onStateChange = fn; }
export function registerToggleTerminal(fn) { _toggleTerminal = fn; }
