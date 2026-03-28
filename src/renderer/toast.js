/**
 * Centralized toast notification system.
 *
 * Usage:
 *   import { toast } from './toast.js';
 *   toast.success('Worktree created');
 *   toast.error('Push failed: remote rejected');
 *   toast.info('Fetching branches...');
 */

const container = document.getElementById('toast-container');

const ICONS = {
  success: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  error: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  info: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 5v0.01"/><path d="M8 7.5v3.5"/></svg>',
};

const DURATIONS = { success: 3000, error: 6000, info: 3000 };

function show(type, message, duration) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${ICONS[type]}</span><span class="toast-message">${escapeHtml(message)}</span><button class="toast-close">&times;</button>`;

  el.querySelector('.toast-close').addEventListener('click', () => dismiss(el));

  container.appendChild(el);
  // Trigger reflow for CSS transition
  el.offsetHeight;
  el.classList.add('toast-visible');

  const timeout = duration || DURATIONS[type];
  const timer = setTimeout(() => dismiss(el), timeout);
  el._timer = timer;

  return el;
}

function dismiss(el) {
  if (el._dismissed) return;
  el._dismissed = true;
  clearTimeout(el._timer);
  el.classList.remove('toast-visible');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
  // Fallback removal if transition doesn't fire
  setTimeout(() => { if (el.parentNode) el.remove(); }, 400);
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const toast = {
  success: (msg, duration) => show('success', msg, duration),
  error: (msg, duration) => show('error', msg, duration),
  info: (msg, duration) => show('info', msg, duration),
};
