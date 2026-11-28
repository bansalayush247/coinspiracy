// The wardrobe: wear the hats, eyewear, robes, hairstyles and boards you own. A change shows on your guardian at once,
// while it is saved to your profile.
import { DEFAULT_OWNED, getItem, type CosmeticSlot, type Look } from '@byzantine-council/shared/economy';
import { lookWear } from '../game/wear.js';
import { el, h } from '../ui/dom.js';
import { t, type PlainKey } from '../i18n/index.js';
import { guardianPortrait } from './portrait.js';
import type { ProfileSummary } from './api.js';

const SLOTS: readonly { slot: CosmeticSlot; label: PlainKey; optional: boolean }[] = [
  { slot: 'hat', label: 'wardrobe.hats', optional: true },
  { slot: 'shades', label: 'wardrobe.eyewear', optional: true },
  { slot: 'outfit', label: 'wardrobe.robes', optional: false },
  { slot: 'hair', label: 'wardrobe.hair', optional: false },
  { slot: 'dye', label: 'wardrobe.dye', optional: false },
  { slot: 'beard', label: 'wardrobe.beard', optional: true },
  { slot: 'board', label: 'wardrobe.board', optional: true },
];

export class Wardrobe {
  readonly #root = el('wardrobe', HTMLElement);
  readonly #body = el('wardrobe-body', HTMLDivElement);
  #profile: ProfileSummary | null = null;
  // The look just picked, shown while it is being saved.
  #pending: Look | null = null;
  /** Saves a look; resolves false if it was not saved, and the wardrobe goes back to the saved look. */
  onWear: (look: Look) => Promise<boolean> = () => Promise.resolve(false);
  /** The colour seat to show the guardian in. */
  seat = 0;
  onClosed: () => void = () => undefined;

  get isOpen(): boolean {
    return !this.#root.hidden;
  }

  constructor() {
    el('wardrobe-close', HTMLButtonElement).addEventListener('click', () => {
      this.close();
    });
    this.#root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  setProfile(p: ProfileSummary): void {
    this.#profile = p;
    if (!this.#root.hidden) this.#render();
  }

  open(): void {
    this.#root.hidden = false;
    this.#render();
    this.#root.focus();
  }

  close(): void {
    if (this.#root.hidden) return;
    this.#root.hidden = true;
    this.onClosed();
  }

  #render(): void {
    const p = this.#profile;
    if (p === null) {
      this.#body.replaceChildren(h('p', 'hint', t('wardrobe.loading')));
      return;
    }
    const owned = new Set<string>([...p.owned, ...DEFAULT_OWNED]);
    const look = this.#pending ?? p.look;
    const preview = h('div', 'wardrobe-preview');
    preview.append(guardianPortrait(this.seat, lookWear(look)));
    const sections = SLOTS.map(({ slot, label, optional }) => {
      const section = h('section', 'wardrobe-slot');
      section.append(h('h3', '', t(label)));
      const row = h('div', 'wardrobe-items');
      const ids = [...owned].filter((id) => id.startsWith(`${slot}:`)).sort();
      const current = look[slot];
      if (optional) row.append(this.#chip(null, current === null, slot));
      for (const id of ids) row.append(this.#chip(id, current === id, slot));
      if (ids.length === 0) row.append(h('span', 'hint', t('wardrobe.none')));
      section.append(row);
      return section;
    });
    this.#body.replaceChildren(preview, ...sections);
  }

  #chip(id: string | null, worn: boolean, slot: CosmeticSlot): HTMLButtonElement {
    const item = id === null ? undefined : getItem(id);
    const b = h('button', `wardrobe-chip${worn ? ' worn' : ''}`);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(worn));
    const swatch = h('span', 'swatch');
    if (item !== undefined) swatch.style.background = item.hints.swatch;
    else swatch.classList.add('none');
    b.append(swatch, h('span', '', item?.name ?? t('wardrobe.nothing')));
    b.addEventListener('click', () => {
      const p = this.#profile;
      if (p === null || worn) return;
      const next: Look = { ...(this.#pending ?? p.look), [slot]: id };
      this.#pending = next;
      this.#render();
      void this.onWear(next).then(() => {
        if (this.#pending !== next) return;
        this.#pending = null;
        if (!this.#root.hidden) this.#render();
      });
    });
    return b;
  }
}
