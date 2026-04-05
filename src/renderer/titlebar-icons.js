import {
  DOT_COMMIT_PUSH_SVG, DOT_CREATE_PR_SVG, DOT_OPEN_PR_SVG, DOT_COMPLETE_PR_SVG,
  DOT_RESOLVE_TASK_SVG, DOT_PIPELINE_SVG, DOT_OPEN_TASK_SVG, DOT_SWITCH_SVG,
  DOT_SET_TASK_SVG, DOT_OPEN_MERGED_PR_SVG, INSTALL_BTN_SVG, BIN_ICON_SVG,
  OPEN_DIRECTORY_SVG, OPEN_EXPLORER_SVG, CLONE_REPO_SVG, AZURE_PAT_SVG,
  GIT_APP_SVG, THEME_DARK_SVG, THEME_LIGHT_SVG, TERMINAL_SVG, UPDATE_SVG,
} from './sidebar/worktree-tab-icons.js';

const BUTTON_ICONS = {
  'btn-open-directory': OPEN_DIRECTORY_SVG,
  'btn-clone-repo': CLONE_REPO_SVG,
  'btn-azure-pat': AZURE_PAT_SVG,
  'btn-check-updates': UPDATE_SVG,
  'btn-titlebar-commit': DOT_COMMIT_PUSH_SVG,
  'btn-titlebar-create-pr': DOT_CREATE_PR_SVG,
  'btn-titlebar-open-pr': DOT_OPEN_PR_SVG,
  'btn-titlebar-complete-pr': DOT_COMPLETE_PR_SVG,
  'btn-titlebar-resolve-task': DOT_RESOLVE_TASK_SVG,
  'btn-titlebar-open-pipeline': DOT_PIPELINE_SVG,
  'btn-titlebar-open-task': DOT_OPEN_TASK_SVG,
  'btn-titlebar-open-explorer': OPEN_EXPLORER_SVG,
  'btn-titlebar-remove': BIN_ICON_SVG,
  'btn-titlebar-install': INSTALL_BTN_SVG,
  'btn-titlebar-set-task': DOT_SET_TASK_SVG,
'btn-titlebar-open-merged-pr': DOT_OPEN_MERGED_PR_SVG,
  'btn-titlebar-git-app': GIT_APP_SVG,
  'btn-titlebar-switch': DOT_SWITCH_SVG,
  'btn-theme': THEME_DARK_SVG + THEME_LIGHT_SVG,
  'collapsed-terminal-btn': TERMINAL_SVG,
};

for (const [id, svg] of Object.entries(BUTTON_ICONS)) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = svg;
}

const terminalTab = document.getElementById('sidebar-terminal-tab');
if (terminalTab) terminalTab.innerHTML = TERMINAL_SVG + '<span>Terminal</span>';
