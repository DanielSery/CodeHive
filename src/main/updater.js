const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { spawn } = require('child_process');
const os = require('os');

const GITHUB_OWNER = 'DanielSery';
const GITHUB_REPO = 'CodeHive';

function compareVersions(current, latest) {
  const parse = v => v.replace(/^v/, '').split('.').map(n => parseInt(n) || 0);
  const a = parse(current), b = parse(latest);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((b[i] || 0) > (a[i] || 0)) return true;
    if ((b[i] || 0) < (a[i] || 0)) return false;
  }
  return false;
}

async function checkForUpdates() {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'CodeHive-Updater' },
    signal: AbortSignal.timeout(10000)
  });
  if (response.status === 404) return { hasUpdate: false };
  if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);

  const release = await response.json();
  const currentVersion = app.getVersion();
  const latestVersion = release.tag_name;
  const hasUpdate = compareVersions(currentVersion, latestVersion);

  return {
    hasUpdate,
    currentVersion,
    latestVersion,
    releaseName: release.name,
    releaseUrl: release.html_url,
    releaseNotes: release.body || '',
    assets: (release.assets || []).map(a => ({
      name: a.name,
      downloadUrl: a.browser_download_url,
      size: a.size
    }))
  };
}

async function downloadUpdate(downloadUrl, onProgress) {
  const destPath = path.join(os.tmpdir(), 'codehive-update.zip');
  if (fs.existsSync(destPath)) fs.unlinkSync(destPath);

  const response = await fetch(downloadUrl, {
    headers: { 'User-Agent': 'CodeHive-Updater' }
  });
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);

  const total = parseInt(response.headers.get('content-length') || '0');
  let downloaded = 0;

  const writer = fs.createWriteStream(destPath);
  const reader = response.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(Buffer.from(value));
      downloaded += value.length;
      if (total > 0 && onProgress) onProgress(Math.round(downloaded / total * 100));
    }
  } finally {
    reader.releaseLock();
  }

  await new Promise((resolve, reject) => {
    writer.end(err => err ? reject(err) : resolve());
  });

  return destPath;
}

function installUpdate(zipPath) {
  const exePath = app.getPath('exe');
  const appDir = path.dirname(exePath);
  const extractDir = path.join(os.tmpdir(), 'codehive-update-extract');

  const esc = p => p.replace(/'/g, "''");

  const script = [
    'Start-Sleep -Seconds 2',
    `$zipPath = '${esc(zipPath)}'`,
    `$extractDir = '${esc(extractDir)}'`,
    `$appDir = '${esc(appDir)}'`,
    `$exePath = '${esc(exePath)}'`,
    'if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }',
    'Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force',
    '$items = Get-ChildItem $extractDir',
    'if ($items.Count -eq 1 -and $items[0].PSIsContainer) { $srcDir = $items[0].FullName } else { $srcDir = $extractDir }',
    'Copy-Item -Path "$srcDir\\*" -Destination $appDir -Recurse -Force',
    'Write-Host "Update complete. Launching MUCHA..."',
    'Start-Process -FilePath $exePath',
  ].join("\r\n");

  const scriptPath = path.join(os.tmpdir(), 'codehive-update.ps1');
  fs.writeFileSync(scriptPath, script, 'utf8');

  // Use cmd /c start to break out of Electron's Windows Job Object so the
  // PowerShell process survives app.quit() on all Windows configurations.
  spawn('cmd.exe', [
    '/c', 'start', '', '/normal',
    'powershell.exe',
    '-ExecutionPolicy', 'Bypass',
    '-NonInteractive',
    '-WindowStyle', 'Normal',
    '-File', scriptPath
  ], { detached: true, stdio: 'ignore' }).unref();

  app.quit();
}

module.exports = { checkForUpdates, downloadUpdate, installUpdate };
