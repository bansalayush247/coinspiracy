// The wardrobe: wear the hats, eyewear and robes you own. They show on your guardian in every match.
import { DEFAULT_OWNED, getItem, type Look } from '@byzantine-council/shared/economy';
import { el, h } from '../ui/dom.js';
import { guardianPortrait } from './portrait.js';
import type { ProfileSummary } from './api.js';

type Slot = 'outfit' | 'hat' | 'shades';
const SLOTS: readonly { slot: Slot; label: string; optional: boolean }[] = [
  { slot: 'hat', label: 'Hats', optional: true },
  { slot: 'shades', label: 'Eyewear', optional: true },
  { slot: 'outfit', label: 'Robes (the trim on your seat colour)', optional: false },
];

export class Wardrobe {
  readonly #root = el('wardrobe', HTMLElement);
  readonly #body = el('wardrobe-body', HTMLDivElement);
  #profile: ProfileSummary | null = null;
  onWear: (look: Look) => void = () => undefined;
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
      this.#body.replaceChildren(h('p', 'hint', 'Your wardrobe opens once your guest profile has loaded.'));
      return;
    }
    const owned = new Set<string>([...p.owned, ...DEFAULT_OWNED]);
    const preview = h('div', 'wardrobe-preview');
    preview.append(guardianPortrait(0, { hat: p.look.hat ?? '', shades: p.look.shades ?? '', outfit: p.look.outfit }));
    const sections = SLOTS.map(({ slot, label, optional }) => {
      const section = h('section', 'wardrobe-slot');
      section.append(h('h3', '', label));
      const row = h('div', 'wardrobe-items');
      const ids = [...owned].filter((id) => id.startsWith(`${slot}:`)).sort();
      const current = p.look[slot];
      if (optional) row.append(this.#chip(null, current === null, slot));
      for (const id of ids) row.append(this.#chip(id, current === id, slot));
      if (ids.length === 0) row.append(h('span', 'hint', 'None yet. Win matches, rank up or visit the shops to earn some.'));
      section.append(row);
      return section;
    });
    this.#body.replaceChildren(preview, ...sections);
  }

  #chip(id: string | null, worn: boolean, slot: Slot): HTMLButtonElement {
    const item = id === null ? undefined : getItem(id);
    const b = h('button', `wardrobe-chip${worn ? ' worn' : ''}`);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(worn));
    const swatch = h('span', 'swatch');
    if (item !== undefined) swatch.style.background = item.hints.swatch;
    else swatch.classList.add('none');
    b.append(swatch, h('span', '', item?.name ?? 'Nothing'));
    b.addEventListener('click', () => {
      const p = this.#profile;
      if (p === null || worn) return;
      this.onWear({ ...p.look, [slot]: id });
    });
    return b;
  }
}
