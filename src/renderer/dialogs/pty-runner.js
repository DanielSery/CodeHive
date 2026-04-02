import { terminal } from '../terminal-panel.js';
import { toast } from '../toast.js';

/**
 * Wires a PTY API's data and exit events to the terminal panel.
 * Returns the disposeData function for use in catch blocks.
 *
 * @param {object} ptyApi - API object with onData(cb) and onExit(cb) methods
 * @param {object} [options]
 * @param {string} [options.successMsg] - Written to terminal and shown as toast on success
 * @param {string} [options.failMsg] - Written to terminal and shown as toast on failure
 * @param {Function} [options.onSuccess] - Called with the full exit result on success
 * @param {Function} [options.onError] - Called with the full exit result on failure (showCloseButton is always called)
 */
export function runPty(ptyApi, { successMsg, failMsg, onSuccess, onError } = {}) {
  const disposeData = ptyApi.onData((data) => terminal.write(data));
  ptyApi.onExit((result) => {
    disposeData();
    terminal.writeln('');
    if (result.exitCode === 0) {
      if (successMsg) terminal.writeln(`\x1b[32m${successMsg}\x1b[0m`);
      if (successMsg) toast.success(successMsg);
      onSuccess?.(result);
    } else {
      if (failMsg) terminal.writeln(`\x1b[31m${failMsg}\x1b[0m`);
      if (failMsg) toast.error(`${failMsg} — see terminal for details`);
      terminal.showCloseButton();
      onError?.(result);
    }
  });
  return disposeData;
}
