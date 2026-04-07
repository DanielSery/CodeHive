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

function nextWorktreeId(repoDir) {
  const existing = new Set();
  try {
    for (const entry of fs.readdirSync(repoDir)) {
      if (/^\d{3}$/.test(entry)) existing.add(parseInt(entry, 10));
    }
  } catch {}
  for (let i = 1; i <= 999; i++) {
    if (!existing.has(i)) return String(i).padStart(3, '0');
  }
  return String(Date.now()).slice(-3);
}

function buildWorktreeCmd(barePath, { repoDir, branchName, sourceBranch }) {
  assertSafeRef(branchName);
  assertSafeRef(sourceBranch);

  const dirName = nextWorktreeId(repoDir);
  const wtPath = path.join(repoDir, dirName).replace(/\\/g, '/');
  const startPoint = `refs/remotes/origin/${sourceBranch}`;

  let branchExists = false;
  try {
    execSync(`git rev-parse --verify refs/heads/${branchName}`, { cwd: barePath, encoding: 'utf8', stdio: 'pipe' });
    branchExists = true;
  } catch {}

  const cmd = branchExists
    ? `git worktree add ${shellQuote(wtPath)} ${shellQuote(branchName)}`
    : `git worktree add --no-track ${shellQuote(wtPath)} -b ${shellQuote(branchName)} ${shellQuote(startPoint)}`;

  return { cmd, cwd: barePath, wtPath, dirName };
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

function buildWorktreeRemoveScript(barePath, wtPath, { branchName, deleteBranch } = {}) {
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
    if (deleteBranch && branchName) {
      assertSafeRef(branchName);
      lines.push(`echo Deleting branch: ${branchName}`);
      lines.push(`git branch -D ${shellQuote(branchName)}`);
    }
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
    if (deleteBranch && branchName) {
      assertSafeRef(branchName);
      lines.push(`echo "Deleting branch: ${branchName}"`);
      lines.push(`git branch -D ${shellQuote(branchName)}`);
    }
    lines.push('echo ""');
    lines.push('echo "=== REMOVE COMPLETE ==="');
  }

  fs.writeFileSync(scriptPath, lines.join('\n'), { encoding: 'utf8' });

  const cmd = isWin ? scriptPath : `sh "${scriptPath}"`;
  return { cmd, cwd: barePath, scriptPath };
}

function buildWorktreeSwitchScript(cwd, { branchName, sourceBranch, oldBranch }) {
  assertSafeRef(branchName);
  assertSafeRef(sourceBranch);
  assertSafeRef(oldBranch);

  const startPoint = `refs/remotes/origin/${sourceBranch}`;
  const isWin = process.platform === 'win32';
  const scriptExt = isWin ? '.cmd' : '.sh';
  const scriptPath = path.join(os.tmpdir(), `codehive-wt-switch-${Date.now()}${scriptExt}`);

  const lines = [];
  if (isWin) {
    lines.push('@echo off');
    lines.push(`echo Switching to ${branchName}...`);
    lines.push(`git checkout -B ${shellQuote(branchName)} ${shellQuote(startPoint)}`);
    lines.push('if %errorlevel% neq 0 exit /b %errorlevel%');
    lines.push(`echo Deleting old branch: ${oldBranch}`);
    lines.push(`git branch -D ${shellQuote(oldBranch)}`);
    lines.push('echo.');
    lines.push('echo === SWITCH COMPLETE ===');
  } else {
    lines.push('#!/bin/sh');
    lines.push('set -e');
    lines.push(`echo "Switching to ${branchName}..."`);
    lines.push(`git checkout -B ${shellQuote(branchName)} ${shellQuote(startPoint)}`);
    lines.push(`echo "Deleting old branch: ${oldBranch}"`);
    lines.push(`git branch -D ${shellQuote(oldBranch)}`);
    lines.push('echo ""');
    lines.push('echo "=== SWITCH COMPLETE ==="');
  }

  fs.writeFileSync(scriptPath, lines.join('\n'), { encoding: 'utf8' });

  const cmd = isWin ? scriptPath : `sh "${scriptPath}"`;
  return { cmd, cwd, scriptPath };
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
    lines.push('echo === COMMIT COMPLETE ===');
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
    lines.push('echo "=== COMMIT COMPLETE ==="');
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

/**
 * Transform commits into todo lines, converting reword/squash into pick/fixup
 * plus exec-amend lines so git never opens an interactive editor.
 * Returns { todoLines, msgFiles: [{path, content}] }
 */
function transformCommitsForTodo(commits, timestamp) {
  const todoLines = [];
  const msgFiles = [];

  let i = 0;
  while (i < commits.length) {
    const c = commits[i];

    if (c.action === 'reword') {
      const msgPath = path.join(os.tmpdir(), `codehive-rebase-msg-${timestamp}-${i}.txt`).replace(/\\/g, '/');
      msgFiles.push({ path: msgPath, content: c.message });
      todoLines.push(`pick ${c.hash} ${c.message}`);
      todoLines.push(`exec git commit --amend -F ${shellQuote(msgPath)}`);
      i++;
      continue;
    }

    if (c.action === 'pick') {
      todoLines.push(`pick ${c.hash} ${c.message}`);
      i++;

      // Absorb any following squash commits into this group
      const squashGroup = [];
      while (i < commits.length && commits[i].action === 'squash') {
        squashGroup.push(commits[i]);
        todoLines.push(`fixup ${commits[i].hash} ${commits[i].message}`);
        i++;
      }

      if (squashGroup.length > 0) {
        const combined = [c.message, ...squashGroup.map(s => s.message)].join('\n\n');
        const msgPath = path.join(os.tmpdir(), `codehive-rebase-msg-${timestamp}-${i}.txt`).replace(/\\/g, '/');
        msgFiles.push({ path: msgPath, content: combined });
        todoLines.push(`exec git commit --amend -F ${shellQuote(msgPath)}`);
      }
      continue;
    }

    // fixup, drop — pass through as-is; stray squash (no preceding pick) → fixup
    todoLines.push(`${c.action === 'squash' ? 'fixup' : c.action} ${c.hash} ${c.message}`);
    i++;
  }

  return { todoLines, msgFiles };
}

/**
 * Build a script that performs a non-interactive git rebase -i by injecting
 * the user-composed todo list via GIT_SEQUENCE_EDITOR.
 *
 * @param {string} wtPath - worktree directory
 * @param {{ sourceBranch: string, commits: Array<{action:string, hash:string, message:string}> }} opts
 */
function buildRebaseScript(wtPath, { sourceBranch, commits }) {
  assertSafeRef(sourceBranch);

  const timestamp = Date.now();
  const isWin = process.platform === 'win32';
  const scriptExt = isWin ? '.cmd' : '.sh';

  const { todoLines, msgFiles } = transformCommitsForTodo(commits, timestamp);
  for (const f of msgFiles) fs.writeFileSync(f.path, f.content, { encoding: 'utf8' });
  const todoContent = todoLines.join('\n') + '\n';

  const todoPath = path.join(os.tmpdir(), `codehive-rebase-todo-${timestamp}.txt`);
  const editorPath = path.join(os.tmpdir(), `codehive-rebase-editor-${timestamp}${scriptExt}`);
  const scriptPath = path.join(os.tmpdir(), `codehive-rebase-${timestamp}${scriptExt}`);

  fs.writeFileSync(todoPath, todoContent, { encoding: 'utf8' });

  const startPoint = `origin/${sourceBranch}`;

  if (isWin) {
    const todoWin = todoPath.replace(/\//g, '\\');
    const editorWin = editorPath.replace(/\//g, '\\');

    // Editor script: copy our todo over the git-rebase-todo file git passes as %1
    fs.writeFileSync(editorPath, `@echo off\r\ncopy /y "${todoWin}" "%~1"\r\n`, { encoding: 'utf8' });

    const lines = [
      '@echo off',
      `echo Starting interactive rebase onto ${sourceBranch}...`,
      `set "GIT_SEQUENCE_EDITOR="${editorWin}""`,
      `git rebase -i ${shellQuote(startPoint)}`,
      'if %errorlevel% neq 0 (',
      `  del "${todoWin}" 2>nul`,
      `  del "${editorWin}" 2>nul`,
      '  echo.',
      '  echo Rebase failed. Aborting...',
      '  git rebase --abort',
      '  exit /b 1',
      ')',
      `del "${todoWin}" 2>nul`,
      `del "${editorWin}" 2>nul`,
      'echo.',
      'echo === REBASE COMPLETE ===',
    ];
    fs.writeFileSync(scriptPath, lines.join('\r\n'), { encoding: 'utf8' });
  } else {
    // Editor script: cp our todo over the git-rebase-todo file git passes as $1
    fs.writeFileSync(editorPath, `#!/bin/sh\ncp ${shellQuote(todoPath)} "$1"\n`, { encoding: 'utf8' });
    fs.chmodSync(editorPath, 0o755);

    const lines = [
      '#!/bin/sh',
      `echo "Starting interactive rebase onto ${sourceBranch}..."`,
      `export GIT_SEQUENCE_EDITOR=${shellQuote(editorPath)}`,
      `git rebase -i ${shellQuote(startPoint)}`,
      'REBASE_STATUS=$?',
      `rm -f ${shellQuote(todoPath)} ${shellQuote(editorPath)}`,
      'if [ "$REBASE_STATUS" -ne 0 ]; then',
      '  echo ""',
      '  echo "Rebase failed. Aborting..."',
      '  git rebase --abort',
      '  exit 1',
      'fi',
      'echo ""',
      'echo "=== REBASE COMPLETE ==="',
    ];
    fs.writeFileSync(scriptPath, lines.join('\n'), { encoding: 'utf8' });
    fs.chmodSync(scriptPath, 0o755);
  }

  const cmd = isWin ? scriptPath : `sh ${shellQuote(scriptPath)}`;
  return { cmd, cwd: wtPath, scriptPath, editorPath, todoPath, msgFiles };
}

function buildForcePushScript(wtPath) {
  const isWin = process.platform === 'win32';
  const scriptExt = isWin ? '.cmd' : '.sh';
  const scriptPath = path.join(os.tmpdir(), `codehive-force-push-${Date.now()}${scriptExt}`);

  if (isWin) {
    const lines = [
      '@echo off',
      'echo Force pushing...',
      'git push --force-with-lease',
      'if %errorlevel% neq 0 (',
      '  echo.',
      '  echo Force push failed.',
      '  exit /b 1',
      ')',
      'echo.',
      'echo === FORCE PUSH COMPLETE ===',
    ];
    fs.writeFileSync(scriptPath, lines.join('\r\n'), { encoding: 'utf8' });
  } else {
    const lines = [
      '#!/bin/sh',
      'echo "Force pushing..."',
      'git push --force-with-lease',
      'PUSH_STATUS=$?',
      'if [ "$PUSH_STATUS" -ne 0 ]; then',
      '  echo ""',
      '  echo "Force push failed."',
      '  exit 1',
      'fi',
      'echo ""',
      'echo "=== FORCE PUSH COMPLETE ==="',
    ];
    fs.writeFileSync(scriptPath, lines.join('\n'), { encoding: 'utf8' });
    fs.chmodSync(scriptPath, 0o755);
  }

  const cmd = isWin ? scriptPath : `sh ${shellQuote(scriptPath)}`;
  return { cmd, cwd: wtPath, scriptPath };
}

function buildRegularPushScript(wtPath) {
  const isWin = process.platform === 'win32';
  const scriptExt = isWin ? '.cmd' : '.sh';
  const scriptPath = path.join(os.tmpdir(), `codehive-push-${Date.now()}${scriptExt}`);

  if (isWin) {
    const lines = [
      '@echo off',
      'echo Pushing to origin...',
      'git push origin HEAD',
      'if %errorlevel% neq 0 (',
      '  echo.',
      '  echo Push failed.',
      '  exit /b 1',
      ')',
      'echo.',
      'echo === PUSH COMPLETE ===',
    ];
    fs.writeFileSync(scriptPath, lines.join('\r\n'), { encoding: 'utf8' });
  } else {
    const lines = [
      '#!/bin/sh',
      'echo "Pushing to origin..."',
      'git push origin HEAD',
      'PUSH_STATUS=$?',
      'if [ "$PUSH_STATUS" -ne 0 ]; then',
      '  echo ""',
      '  echo "Push failed."',
      '  exit 1',
      'fi',
      'echo ""',
      'echo "=== PUSH COMPLETE ==="',
    ];
    fs.writeFileSync(scriptPath, lines.join('\n'), { encoding: 'utf8' });
    fs.chmodSync(scriptPath, 0o755);
  }

  const cmd = isWin ? scriptPath : `sh ${shellQuote(scriptPath)}`;
  return { cmd, cwd: wtPath, scriptPath };
}

/**
 * Build a script that cherry-picks a list of commits into the target worktree.
 *
 * @param {string} wtPath - target worktree directory
 * @param {{ sourceBranch: string, targetBranch: string, commits: string[] }} opts - commits are hashes to cherry-pick in order
 */
function buildFastForwardScript(wtPath, { branch }) {
  assertSafeRef(branch);
  const isWin = process.platform === 'win32';
  const scriptExt = isWin ? '.cmd' : '.sh';
  const scriptPath = path.join(os.tmpdir(), `codehive-ff-${Date.now()}${scriptExt}`);
  const ref = `origin/${branch}`;

  if (isWin) {
    const lines = [
      '@echo off',
      `echo Fast-forwarding to ${ref}...`,
      `git merge --ff-only ${shellQuote(ref)}`,
      'if %errorlevel% neq 0 (',
      '  echo.',
      '  echo Fast-forward failed.',
      '  exit /b 1',
      ')',
      'echo.',
      'echo === FAST-FORWARD COMPLETE ===',
    ];
    fs.writeFileSync(scriptPath, lines.join('\r\n'), { encoding: 'utf8' });
  } else {
    const lines = [
      '#!/bin/sh',
      `echo "Fast-forwarding to ${ref}..."`,
      `git merge --ff-only ${shellQuote(ref)}`,
      'STATUS=$?',
      'if [ "$STATUS" -ne 0 ]; then',
      '  echo ""',
      '  echo "Fast-forward failed."',
      '  exit 1',
      'fi',
      'echo ""',
      'echo "=== FAST-FORWARD COMPLETE ==="',
    ];
    fs.writeFileSync(scriptPath, lines.join('\n'), { encoding: 'utf8' });
    fs.chmodSync(scriptPath, 0o755);
  }

  const cmd = isWin ? scriptPath : `sh ${shellQuote(scriptPath)}`;
  return { cmd, cwd: wtPath, scriptPath };
}

function buildCherryPickScript(wtPath, { sourceBranch, targetBranch, commits }) {
  assertSafeRef(sourceBranch);
  assertSafeRef(targetBranch);
  for (const hash of commits) {
    if (!/^[0-9a-f]{7,40}$/.test(hash)) throw new Error(`Invalid commit hash: ${hash}`);
  }

  const isWin = process.platform === 'win32';
  const scriptExt = isWin ? '.cmd' : '.sh';
  const scriptPath = path.join(os.tmpdir(), `codehive-cherrypick-${Date.now()}${scriptExt}`);
  const hashList = commits.map(shellQuote).join(' ');

  if (isWin) {
    const lines = [
      '@echo off',
      `echo Cherry-picking ${commits.length} commit(s) from ${sourceBranch} onto ${targetBranch}...`,
      `git cherry-pick ${hashList}`,
      'if %errorlevel% neq 0 (',
      '  echo.',
      '  echo Cherry-pick failed.',
      '  exit /b 1',
      ')',
      'echo.',
      'echo === CHERRY-PICK COMPLETE ===',
    ];
    fs.writeFileSync(scriptPath, lines.join('\r\n'), { encoding: 'utf8' });
  } else {
    const lines = [
      '#!/bin/sh',
      `echo "Cherry-picking ${commits.length} commit(s) from ${sourceBranch} onto ${targetBranch}..."`,
      `git cherry-pick ${hashList}`,
      'STATUS=$?',
      'if [ "$STATUS" -ne 0 ]; then',
      '  echo ""',
      '  echo "Cherry-pick failed."',
      '  exit 1',
      'fi',
      'echo ""',
      'echo "=== CHERRY-PICK COMPLETE ==="',
    ];
    fs.writeFileSync(scriptPath, lines.join('\n'), { encoding: 'utf8' });
    fs.chmodSync(scriptPath, 0o755);
  }

  const cmd = isWin ? scriptPath : `sh ${shellQuote(scriptPath)}`;
  return { cmd, cwd: wtPath, scriptPath };
}

/**
 * Shared scaffold: `git fetch origin/<branch>` then run one git command.
 * @param {string} wtPath
 * @param {string} branch
 * @param {{ prefix: string, command: string, actionLabel: string, successLabel: string, failLabel: string, failCommands?: string[] }} opts
 */
function _buildFetchThenScript(wtPath, branch, { prefix, command, actionLabel, successLabel, failLabel, failCommands = [] }) {
  assertSafeRef(branch);
  const isWin = process.platform === 'win32';
  const scriptExt = isWin ? '.cmd' : '.sh';
  const scriptPath = path.join(os.tmpdir(), `codehive-${prefix}-${Date.now()}${scriptExt}`);

  if (isWin) {
    const failExtra = failCommands.map(c => `  ${c}`).join('\r\n');
    const lines = [
      '@echo off',
      'echo Fetching from origin...',
      `git fetch origin ${shellQuote(branch)}`,
      'if %errorlevel% neq 0 exit /b %errorlevel%',
      'echo.',
      `echo ${actionLabel}...`,
      command,
      'if %errorlevel% neq 0 (',
      '  echo.',
      `  echo ${failLabel}.`,
      ...(failExtra ? [failExtra] : []),
      '  exit /b 1',
      ')',
      'echo.',
      `echo === ${successLabel} ===`,
    ];
    fs.writeFileSync(scriptPath, lines.join('\r\n'), { encoding: 'utf8' });
  } else {
    const failExtra = failCommands.map(c => `  ${c}`).join('\n');
    const lines = [
      '#!/bin/sh',
      'echo "Fetching from origin..."',
      `git fetch origin ${shellQuote(branch)}`,
      'echo ""',
      `echo "${actionLabel}..."`,
      command,
      'STATUS=$?',
      'if [ "$STATUS" -ne 0 ]; then',
      '  echo ""',
      `  echo "${failLabel}."`,
      ...(failExtra ? [failExtra] : []),
      '  exit 1',
      'fi',
      'echo ""',
      `echo "=== ${successLabel} ==="`,
    ];
    fs.writeFileSync(scriptPath, lines.join('\n'), { encoding: 'utf8' });
    fs.chmodSync(scriptPath, 0o755);
  }

  const cmd = isWin ? scriptPath : `sh ${shellQuote(scriptPath)}`;
  return { cmd, cwd: wtPath, scriptPath };
}

function buildPullScript(wtPath, branch) {
  return _buildFetchThenScript(wtPath, branch, {
    prefix: 'pull',
    command: `git pull origin ${shellQuote(branch)}`,
    actionLabel: `Pulling origin/${branch}`,
    successLabel: 'PULL COMPLETE',
    failLabel: 'Pull failed',
  });
}

function buildMergeRemoteScript(wtPath, branch) {
  const ref = `origin/${branch}`;
  return _buildFetchThenScript(wtPath, branch, {
    prefix: 'merge-remote',
    command: `git merge ${shellQuote(ref)}`,
    actionLabel: `Merging ${ref}`,
    successLabel: 'MERGE COMPLETE',
    failLabel: 'Merge failed',
  });
}

function buildRebaseRemoteScript(wtPath, branch) {
  const ref = `origin/${branch}`;
  return _buildFetchThenScript(wtPath, branch, {
    prefix: 'rebase-remote',
    command: `git rebase ${shellQuote(ref)}`,
    actionLabel: `Rebasing onto ${ref}`,
    successLabel: 'REBASE COMPLETE',
    failLabel: 'Rebase failed. Aborting...',
    failCommands: ['git rebase --abort'],
  });
}

function buildResetToTheirsScript(wtPath, branch) {
  const ref = `origin/${branch}`;
  return _buildFetchThenScript(wtPath, branch, {
    prefix: 'reset-theirs',
    command: `git reset --hard ${shellQuote(ref)}`,
    actionLabel: `Resetting to ${ref}`,
    successLabel: 'RESET COMPLETE',
    failLabel: 'Reset failed',
  });
}

module.exports = { buildWorktreeCmd, buildCloneCmd, buildDeleteScript, buildWorktreeRemoveScript, buildWorktreeSwitchScript, buildCommitPushScript, buildPrCreateScript, buildRebaseScript, buildForcePushScript, buildRegularPushScript, buildFastForwardScript, buildCherryPickScript, buildPullScript, buildMergeRemoteScript, buildRebaseRemoteScript, buildResetToTheirsScript, shellQuote, assertSafeRef };
