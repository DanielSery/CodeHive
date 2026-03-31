import { openWorktree, closeWorkspace } from '../workspace-manager.js';
import { getActive } from '../state.js';
import { _showWorktreeDialog, _showWorktreeSwitchDialog, _showCommitPushDialog, _showCreatePrDialog, _toggleTerminal } from './registers.js';

const repoGroupsEl = document.getElementById('repo-groups');

const SHORTCUT_HOLD_DELAY = 300;
let _shortcutHoldTimer = null;
let _shortcutBadgesVisible = false;

function getAllTabs() {
  return Array.from(document.querySelectorAll('.workspace-tab'));
}

export function showShortcutBadges() {
  // Remove all stale badges first (closed tabs may still have them)
  for (const old of document.querySelectorAll('.workspace-tab-shortcut-badge')) {
    old.remove();
  }
  const tabs = getAllTabs();
  const digits = ['1','2','3','4','5','6','7','8','9','0'];
  const isCollapsed = document.getElementById('sidebar').classList.contains('collapsed');
  tabs.forEach((tab, i) => {
    if (i >= digits.length) return;
    // Badge on the tab itself (expanded sidebar)
    const badge = document.createElement('span');
    badge.className = 'workspace-tab-shortcut-badge';
    badge.textContent = digits[i];
    tab.insertBefore(badge, tab.firstChild);
    // Badge on the collapsed dot
    if (isCollapsed && tab._dotEl) {
      let dotBadge = tab._dotEl.querySelector('.workspace-tab-shortcut-badge');
      if (!dotBadge) {
        dotBadge = document.createElement('span');
        dotBadge.className = 'workspace-tab-shortcut-badge';
        tab._dotEl.appendChild(dotBadge);
      }
      dotBadge.textContent = digits[i];
    }
  });
  repoGroupsEl.classList.add('show-shortcut-numbers');
  _shortcutBadgesVisible = true;
}

export function hideShortcutBadges() {
  repoGroupsEl.classList.remove('show-shortcut-numbers');
  // Remove badges from collapsed dots
  for (const badge of document.querySelectorAll('.collapsed-dot .workspace-tab-shortcut-badge')) {
    badge.remove();
  }
  _shortcutBadgesVisible = false;
  _shortcutHoldTimer = null;
}

export function cancelShortcutHold() {
  if (_shortcutHoldTimer) {
    clearTimeout(_shortcutHoldTimer);
    _shortcutHoldTimer = null;
  }
  if (_shortcutBadgesVisible) hideShortcutBadges();
}

function _activeTab() {
  return getActive()?.tabEl ?? null;
}

export function handleAltShortcut(key) {
  cancelShortcutHold();

  const digits = ['1','2','3','4','5','6','7','8','9','0'];
  const digitIdx = digits.indexOf(key);
  if (digitIdx !== -1) {
    const tabs = getAllTabs();
    const tab = tabs[digitIdx];
    if (tab) openWorktree(tab, { path: tab._wtPath, branch: tab._wtBranch });
    return;
  }

  const lkey = key.toLowerCase();

  if (lkey === 'w') {
    const ws = getActive();
    if (ws) closeWorkspace(ws.tabEl._workspaceId);
    return;
  }

  if (lkey === 'n') {
    const tabEl = _activeTab();
    const groupEl = tabEl ? tabEl.closest('.repo-group') : repoGroupsEl.querySelector('.repo-group');
    if (groupEl && _showWorktreeDialog) {
      _showWorktreeDialog(groupEl, groupEl.querySelector('.repo-group-tabs'));
    }
    return;
  }

  if (lkey === 'r') {
    const tabEl = _activeTab();
    if (tabEl && _showWorktreeSwitchDialog) {
      _showWorktreeSwitchDialog(tabEl, tabEl.closest('.repo-group'));
    }
    return;
  }

  // Alt+Enter — smart action: trigger the visible action button on active tab
  if (key === 'Enter') {
    const tabEl = _activeTab();
    if (!tabEl) return;
    const btns = [
      '.workspace-tab-commit-push',
      '.workspace-tab-complete-pr',
      '.workspace-tab-resolve-task',
      '.workspace-tab-create-pr',
      '.workspace-tab-open-pr',
      '.workspace-tab-switch'
    ];
    for (const sel of btns) {
      const btn = tabEl.querySelector(sel);
      if (btn && btn.style.display !== 'none') {
        btn.click();
        return;
      }
    }
    return;
  }
}

function isDialogOpen() {
  return !!document.querySelector('.dialog-overlay.visible');
}

document.addEventListener('keydown', (e) => {
  if (!e.altKey || e.ctrlKey) return;
  if (isDialogOpen()) return;

  if (!_shortcutBadgesVisible && !_shortcutHoldTimer && e.key === 'Alt') {
    _shortcutHoldTimer = setTimeout(showShortcutBadges, SHORTCUT_HOLD_DELAY);
  }

  if (e.key === 'Alt') return;
  e.preventDefault();
  handleAltShortcut(e.key);
});

// Also handle shortcuts when keyboard focus is inside a VS Code webview
window.shortcutAPI.onAlt((key) => {
  handleAltShortcut(key);
});

document.addEventListener('keyup', (e) => {
  if (e.key === 'Alt') cancelShortcutHold();
});

window.addEventListener('blur', () => {
  cancelShortcutHold();
});
