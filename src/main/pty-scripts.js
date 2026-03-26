const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

function buildWorktreeCmd(barePath, { repoDir, dirName, branchName, sourceBranch }) {
  const wtPath = path.join(repoDir, dirName).replace(/\\/g, '/');
  const startPoint = `refs/remotes/origin/${sourceBranch}`;

  let branchExists = false;
  try {
    execSync(`git rev-parse --verify refs/heads/${branchName}`, { cwd: barePath, encoding: 'utf8', stdio: 'pipe' });
    branchExists = true;
  } catch {}

  const cmd = branchExists
    ? `git worktree add ${wtPath} ${branchName}`
    : `git worktree add ${wtPath} -b ${branchName} ${startPoint}`;

  return { cmd, cwd: barePath, wtPath };
}

function buildCloneCmd({ url, reposDir }) {
  const urlPath = url.replace(/\.git\/?$/, '').replace(/\/$/, '');
  const repoName = urlPath.split('/').pop();
  const repoDir = path.join(reposDir, repoName);
  const bareDir = path.join(repoDir, 'Bare');

  fs.mkdirSync(bareDir, { recursive: true });

  const gitCmds = `git init --bare . && git remote add origin ${url} && git config remote.origin.fetch +refs/heads/*:refs/remotes/origin/* && git fetch --progress origin && echo. && echo === CLONE COMPLETE ===`;
  const cmd = process.platform === 'win32' ? gitCmds : gitCmds.replace(/echo\./g, 'echo');

  return { cmd, cwd: bareDir, repoName, repoDir, bareDir };
}

function buildDeleteScript(repoDir) {
  const barePath = path.join(repoDir, 'Bare');

  let worktreePaths = [];
  try {
    const output = execSync('git worktree list --porcelain', {
      cwd: barePath,
      encoding: 'utf8',
      timeout: 10000
    });
    const blocks = output.trim().split('\n\n');
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      const wtLine = lines.find(l => l.startsWith('worktree '));
      const isBare = lines.some(l => l.trim() === 'bare');
      if (!wtLine || isBare) continue;
      worktreePaths.push(wtLine.substring('worktree '.length).trim());
    }
  } catch {}

  const isWin = process.platform === 'win32';
  const scriptExt = isWin ? '.cmd' : '.sh';
  const scriptPath = path.join(os.tmpdir(), `codehive-delete-${Date.now()}${scriptExt}`);

  const lines = [];
  if (isWin) {
    lines.push('@echo off');
    lines.push('echo Removing worktrees...');
    for (const wt of worktreePaths) {
      const wtWin = wt.replace(/\//g, '\\');
      lines.push(`echo   ${path.basename(wt)}`);
      lines.push(`git worktree remove "${wtWin}" --force 2>nul`);
      lines.push(`if exist "${wtWin}" rd /s /q "${wtWin}"`);
    }
    lines.push('echo.');
    lines.push('echo Removing project directory...');
    const repoDirWin = repoDir.replace(/\//g, '\\');
    lines.push(`echo   ${repoDirWin}`);
    lines.push(`cd /d "%TEMP%"`);
    lines.push(`rd /s /q "${repoDirWin}"`);
    lines.push('echo.');
    lines.push('echo === DELETE COMPLETE ===');
  } else {
    lines.push('#!/bin/sh');
    lines.push('echo "Removing worktrees..."');
    for (const wt of worktreePaths) {
      lines.push(`echo "  ${path.basename(wt)}"`);
      lines.push(`git worktree remove "${wt}" --force 2>/dev/null || rm -rf "${wt}"`);
    }
    lines.push('echo ""');
    lines.push('echo "Removing project directory..."');
    lines.push(`echo "  ${repoDir}"`);
    lines.push('cd /tmp');
    lines.push(`rm -rf "${repoDir}"`);
    lines.push('echo ""');
    lines.push('echo "=== DELETE COMPLETE ==="');
  }

  fs.writeFileSync(scriptPath, lines.join('\n'), { encoding: 'utf8' });

  const cmd = isWin ? scriptPath : `sh "${scriptPath}"`;
  return { cmd, cwd: barePath, scriptPath };
}

function buildWorktreeRemoveScript(barePath, wtPath) {
  const isWin = process.platform === 'win32';
  const scriptExt = isWin ? '.cmd' : '.sh';
  const scriptPath = path.join(os.tmpdir(), `codehive-wt-remove-${Date.now()}${scriptExt}`);

  const wtForGit = wtPath.replace(/\\/g, '/');
  const wtForFs = isWin ? wtPath.replace(/\//g, '\\') : wtPath;

  const lines = [];
  if (isWin) {
    lines.push('@echo off');
    lines.push(`echo Removing worktree: ${path.basename(wtPath)}`);
    lines.push(`git worktree remove "${wtForGit}" --force 2>nul`);
    lines.push(`if exist "${wtForFs}" (`);
    lines.push(`  echo Cleaning up directory...`);
    lines.push(`  rd /s /q "${wtForFs}"`);
    lines.push(`)`);
    lines.push(`git worktree prune 2>nul`);
    lines.push('echo.');
    lines.push('echo === REMOVE COMPLETE ===');
  } else {
    lines.push('#!/bin/sh');
    lines.push(`echo "Removing worktree: ${path.basename(wtPath)}"`);
    lines.push(`git worktree remove "${wtForGit}" --force 2>/dev/null`);
    lines.push(`if [ -d "${wtPath}" ]; then`);
    lines.push(`  echo "Cleaning up directory..."`);
    lines.push(`  rm -rf "${wtPath}"`);
    lines.push('fi');
    lines.push('git worktree prune 2>/dev/null');
    lines.push('echo ""');
    lines.push('echo "=== REMOVE COMPLETE ==="');
  }

  fs.writeFileSync(scriptPath, lines.join('\n'), { encoding: 'utf8' });

  const cmd = isWin ? scriptPath : `sh "${scriptPath}"`;
  return { cmd, cwd: barePath, scriptPath };
}

function buildCommitPushScript(wtPath, { title, description, branch }) {
  const isWin = process.platform === 'win32';
  const scriptExt = isWin ? '.cmd' : '.sh';
  const scriptPath = path.join(os.tmpdir(), `codehive-commit-push-${Date.now()}${scriptExt}`);

  const commitMsg = description ? `${title}\n\n${description}` : title;
  const escapedMsg = commitMsg.replace(/"/g, isWin ? '""' : '\\"');

  const lines = [];
  if (isWin) {
    lines.push('@echo off');
    lines.push('echo Staging all changes...');
    lines.push('git add -A');
    lines.push('echo.');
    lines.push('echo Creating commit...');
    lines.push(`git commit -m "${escapedMsg}"`);
    lines.push('if %errorlevel% neq 0 (');
    lines.push('  echo.');
    lines.push('  echo No changes to commit or commit failed.');
    lines.push('  exit /b 1');
    lines.push(')');
    lines.push('echo.');
    lines.push(`echo Pushing to origin/${branch}...`);
    lines.push(`git push -u origin "${branch}"`);
    lines.push('if %errorlevel% neq 0 (');
    lines.push('  echo.');
    lines.push('  echo Push failed.');
    lines.push('  exit /b 1');
    lines.push(')');
    lines.push('echo.');
    lines.push('echo === COMMIT AND PUSH COMPLETE ===');
  } else {
    lines.push('#!/bin/sh');
    lines.push('set -e');
    lines.push('echo "Staging all changes..."');
    lines.push('git add -A');
    lines.push('echo ""');
    lines.push('echo "Creating commit..."');
    lines.push(`git commit -m "${escapedMsg}"`);
    lines.push('echo ""');
    lines.push(`echo "Pushing to origin/${branch}..."`);
    lines.push(`git push -u origin "${branch}"`);
    lines.push('echo ""');
    lines.push('echo "=== COMMIT AND PUSH COMPLETE ==="');
  }

  fs.writeFileSync(scriptPath, lines.join('\n'), { encoding: 'utf8' });

  const cmd = isWin ? scriptPath : `sh "${scriptPath}"`;
  return { cmd, cwd: wtPath, scriptPath };
}

function buildPrCreateScript(wtPath, { sourceBranch, targetBranch, title, description, pat, workItemId }) {
  const isWin = process.platform === 'win32';
  const scriptExt = isWin ? '.ps1' : '.sh';
  const scriptPath = path.join(os.tmpdir(), `codehive-pr-create-${Date.now()}${scriptExt}`);

  const lines = [];
  if (isWin) {
    const escapedTitle = title.replace(/'/g, "''");
    const escapedDesc = (description || '').replace(/'/g, "''");
    let azPrCmd = `az repos pr create --open --source-branch '${sourceBranch}' --target-branch '${targetBranch}' --title '${escapedTitle}'`;
    if (description) azPrCmd += ` --description '${escapedDesc}'`;
    if (workItemId) azPrCmd += ` --work-items ${workItemId}`;
    if (pat) lines.push(`$env:AZURE_DEVOPS_EXT_PAT = '${pat.replace(/'/g, "''")}'`);
    lines.push(`Write-Host "Creating pull request: ${sourceBranch} -> ${targetBranch}"`);
    lines.push('Write-Host ""');
    lines.push(azPrCmd);
    lines.push('if ($LASTEXITCODE -ne 0) { Write-Host ""; Write-Host "Pull request creation failed."; exit 1 }');
    lines.push('Write-Host ""');
    lines.push('Write-Host "=== PULL REQUEST CREATED ==="');
  } else {
    const escapedTitle = title.replace(/"/g, '\\"');
    const escapedDesc = (description || '').replace(/"/g, '\\"');
    let azPrCmd = `az repos pr create --open --source-branch "${sourceBranch}" --target-branch "${targetBranch}" --title "${escapedTitle}"`;
    if (description) azPrCmd += ` --description "${escapedDesc}"`;
    if (workItemId) azPrCmd += ` --work-items ${workItemId}`;
    lines.push('#!/bin/sh');
    lines.push('set -e');
    if (pat) lines.push(`export AZURE_DEVOPS_EXT_PAT='${pat.replace(/'/g, "'\\''")}'`);
    lines.push(`echo "Creating pull request: ${sourceBranch} -> ${targetBranch}"`);
    lines.push('echo ""');
    lines.push(azPrCmd);
    lines.push('echo ""');
    lines.push('echo "=== PULL REQUEST CREATED ==="');
  }

  fs.writeFileSync(scriptPath, lines.join('\r\n'), { encoding: 'utf8' });

  const cmd = isWin ? `powershell -ExecutionPolicy Bypass -File "${scriptPath}"` : `sh "${scriptPath}"`;
  return { cmd, cwd: wtPath, scriptPath };
}

module.exports = { buildWorktreeCmd, buildCloneCmd, buildDeleteScript, buildWorktreeRemoveScript, buildCommitPushScript, buildPrCreateScript };
