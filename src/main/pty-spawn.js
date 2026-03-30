const { spawn } = require('child_process');

function spawnProc(cmd, cwd, extraEnv) {
  const buffer = [`\x1b[90m$ ${cmd}\x1b[0m\r\n`];
  let exitInfo = null;
  let ready = false;
  const listeners = { data: [], exit: [] };

  const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
  const proc = spawn(cmd, [], {
    cwd,
    env,
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  proc.stdout.on('data', (data) => {
    const str = data.toString().replace(/\r?\n/g, '\r\n');

    if (ready) {
      for (const cb of listeners.data) cb(str);
    } else {
      buffer.push(str);
    }
  });

  proc.stderr.on('data', (data) => {
    const str = data.toString().replace(/\r?\n/g, '\r\n');

    if (ready) {
      for (const cb of listeners.data) cb(str);
    } else {
      buffer.push(str);
    }
  });

  proc.on('close', (code) => {

    const info = { exitCode: code || 0 };
    if (ready) {
      for (const cb of listeners.exit) cb(info);
    } else {
      exitInfo = info;
    }
  });

  proc.on('error', (err) => {

    buffer.push(`Error: ${err.message}\r\n`);
    exitInfo = { exitCode: 1 };
  });

  return {
    onData: (cb) => listeners.data.push(cb),
    onExit: (cb) => listeners.exit.push(cb),
    flush: () => {

      ready = true;
      for (const str of buffer) {
        for (const cb of listeners.data) cb(str);
      }
      buffer.length = 0;
      if (exitInfo) {
        for (const cb of listeners.exit) cb(exitInfo);
      }
    },
    resize: () => {},
    kill: () => proc.kill()
  };
}

module.exports = { spawnProc };
