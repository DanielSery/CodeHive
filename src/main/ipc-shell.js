const { ipcMain, dialog, shell, safeStorage, app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const vscode = require('./vscode-server');

function register(mainWindow, getServerPort) {
  ipcMain.handle('codeserver:openFolder', (event, folderPath) => {
    return vscode.buildFolderUrl(getServerPort(), folderPath);
  });

  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  // Shell
  ipcMain.handle('shell:openInExplorer', (event, folderPath) => {
    return shell.openPath(folderPath);
  });

  ipcMain.handle('shell:openExternal', (event, url) => {
    return shell.openExternal(url);
  });

  ipcMain.handle('shell:openInGitApp', (event, repoPath) => {
    const localAppData = process.env.LOCALAPPDATA || '';

    const forkExe = path.join(localAppData, 'Fork', 'current', 'Fork.exe');
    if (fs.existsSync(forkExe)) {
      spawn(forkExe, [repoPath], { detached: true, stdio: 'ignore' }).unref();
      return { app: 'Fork' };
    }

    const sourcetreeExe = path.join(localAppData, 'SourceTree', 'SourceTree.exe');
    if (fs.existsSync(sourcetreeExe)) {
      spawn(sourcetreeExe, ['-p', repoPath], { detached: true, stdio: 'ignore' }).unref();
      return { app: 'SourceTree' };
    }

    const gitkrakenDir = path.join(localAppData, 'gitkraken');
    if (fs.existsSync(gitkrakenDir)) {
      const versions = fs.readdirSync(gitkrakenDir).filter(d => d.startsWith('app-')).sort().reverse();
      for (const v of versions) {
        const exe = path.join(gitkrakenDir, v, 'gitkraken.exe');
        if (fs.existsSync(exe)) {
          spawn(exe, ['--path', repoPath], { detached: true, stdio: 'ignore' }).unref();
          return { app: 'GitKraken' };
        }
      }
    }

    for (const base of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']]) {
      if (!base) continue;
      const gitBashExe = path.join(base, 'Git', 'git-bash.exe');
      if (fs.existsSync(gitBashExe)) {
        spawn(gitBashExe, [`--cd=${repoPath}`], { detached: true, stdio: 'ignore' }).unref();
        return { app: 'Git Bash' };
      }
    }

    return { app: null };
  });

  // Window controls
  ipcMain.on('window:minimize', () => mainWindow.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow.close());

  // Updater
  const updater = require('./updater');

  ipcMain.handle('updater:getVersion', () => app.getVersion());
  ipcMain.handle('updater:isPackaged', () => app.isPackaged);
  ipcMain.handle('updater:publish', () => {
    const scriptPath = path.join(__dirname, '..', '..', 'publish.ps1');
    spawn('cmd.exe', [
      '/c', 'start', '', '/normal',
      'powershell.exe',
      '-ExecutionPolicy', 'Bypass',
      '-NoExit',
      '-File', scriptPath
    ], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
  });
  ipcMain.handle('updater:check', () => updater.checkForUpdates());
  ipcMain.handle('updater:download', async (event, downloadUrl) => {
    return updater.downloadUpdate(downloadUrl, (pct) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:progress', pct);
      }
    });
  });
  ipcMain.handle('updater:install', (event, zipPath) => {
    updater.installUpdate(zipPath);
  });

  // Credential storage (OS keychain via safeStorage)
  const credentialPath = path.join(app.getPath('userData'), 'credentials.enc');

  ipcMain.handle('credentials:get', (event, key) => {
    try {
      if (!fs.existsSync(credentialPath)) return null;
      const raw = fs.readFileSync(credentialPath);
      const decrypted = safeStorage.decryptString(raw);
      const store = JSON.parse(decrypted);
      return store[key] || null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('credentials:set', (event, key, value) => {
    try {
      let store = {};
      if (fs.existsSync(credentialPath)) {
        try {
          const raw = fs.readFileSync(credentialPath);
          store = JSON.parse(safeStorage.decryptString(raw));
        } catch {}
      }
      store[key] = value;
      const encrypted = safeStorage.encryptString(JSON.stringify(store));
      fs.writeFileSync(credentialPath, encrypted);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('credentials:delete', (event, key) => {
    try {
      if (!fs.existsSync(credentialPath)) return true;
      const raw = fs.readFileSync(credentialPath);
      const store = JSON.parse(safeStorage.decryptString(raw));
      delete store[key];
      const encrypted = safeStorage.encryptString(JSON.stringify(store));
      fs.writeFileSync(credentialPath, encrypted);
      return true;
    } catch {
      return false;
    }
  });
}

module.exports = { register };
