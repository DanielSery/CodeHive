import { terminal, registerPtyApi } from '../terminal-panel.js';
import { _refreshTabStatus } from '../sidebar/registers.js';
import { runPty } from './pty-runner.js';
import { renderCommitFileList } from './commit-file-tree.js';
import { runPushFlow } from '../push-flow.js';

registerPtyApi(window.commitPushAPI);
registerPtyApi(window.syncAPI);

// ─── DOM references ───────────────────────────────────────────────────────────
const syncDialogOverlay   = document.getElementById('sync-changes-dialog-overlay');
const syncDialogBox       = document.getElementById('sync-changes-dialog-box');
const syncTitle           = document.getElementById('sync-changes-title');
const syncDesc            = document.getElementById('sync-changes-desc');

const syncAheadSection    = document.getElementById('sync-ahead-section');
const syncAheadLabel      = document.getElementById('sync-ahead-label');
const syncAheadList       = document.getElementById('sync-ahead-list');

const syncBehindSection   = document.getElementById('sync-behind-section');
const syncBehindLabel     = document.getElementById('sync-behind-label');
const syncBehindList      = document.getElementById('sync-behind-list');

const syncUncommittedSection = document.getElementById('sync-uncommitted-section');
const syncDiffToolbar     = document.getElementById('sync-diff-toolbar');
const syncFileList        = document.getElementById('sync-file-list');
const syncTitleInput      = document.getElementById('sync-title-input');
const syncDescInput       = document.getElementById('sync-desc-input');

const syncStandardButtons = document.getElementById('sync-standard-buttons');
const syncCancelBtn       = document.getElementById('sync-cancel-btn');
const syncConfirmBtn      = document.getElementById('sync-confirm-btn');

const syncPhase1Footer    = document.getElementById('sync-phase1-footer');
const syncPhase1CancelBtn = document.getElementById('sync-phase1-cancel-btn');
const syncPhase1NextBtn   = document.getElementById('sync-phase1-next-btn');

const syncResolveSection   = document.getElementById('sync-resolve-section');
const syncResolveStrategy  = document.getElementById('sync-resolve-strategy');
const syncResolveCancelBtn = document.getElementById('sync-resolve-cancel-btn');
const syncGetTheirsBtn     = document.getElementById('sync-get-theirs-btn');
const syncMergeBtn         = document.getElementById('sync-merge-btn');
const syncRebaseBtn        = document.getElementById('sync-rebase-btn');
const syncKeepMineBtn      = document.getElementById('sync-keep-mine-btn');

const syncStepIndicator   = document.getElementById('sync-step-indicator');
const syncStepCurrent     = document.getElementById('sync-step-current');
const syncDivergeNotice   = document.getElementById('sync-diverge-notice');
const syncCommitsWrapper  = document.getElementById('sync-commits-wrapper');
const syncCommitInputs    = document.getElementById('sync-commit-inputs');
const syncRolledBackNotice = document.getElementById('sync-rolled-back-notice');

// ─── State ────────────────────────────────────────────────────────────────────
const DIALOG_SIZE_KEY = 'syncChangesDialogSize';
let _syncTabEl = null;
let _fileTree  = null;
let _syncState = 'clean'; // 'uncommitted' | 'ahead' | 'behind' | 'diverged'
let _hasUncommitted = false;
let _localAhead = 0;
let _divergedPhase = 1;   // 1 = commit form, 2 = resolve strategy (diverged+uncommitted only)
let _sourceBranch = 'master';

function saveDialogSize() {
  localStorage.setItem(DIALOG_SIZE_KEY, JSON.stringify({
    width: syncDialogBox.offsetWidth,
    height: syncDialogBox.offsetHeight,
  }));
}

function restoreDialogSize() {
  const saved = localStorage.getItem(DIALOG_SIZE_KEY);
  if (!saved) return;
  try {
    const { width, height } = JSON.parse(saved);
    syncDialogBox.style.width  = `${width}px`;
    syncDialogBox.style.height = `${height}px`;
  } catch {}
}

let _saveTimer = null;
const _resizeObserver = new ResizeObserver(() => {
  if (!syncDialogOverlay.classList.contains('visible')) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveDialogSize, 300);
});
_resizeObserver.observe(syncDialogBox);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function computeSyncState({ uncommitted, localAhead, localBehind }) {
  if ((localAhead > 0 || uncommitted) && localBehind > 0) return 'diverged';
  if (uncommitted) return 'uncommitted';
  if (localAhead > 0) return 'ahead';
  if (localBehind > 0) return 'behind';
  return 'clean';
}

function show(el) { if (el) el.style.display = ''; }
function hide(el) { if (el) el.style.display = 'none'; }

function renderCommitItems(containerEl, commits, emptyMsg) {
  if (!commits || commits.length === 0) {
    containerEl.innerHTML = `<div class="sync-commit-item"><span class="sync-commit-message" style="color:var(--text-muted)">${emptyMsg}</span></div>`;
    return;
  }
  containerEl.innerHTML = commits.map(c => {
    const date = c.date ? c.date.substring(0, 10) : '';
    return `<div class="sync-commit-item">
      <span class="sync-commit-hash">${c.hash || ''}</span>
      <span class="sync-commit-message" title="${escapeAttr(c.message || '')}">${escapeHtml(c.message || '')}</span>
      ${date ? `<span class="sync-commit-date">${date}</span>` : ''}
    </div>`;
  }).join('');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return s.replace(/"/g, '&quot;').replace(/&/g, '&amp;');
}

// ─── Dialog open/close ────────────────────────────────────────────────────────
function hideSyncDialog() {
  syncDialogOverlay.classList.remove('visible');
  _syncTabEl = null;
  _fileTree  = null;
  _syncState = 'clean';
  _hasUncommitted = false;
  _divergedPhase = 1;
  _sourceBranch = 'master';
}

export async function showCommitPushDialog(tabEl, _groupEl) {
  _syncTabEl = tabEl;
  _divergedPhase = 1;
  restoreDialogSize();
  syncDialogOverlay.classList.add('visible');

  // Reset all sections to loading state
  syncTitle.textContent = 'Sync Changes';
  syncDesc.textContent = 'Checking status\u2026';
  hide(syncAheadSection);
  hide(syncBehindSection);
  hide(syncUncommittedSection);
  hide(syncStandardButtons);
  hide(syncPhase1Footer);
  hide(syncResolveSection);
  hide(syncResolveStrategy);
  hide(syncStepIndicator);
  hide(syncDivergeNotice);
  show(syncCommitsWrapper);
  show(syncCommitInputs);
  hide(syncRolledBackNotice);
  syncAheadList.innerHTML = '';
  syncBehindList.innerHTML = '';
  syncFileList.innerHTML = '<span class="commit-file-list-empty">Loading\u2026</span>';
  syncDiffToolbar.innerHTML = '';
  syncTitleInput.value = '';
  syncDescInput.value = '';
  _fileTree = null;

  const branch = tabEl._wtBranch;
  const wtPath = tabEl._wtPath;

  _sourceBranch = tabEl._wtSourceBranch || 'master';
  let syncResult;
  try {
    syncResult = await window.reposAPI.getSyncStatus(wtPath, branch, _sourceBranch);
  } catch {
    syncResult = { uncommitted: false, localAhead: 0, localBehind: 0, error: true };
  }

  if (!syncDialogOverlay.classList.contains('visible')) return; // dismissed while loading

  _syncState = computeSyncState(syncResult);
  _hasUncommitted = syncResult.uncommitted || false;
  _localAhead = syncResult.localAhead || 0;

  await renderDialogForState(_syncState, tabEl);
}

async function renderDialogForState(state, tabEl) {
  const branch = tabEl._wtBranch;
  const wtPath = tabEl._wtPath;

  syncDialogBox.dataset.state = state;
  show(syncCancelBtn); // reset — hidden only for 'clean' where Close is the sole action

  if (state === 'uncommitted') {
    syncTitle.textContent = 'Commit & Push';
    syncDesc.textContent  = 'Stage selected files, commit, and push to the current branch.';
    syncConfirmBtn.textContent = 'Commit & Push';
    syncConfirmBtn.className = 'dialog-btn dialog-btn-confirm';

    show(syncUncommittedSection);
    show(syncStandardButtons);

    // Prefill title with task ID prefix
    const prefix = tabEl._wtTaskId ? `${tabEl._wtTaskId}: ` : '';
    syncTitleInput.value = prefix;
    syncDescInput.value  = '';
    setTimeout(() => { syncTitleInput.focus(); syncTitleInput.setSelectionRange(prefix.length, prefix.length); }, 50);

    const files = await window.reposAPI.gitDiffStat(wtPath);
    if (!syncDialogOverlay.classList.contains('visible')) return;
    _fileTree = renderCommitFileList(syncFileList, files, wtPath, { toolbar: syncDiffToolbar });

  } else if (state === 'ahead') {
    syncTitle.textContent = 'Push';
    syncDesc.textContent  = 'Push your local commits to the remote branch.';
    syncConfirmBtn.textContent = 'Push';
    syncConfirmBtn.className = 'dialog-btn dialog-btn-confirm';

    syncAheadLabel.textContent = 'Commits to Push';
    show(syncAheadSection);
    show(syncStandardButtons);

    const commits = await window.reposAPI.getCommitsAhead(wtPath, branch, _sourceBranch);
    if (!syncDialogOverlay.classList.contains('visible')) return;
    renderCommitItems(syncAheadList, commits, 'No commits found');

  } else if (state === 'behind') {
    syncTitle.textContent = 'Pull';
    syncDesc.textContent  = 'Pull incoming commits from the remote branch.';
    syncConfirmBtn.textContent = 'Pull';
    syncConfirmBtn.className = 'dialog-btn dialog-btn-confirm';

    syncBehindLabel.textContent = 'Incoming Commits';
    show(syncBehindSection);
    show(syncStandardButtons);

    const commits = await window.reposAPI.getCommitsBehind(wtPath, branch);
    if (!syncDialogOverlay.classList.contains('visible')) return;
    renderCommitItems(syncBehindList, commits, 'No incoming commits');

  } else if (state === 'diverged') {
    syncAheadLabel.textContent  = 'Your Commits';
    syncBehindLabel.textContent = 'Incoming Commits';
    show(syncAheadSection);
    show(syncBehindSection);

    const [ahead, behind] = await Promise.all([
      window.reposAPI.getCommitsAhead(wtPath, branch, _sourceBranch),
      window.reposAPI.getCommitsBehind(wtPath, branch),
    ]);
    if (!syncDialogOverlay.classList.contains('visible')) return;
    renderCommitItems(syncAheadList, ahead, 'No local commits');
    renderCommitItems(syncBehindList, behind, 'No remote commits');

    if (_hasUncommitted) {
      // Two-phase flow: start at Phase 1 (commit form)
      const prefix = tabEl._wtTaskId ? `${tabEl._wtTaskId}: ` : '';
      syncTitleInput.value = prefix;
      syncDescInput.value  = '';
      const files = await window.reposAPI.gitDiffStat(wtPath);
      if (!syncDialogOverlay.classList.contains('visible')) return;
      _fileTree = renderCommitFileList(syncFileList, files, wtPath, { toolbar: syncDiffToolbar, onChange: onPhase1FilesChanged });
      showDivergedPhase(1);
      setTimeout(() => { syncTitleInput.focus(); syncTitleInput.setSelectionRange(prefix.length, prefix.length); }, 50);
    } else {
      // No uncommitted changes — go straight to resolve
      showDivergedPhase(2);
    }

  } else {
    // clean — nothing to do, just show a close button (no separate cancel needed)
    syncTitle.textContent = 'Up to Date';
    syncDesc.textContent  = 'Your branch is in sync with the remote.';
    syncConfirmBtn.textContent = 'Close';
    syncConfirmBtn.className = 'dialog-btn dialog-btn-cancel';
    hide(syncCancelBtn);
    show(syncStandardButtons);
  }

}

// ─── Phase 1 file state handler ──────────────────────────────────────────────
function onPhase1FilesChanged() {
  if (_syncState !== 'diverged' || _divergedPhase !== 1) return;
  const allReverted = _fileTree?.isEmpty() ?? false;
  syncCommitInputs.style.display  = allReverted ? 'none' : '';
  syncRolledBackNotice.style.display = allReverted ? '' : 'none';
}

// ─── Diverged phase transitions ───────────────────────────────────────────────
function showDivergedPhase(phase) {
  _divergedPhase = phase;

  if (phase === 1) {
    // Phase 1: commit form — hide commit lists, show notice + file diff
    syncTitle.textContent = 'Step 1 of 2 \u2014 Commit Changes';
    syncDesc.textContent  = 'Commit your local changes before resolving the divergence.';
    syncStepCurrent.textContent = '1';
    show(syncStepIndicator);
    show(syncDivergeNotice);
    hide(syncCommitsWrapper);
    show(syncUncommittedSection);
    show(syncCommitInputs);
    hide(syncRolledBackNotice);
    hide(syncResolveStrategy);
    hide(syncResolveSection);
    show(syncPhase1Footer);
  } else {
    syncStepCurrent.textContent = '2';
    show(syncStepIndicator);
    hide(syncDivergeNotice);
    show(syncCommitsWrapper);
    hide(syncUncommittedSection);
    hide(syncPhase1Footer);

    // A pending commit (files still selected in phase 1) counts as a local commit
    // even before it is created, so we must not show a plain "Pull" in that case.
    const hasPendingCommit = _hasUncommitted && (_fileTree?.getSelectedFiles()?.length ?? 0) > 0;
    const noLocalCommits = !hasPendingCommit && _localAhead === 0;
    if (noLocalCommits) {
      // Nothing local to resolve — just pull
      syncTitle.textContent = 'Step 2 of 2 \u2014 Pull Changes';
      syncDesc.textContent  = 'Your local changes were rolled back. Pull the remote commits to finish.';
      hide(syncAheadSection);
      hide(syncResolveStrategy);
      syncConfirmBtn.textContent = 'Pull';
      syncConfirmBtn.className = 'dialog-btn dialog-btn-confirm';
      show(syncStandardButtons);
      hide(syncResolveSection);
    } else {
      // Local commits exist — show full resolve strategy
      syncTitle.textContent = 'Step 2 of 2 \u2014 Resolve Divergence';
      syncDesc.textContent  = 'Choose how to integrate your commits with the remote branch.';
      show(syncResolveStrategy);
      show(syncResolveSection);
      hide(syncStandardButtons);
    }
  }
}

// ─── Confirm handler (uncommitted / ahead / behind / clean) ───────────────────
async function confirmSync() {
  if (!_syncTabEl) return;
  const tabEl  = _syncTabEl;
  const wtPath = tabEl._wtPath;
  const branch = tabEl._wtBranch;

  if (_syncState === 'clean') {
    hideSyncDialog();
    return;
  }

  if (_syncState === 'uncommitted') {
    await commitThenPush(tabEl);
    return;

  } else if (_syncState === 'ahead') {
    hideSyncDialog();
    runPushFlow(wtPath, {
      onSuccess: () => {
        if (_refreshTabStatus) _refreshTabStatus(tabEl);
        setTimeout(() => terminal.close(), 1200);
      }
    });
    terminal.show(`Push: ${branch}`);

  } else if (_syncState === 'behind' || (_syncState === 'diverged' && _localAhead === 0)) {
    hideSyncDialog();
    await runSyncMode(tabEl, 'pull', `Pull: ${branch}`, 'Pull complete', 'Pull failed');
  }
}

// ─── Sync mode runner (pull / merge / rebase / reset-theirs) ─────────────────
async function runSyncMode(tabEl, mode, termTitle, successMsg, failMsg) {
  const wtPath = tabEl._wtPath;
  const branch = tabEl._wtBranch;

  terminal.show(termTitle);

  const disposeData = runPty(window.syncAPI, {
    successMsg,
    failMsg,
    onSuccess: () => {
      terminal.setTitle(successMsg);
      if (_refreshTabStatus) _refreshTabStatus(tabEl);
      setTimeout(() => terminal.close(), 1200);
    },
    onError: () => terminal.setTitle(failMsg),
  });

  try {
    await window.syncAPI.start({ wtPath, branch, mode });
    window.syncAPI.ready();
  } catch (err) {
    disposeData();
    terminal.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    terminal.setTitle(failMsg);
    terminal.showCloseButton();
  }
}

// ─── Commit then push ────────────────────────────────────────────────────────
async function commitThenPush(tabEl) {
  const wtPath = tabEl._wtPath;
  const branch = tabEl._wtBranch;
  const title  = syncTitleInput.value.trim();

  if (!title) { syncTitleInput.focus(); return; }
  const selectedFiles = _fileTree?.getSelectedFiles() || [];
  if (selectedFiles.length === 0) return;
  const desc = syncDescInput.value.trim();

  hideSyncDialog();
  terminal.show(`Commit & Push: ${branch}`);

  const disposeCommit = runPty(window.commitPushAPI, {
    successMsg: `Committed ${branch}`,
    failMsg: 'Commit failed',
    onSuccess: () => {
      terminal.setTitle('Commit complete');
      runPushFlow(wtPath, {
        onSuccess: () => {
          if (_refreshTabStatus) _refreshTabStatus(tabEl);
          setTimeout(() => terminal.close(), 1200);
        }
      });
    },
    onError: () => terminal.setTitle('Commit failed'),
  });

  try {
    await window.commitPushAPI.start({ wtPath, title, description: desc, branch, files: selectedFiles });
    window.commitPushAPI.ready();
  } catch (err) {
    disposeCommit();
    terminal.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    terminal.setTitle('Commit & push failed');
    terminal.showCloseButton();
  }
}

// ─── Commit then run sync mode ────────────────────────────────────────────────
async function commitThenSync(tabEl, syncMode, termTitle, syncSuccessMsg, syncFailMsg) {
  const wtPath = tabEl._wtPath;
  const branch = tabEl._wtBranch;
  const title  = syncTitleInput.value.trim();

  if (!title) { syncTitleInput.focus(); return; }
  const selectedFiles = _fileTree?.getSelectedFiles() || [];
  if (selectedFiles.length === 0) return;
  const desc = syncDescInput.value.trim();

  hideSyncDialog();
  terminal.show(`${termTitle}: ${branch}`);

  const disposeCommit = runPty(window.commitPushAPI, {
    successMsg: `Committed ${branch}`,
    failMsg: 'Commit failed',
    onSuccess: () => {
      terminal.setTitle('Commit complete — syncing…');
      runSyncMode(tabEl, syncMode, termTitle, syncSuccessMsg, syncFailMsg);
    },
    onError: () => terminal.setTitle('Commit failed'),
  });

  try {
    await window.commitPushAPI.start({ wtPath, title, description: desc, branch, files: selectedFiles });
    window.commitPushAPI.ready();
  } catch (err) {
    disposeCommit();
    terminal.writeln(`\x1b[31m${err.message || err}\x1b[0m`);
    terminal.setTitle('Commit failed');
    terminal.showCloseButton();
  }
}

// ─── Diverged resolve handlers ────────────────────────────────────────────────
syncGetTheirsBtn.addEventListener('click', async () => {
  if (!_syncTabEl) return;
  const tabEl = _syncTabEl;
  hideSyncDialog();
  await runSyncMode(tabEl, 'reset-theirs', `Get Theirs: ${tabEl._wtBranch}`, 'Reset complete', 'Reset failed');
});

syncMergeBtn.addEventListener('click', async () => {
  if (!_syncTabEl) return;
  const tabEl = _syncTabEl;
  const hasFilesToCommit = (_fileTree?.getSelectedFiles() || []).length > 0;
  if (_hasUncommitted && hasFilesToCommit) {
    await commitThenSync(tabEl, 'merge', `Merge: ${tabEl._wtBranch}`, 'Merge complete', 'Merge failed');
  } else {
    hideSyncDialog();
    await runSyncMode(tabEl, 'merge', `Merge: ${tabEl._wtBranch}`, 'Merge complete', 'Merge failed');
  }
});

syncRebaseBtn.addEventListener('click', async () => {
  if (!_syncTabEl) return;
  const tabEl = _syncTabEl;
  const hasFilesToCommit = (_fileTree?.getSelectedFiles() || []).length > 0;
  if (_hasUncommitted && hasFilesToCommit) {
    await commitThenSync(tabEl, 'rebase', `Rebase: ${tabEl._wtBranch}`, 'Rebase complete', 'Rebase failed');
  } else {
    hideSyncDialog();
    await runSyncMode(tabEl, 'rebase', `Rebase: ${tabEl._wtBranch}`, 'Rebase complete', 'Rebase failed');
  }
});

syncKeepMineBtn.addEventListener('click', async () => {
  if (!_syncTabEl) return;
  const tabEl = _syncTabEl;
  const wtPath = tabEl._wtPath;
  const branch = tabEl._wtBranch;
  const selectedFiles = _fileTree?.getSelectedFiles() || [];

  if (_hasUncommitted && selectedFiles.length > 0) {
    await commitThenPush(tabEl);
  } else {
    hideSyncDialog();
    runPushFlow(wtPath, {
      onSuccess: () => {
        if (_refreshTabStatus) _refreshTabStatus(tabEl);
        setTimeout(() => terminal.close(), 1200);
      }
    });
    terminal.show(`Keep Mine: ${branch}`);
  }
});

// ─── Standard button handlers ─────────────────────────────────────────────────
syncCancelBtn.addEventListener('click', hideSyncDialog);
syncResolveCancelBtn.addEventListener('click', hideSyncDialog);
syncConfirmBtn.addEventListener('click', confirmSync);

// Phase 1 footer (diverged + uncommitted)
syncPhase1CancelBtn.addEventListener('click', hideSyncDialog);
syncPhase1NextBtn.addEventListener('click', () => {
  const selectedFiles = _fileTree?.getSelectedFiles() || [];
  if (selectedFiles.length > 0) {
    const title = syncTitleInput.value.trim();
    if (!title) { syncTitleInput.focus(); return; }
  }
  showDivergedPhase(2);
});

syncTitleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (_syncState === 'diverged' && _divergedPhase === 1) syncPhase1NextBtn.click();
    else confirmSync();
  }
  if (e.key === 'Escape') hideSyncDialog();
});
syncDescInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideSyncDialog();
});

syncDialogOverlay.addEventListener('mousedown', (e) => {
  if (e.target === syncDialogOverlay) hideSyncDialog();
});
