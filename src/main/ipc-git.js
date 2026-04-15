const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { scanDirectory, checkClaudeActive, getCachedBranches, fetchAndListBranches, getGitUser, getRemoteUrl, getLaunchConfigs, gitDiffStat, gitFileDiff, gitBranchDiffStat, gitBranchFileDiff, gitRevertLines, getFirstBranchCommit, hasUncommittedChanges, hasPushedCommits, gitRevertFile, getRebaseCommits, getCherryPickCommits, gitGetFileLines, getSyncStatus, getCommitsAhead, getCommitsBehind, checkoutIdle } = require('./repo-scanner');
const { watchClaude, unwatchClaude } = require('./claude-status');

function register(mainWindow) {
  ipcMain.handle('repos:scanDirectory', async (event, dirPath) => {
    return scanDirectory(dirPath);
  });

  ipcMain.handle('repos:repoExists', (event, { reposDir, repoName }) => {
    return fs.existsSync(path.join(reposDir, repoName));
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

  ipcMain.handle('repos:gitFileDiff', (event, { wtPath, filePath, context }) => {
    return gitFileDiff(wtPath, filePath, context);
  });

  ipcMain.handle('repos:gitBranchDiffStat', (event, { wtPath, targetBranch }) => {
    return gitBranchDiffStat(wtPath, targetBranch);
  });

  ipcMain.handle('repos:gitBranchFileDiff', (event, { wtPath, filePath, targetBranch, context }) => {
    return gitBranchFileDiff(wtPath, filePath, targetBranch, context);
  });

  ipcMain.handle('repos:gitRevertLines', (event, { wtPath, filePath, changes }) => {
    return gitRevertLines(wtPath, filePath, changes);
  });

  ipcMain.handle('repos:gitGetFileLines', (event, { wtPath, filePath, startLine, endLine }) => {
    return gitGetFileLines(wtPath, filePath, startLine, endLine);
  });

  ipcMain.handle('repos:rebaseCommits', (event, { wtPath, sourceBranch }) => {
    return getRebaseCommits(wtPath, sourceBranch);
  });

  ipcMain.handle('repos:cherryPickCommits', (event, { sourceWtPath, targetBranch }) => {
    return getCherryPickCommits(sourceWtPath, targetBranch);
  });

  ipcMain.handle('repos:getSyncStatus', (event, { wtPath, branch, sourceBranch }) => {
    return getSyncStatus(wtPath, branch, sourceBranch);
  });

  ipcMain.handle('repos:getCommitsAhead', (event, { wtPath, branch, sourceBranch }) => {
    return getCommitsAhead(wtPath, branch, sourceBranch);
  });

  ipcMain.handle('repos:getCommitsBehind', (event, { wtPath, branch }) => {
    return getCommitsBehind(wtPath, branch);
  });

  ipcMain.handle('repos:checkoutIdle', (event, wtPath) => {
    return checkoutIdle(wtPath);
  });
}

module.exports = { register };
