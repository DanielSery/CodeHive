// Workspace state — no DOM dependencies
const workspaces = new Map(); // id -> { folderPath, name, webview, tabEl }
let activeWorkspaceId = null;
let workspaceCounter = 0;

function nextId() {
  return ++workspaceCounter;
}

function getWorkspace(id) {
  return workspaces.get(id);
}

function getActive() {
  return activeWorkspaceId !== null ? workspaces.get(activeWorkspaceId) : null;
}

function getActiveId() {
  return activeWorkspaceId;
}

function setActiveId(id) {
  activeWorkspaceId = id;
}

function addWorkspace(id, ws) {
  workspaces.set(id, ws);
}

function removeWorkspace(id) {
  workspaces.delete(id);
}

function getAllIds() {
  return Array.from(workspaces.keys());
}

export { workspaces, getWorkspace, getActive, getActiveId, setActiveId, nextId, addWorkspace, removeWorkspace, getAllIds };
