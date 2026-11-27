// The emote picker in the corner of the city and the beach: one smiley button that opens the six emotes, each named
// and numbered, so the corner stays quiet until someone wants to wave.
import { EMOTES, EMOTE_GLYPHS, type Emote } from '@byzantine-council/shared/hub';
import { onLocaleChange, t } from '../i18n/index.js';
import { h } from './dom.js';

const NAMES: Readonly<Record<Emote, 'emote.wave' | 'emote.cheer' | 'emote.dance' | 'emote.heart' | 'emote.laugh' | 'emote.shaka'>> = {
  wave: 'emote.wave',
  cheer: 'emote.cheer',
  dance: 'emote.dance',
  heart: 'emote.heart',
  laugh: 'emote.laugh',
  shaka: 'emote.shaka',
};

/** Fills `root` with the emote picker; `onEmote` is called with the emote picked. */
export function mountEmoteBar(root: HTMLElement, onEmote: (emote: Emote) => void): void {
  const toggle = h('button', 'emote-toggle', '😊');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  const tray = h('div', 'emote-tray');
  tray.hidden = true;
  const buttons = EMOTES.map((emote, i) => {
    const b = h('button', 'emote-pick');
    b.type = 'button';
    b.append(h('span', 'emote-glyph', EMOTE_GLYPHS[emote]), h('kbd', '', String(i + 1)));
    b.addEventListener('click', () => {
      onEmote(emote);
      setOpen(false);
    });
    return b;
  });
  tray.append(...buttons);
  const setOpen = (open: boolean): void => {
    tray.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => {
    setOpen(tray.hidden);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
  const label = (): void => {
    toggle.setAttribute('aria-label', t('common.emotes'));
    toggle.title = t('common.emotes');
    buttons.forEach((b, i) => {
      const emote = EMOTES[i];
      if (emote === undefined) return;
      const name = t(NAMES[emote]);
      b.setAttribute('aria-label', `${name} (${String(i + 1)})`);
      b.title = `${name} · ${String(i + 1)}`;
    });
  };
  onLocaleChange(label);
  label();
  root.replaceChildren(tray, toggle);
}
