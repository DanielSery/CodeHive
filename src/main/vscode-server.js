const path = require('path');
const os = require('os');
const fs = require('fs');
const net = require('net');
const { spawn, execSync } = require('child_process');
const { app } = require('electron');

const REQUIRED_EXTENSIONS = [
  'Catppuccin.catppuccin-vsc',
  'Catppuccin.catppuccin-vsc-icons',
  'anthropic.claude-code',
  'ms-dotnettools.csdevkit'
];

function getServerDataDir() {
  return path.join(app.getPath('userData'), 'vscode-data');
}

function getOrCreateConnectionToken() {
  const tokenFile = path.join(getServerDataDir(), 'connection-token');
  if (fs.existsSync(tokenFile)) {
    return fs.readFileSync(tokenFile, 'utf8').trim();
  }
  const { randomUUID } = require('crypto');
  const token = randomUUID();
  fs.mkdirSync(getServerDataDir(), { recursive: true });
  fs.writeFileSync(tokenFile, token, 'utf8');
  return token;
}

function getBundledDataDir() {
  // In packaged app: resources/app.asar/vscode-data
  // In dev: ./vscode-data
  return path.join(__dirname, '..', '..', 'vscode-data');
}

function seedDefaultSettings() {
  const serverDataDir = getServerDataDir();
  const machineSettingsDir = path.join(serverDataDir, 'data', 'Machine');
  const machineSettingsFile = path.join(machineSettingsDir, 'settings.json');

  // Only seed if settings don't exist yet
  if (fs.existsSync(machineSettingsFile)) return;

  const bundledSettings = path.join(getBundledDataDir(), 'data', 'Machine', 'settings.json');
  if (!fs.existsSync(bundledSettings)) return;

  fs.mkdirSync(machineSettingsDir, { recursive: true });
  fs.copyFileSync(bundledSettings, machineSettingsFile);
  console.log('Seeded default VS Code Machine settings');
}

function isVSCodeServerRunning(port) {
  return new Promise((resolve) => {
    const http = require('http');
    const req = http.get(`http://127.0.0.1:${port}/`, { timeout: 2000 }, (res) => {
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function findFreePort(startPort, maxAttempts = 20) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    function tryPort(port) {
      if (attempt >= maxAttempts) {
        reject(new Error(`No available port found in range ${startPort}-${startPort + maxAttempts - 1}`));
        return;
      }
      attempt++;
      const server = net.createServer();
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(port));
      });
      server.on('error', () => tryPort(port + 1));
    }
    tryPort(startPort);
  });
}

// Tries to use the preferred port. If it's busy and already running a VS Code
// server, returns { port, alreadyRunning: true } so the caller can skip startServer.
// If it's busy with something else, falls back to a free port.
async function resolvePort(preferredPort) {
  console.log(`[resolvePort] Checking preferred port ${preferredPort}...`);
  const free = await new Promise((resolve) => {
    const server = net.createServer();
    server.listen(preferredPort, '127.0.0.1', () => { server.close(() => resolve(true)); });
    server.on('error', () => resolve(false));
  });

  if (free) {
    console.log(`[resolvePort] Port ${preferredPort} is free`);
    return { port: preferredPort, alreadyRunning: false };
  }

  console.log(`[resolvePort] Port ${preferredPort} is busy, checking if VS Code server...`);
  const running = await isVSCodeServerRunning(preferredPort);
  if (running) {
    console.log(`[resolvePort] VS Code server already running on ${preferredPort}`);
    return { port: preferredPort, alreadyRunning: true };
  }

  console.log(`[resolvePort] Port ${preferredPort} busy with something else, finding free port...`);
  const port = await findFreePort(preferredPort + 1);
  console.log(`[resolvePort] Using fallback port ${port}`);
  return { port, alreadyRunning: false };
}

function findCodeCmd() {
  const isWin = os.platform() === 'win32';
  if (isWin) {
    try {
      const result = execSync('where code.cmd', { encoding: 'utf8', shell: true }).split('\n')[0].trim();
      if (result) return result;
    } catch {}
  }
  return isWin ? 'code.cmd' : 'code';
}

function isVSCodeInstalled() {
  const isWin = os.platform() === 'win32';
  try {
    execSync(isWin ? 'where code.cmd' : 'which code', { encoding: 'utf8', shell: true, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function installExtensions(sendStatus) {
  const cmd = findCodeCmd();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;
  const extensionsDir = path.join(getServerDataDir(), 'extensions');

  // Run in background — spawn a single shell with all installs chained
  const cmds = REQUIRED_EXTENSIONS.map(ext =>
    `"${cmd}" --install-extension ${ext} --extensions-dir "${extensionsDir}"`
  ).join(' && ');

  const proc = spawn(cmds, [], {
    cwd: path.dirname(cmd),
    env,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  proc.stdout.on('data', (data) => {
    const msg = data.toString().trim();
    console.log('[extensions]', msg);
    // Show which extension is being installed
    const match = msg.match(/Installing extensions?:\s*(.+)/i);
    if (match && sendStatus) sendStatus(`Installing extension: ${match[1]}`);
  });
  proc.stderr.on('data', (data) => {
    console.warn('[extensions]', data.toString().trim());
  });
  proc.on('close', (code) => {
    console.log(`[extensions] Install finished with exit code ${code}`);
  });
  proc.on('error', (err) => {
    console.warn('[extensions] Install failed:', err.message);
  });
}

function waitForServer(port, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const start = Date.now();
    let done = false;
    function poll() {
      if (done) return;
      if (Date.now() - start > timeoutMs) {
        done = true;
        return reject(new Error(`VS Code server did not respond within ${timeoutMs}ms`));
      }
      const req = http.get(`http://127.0.0.1:${port}/`, { timeout: 2000 }, (res) => {
        res.resume(); // drain the response body so the socket closes cleanly
        if (done) return;
        if (res.statusCode < 500) {
          done = true;
          resolve();
        } else {
          setTimeout(poll, 500);
        }
      });
      req.on('error', () => { if (!done) setTimeout(poll, 500); });
      req.on('timeout', () => { req.destroy(); });
    }
    poll();
  });
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const cmd = findCodeCmd();
    getOrCreateConnectionToken(); // ensure token file exists before server starts
    const args = [
      'serve-web',
      '--port', port.toString(),
      '--host', '127.0.0.1',
      '--connection-token-file', path.join(getServerDataDir(), 'connection-token'),
      '--accept-server-license-terms',
      '--server-data-dir', getServerDataDir()
    ];

    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_NO_ASAR;

    const proc = spawn(`"${cmd}"`, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    });

    console.log(`[startServer] Spawned: "${cmd}" ${args.join(' ')}`);

    proc.stdout.on('data', (data) => console.log('[vscode-server stdout]', data.toString().trimEnd()));
    proc.stderr.on('data', (data) => console.log('[vscode-server stderr]', data.toString().trimEnd()));

    proc.on('error', (err) => {
      console.error('[startServer] Process error:', err);
      reject(err);
    });

    proc.on('exit', (code, signal) => {
      console.log(`[startServer] Process exited: code=${code}, signal=${signal}`);
    });

    console.log(`[startServer] Waiting for server on port ${port}...`);
    waitForServer(port)
      .then(() => {
        console.log(`[startServer] Server responded on port ${port}`);
        resolve({ port, proc });
      })
      .catch((err) => {
        console.warn(`[startServer] waitForServer failed: ${err.message}, resolving anyway`);
        resolve({ port, proc });
      });
  });
}

function buildFolderUrl(port, folderPath) {
  let normalized = folderPath.replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(normalized)) normalized = '/' + normalized;
  const folderUri = `vscode-remote://localhost:${port}${normalized}`;
  const token = getOrCreateConnectionToken();
  return `http://127.0.0.1:${port}/?tkn=${encodeURIComponent(token)}&folder=${encodeURIComponent(folderUri)}`;
}

// Kill all processes listening on a port (needed to clear orphan servers on Windows).
function killServerOnPort(port) {
  if (process.platform !== 'win32') return Promise.resolve();
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec('netstat -ano', (err, stdout) => {
      if (err || !stdout) { resolve(); return; }
      const pids = new Set();
      for (const line of stdout.split('\n')) {
        if (line.includes(`:${port}`) && line.toUpperCase().includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
        }
      }
      if (pids.size === 0) { resolve(); return; }
      let done = 0;
      for (const pid of pids) {
        exec(`taskkill /F /T /PID ${pid}`, () => {
          if (++done === pids.size) setTimeout(resolve, 300); // allow port to be released
        });
      }
    });
  });
}

// Kill a spawned server process and its entire child tree (shell: true spawns cmd.exe
// as the direct child; only killing the tree ensures VS Code itself is terminated).
function killServer(proc) {
  if (!proc) return;
  if (process.platform === 'win32') {
    const { exec } = require('child_process');
    exec(`taskkill /F /T /PID ${proc.pid}`, () => {});
  } else {
    proc.kill();
  }
}

module.exports = { resolvePort, installExtensions, seedDefaultSettings, startServer, buildFolderUrl, killServer, killServerOnPort, isVSCodeInstalled };
