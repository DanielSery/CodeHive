const { ipcMain } = require('electron');
const { scanDirectory, checkClaudeActive, getCachedBranches, fetchAndListBranches, getGitUser, getRemoteUrl, getLaunchConfigs, gitDiffStat, gitFileDiff, getFirstBranchCommit, hasUncommittedChanges, hasPushedCommits, gitRevertFile, getRebaseCommits } = require('./repo-scanner');
const { watchClaude, unwatchClaude } = require('./claude-status');

function register(mainWindow) {
  ipcMain.handle('repos:scanDirectory', async (event, dirPath) => {
    return scanDirectory(dirPath);
  });

  ipcMain.handle('repos:claudeActive', (event, wtPath) => {
    return checkClaudeActive(wtPath);
  });

  ipcMain.on('claude:watch', (event, wtPath) => {
    watchClaude(wtPath, (watchedPath, status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('claude:status', watchedPath, status);
      }
    });
  });

  ipcMain.on('claude:unwatch', (event, wtPath) => {
    unwatchClaude(wtPath);
  });

  ipcMain.handle('repos:cachedBranches', (event, barePath) => {
    return getCachedBranches(barePath);
  });

  ipcMain.handle('repos:fetchBranches', (event, barePath) => {
    return fetchAndListBranches(barePath);
  });

  ipcMain.handle('repos:gitUser', (event, barePath) => {
    return getGitUser(barePath);
  });

  ipcMain.handle('repos:remoteUrl', (event, barePath) => {
    return getRemoteUrl(barePath);
  });

  ipcMain.handle('repos:launchConfigs', (event, wtPath) => {
    return getLaunchConfigs(wtPath);
  });

  ipcMain.handle('repos:gitDiffStat', (event, wtPath) => {
    return gitDiffStat(wtPath);
  });

  ipcMain.handle('repos:firstBranchCommit', (event, { wtPath, sourceBranch }) => {
    return getFirstBranchCommit(wtPath, sourceBranch);
  });

  ipcMain.handle('repos:hasUncommittedChanges', (event, wtPath) => {
    return hasUncommittedChanges(wtPath);
  });

  ipcMain.handle('repos:hasPushedCommits', (event, { wtPath, branch, sourceBranch }) => {
    return hasPushedCommits(wtPath, branch, sourceBranch);
  });

  ipcMain.handle('repos:gitRevertFile', (event, { wtPath, filePath, isNew }) => {
    return gitRevertFile(wtPath, filePath, isNew);
  });

  ipcMain.handle('repos:gitFileDiff', (event, { wtPath, filePath }) => {
    return gitFileDiff(wtPath, filePath);
  });

  ipcMain.handle('repos:rebaseCommits', (event, { wtPath, sourceBranch }) => {
    return getRebaseCommits(wtPath, sourceBranch);
  });
}

module.exports = { register };
