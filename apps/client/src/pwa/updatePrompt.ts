import { h } from '../ui/dom.js';
import './pwa.css';

export const PROMPT_ID = 'pwa-update';
export const PROMPT_TEXT = 'A new version of Byzantine Council is ready.';
// The text lands after the live region exists, so screen readers announce it.
const ANNOUNCE_DELAY_MS = 100;

// A non-modal notice: it never takes focus and never reloads by itself.
export function showUpdatePrompt(apply: () => void): void {
  if (document.getElementById(PROMPT_ID) !== null) return;
  const box = h('div', 'pwa-update');
  box.id = PROMPT_ID;
  box.setAttribute('role', 'status');
  const text = h('p', 'pwa-update-text');
  const reload = h('button', 'pwa-update-reload', 'Reload');
  reload.type = 'button';
  const later = h('button', 'pwa-update-later', 'Later');
  later.type = 'button';
  reload.addEventListener('click', () => {
    reload.disabled = true;
    later.disabled = true;
    text.textContent = 'Updating…';
    apply();
  });
  later.addEventListener('click', () => {
    box.remove();
  });
  box.append(text, reload, later);
  document.body.append(box);
  window.setTimeout(() => {
    if (!reload.disabled) text.textContent = PROMPT_TEXT;
  }, ANNOUNCE_DELAY_MS);
}
