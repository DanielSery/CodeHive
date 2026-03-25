const path = require('path');
const os = require('os');
const fs = require('fs');
const net = require('net');
const { spawn, execSync } = require('child_process');

const REQUIRED_EXTENSIONS = [
  'Catppuccin.catppuccin-vsc',
  'Catppuccin.catppuccin-vsc-icons',
  'anthropic.claude-code',
  'ms-dotnettools.csdevkit',
  'ms-dotnettools.csharp'
];

const SERVER_DATA_DIR = path.join(__dirname, '..', '..', 'vscode-data');

function findPort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, '127.0.0.1', () => {
      server.close(() => resolve(startPort));
    });
    server.on('error', () => {
      resolve(findPort(startPort + 1));
    });
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

function installExtensions() {
  const cmd = findCodeCmd();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;
  const extensionsDir = path.join(SERVER_DATA_DIR, 'extensions');

  for (const ext of REQUIRED_EXTENSIONS) {
    try {
      console.log(`Installing extension: ${ext}`);
      execSync(`"${cmd}" --install-extension ${ext} --extensions-dir "${extensionsDir}"`, {
        stdio: 'pipe',
        shell: true,
        timeout: 60000,
        env,
        cwd: path.dirname(cmd)
      });
      console.log(`Extension installed: ${ext}`);
    } catch (err) {
      console.warn(`Extension install failed for ${ext}:`, err.message);
    }
  }
}

function isTrustedFolder(folderPath) {
  const dbPath = path.join(SERVER_DATA_DIR, 'data', 'User', 'globalStorage', 'state.vscdb');
  if (!fs.existsSync(dbPath)) return false;

  try {
    const initSqlJs = require('sql.js');
    // sql.js init is async, but we cache the check with a sync file read + parse
    const data = fs.readFileSync(dbPath);
    // Use a simple regex check on the raw DB bytes for the normalized path
    const normalized = '/' + folderPath.replace(/\\/g, '/');
    return data.toString().includes(normalized);
  } catch {
    return false;
  }
}

async function seedTrustedFolders(trustedPaths) {
  const initSqlJs = require('sql.js');
  const stateDir = path.join(SERVER_DATA_DIR, 'data', 'User', 'globalStorage');
  const dbPath = path.join(stateDir, 'state.vscdb');

  fs.mkdirSync(stateDir, { recursive: true });

  const SQL = await initSqlJs();
  const db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();

  db.run('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');

  // Load existing trust entries to avoid overwriting user-added ones
  let existing = [];
  const rows = db.exec("SELECT value FROM ItemTable WHERE key = 'content.trust.model.key'");
  if (rows.length > 0) {
    try { existing = JSON.parse(rows[0].values[0][0]).uriTrustInfo || []; } catch {}
  }

  const newEntries = trustedPaths.map(p => {
    const normalized = p.replace(/\\/g, '/');
    const lower = normalized.toLowerCase();
    return {
      uri: {
        $mid: 1,
        external: `file:///${encodeURI(lower).replace(/%3A/i, ':')}`,
        path: `/${normalized}`,
        scheme: 'file'
      },
      trusted: true
    };
  });

  // Merge: keep existing entries, add new ones that aren't already present
  const existingPaths = new Set(existing.map(e => e.uri?.path));
  const merged = [...existing, ...newEntries.filter(e => !existingPaths.has(e.uri.path))];

  const value = JSON.stringify({ uriTrustInfo: merged });
  db.run('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)', ['content.trust.model.key', value]);

  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
  console.log(`[vscode-server] Trusted folders seeded: ${trustedPaths.join(', ')}`);
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
      '--server-data-dir', SERVER_DATA_DIR
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

module.exports = { findPort, installExtensions, isTrustedFolder, seedTrustedFolders, startServer, buildFolderUrl };
