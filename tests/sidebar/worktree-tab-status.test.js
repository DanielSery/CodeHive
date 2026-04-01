import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock calls are hoisted before imports — factory fns run once, configured per-test in beforeEach
vi.mock('../../src/renderer/azure-api.js', () => ({
  parseAzureRemoteUrl: vi.fn(),
  fetchPolicyEvaluations: vi.fn(),
  fetchPrUnresolvedThreadCount: vi.fn(),
  fetchWorkItemById: vi.fn(),
  fetchLatestBuild: vi.fn(),
  fetchBuildArtifacts: vi.fn(),
}));
vi.mock('../../src/renderer/sidebar/worktree-tab-dot-state.js', () => ({ updateDotState: vi.fn() }));
vi.mock('../../src/renderer/workspace-manager.js', () => ({ syncTitlebarToTab: vi.fn() }));

import {
  parseAzureRemoteUrl,
  fetchPolicyEvaluations,
  fetchPrUnresolvedThreadCount,
  fetchWorkItemById,
  fetchLatestBuild,
  fetchBuildArtifacts,
} from '../../src/renderer/azure-api.js';
import { updateDotState } from '../../src/renderer/sidebar/worktree-tab-dot-state.js';
import { syncTitlebarToTab } from '../../src/renderer/workspace-manager.js';
import { updatePipelineForTab, refreshTabStatus, showFallbackSwitch } from '../../src/renderer/sidebar/worktree-tab-status.js';

// ─── Test data ────────────────────────────────────────────────────────────────

const CTX = { org: 'myorg', project: 'myproject', auth: 'Basic dGVzdA==' };

const RUNNING_BUILD = {
  id: 42, buildNumber: '20240101.1', status: 'inProgress', result: null,
  webUrl: 'https://dev.azure.com/o/p/_build/42', definitionId: 7,
};
const SUCCEEDED_BUILD = {
  id: 42, buildNumber: '20240101.1', status: 'completed', result: 'succeeded',
  webUrl: 'https://dev.azure.com/o/p/_build/42', definitionId: 7,
};
const PARTIALLY_SUCCEEDED_BUILD = { ...SUCCEEDED_BUILD, result: 'partiallySucceeded' };
const FAILED_BUILD = { ...SUCCEEDED_BUILD, result: 'failed' };

const ACTIVE_PR = {
  pullRequestId: 101,
  repository: { name: 'myrepo', id: 'repo-id-1', project: { id: 'proj-id-1' } },
  lastMergeSourceCommit: { commitId: 'abc123' },
  targetRefName: 'refs/heads/master',
  title: 'My feature PR',
  reviewers: [],
};
const COMPLETED_PR = {
  pullRequestId: 101,
  repository: { name: 'myrepo', id: 'repo-id-1', project: { id: 'proj-id-1' } },
  lastMergeSourceCommit: { commitId: 'abc123' },
  targetRefName: 'refs/heads/master',
  title: 'My feature PR',
  closedDate: '2024-01-15T10:00:00Z',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTabEl(overrides = {}) {
  const group = document.createElement('div');
  group.className = 'repo-group';
  group._barePath = '/repos/myrepo.git';

  const tab = document.createElement('div');
  [
    'workspace-tab-commit-push', 'workspace-tab-switch', 'workspace-tab-open-pr',
    'workspace-tab-complete-pr', 'workspace-tab-create-pr', 'workspace-tab-resolve-task',
    'workspace-tab-open-pipeline', 'workspace-tab-install-btn', 'workspace-tab-action',
  ].forEach(cls => {
    const el = document.createElement('button');
    el.className = cls;
    tab.appendChild(el);
  });

  group.appendChild(tab);
  document.body.appendChild(group);

  Object.assign(tab, {
    _wtBranch: 'feature/123',
    _wtPath: '/repos/myrepo/worktrees/123',
    _wtSourceBranch: 'master',
    _wtTaskId: null,
    _taskResolved: false,
    _canResolveTask: false,
    _canOpenPipeline: false,
    _canCompletePr: false,
    _pipelineInstalled: false,
    _hasUncommittedChanges: false,
    _hasPushedCommits: true,
    _workspaceId: null,
    _pipelineTargetBranch: 'refs/heads/master',
    _pipelineMergeTime: null,
    _refreshInFlight: false,
    _refreshPending: false,
    ...overrides,
  });
  return tab;
}

function mockActivePr(prOverrides = {}) {
  const pr = { ...ACTIVE_PR, ...prOverrides };
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ value: [pr] }),
  });
  return pr;
}

function mockCompletedPr(pr = COMPLETED_PR) {
  global.fetch = vi.fn().mockImplementation(url => {
    const body = url.includes('status=completed') ? { value: [pr] } : { value: [] };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });
}

const btn = (tab, name) => tab.querySelector(`.workspace-tab-${name}`);
const visible = el => el != null && el.style.display !== 'none';
const hidden = el => el == null || el.style.display === 'none';

// Asserts the complete visible state of multiple buttons simultaneously.
// Pass button names that should be visible and names that should be hidden.
function assertButtons(tab, shouldBeVisible = [], shouldBeHidden = []) {
  for (const name of shouldBeVisible)
    expect(visible(btn(tab, name)), `"${name}" should be visible`).toBe(true);
  for (const name of shouldBeHidden)
    expect(hidden(btn(tab, name)), `"${name}" should be hidden`).toBe(true);
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  parseAzureRemoteUrl.mockReturnValue({ org: 'myorg', project: 'myproject' });
  fetchLatestBuild.mockResolvedValue(null);
  fetchBuildArtifacts.mockResolvedValue([]);
  fetchPolicyEvaluations.mockResolvedValue([]);
  fetchPrUnresolvedThreadCount.mockResolvedValue(0);
  fetchWorkItemById.mockResolvedValue(null);

  // Default: no active PR, no completed PR
  global.fetch = vi.fn().mockImplementation(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ value: [] }) })
  );

  window.reposAPI = {
    hasUncommittedChanges: vi.fn().mockResolvedValue({ value: false }),
    hasPushedCommits: vi.fn().mockResolvedValue({ value: true }),
    remoteUrl: vi.fn().mockResolvedValue('https://dev.azure.com/myorg/myproject/_git/myrepo'),
  };
  window.credentialsAPI = {
    get: vi.fn().mockResolvedValue('mypat'),
  };
});

afterEach(() => {
  document.body.innerHTML = '';
});

// ─── showFallbackSwitch ───────────────────────────────────────────────────────

describe('showFallbackSwitch', () => {
  it('does nothing when tab has uncommitted changes', () => {
    const tab = makeTabEl({ _hasUncommittedChanges: true });
    btn(tab, 'switch').style.display = 'none';
    showFallbackSwitch(tab);
    expect(btn(tab, 'switch').style.display).toBe('none');
    expect(tab._switchMode).toBeUndefined();
  });

  it('sets switchMode=open-task and shows switch when task linked and not resolved', () => {
    const tab = makeTabEl({ _wtTaskId: 42, _taskResolved: false });
    btn(tab, 'switch').style.display = 'none';
    showFallbackSwitch(tab);
    expect(tab._switchMode).toBe('open-task');
    expect(btn(tab, 'switch').style.display).toBe('');
  });

  it('sets switchMode=switch when no task linked', () => {
    const tab = makeTabEl({ _wtTaskId: null });
    btn(tab, 'switch').style.display = 'none';
    showFallbackSwitch(tab);
    expect(tab._switchMode).toBe('switch');
    expect(btn(tab, 'switch').style.display).toBe('');
  });

  it('sets switchMode=switch when task linked but already resolved', () => {
    const tab = makeTabEl({ _wtTaskId: 42, _taskResolved: true });
    btn(tab, 'switch').style.display = 'none';
    showFallbackSwitch(tab);
    expect(tab._switchMode).toBe('switch');
    expect(btn(tab, 'switch').style.display).toBe('');
  });
});

// ─── updatePipelineForTab ─────────────────────────────────────────────────────

describe('updatePipelineForTab', () => {
  it('no _pipelineTargetBranch → nothing is fetched or changed', async () => {
    const tab = makeTabEl({ _pipelineTargetBranch: null });
    await updatePipelineForTab(tab, CTX);
    expect(fetchLatestBuild).not.toHaveBeenCalled();
  });

  describe('no build yet — waiting for pipeline to start', () => {
    it('shows pipeline button in "waiting" state; install, resolve-task, and switch are hidden', async () => {
      const tab = makeTabEl();
      await updatePipelineForTab(tab, CTX);
      assertButtons(tab,
        ['open-pipeline'],
        ['install-btn', 'switch', 'resolve-task'],
      );
      expect(btn(tab, 'open-pipeline').title).toMatch(/waiting/i);
      expect(tab._pipelineStatus).toBeNull();
    });
  });

  describe('pipeline running', () => {
    beforeEach(() => fetchLatestBuild.mockResolvedValue(RUNNING_BUILD));

    it('no artifact yet → pipeline-running button is shown; install and switch hidden', async () => {
      fetchBuildArtifacts.mockResolvedValue([]);
      const tab = makeTabEl();
      await updatePipelineForTab(tab, CTX);
      assertButtons(tab,
        ['open-pipeline'],
        ['install-btn', 'switch'],
      );
      expect(btn(tab, 'open-pipeline').classList.contains('pipeline-running')).toBe(true);
      expect(tab._pipelineStatus).toBe('running');
    });

    it('Setups artifact ready → action shows install icon; install-btn shown as semantic target', async () => {
      fetchBuildArtifacts.mockResolvedValue([{ name: 'Setups' }]);
      const tab = makeTabEl();
      await updatePipelineForTab(tab, CTX);
      assertButtons(tab,
        ['action', 'install-btn'],
        ['switch'],
      );
      expect(btn(tab, 'action').style.color).toBe('var(--accent)');
      expect(btn(tab, 'action').title).toMatch(/download/i);
    });

    it('non-Setups artifact (e.g. Symbols, Logs) → install button stays hidden', async () => {
      fetchBuildArtifacts.mockResolvedValue([{ name: 'Symbols' }, { name: 'Logs' }]);
      const tab = makeTabEl();
      await updatePipelineForTab(tab, CTX);
      assertButtons(tab, [], ['install-btn']);
    });

    it('already installed + task linked → action and resolve-task shown; install and switch hidden', async () => {
      const tab = makeTabEl({ _wtTaskId: 99, _pipelineInstalled: true });
      await updatePipelineForTab(tab, CTX);
      assertButtons(tab,
        ['action', 'resolve-task'],
        ['install-btn', 'switch'],
      );
      expect(btn(tab, 'resolve-task').title).toMatch(/complete task/i);
      expect(tab._canResolveTask).toBe(true);
    });

    it('task already resolved (no task id) → pipeline-running shown; install and resolve-task hidden', async () => {
      // Represents the "no task linked" pipeline monitoring path: PR merged with no task → _taskResolved=true, _wtTaskId=null
      fetchBuildArtifacts.mockResolvedValue([]);
      const tab = makeTabEl({ _taskResolved: true, _wtTaskId: null });
      await updatePipelineForTab(tab, CTX);
      assertButtons(tab,
        ['open-pipeline'],
        ['install-btn', 'resolve-task', 'switch'],
      );
    });

    it('task resolved mid-flight (task id still set) → pipeline-running shown; install and resolve-task hidden', async () => {
      // Workflow: user clicked resolve-task while pipeline was running → _taskResolved=true, _wtTaskId still set.
      // Takes the taskResolved+wtTaskId path (no artifact check), different from the no-task path above.
      const tab = makeTabEl({ _taskResolved: true, _wtTaskId: 99 });
      await updatePipelineForTab(tab, CTX);
      assertButtons(tab,
        ['open-pipeline', 'action'],
        ['install-btn', 'resolve-task', 'switch'],
      );
    });

    it('task resolved + Setups artifact → action shows install icon; install-btn shown as semantic target', async () => {
      fetchBuildArtifacts.mockResolvedValue([{ name: 'Setups' }]);
      const tab = makeTabEl({ _taskResolved: true });
      await updatePipelineForTab(tab, CTX);
      assertButtons(tab,
        ['action', 'install-btn'],
        ['switch', 'resolve-task'],
      );
      expect(btn(tab, 'action').style.color).toBe('var(--accent)');
    });
  });

  describe('pipeline succeeded', () => {
    beforeEach(() => fetchLatestBuild.mockResolvedValue(SUCCEEDED_BUILD));

    it('task resolved → switch is the call to action; pipeline and install are gone', async () => {
      const tab = makeTabEl({ _taskResolved: true });
      await updatePipelineForTab(tab, CTX);
      assertButtons(tab,
        ['switch'],
        ['open-pipeline', 'install-btn', 'resolve-task'],
      );
      expect(tab._pipelineStatus).toBe('succeeded');
    });

    it('task linked but not yet resolved → resolve-task is the call to action; switch hidden', async () => {
      // Workflow: user did not install during running (or pipeline was fast) → pipeline done, task still open
      const tab = makeTabEl({ _wtTaskId: 99, _taskResolved: false });
      await updatePipelineForTab(tab, CTX);
      assertButtons(tab,
        ['resolve-task'],
        ['open-pipeline', 'install-btn', 'switch'],
      );
      expect(btn(tab, 'resolve-task').title).toMatch(/complete azure task/i);
      expect(tab._canResolveTask).toBe(true);
    });

    it('installed during running, pipeline then succeeds → resolve-task is still the call to action', async () => {
      // Workflow: user downloaded installer while pipeline ran, pipeline completes → still needs to resolve task
      const tab = makeTabEl({ _wtTaskId: 99, _taskResolved: false, _pipelineInstalled: true });
      await updatePipelineForTab(tab, CTX);
      assertButtons(tab,
        ['resolve-task'],
        ['open-pipeline', 'install-btn', 'switch'],
      );
      expect(tab._canResolveTask).toBe(true);
    });

    it('partiallySucceeded treated same as succeeded → switch shown when task resolved', async () => {
      fetchLatestBuild.mockResolvedValue(PARTIALLY_SUCCEEDED_BUILD);
      const tab = makeTabEl({ _taskResolved: true });
      await updatePipelineForTab(tab, CTX);
      assertButtons(tab,
        ['switch'],
        ['open-pipeline', 'install-btn'],
      );
      expect(tab._pipelineStatus).toBe('succeeded');
    });
  });

  describe('pipeline failed', () => {
    beforeEach(() => fetchLatestBuild.mockResolvedValue(FAILED_BUILD));

    it('shows pipeline-failed button; install and resolve-task hidden', async () => {
      const tab = makeTabEl({ _wtTaskId: 99 });
      await updatePipelineForTab(tab, CTX);
      assertButtons(tab,
        ['open-pipeline'],
        ['install-btn', 'resolve-task'],
      );
      expect(btn(tab, 'open-pipeline').classList.contains('pipeline-failed')).toBe(true);
      expect(btn(tab, 'open-pipeline').title).toMatch(/failed/i);
      expect(tab._pipelineStatus).toBe('failed');
    });
  });
});

// ─── refreshTabStatus ─────────────────────────────────────────────────────────

describe('refreshTabStatus', () => {
  it('always calls updateDotState and syncTitlebarToTab, even on a normal run', async () => {
    const tab = makeTabEl();
    await refreshTabStatus(tab);
    expect(updateDotState).toHaveBeenCalledWith(tab);
    expect(syncTitlebarToTab).toHaveBeenCalled();
  });

  describe('Azure not configured or unreachable', () => {
    it('tab not inside a .repo-group → returns immediately, nothing touched', async () => {
      const tab = document.createElement('div');
      document.body.appendChild(tab);
      await refreshTabStatus(tab);
      expect(window.reposAPI.hasUncommittedChanges).not.toHaveBeenCalled();
    });

    it('no _barePath on group → nothing fetched', async () => {
      const group = document.createElement('div');
      group.className = 'repo-group';
      const tab = document.createElement('div');
      Object.assign(tab, { _wtBranch: 'feature/x', _wtPath: '/x' });
      group.appendChild(tab);
      document.body.appendChild(group);
      await refreshTabStatus(tab);
      expect(window.reposAPI.hasUncommittedChanges).not.toHaveBeenCalled();
    });

    it('no _wtBranch → nothing fetched', async () => {
      const tab = makeTabEl({ _wtBranch: '' });
      await refreshTabStatus(tab);
      expect(window.reposAPI.hasUncommittedChanges).not.toHaveBeenCalled();
    });

    it('remoteUrl throws → shows Switch; no PR fetch', async () => {
      window.reposAPI.remoteUrl = vi.fn().mockRejectedValue(new Error('network error'));
      const tab = makeTabEl();
      btn(tab, 'switch').style.display = 'none';
      await refreshTabStatus(tab);
      assertButtons(tab, ['switch'], []);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('remoteUrl returns null → shows Switch', async () => {
      window.reposAPI.remoteUrl = vi.fn().mockResolvedValue(null);
      const tab = makeTabEl();
      btn(tab, 'switch').style.display = 'none';
      await refreshTabStatus(tab);
      assertButtons(tab, ['switch'], []);
    });

    it('no Azure PAT → shows Switch; no PR fetch', async () => {
      window.credentialsAPI.get = vi.fn().mockResolvedValue(null);
      const tab = makeTabEl();
      btn(tab, 'switch').style.display = 'none';
      await refreshTabStatus(tab);
      assertButtons(tab, ['switch'], []);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('PR fetch returns !ok → shows Switch', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false });
      const tab = makeTabEl();
      btn(tab, 'switch').style.display = 'none';
      await refreshTabStatus(tab);
      assertButtons(tab, ['switch'], []);
    });

    it('PR fetch throws → shows Switch', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('fetch error'));
      const tab = makeTabEl();
      btn(tab, 'switch').style.display = 'none';
      await refreshTabStatus(tab);
      assertButtons(tab, ['switch'], []);
    });

    it('non-Azure remote → shows Switch; all PR and resolve-task buttons hidden', async () => {
      parseAzureRemoteUrl.mockReturnValue(null);
      const tab = makeTabEl();
      btn(tab, 'switch').style.display = 'none';
      await refreshTabStatus(tab);
      assertButtons(tab,
        ['switch'],
        ['create-pr', 'open-pr', 'complete-pr', 'resolve-task'],
      );
    });
  });

  describe('uncommitted changes', () => {
    it('dirty working tree, no PR → Commit-Push shown; switch hidden', async () => {
      window.reposAPI.hasUncommittedChanges = vi.fn().mockResolvedValue({ value: true });
      const tab = makeTabEl();
      await refreshTabStatus(tab);
      assertButtons(tab, ['commit-push'], ['switch']);
      expect(tab._hasUncommittedChanges).toBe(true);
    });

    it('hasUncommittedChanges throws → defaults to false and continues without crashing', async () => {
      window.reposAPI.hasUncommittedChanges = vi.fn().mockRejectedValue(new Error('fail'));
      const tab = makeTabEl();
      await refreshTabStatus(tab);
      expect(tab._hasUncommittedChanges).toBe(false);
    });
  });

  describe('workspace already open', () => {
    it('switch hidden when workspace is open and commits have been pushed', async () => {
      const tab = makeTabEl({ _workspaceId: 'ws-1' });
      btn(tab, 'switch').style.display = '';
      await refreshTabStatus(tab);
      assertButtons(tab, [], ['switch']);
    });

    it('switch hidden when workspace is open and no commits pushed yet', async () => {
      window.reposAPI.hasPushedCommits = vi.fn().mockResolvedValue({ value: false });
      const tab = makeTabEl({ _workspaceId: 'ws-1' });
      btn(tab, 'switch').style.display = '';
      await refreshTabStatus(tab);
      assertButtons(tab, [], ['switch']);
    });
  });

  describe('no PR yet', () => {
    it('commits pushed, clean working tree → Create PR is the call to action', async () => {
      const tab = makeTabEl({ _hasPushedCommits: true });
      await refreshTabStatus(tab);
      assertButtons(tab,
        ['create-pr'],
        ['switch', 'open-pr', 'complete-pr', 'resolve-task'],
      );
    });

    it('no pushed commits yet → Switch is the call to action', async () => {
      window.reposAPI.hasPushedCommits = vi.fn().mockResolvedValue({ value: false });
      const tab = makeTabEl();
      btn(tab, 'switch').style.display = 'none';
      await refreshTabStatus(tab);
      assertButtons(tab,
        ['switch'],
        ['create-pr'],
      );
    });

    it('task linked, no pushed commits → switch opens the task (not just switches branch)', async () => {
      // Workflow: user has a task linked but hasn't pushed anything yet (or only adds a comment).
      // Clicking Switch should navigate to the Azure task, not just switch branch.
      window.reposAPI.hasPushedCommits = vi.fn().mockResolvedValue({ value: false });
      const tab = makeTabEl({ _wtTaskId: 42, _taskResolved: false });
      btn(tab, 'switch').style.display = 'none';
      await refreshTabStatus(tab);
      assertButtons(tab, ['switch'], ['create-pr']);
      expect(tab._switchMode).toBe('open-task');
    });

    it('uncommitted changes → only Commit-Push shown; Create PR hidden', async () => {
      window.reposAPI.hasUncommittedChanges = vi.fn().mockResolvedValue({ value: true });
      window.reposAPI.hasPushedCommits = vi.fn().mockResolvedValue({ value: true });
      const tab = makeTabEl();
      await refreshTabStatus(tab);
      assertButtons(tab,
        ['commit-push'],
        ['create-pr'],
      );
    });

    it('task linked → _taskUrl is constructed so user can navigate to the work item', async () => {
      const tab = makeTabEl({ _wtTaskId: 77 });
      await refreshTabStatus(tab);
      expect(tab._taskUrl).toContain('77');
      expect(tab._taskUrl).toContain('myorg');
      expect(tab._taskUrl).toContain('myproject');
    });
  });

  describe('active PR', () => {
    describe('PR status indicators on the Open PR button', () => {
      it('no evaluations, no reviewers, no comments → has-pr (neutral)', async () => {
        mockActivePr({ reviewers: [] });
        fetchPolicyEvaluations.mockResolvedValue([]);
        fetchPrUnresolvedThreadCount.mockResolvedValue(0);
        const tab = makeTabEl();
        await refreshTabStatus(tab);
        expect(btn(tab, 'open-pr').classList.contains('has-pr')).toBe(true);
      });

      it('reviewer voted to reject → has-pr-failed', async () => {
        mockActivePr({ reviewers: [{ vote: -10 }] });
        const tab = makeTabEl();
        await refreshTabStatus(tab);
        expect(btn(tab, 'open-pr').classList.contains('has-pr-failed')).toBe(true);
      });

      it('policy evaluation rejected → has-pr-failed', async () => {
        mockActivePr();
        fetchPolicyEvaluations.mockResolvedValue([{ status: 'rejected', context: {} }]);
        const tab = makeTabEl();
        await refreshTabStatus(tab);
        expect(btn(tab, 'open-pr').classList.contains('has-pr-failed')).toBe(true);
      });

      it('policy evaluation broken → has-pr-failed', async () => {
        mockActivePr();
        fetchPolicyEvaluations.mockResolvedValue([{ status: 'broken', context: {} }]);
        const tab = makeTabEl();
        await refreshTabStatus(tab);
        expect(btn(tab, 'open-pr').classList.contains('has-pr-failed')).toBe(true);
      });

      it('all evaluations approved, no unresolved comments → has-pr-approved', async () => {
        mockActivePr();
        fetchPolicyEvaluations.mockResolvedValue([
          { status: 'approved', context: {} },
          { status: 'approved', context: { buildId: 'b1' } },
        ]);
        fetchPrUnresolvedThreadCount.mockResolvedValue(0);
        const tab = makeTabEl();
        await refreshTabStatus(tab);
        expect(btn(tab, 'open-pr').classList.contains('has-pr-approved')).toBe(true);
      });

      it('approved but unresolved comments → has-pr-comments overrides approved', async () => {
        mockActivePr();
        fetchPolicyEvaluations.mockResolvedValue([{ status: 'approved', context: {} }]);
        fetchPrUnresolvedThreadCount.mockResolvedValue(1);
        const tab = makeTabEl();
        await refreshTabStatus(tab);
        expect(btn(tab, 'open-pr').classList.contains('has-pr-comments')).toBe(true);
      });

      it('no evaluations but unresolved comments → has-pr-comments', async () => {
        mockActivePr();
        fetchPolicyEvaluations.mockResolvedValue([]);
        fetchPrUnresolvedThreadCount.mockResolvedValue(2);
        const tab = makeTabEl();
        await refreshTabStatus(tab);
        expect(btn(tab, 'open-pr').classList.contains('has-pr-comments')).toBe(true);
      });

      it('build policies approved, non-build policies still queued → has-pr-succeeded', async () => {
        mockActivePr();
        fetchPolicyEvaluations.mockResolvedValue([
          { status: 'approved', context: { buildId: 'b1' } },
          { status: 'queued', context: {} },
        ]);
        fetchPrUnresolvedThreadCount.mockResolvedValue(0);
        const tab = makeTabEl();
        await refreshTabStatus(tab);
        expect(btn(tab, 'open-pr').classList.contains('has-pr-succeeded')).toBe(true);
      });
    });

    describe('button visibility', () => {
      it('PR approved, clean working tree → Complete PR and Open PR shown; switch and create-pr hidden', async () => {
        mockActivePr();
        fetchPolicyEvaluations.mockResolvedValue([{ status: 'approved', context: {} }]);
        fetchPrUnresolvedThreadCount.mockResolvedValue(0);
        const tab = makeTabEl();
        await refreshTabStatus(tab);
        assertButtons(tab,
          ['complete-pr', 'open-pr'],
          ['switch', 'create-pr'],
        );
        expect(tab._canCompletePr).toBe(true);
      });

      it('PR approved but uncommitted changes → Commit-Push shown; PR action buttons hidden', async () => {
        mockActivePr();
        fetchPolicyEvaluations.mockResolvedValue([{ status: 'approved', context: {} }]);
        fetchPrUnresolvedThreadCount.mockResolvedValue(0);
        window.reposAPI.hasUncommittedChanges = vi.fn().mockResolvedValue({ value: true });
        const tab = makeTabEl();
        await refreshTabStatus(tab);
        assertButtons(tab,
          ['commit-push'],
          ['complete-pr', 'open-pr'],
        );
      });

      it('PR not yet approved → only Open PR shown; Complete PR hidden', async () => {
        mockActivePr();
        const tab = makeTabEl();
        await refreshTabStatus(tab);
        assertButtons(tab,
          ['open-pr'],
          ['complete-pr'],
        );
        expect(tab._canCompletePr).toBe(false);
      });

      it('active PR clears any stale pipeline and install buttons left from a previous state', async () => {
        mockActivePr();
        const tab = makeTabEl();
        btn(tab, 'open-pipeline').style.display = 'inline-flex';
        btn(tab, 'install-btn').style.display = 'inline-flex';
        await refreshTabStatus(tab);
        assertButtons(tab, [], ['open-pipeline', 'install-btn']);
      });

      it('active PR stores _existingPrUrl and _prData for use by click handlers', async () => {
        mockActivePr();
        const tab = makeTabEl();
        await refreshTabStatus(tab);
        expect(tab._existingPrUrl).toContain('101');
        expect(tab._prData.id).toBe(101);
        expect(tab._prData.org).toBe('myorg');
      });
    });
  });

  describe('PR merged → pipeline monitoring phase', () => {
    it('no task linked → enters pipeline monitoring; create-pr and resolve-task hidden', async () => {
      mockCompletedPr();
      const tab = makeTabEl({ _wtTaskId: null, _pipelineTargetBranch: null });
      await refreshTabStatus(tab);
      expect(tab._canOpenPipeline).toBe(true);
      expect(tab._taskResolved).toBe(true);
      expect(tab._pipelineTargetBranch).toBe(COMPLETED_PR.targetRefName);
      assertButtons(tab, [], ['create-pr', 'resolve-task']);
    });

    it('task already Resolved → enters pipeline monitoring; task marked done', async () => {
      mockCompletedPr();
      fetchWorkItemById.mockResolvedValue({ state: 'Resolved' });
      const tab = makeTabEl({ _wtTaskId: 42, _pipelineTargetBranch: null });
      await refreshTabStatus(tab);
      expect(tab._canOpenPipeline).toBe(true);
      expect(tab._taskResolved).toBe(true);
      assertButtons(tab, [], ['resolve-task']);
    });

    it('task Closed → treated the same as Resolved', async () => {
      mockCompletedPr();
      fetchWorkItemById.mockResolvedValue({ state: 'Closed' });
      const tab = makeTabEl({ _wtTaskId: 42, _pipelineTargetBranch: null });
      await refreshTabStatus(tab);
      expect(tab._taskResolved).toBe(true);
    });

    it('task still Active → pipeline monitoring starts but task is not yet marked resolved', async () => {
      mockCompletedPr();
      fetchWorkItemById.mockResolvedValue({ state: 'Active' });
      fetchLatestBuild.mockResolvedValue(null);
      const tab = makeTabEl({ _wtTaskId: 42, _pipelineTargetBranch: null });
      await refreshTabStatus(tab);
      expect(tab._canOpenPipeline).toBe(true);
      expect(tab._taskResolved).toBeFalsy();
      assertButtons(tab, [], ['create-pr']);
    });

    it('task Active + uncommitted changes → pipeline phase NOT started yet', async () => {
      mockCompletedPr();
      fetchWorkItemById.mockResolvedValue({ state: 'Active' });
      window.reposAPI.hasUncommittedChanges = vi.fn().mockResolvedValue({ value: true });
      const tab = makeTabEl({ _wtTaskId: 42, _pipelineTargetBranch: null });
      await refreshTabStatus(tab);
      expect(tab._canOpenPipeline).toBeFalsy();
    });

    it('preserves existing _pipelineTargetBranch when one is already set', async () => {
      mockCompletedPr();
      const existingTarget = 'refs/heads/develop';
      const tab = makeTabEl({ _wtTaskId: null, _pipelineTargetBranch: existingTarget });
      await refreshTabStatus(tab);
      expect(tab._pipelineTargetBranch).toBe(existingTarget);
    });

    it('stores _mergedPrUrl so the user can navigate to the merged PR', async () => {
      mockCompletedPr();
      const tab = makeTabEl({ _wtTaskId: null, _pipelineTargetBranch: null });
      await refreshTabStatus(tab);
      expect(tab._mergedPrUrl).toContain('101');
      expect(tab._mergedPrUrl).toContain('myrepo');
    });
  });

  describe('already in pipeline monitoring mode', () => {
    it('refreshes pipeline status without re-fetching completed PRs', async () => {
      fetchLatestBuild.mockResolvedValue(SUCCEEDED_BUILD);
      const tab = makeTabEl({ _canOpenPipeline: true, _taskResolved: true });
      await refreshTabStatus(tab);
      expect(fetchLatestBuild).toHaveBeenCalled();
      // One fetch only — for the active PR check; completed PR URL is never fetched
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch.mock.calls[0][0]).toContain('status=active');
    });

    it('uncommitted changes while in pipeline mode → hides pipeline and install buttons', async () => {
      window.reposAPI.hasUncommittedChanges = vi.fn().mockResolvedValue({ value: true });
      const tab = makeTabEl({ _canOpenPipeline: true, _taskResolved: true });
      btn(tab, 'open-pipeline').style.display = 'inline-flex';
      btn(tab, 'install-btn').style.display = 'inline-flex';
      await refreshTabStatus(tab);
      assertButtons(tab, [], ['open-pipeline', 'install-btn']);
    });

    it('_canResolveTask=true → skips completed PR check; only the active PR URL is fetched', async () => {
      const tab = makeTabEl({ _canResolveTask: true });
      await refreshTabStatus(tab);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch.mock.calls[0][0]).not.toContain('status=completed');
    });
  });

  describe('concurrency guard', () => {
    it('second call while first is in-flight is deferred, not run immediately', async () => {
      // Create the hanging promise eagerly so resolveFirst is assigned before async code runs
      let resolveFirst;
      const hang = new Promise(r => { resolveFirst = r; });
      fetchLatestBuild.mockImplementationOnce(() => hang);
      fetchLatestBuild.mockResolvedValue(null);

      const tab = makeTabEl({ _canOpenPipeline: true, _taskResolved: true });

      const p1 = refreshTabStatus(tab);
      expect(tab._refreshInFlight).toBe(true);
      expect(tab._refreshPending).toBe(false);

      refreshTabStatus(tab); // second call — should be deferred
      expect(tab._refreshPending).toBe(true);

      refreshTabStatus(tab); // third call — deduped into the single pending slot
      expect(tab._refreshPending).toBe(true);

      resolveFirst(null);
      await p1;
      await new Promise(r => setTimeout(r, 0)); // let deferred call complete

      // fetchLatestBuild called once for the first run, once for the deferred run
      expect(fetchLatestBuild).toHaveBeenCalledTimes(2);
      expect(tab._refreshInFlight).toBe(false);
      expect(tab._refreshPending).toBe(false);
    });

    it('no call is dropped: after the guard releases, exactly one deferred run executes', async () => {
      let resolveFirst;
      const hang = new Promise(r => { resolveFirst = r; });
      fetchLatestBuild.mockImplementationOnce(() => hang);
      fetchLatestBuild.mockResolvedValue(SUCCEEDED_BUILD);

      const tab = makeTabEl({ _canOpenPipeline: true, _taskResolved: true });

      refreshTabStatus(tab); // first — hangs at fetchLatestBuild
      refreshTabStatus(tab); // second — deferred
      refreshTabStatus(tab); // third — deduped

      resolveFirst(null);
      await new Promise(r => setTimeout(r, 10));

      // Pipeline succeeds in the deferred run → switch button shown
      assertButtons(tab, ['switch'], []);
    });
  });
});
