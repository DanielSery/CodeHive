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
  const resp = await fetch(`${ctx.apiBase}/wit/workitems/$${encodeURIComponent(workItemType)}?api-version=7.0`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json-patch+json', 'Authorization': `Basic ${ctx.auth}` },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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
 * Fetch a single work item by ID. Returns { id, title, type } or null.
 */
export async function fetchWorkItemById(ctx, id) {
  try {
    const resp = await fetch(
      `${ctx.apiBase}/wit/workitems/${id}?fields=System.Id,System.Title,System.WorkItemType,System.Description&api-version=7.0`,
      { headers: { Authorization: `Basic ${ctx.auth}` } }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return { id: data.id, title: data.fields['System.Title'] || '', type: data.fields['System.WorkItemType'] || '', description: data.fields['System.Description'] || '' };
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
