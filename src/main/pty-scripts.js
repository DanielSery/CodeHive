const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

/**
 * Sanitize a value for safe interpolation into shell commands.
 * Wraps in double quotes and escapes characters that are dangerous in both
 * cmd.exe and sh/bash contexts.
 */
function shellQuote(value) {
  if (typeof value !== 'string') value = String(value);
  // Reject values containing null bytes (never valid in shell arguments)
  if (value.includes('\0')) throw new Error('Shell argument must not contain null bytes');
  if (process.platform === 'win32') {
    // For cmd.exe: escape double quotes, percent signs, and special chars
    const escaped = value.replace(/%/g, '%%').replace(/"/g, '""');
    return `"${escaped}"`;
  } else {
    // For sh/bash: single-quote the value, escaping embedded single quotes
    const escaped = value.replace(/'/g, "'\\''");
    return `'${escaped}'`;
  }
}

/**
 * Validate that a string looks like a valid git ref name.
 * Rejects characters that could break out of shell commands.
 */
function assertSafeRef(ref) {
  // Git ref names must not contain: space, ~, ^, :, ?, *, [, \, control chars, ..
  // They also must not start/end with . or contain //
  if (/[\x00-\x1f\x7f ~^:?*[\]\\;&|`$(){}!#<>]/.test(ref)) {
    throw new Error(`Unsafe characters in git ref: ${ref}`);
  }
  if (ref.includes('..')) {
    throw new Error(`Git ref must not contain "..": ${ref}`);
  }
  return ref;
}

function buildWorktreeCmd(barePath, { repoDir, dirName, branchName, sourceBranch }) {
  assertSafeRef(branchName);
  assertSafeRef(sourceBranch);

  const wtPath = path.join(repoDir, dirName).replace(/\\/g, '/');
  const startPoint = `refs/remotes/origin/${sourceBranch}`;

  let branchExists = false;
  try {
    execSync(`git rev-parse --verify refs/heads/${branchName}`, { cwd: barePath, encoding: 'utf8', stdio: 'pipe' });
    branchExists = true;
  } catch {}

  const cmd = branchExists
    ? `git worktree add ${shellQuote(wtPath)} ${shellQuote(branchName)}`
    : `git worktree add ${shellQuote(wtPath)} -b ${shellQuote(branchName)} ${shellQuote(startPoint)}`;

  return { cmd, cwd: barePath, wtPath };
}

function buildCloneCmd({ url, reposDir }) {
  const urlPath = url.replace(/\.git\/?$/, '').replace(/\/$/, '');
  const repoName = urlPath.split('/').pop();
  const repoDir = path.join(reposDir, repoName);
  const bareDir = path.join(repoDir, 'Bare');

  fs.mkdirSync(bareDir, { recursive: true });

  const gitCmds = `git init --bare . && git remote add origin ${shellQuote(url)} && git config remote.origin.fetch +refs/heads/*:refs/remotes/origin/* && git fetch --progress origin && echo. && echo === CLONE COMPLETE ===`;
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

function buildCommitPushScript(wtPath, { title, description, branch, files }) {
  assertSafeRef(branch);

  const isWin = process.platform === 'win32';
  const scriptExt = isWin ? '.cmd' : '.sh';
  const scriptPath = path.join(os.tmpdir(), `codehive-commit-push-${Date.now()}${scriptExt}`);

  // Write commit message to a temp file to avoid all shell escaping issues
  const msgPath = path.join(os.tmpdir(), `codehive-commit-msg-${Date.now()}.txt`);
  const commitMsg = description ? `${title}\n\n${description}` : title;
  fs.writeFileSync(msgPath, commitMsg, { encoding: 'utf8' });

  const lines = [];
  if (isWin) {
    const msgPathWin = msgPath.replace(/\//g, '\\');
    lines.push('@echo off');
    lines.push('echo Staging selected files...');
    for (const f of files) lines.push(`git add -- ${shellQuote(f)}`);
    lines.push('echo.');
    lines.push('echo Creating commit...');
    lines.push(`git commit -F "${msgPathWin}"`);
    lines.push('if %errorlevel% neq 0 (');
    lines.push('  echo.');
    lines.push('  echo No changes to commit or commit failed.');
    lines.push(`  del "${msgPathWin}" 2>nul`);
    lines.push('  exit /b 1');
    lines.push(')');
    lines.push(`del "${msgPathWin}" 2>nul`);
    lines.push('echo.');
    lines.push(`echo Pushing to origin/${branch}...`);
    lines.push(`git push -u origin ${shellQuote(branch)}`);
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
    lines.push('echo "Staging selected files..."');
    for (const f of files) lines.push(`git add -- ${shellQuote(f)}`);
    lines.push('echo ""');
    lines.push('echo "Creating commit..."');
    lines.push(`git commit -F ${shellQuote(msgPath)}`);
    lines.push(`rm -f ${shellQuote(msgPath)}`);
    lines.push('echo ""');
    lines.push(`echo "Pushing to origin/${branch}..."`);
    lines.push(`git push -u origin ${shellQuote(branch)}`);
    lines.push('echo ""');
    lines.push('echo "=== COMMIT AND PUSH COMPLETE ==="');
  }

  fs.writeFileSync(scriptPath, lines.join('\n'), { encoding: 'utf8' });

  const cmd = isWin ? scriptPath : `sh "${scriptPath}"`;
  return { cmd, cwd: wtPath, scriptPath };
}

function buildPrCreateScript(wtPath, { sourceBranch, targetBranch, title, description, pat, workItemId }) {
  assertSafeRef(sourceBranch);
  assertSafeRef(targetBranch);
  if (workItemId && !/^\d+$/.test(String(workItemId))) {
    throw new Error(`Invalid work item ID: ${workItemId}`);
  }

  const isWin = process.platform === 'win32';
  const scriptExt = isWin ? '.ps1' : '.sh';
  const scriptPath = path.join(os.tmpdir(), `codehive-pr-create-${Date.now()}${scriptExt}`);

  const lines = [];
  if (isWin) {
    // PowerShell: use single-quote escaping ('' inside single-quoted strings)
    const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
    let azPrCmd = `az repos pr create --source-branch ${psQuote(sourceBranch)} --target-branch ${psQuote(targetBranch)} --title ${psQuote(title)}`;
    if (description) azPrCmd += ` --description ${psQuote(description)}`;
    if (workItemId) azPrCmd += ` --work-items ${workItemId}`;
    lines.push(`Write-Host "Creating pull request: ${sourceBranch} -> ${targetBranch}"`);
    lines.push('Write-Host ""');
    lines.push(azPrCmd);
    lines.push('if ($LASTEXITCODE -ne 0) { Write-Host ""; Write-Host "Pull request creation failed."; exit 1 }');
    lines.push('Write-Host ""');
    lines.push('Write-Host "=== PULL REQUEST CREATED ==="');
  } else {
    let azPrCmd = `az repos pr create --source-branch ${shellQuote(sourceBranch)} --target-branch ${shellQuote(targetBranch)} --title ${shellQuote(title)}`;
    if (description) azPrCmd += ` --description ${shellQuote(description)}`;
    if (workItemId) azPrCmd += ` --work-items ${workItemId}`;
    lines.push('#!/bin/sh');
    lines.push('set -e');
    lines.push(`echo "Creating pull request: ${sourceBranch} -> ${targetBranch}"`);
    lines.push('echo ""');
    lines.push(azPrCmd);
    lines.push('echo ""');
    lines.push('echo "=== PULL REQUEST CREATED ==="');
  }

  fs.writeFileSync(scriptPath, lines.join('\r\n'), { encoding: 'utf8' });

  // PAT passed via environment variable (not written to script file on disk)
  const env = pat ? { AZURE_DEVOPS_EXT_PAT: pat } : undefined;
  const cmd = isWin ? `powershell -ExecutionPolicy Bypass -File "${scriptPath}"` : `sh "${scriptPath}"`;
  return { cmd, cwd: wtPath, scriptPath, env };
}

module.exports = { buildWorktreeCmd, buildCloneCmd, buildDeleteScript, buildWorktreeRemoveScript, buildCommitPushScript, buildPrCreateScript, shellQuote, assertSafeRef };
