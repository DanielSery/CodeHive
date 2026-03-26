import { openWorktree, closeWorkspace } from '../workspace-manager.js';
import { getActive } from '../state.js';
import { _showWorktreeDialog, _showWorktreeSwitchDialog, _showCommitPushDialog, _showCreatePrDialog, _toggleTerminal } from './registers.js';

const repoGroupsEl = document.getElementById('repo-groups');

const SHORTCUT_HOLD_DELAY = 300;
let _shortcutHoldTimer = null;
let _shortcutBadgesVisible = false;

export function showShortcutBadges() {
  const tabs = Array.from(document.querySelectorAll('.repo-group-tabs.expanded .workspace-tab'))
    .filter(tab => tab._workspaceId !== null);
  const digits = ['1','2','3','4','5','6','7','8','9','0'];
  tabs.forEach((tab, i) => {
    if (i >= digits.length) return;
    let badge = tab.querySelector('.workspace-tab-shortcut-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'workspace-tab-shortcut-badge';
      tab.insertBefore(badge, tab.firstChild);
    }
    badge.textContent = digits[i];
  });
  repoGroupsEl.classList.add('show-shortcut-numbers');
  _shortcutBadgesVisible = true;
}

export function hideShortcutBadges() {
  repoGroupsEl.classList.remove('show-shortcut-numbers');
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

export function handleCtrlAltShortcut(key) {
  cancelShortcutHold();

  const digits = ['1','2','3','4','5','6','7','8','9','0'];
  const digitIdx = digits.indexOf(key);
  if (digitIdx !== -1) {
    const tabs = Array.from(document.querySelectorAll('.repo-group-tabs.expanded .workspace-tab'))
      .filter(tab => tab._workspaceId !== null);
    const tab = tabs[digitIdx];
    if (tab) openWorktree(tab, { path: tab._wtPath, branch: tab._wtBranch });
    return;
  }

  const lkey = key.toLowerCase();

  if (lkey === 't') {
    if (_toggleTerminal) _toggleTerminal();
    return;
  }

  if (lkey === 'w') {
    const ws = getActive();
    if (ws) closeWorkspace(ws.tabEl._workspaceId);
    return;
  }

  if (lkey === 'p') {
    const tabEl = _activeTab();
    if (tabEl && _showCommitPushDialog) {
      _showCommitPushDialog(tabEl, tabEl.closest('.repo-group'));
    }
    return;
  }

  if (lkey === 'm') {
    const tabEl = _activeTab();
    if (!tabEl) return;
    if (tabEl._existingPrUrl) {
      window.shellAPI.openExternal(tabEl._existingPrUrl);
    } else if (_showCreatePrDialog) {
      _showCreatePrDialog(tabEl, tabEl.closest('.repo-group'));
    }
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

  if (lkey === 'e') {
    const tabEl = _activeTab();
    if (tabEl) window.shellAPI.openInExplorer(tabEl._wtPath);
    return;
  }

  if (lkey === 'a') {
    const tabEl = _activeTab();
    if (!tabEl) return;
    const taskId = tabEl._wtTaskId;
    if (!taskId) return;
    const groupEl = tabEl.closest('.repo-group');
    const barePath = groupEl ? groupEl._barePath : null;
    (async () => {
      let url = null;
      if (barePath) {
        try {
          const remoteUrl = await window.reposAPI.remoteUrl(barePath);
          const m = remoteUrl && remoteUrl.match(/https?:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\//);
          if (m) {
            url = `https://dev.azure.com/${encodeURIComponent(decodeURIComponent(m[1]))}/${encodeURIComponent(decodeURIComponent(m[2]))}/_workitems/edit/${taskId}`;
          } else {
            const m2 = remoteUrl && remoteUrl.match(/https?:\/\/(?:[^@/]+@)?([^.]+)\.visualstudio\.com\/([^/]+)\/_git\//);
            if (m2) {
              url = `https://dev.azure.com/${encodeURIComponent(m2[1])}/${encodeURIComponent(decodeURIComponent(m2[2]))}/_workitems/edit/${taskId}`;
            }
          }
        } catch {}
      }
      if (url) window.shellAPI.openExternal(url);
    })();
    return;
  }
}

document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || !e.altKey) return;

  if (!_shortcutBadgesVisible && !_shortcutHoldTimer && (e.key === 'Control' || e.key === 'Alt')) {
    _shortcutHoldTimer = setTimeout(showShortcutBadges, SHORTCUT_HOLD_DELAY);
  }

  if (e.key === 'Control' || e.key === 'Alt') return;
  e.preventDefault();
  handleCtrlAltShortcut(e.key);
});

// Also handle shortcuts when keyboard focus is inside a VS Code webview
window.shortcutAPI.onCtrlAlt((key) => {
  handleCtrlAltShortcut(key);
});

document.addEventListener('keyup', (e) => {
  if (e.key === 'Control' || e.key === 'Alt') cancelShortcutHold();
});

window.addEventListener('blur', () => {
  cancelShortcutHold();
});
