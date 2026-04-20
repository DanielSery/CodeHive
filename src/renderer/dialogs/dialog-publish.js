const publishDialogOverlay = document.getElementById('publish-dialog-overlay');
const publishVersionInput = document.getElementById('publish-version-input');
const publishReleaseNotesInput = document.getElementById('publish-release-notes');
let publishDialogResolve = null;

export async function showPublishDialog() {
  const currentVersion = await updaterAPI.getVersion();
  const parts = currentVersion.split('.');
  parts[2] = String(parseInt(parts[2]) + 1);
  publishVersionInput.value = parts.join('.');
  publishReleaseNotesInput.value = '';

  return new Promise((resolve) => {
    publishDialogResolve = resolve;
    publishDialogOverlay.classList.add('visible');
    publishVersionInput.focus();
    publishVersionInput.select();
  });
}

function confirm() {
  const version = publishVersionInput.value.trim();
  if (!version) { return; }
  const releaseNotes = publishReleaseNotesInput.value.trim();
  publishDialogOverlay.classList.remove('visible');
  if (publishDialogResolve) { publishDialogResolve({ version, releaseNotes }); publishDialogResolve = null; }
}

function cancel() {
  publishDialogOverlay.classList.remove('visible');
  if (publishDialogResolve) { publishDialogResolve(null); publishDialogResolve = null; }
}

document.getElementById('publish-confirm-btn').addEventListener('click', confirm);
document.getElementById('publish-cancel-btn').addEventListener('click', cancel);
publishVersionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { confirm(); }
  if (e.key === 'Escape') { cancel(); }
});
publishReleaseNotesInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { cancel(); }
});
