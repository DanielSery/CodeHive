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
  'ms-dotnettools.csharp'
];

function getServerDataDir() {
  return path.join(app.getPath('userData'), 'vscode-data');
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

function findPort(startPort, maxAttempts = 20) {
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
      server.on('error', () => {
        tryPort(port + 1);
      });
    }
    tryPort(startPort);
  });
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
    if (sendStatus) sendStatus('Extensions installed');
  });
  proc.on('error', (err) => {
    console.warn('[extensions] Install failed:', err.message);
  });
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const cmd = findCodeCmd();
    const args = [
      'serve-web',
      '--port', port.toString(),
      '--host', '127.0.0.1',
      '--without-connection-token',
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

    let started = false;

    const onData = (data) => {
      const output = data.toString();
      console.log('[vscode-server]', output);
      if (!started && (output.includes('Web UI available') || output.includes(`http://127.0.0.1:${port}`) || output.includes('available at'))) {
        started = true;
        setTimeout(() => resolve({ port, proc }), 1000);
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    proc.on('error', (err) => {
      console.error('Failed to start VS Code server:', err);
      reject(err);
    });

    proc.on('exit', (code) => {
      console.log('VS Code server exited with code:', code);
    });

    setTimeout(() => {
      if (!started) {
        started = true;
        resolve({ port, proc });
      }
    }, 30000);
  });
}

function buildFolderUrl(port, folderPath) {
  let normalized = folderPath.replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(normalized)) normalized = '/' + normalized;
  const folderUri = `vscode-remote://localhost:${port}${normalized}`;
  return `http://127.0.0.1:${port}/?folder=${encodeURIComponent(folderUri)}`;
}

module.exports = { findPort, installExtensions, seedDefaultSettings, startServer, buildFolderUrl };
