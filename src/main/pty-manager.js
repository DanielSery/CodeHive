const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnProc } = require('./pty-spawn.js');
const { buildWorktreeCmd, buildCloneCmd, buildDeleteScript, buildWorktreeRemoveScript, buildWorktreeSwitchScript, buildCommitPushScript, buildPrCreateScript, buildRebaseScript, buildForcePushScript, buildRegularPushScript, buildFastForwardScript, buildCherryPickScript, buildPullScript, buildMergeRemoteScript, buildRebaseRemoteScript, buildResetToTheirsScript } = require('./pty-scripts.js');
const { createPackagesJunction } = require('./repo-scanner.js');

function createWorktreePty(mainWindow, { barePath, repoDir, branchName, sourceBranch }) {
  const { cmd, cwd, wtPath, dirName } = buildWorktreeCmd(barePath, { repoDir, branchName, sourceBranch });
  const proc = spawnProc(cmd, cwd);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('worktree:data', data);
    }
  });

  proc.onExit(({ exitCode }) => {
    if (exitCode === 0) createPackagesJunction(wtPath, barePath);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('worktree:exit', { exitCode, wtPath, branchName, dirName });
    }
  });

  return { proc, wtPath, branchName, dirName };
}

function createClonePty(mainWindow, { url, reposDir }) {
  const { cmd, cwd, repoName, repoDir, bareDir } = buildCloneCmd({ url, reposDir });
  const proc = spawnProc(cmd, cwd);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clone:data', data);
    }
  });

  proc.onExit(({ exitCode }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clone:exit', { exitCode, repoName, repoDir, bareDir, reposDir });
    }
  });

  return { proc, repoName, repoDir, bareDir };
}

function createDeletePty(mainWindow, { repoDir }) {
  const { cmd, cwd, scriptPath } = buildDeleteScript(repoDir);
  const proc = spawnProc(cmd, cwd);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('delete:data', data);
    }
  });

  proc.onExit(({ exitCode }) => {
    try { fs.unlinkSync(scriptPath); } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('delete:exit', { exitCode, repoDir });
    }
  });

  return { proc };
}

function createWorktreeRemovePty(mainWindow, { barePath, wtPath, branchName, deleteBranch }) {
  const { cmd, cwd, scriptPath } = buildWorktreeRemoveScript(barePath, wtPath, { branchName, deleteBranch });
  const proc = spawnProc(cmd, cwd);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('worktreeRemove:data', data);
    }
  });

  proc.onExit(({ exitCode }) => {
    try { fs.unlinkSync(scriptPath); } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('worktreeRemove:exit', { exitCode, wtPath });
    }
  });

  return { proc };
}

function createWorktreeSwitchPty(mainWindow, { oldWtPath, branchName, sourceBranch, oldBranch, deleteBranch }) {
  const oldWtForGit = oldWtPath.replace(/\\/g, '/');
  const dirName = require('path').basename(oldWtPath);
  const cwd = require('path').resolve(oldWtPath);

  let proc, scriptPath;
  if (deleteBranch && oldBranch && oldBranch !== branchName) {
    const result = buildWorktreeSwitchScript(cwd, { branchName, sourceBranch, oldBranch });
    proc = spawnProc(result.cmd, cwd);
    scriptPath = result.scriptPath;
  } else {
    const startPoint = `refs/remotes/origin/${sourceBranch}`;
    const cmd = `git checkout -B ${branchName} ${startPoint}`;
    proc = spawnProc(cmd, cwd);
  }

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('worktreeSwitch:data', data);
    }
  });

  proc.onExit(({ exitCode }) => {
    if (scriptPath) { try { fs.unlinkSync(scriptPath); } catch {} }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('worktreeSwitch:exit', { exitCode, wtPath: oldWtForGit, branchName, dirName });
    }
  });

  return { proc, wtPath: oldWtForGit, branchName, dirName };
}

function createCommitPushPty(mainWindow, { wtPath, title, description, branch, files }) {
  const { cmd, cwd, scriptPath } = buildCommitPushScript(wtPath, { title, description, branch, files });
  const proc = spawnProc(cmd, cwd);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('commitPush:data', data);
    }
  });

  proc.onExit(({ exitCode }) => {
    try { fs.unlinkSync(scriptPath); } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('commitPush:exit', { exitCode });
    }
  });

  return { proc };
}

function createPrCreatePty(mainWindow, { wtPath, sourceBranch, targetBranch, title, description, pat, workItemId }) {
  const { cmd, cwd, scriptPath, env } = buildPrCreateScript(wtPath, { sourceBranch, targetBranch, title, description, pat, workItemId });
  const proc = spawnProc(cmd, cwd, env);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('prCreate:data', data);
    }
  });

  proc.onExit(({ exitCode }) => {
    try { fs.unlinkSync(scriptPath); } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('prCreate:exit', { exitCode });
    }
  });

  return { proc };
}

function createAzInstallPty(mainWindow) {
  const isWin = process.platform === 'win32';
  const cmd = isWin
    ? 'winget install -e --id Microsoft.AzureCLI'
    : 'curl -sL https://aka.ms/InstallAzureCLIDeb -o /tmp/install-azure-cli.sh && sudo bash /tmp/install-azure-cli.sh && rm -f /tmp/install-azure-cli.sh';
  const proc = spawnProc(cmd, process.env.HOME || process.cwd());

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('azInstall:data', data);
    }
  });

  proc.onExit(({ exitCode }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('azInstall:exit', { exitCode });
    }
  });

  return { proc };
}

function createSetupInstallPty(mainWindow, { downloadUrl, auth }) {
  const timestamp = Date.now();
  const zipPath = path.join(os.tmpdir(), `codehive-setup-${timestamp}.zip`);
  const extractDir = path.join(os.tmpdir(), `codehive-setup-${timestamp}`);
  const scriptPath = path.join(os.tmpdir(), `codehive-install-${timestamp}.ps1`);

  const script = `
$zipPath = '${zipPath.replace(/'/g, "''")}'
$extractDir = '${extractDir.replace(/'/g, "''")}'
$url = '${downloadUrl}'
$auth = '${auth}'

Write-Host "Downloading setup package..."
curl.exe -L -s -H "Authorization: Basic $auth" -o $zipPath $url
if ($LASTEXITCODE -ne 0) { Write-Host "Download failed" -ForegroundColor Red; exit 1 }
Write-Host "Download complete."

Write-Host "Extracting..."
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
$msi = Get-ChildItem -Path $extractDir -Filter "*.msi" -Recurse | Select-Object -First 1
if ($null -eq $msi) { Write-Host "No .msi found in artifact" -ForegroundColor Red; exit 1 }
Write-Host "Launching $($msi.Name)..."
Start-Process $msi.FullName -Wait
Write-Host "Installer finished." -ForegroundColor Green
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
`;

  fs.writeFileSync(scriptPath, script, 'utf8');
  const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`;
  const proc = spawnProc(cmd, os.tmpdir());

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('setupInstall:data', data);
  });
  proc.onExit(({ exitCode }) => {
    try { fs.unlinkSync(scriptPath); } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('setupInstall:exit', { exitCode });
  });

  return { proc };
}

function createRebasePty(mainWindow, { wtPath, sourceBranch, commits }) {
  const { cmd, cwd, scriptPath, editorPath, todoPath, msgFiles } = buildRebaseScript(wtPath, { sourceBranch, commits });
  const proc = spawnProc(cmd, cwd);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('rebase:data', data);
    }
  });

  proc.onExit(({ exitCode }) => {
    try { fs.unlinkSync(scriptPath); } catch {}
    try { fs.unlinkSync(editorPath); } catch {}
    try { fs.unlinkSync(todoPath); } catch {}
    for (const f of msgFiles) { try { fs.unlinkSync(f.path); } catch {} }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('rebase:exit', { exitCode });
    }
  });

  return { proc };
}

function createForcePushPty(mainWindow, { wtPath }) {
  const { cmd, cwd, scriptPath } = buildForcePushScript(wtPath);
  const proc = spawnProc(cmd, cwd);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('push:forcePushData', data);
  });

  proc.onExit(({ exitCode }) => {
    try { fs.unlinkSync(scriptPath); } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('push:forcePushExit', { exitCode });
  });

  return { proc };
}

function createPushPty(mainWindow, { wtPath }) {
  const { cmd, cwd, scriptPath } = buildRegularPushScript(wtPath);
  const proc = spawnProc(cmd, cwd);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('push:data', data);
  });

  proc.onExit(({ exitCode }) => {
    try { fs.unlinkSync(scriptPath); } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('push:exit', { exitCode });
  });

  return { proc };
}

function createFastForwardPty(mainWindow, { wtPath, branch }) {
  const { cmd, cwd, scriptPath } = buildFastForwardScript(wtPath, { branch });
  const proc = spawnProc(cmd, cwd);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rebase:fastForwardData', data);
  });

  proc.onExit(({ exitCode }) => {
    try { fs.unlinkSync(scriptPath); } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rebase:fastForwardExit', { exitCode });
  });

  return { proc };
}

function createCherryPickPty(mainWindow, { wtPath, sourceBranch, targetBranch, commits }) {
  const { cmd, cwd, scriptPath } = buildCherryPickScript(wtPath, { sourceBranch, targetBranch, commits });
  const proc = spawnProc(cmd, cwd);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('cherryPick:data', data);
  });

  proc.onExit(({ exitCode }) => {
    try { fs.unlinkSync(scriptPath); } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('cherryPick:exit', { exitCode });
  });

  return { proc };
}

function createSyncPty(mainWindow, { wtPath, branch, mode }) {
  let result;
  if (mode === 'pull') result = buildPullScript(wtPath, branch);
  else if (mode === 'merge') result = buildMergeRemoteScript(wtPath, branch);
  else if (mode === 'rebase') result = buildRebaseRemoteScript(wtPath, branch);
  else if (mode === 'reset-theirs') result = buildResetToTheirsScript(wtPath, branch);
  else throw new Error(`Unknown sync mode: ${mode}`);

  const { cmd, cwd, scriptPath } = result;
  const proc = spawnProc(cmd, cwd);

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sync:data', data);
  });

  proc.onExit(({ exitCode }) => {
    try { fs.unlinkSync(scriptPath); } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sync:exit', { exitCode });
  });

  return { proc };
}

module.exports = { createWorktreePty, createClonePty, createDeletePty, createWorktreeRemovePty, createWorktreeSwitchPty, createCommitPushPty, createPrCreatePty, createAzInstallPty, createSetupInstallPty, createRebasePty, createForcePushPty, createFastForwardPty, createCherryPickPty, createPushPty, createSyncPty };
