// Pure Azure DevOps REST API layer — no DOM, no dialog state

export function parseAzureRemoteUrl(url) {
  if (!url) return null;
  // https://dev.azure.com/org/project/_git/repo  (with optional user@ prefix)
  const m = url.match(/https?:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\//);
  if (m) return { org: decodeURIComponent(m[1]), project: decodeURIComponent(m[2]) };
  // https://org.visualstudio.com/project/_git/repo
  const m2 = url.match(/https?:\/\/(?:[^@/]+@)?([^.]+)\.visualstudio\.com\/([^/]+)\/_git\//);
  if (m2) return { org: m2[1], project: decodeURIComponent(m2[2]) };
  return null;
}

export function buildAzureContext(parsed, pat) {
  const auth = btoa(':' + pat);
  const apiBase = `https://dev.azure.com/${encodeURIComponent(parsed.org)}/${encodeURIComponent(parsed.project)}/_apis`;
  return { org: parsed.org, project: parsed.project, auth, apiBase };
}

export function buildAzureTaskUrl(ctx, taskId) {
  return `https://dev.azure.com/${encodeURIComponent(ctx.org)}/${encodeURIComponent(ctx.project)}/_workitems/edit/${taskId}`;
}

/**
 * Fetch active Azure DevOps work items for a repository.
 * Returns { tasks, azureContext } on success, or { error } on failure/missing PAT/non-Azure repo.
 */
export async function fetchAzureTasks(barePath, pat) {
  if (!pat) return { error: 'no-pat' };

  let remoteUrl;
  try { remoteUrl = await window.reposAPI.remoteUrl(barePath); } catch {}

  const parsed = parseAzureRemoteUrl(remoteUrl);
  if (!parsed) return { error: 'not-azure' };

  try {
    const ctx = buildAzureContext(parsed, pat);

    const wiqlResp = await fetch(`${ctx.apiBase}/wit/wiql?api-version=7.0`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${ctx.auth}` },
      body: JSON.stringify({ query: `SELECT [System.Id] FROM WorkItems WHERE [System.State] NOT IN ('Closed', 'Done', 'Resolved', 'Removed') ORDER BY [System.ChangedDate] DESC` })
    });

    if (!wiqlResp.ok) return { error: 'fetch-failed' };

    const wiqlData = await wiqlResp.json();
    const ids = (wiqlData.workItems || []).slice(0, 200).map(wi => wi.id);

    if (ids.length === 0) return { tasks: [], azureContext: ctx };

    const itemsResp = await fetch(
      `${ctx.apiBase}/wit/workitems?ids=${ids.join(',')}&fields=System.Id,System.Title,System.WorkItemType,System.Description&api-version=7.0`,
      { headers: { 'Authorization': `Basic ${ctx.auth}` } }
    );

    if (!itemsResp.ok) return { error: 'fetch-failed' };

    const itemsData = await itemsResp.json();
    const tasks = (itemsData.value || []).map(wi => ({
      id: wi.id,
      title: wi.fields['System.Title'] || '',
      type: wi.fields['System.WorkItemType'] || '',
      description: wi.fields['System.Description'] || ''
    }));

    return { tasks, azureContext: ctx };
  } catch {
    return { error: 'fetch-failed' };
  }
}

/**
 * Create a new Azure DevOps work item.
 * Returns { id, title, type } on success, throws on failure.
 * If parentId is provided, creates a parent-child relation.
 */
export async function createAzureWorkItem(ctx, workItemType, title, description) {
  const body = [{ op: 'add', path: '/fields/System.Title', value: title }];
  if (description) body.push({ op: 'add', path: '/fields/System.Description', value: description });
  const url = `${ctx.apiBase}/wit/workitems/$${encodeURIComponent(workItemType)}?api-version=7.0`;
  console.log('[createAzureWorkItem] POST', url, { org: ctx.org, project: ctx.project, workItemType });
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json-patch+json', 'Authorization': `Basic ${ctx.auth}` },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error('[createAzureWorkItem] failed', resp.status, text);
    throw new Error(`HTTP ${resp.status} for ${ctx.org}/${ctx.project} type="${workItemType}"\n${text.substring(0, 300)}`);
  }
  const data = await resp.json();
  return { id: data.id, title, type: workItemType };
}

/**
 * Update the state of a work item (e.g. to 'Active'). Silently ignores errors.
 */
export async function updateWorkItemState(ctx, id, state) {
  try {
    const resp = await fetch(
      `${ctx.apiBase}/wit/workitems/${id}?api-version=7.0`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json-patch+json', 'Authorization': `Basic ${ctx.auth}` },
        body: JSON.stringify([{ op: 'add', path: '/fields/System.State', value: state }])
      }
    );
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch a single work item by ID. Returns { id, title, type, state } or null.
 */
export async function fetchWorkItemById(ctx, id) {
  try {
    const resp = await fetch(
      `${ctx.apiBase}/wit/workitems/${id}?fields=System.Id,System.Title,System.WorkItemType,System.Description,System.State&api-version=7.0`,
      { headers: { Authorization: `Basic ${ctx.auth}` } }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return { id: data.id, title: data.fields['System.Title'] || '', type: data.fields['System.WorkItemType'] || '', state: data.fields['System.State'] || '', description: data.fields['System.Description'] || '' };
  } catch {
    return null;
  }
}

/**
 * Fetch the title of a work item by ID. Returns title string or null.
 */
export async function fetchWorkItemTitle(ctx, taskId) {
  try {
    const resp = await fetch(
      `${ctx.apiBase}/wit/workitems/${taskId}?fields=System.Title&api-version=7.0`,
      { headers: { Authorization: `Basic ${ctx.auth}` } }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return (data.fields && data.fields['System.Title']) || null;
  } catch {
    return null;
  }
}

/**
 * Check for an active PR for a branch. Returns PR object or null.
 */
export async function fetchActivePrForBranch(org, project, pat, branch) {
  const auth = btoa(':' + pat);
  const sourceRef = `refs/heads/${branch}`;
  const apiUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/pullrequests?searchCriteria.sourceRefName=${encodeURIComponent(sourceRef)}&searchCriteria.status=active&api-version=7.0`;
  try {
    const resp = await fetch(apiUrl, { headers: { Authorization: `Basic ${auth}` } });
    if (!resp.ok) return null;
    const data = await resp.json();
    return (data.value && data.value.length > 0) ? { pr: data.value[0], auth, org, project } : null;
  } catch {
    return null;
  }
}

/**
 * Fetch PR statuses (pipeline checks). Returns deduplicated latest status objects.
 */
export async function fetchPrStatuses(org, project, auth, repoId, prId) {
  const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/pullRequests/${prId}/statuses?api-version=7.0`;
  try {
    const resp = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!resp.ok) return [];
    const data = await resp.json();
    const statuses = data.value || [];
    const latest = {};
    for (const s of statuses) {
      const key = `${s.context?.genre}/${s.context?.name}`;
      if (!latest[key] || s.id > latest[key].id) latest[key] = s;
    }
    return Object.values(latest);
  } catch {
    return [];
  }
}

/**
 * Fetch policy evaluations for a PR. Returns only blocking evaluations.
 * Statuses: 'approved', 'rejected', 'broken', 'queued', 'running'
 * Build policies have context.buildId; reviewer/comment/work-item policies do not.
 */
export async function fetchPolicyEvaluations(org, project, auth, projectId, prId) {
  const artifactId = `vstfs:///CodeReview/CodeReviewId/${projectId}/${prId}`;
  const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/policy/evaluations?artifactId=${encodeURIComponent(artifactId)}&api-version=7.1-preview.1`;
  console.log('[fetchPolicyEvaluations] projectId=%s prId=%s url=%s', projectId, prId, url);
  try {
    const resp = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!resp.ok) {
      console.warn('[fetchPolicyEvaluations] HTTP %d', resp.status, await resp.text().catch(() => ''));
      return [];
    }
    const data = await resp.json();
    const all = data.value || [];
    const blocking = all.filter(e => e.configuration?.isBlocking);
    console.log('[fetchPolicyEvaluations] total=%d blocking=%d', all.length, blocking.length, blocking.map(e => `${e.configuration?.type?.displayName}:${e.status}`));
    return blocking;
  } catch (err) {
    console.warn('[fetchPolicyEvaluations] error:', err);
    return [];
  }
}

/**
 * Complete a pull request (merge it) and delete the source branch.
 */
export async function completePullRequest(org, project, auth, repositoryId, prId, lastCommitId) {
  const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullRequests/${prId}?api-version=7.0`;
  try {
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify({
        status: 'completed',
        lastMergeSourceCommit: { commitId: lastCommitId },
        completionOptions: { deleteSourceBranch: true }
      })
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch PR threads and return the count of unresolved (active) ones.
 */
export async function fetchPrUnresolvedThreadCount(org, project, auth, repositoryId, prId) {
  const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullRequests/${prId}/threads?api-version=7.0`;
  try {
    const resp = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!resp.ok) return 0;
    const data = await resp.json();
    return (data.value || []).filter(t => t.status === 'active').length;
  } catch {
    return 0;
  }
}

/**
 * Check if there are any active (in-progress/not-started) builds for a PR.
 */
export async function fetchActiveBuilds(org, project, auth, sourceRefName, prId) {
  const prMergeRef = `refs/pull/${prId}/merge`;
  try {
    const [bResp1, bResp2] = await Promise.all([
      fetch(`https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/build/builds?branchName=${encodeURIComponent(sourceRefName)}&$top=5&api-version=7.0`, { headers: { Authorization: `Basic ${auth}` } }),
      fetch(`https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/build/builds?branchName=${encodeURIComponent(prMergeRef)}&$top=5&api-version=7.0`, { headers: { Authorization: `Basic ${auth}` } })
    ]);
    const isActive = b => b.status === 'inProgress' || b.status === 'notStarted';
    let hasActive = false;
    if (bResp1.ok) {
      const bData = await bResp1.json();
      hasActive = (bData.value || []).some(isActive);
    }
    if (!hasActive && bResp2.ok) {
      const bData = await bResp2.json();
      hasActive = (bData.value || []).some(isActive);
    }
    return hasActive;
  } catch {
    return false;
  }
}

/**
 * Fetch the latest completed build number for a branch (e.g. target/source branch).
 * Returns the buildNumber string or null.
 */
export async function fetchLatestBuildNumber(org, project, auth, branchName, minTime) {
  let url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/build/builds?branchName=${encodeURIComponent(branchName)}&$top=5&api-version=7.0`;
  if (minTime) {
    url += `&minTime=${encodeURIComponent(minTime)}&queryOrder=queueTimeAscending`;
  } else {
    url += `&queryOrder=queueTimeDescending`;
  }
  console.log('[fetchLatestBuildNumber] branch=%s url=%s', branchName, url);
  try {
    const resp = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!resp.ok) return null;
    const data = await resp.json();
    const builds = data.value || [];
    console.log('[fetchLatestBuildNumber] found %d builds:', builds.length, builds.map(b => `${b.buildNumber} (${b.definition?.name}, ${b.status})`));
    return builds.length > 0 ? builds[0].buildNumber : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a work item: set state to Resolved and optionally set Integrated in Build and Release Note fields.
 */
export async function resolveWorkItem(ctx, id, { integrationBuild, releaseNote } = {}) {
  const ops = [{ op: 'add', path: '/fields/System.State', value: 'Resolved' }];
  if (integrationBuild) ops.push({ op: 'add', path: '/fields/Microsoft.VSTS.Build.IntegrationBuild', value: integrationBuild });
  if (releaseNote) ops.push({ op: 'add', path: '/fields/Custom.Releasenote', value: releaseNote });
  try {
    const resp = await fetch(
      `${ctx.apiBase}/wit/workitems/${id}?api-version=7.0`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json-patch+json', 'Authorization': `Basic ${ctx.auth}` },
        body: JSON.stringify(ops)
      }
    );
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch the latest build for a branch with full status details.
 * Returns { id, buildNumber, status, result, webUrl } or null.
 * status: 'inProgress' | 'completed' | 'notStarted' | 'cancelling'
 * result (when completed): 'succeeded' | 'failed' | 'partiallySucceeded' | 'canceled' | 'none'
 */
export async function fetchLatestBuild(org, project, auth, branchName, minTime) {
  let url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/build/builds?branchName=${encodeURIComponent(branchName)}&$top=1&api-version=7.0`;
  if (minTime) {
    url += `&minTime=${encodeURIComponent(minTime)}&queryOrder=queueTimeAscending`;
  } else {
    url += `&queryOrder=queueTimeDescending`;
  }
  try {
    const resp = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!resp.ok) return null;
    const data = await resp.json();
    const builds = data.value || [];
    if (builds.length === 0) return null;
    const b = builds[0];
    return { id: b.id, buildNumber: b.buildNumber, status: b.status, result: b.result, webUrl: b._links?.web?.href || null, definitionId: b.definition?.id || null };
  } catch {
    return null;
  }
}

/**
 * Fetch artifacts for a given build — checks both legacy build artifacts and modern pipeline artifacts.
 * Returns array of { name, downloadUrl } or [].
 */
export async function fetchBuildArtifacts(org, project, auth, buildId, definitionId = null) {
  try {
    const base = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}`;

    // Legacy build artifacts (PublishBuildArtifacts task)
    const buildResp = await fetch(`${base}/_apis/build/builds/${buildId}/artifacts?api-version=7.0`, { headers: { Authorization: `Basic ${auth}` } });
    if (buildResp.ok) {
      const data = await buildResp.json();
      const buildArtifacts = (data.value || []).map(a => {
        console.log('[artifacts] raw resource for', a.name, JSON.stringify(a.resource));
        const containerId = a.resource?.data?.startsWith('#/')
          ? a.resource.data.slice(2)
          : (a.resource?.url?.match(/\/Containers\/(\d+)/)?.[1] ?? null);
        return { name: a.name, downloadUrl: a.resource?.downloadUrl || null, containerId };
      });
      if (buildArtifacts.length > 0) return buildArtifacts;
    }

    // Modern pipeline artifacts (PublishPipelineArtifact task) — requires definition ID
    const defId = definitionId;
    if (!defId) return [];
    const pipelineResp = await fetch(`${base}/_apis/pipelines/${defId}/runs/${buildId}/artifacts?api-version=7.2-preview.1`, { headers: { Authorization: `Basic ${auth}` } });
    if (!pipelineResp.ok) return [];
    const pipelineData = await pipelineResp.json();
    return (pipelineData.value || []).map(a => ({ name: a.name, downloadUrl: a.signedContent?.url || null }));
  } catch {
    return [];
  }
}

/**
 * Fetch the individual file items within a build artifact container.
 * Returns array of { name, downloadUrl } or [].
 */
export async function fetchContainerItems(org, auth, containerId) {
  const url = `https://dev.azure.com/${encodeURIComponent(org)}/_apis/resources/Containers/${containerId}?api-version=7.0`;
  try {
    const resp = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (Array.isArray(data) ? data : (data.value || []))
      .filter(item => item.itemType === 1)
      .map(item => ({ name: item.path.split('/').pop(), downloadUrl: item.contentLocation || null }));
  } catch {
    return [];
  }
}

/**
 * Add a comment to a work item. Silently ignores errors.
 */
export async function addWorkItemComment(ctx, id, text) {
  try {
    const resp = await fetch(
      `${ctx.apiBase}/wit/workitems/${id}/comments?api-version=7.1-preview.4`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${ctx.auth}` },
        body: JSON.stringify({ text })
      }
    );
    return resp.ok;
  } catch {
    return false;
  }
}
