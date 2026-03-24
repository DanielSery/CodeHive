const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const net = require('net');

let mainWindow;
let vscodeServerProcess = null;
let vscodeServerPort = 8590;

// Find an available port starting from the given one
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

const REQUIRED_EXTENSIONS = [
  'Catppuccin.catppuccin-vsc',
  'Catppuccin.catppuccin-vsc-icons',
  'anthropic.claude-code'
];

function findCodeCmd() {
  const { execSync } = require('child_process');
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
  const { execSync } = require('child_process');
  const cmd = findCodeCmd();
  const serverDataDir = path.join(__dirname, 'vscode-data');

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;
  const extensionsDir = path.join(serverDataDir, 'extensions');

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

function startVSCodeServer(port) {
  return new Promise((resolve, reject) => {
    const cmd = findCodeCmd();

    const serverDataDir = path.join(__dirname, 'vscode-data');
    const args = [
      'serve-web',
      '--port', port.toString(),
      '--host', '127.0.0.1',
      '--without-connection-token',
      '--accept-server-license-terms',
      '--server-data-dir', serverDataDir
    ];

    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_NO_ASAR;

    vscodeServerProcess = spawn(`"${cmd}"`, args, {
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
        setTimeout(() => resolve(port), 1000);
      }
    };

    vscodeServerProcess.stdout.on('data', onData);
    vscodeServerProcess.stderr.on('data', onData);

    vscodeServerProcess.on('error', (err) => {
      console.error('Failed to start VS Code server:', err);
      reject(err);
    });

    vscodeServerProcess.on('exit', (code) => {
      console.log('VS Code server exited with code:', code);
      vscodeServerProcess = null;
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!started) {
        started = true;
        resolve(port);
      }
    }, 30000);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1e1e2e',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  mainWindow.loadFile('index.html');

  // F5 to reload, F12 for dev tools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F5') {
      mainWindow.reload();
      event.preventDefault();
    }
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

// VS Code server IPC
ipcMain.handle('codeserver:getPort', () => vscodeServerPort);

ipcMain.handle('codeserver:openFolder', (event, folderPath) => {
  return `http://127.0.0.1:${vscodeServerPort}/?folder=${encodeURIComponent(folderPath)}`;
});

// Window controls
ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow.close());

// App lifecycle
app.whenReady().then(async () => {
  console.log('Installing VS Code extensions...');
  installExtensions();
  console.log('Starting VS Code server...');
  try {
    const port = await findPort(vscodeServerPort);
    vscodeServerPort = port;
    await startVSCodeServer(port);
    console.log(`VS Code server ready on port ${port}`);
  } catch (err) {
    console.error('VS Code server failed to start:', err);
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (vscodeServerProcess) {
    vscodeServerProcess.kill();
    vscodeServerProcess = null;
  }
  app.quit();
});
