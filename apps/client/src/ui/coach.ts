// First-time tips: each one appears once per browser, the first time its situation comes up.
import { t, type PlainKey } from '../i18n/index.js';
import { el, h } from './dom.js';

const KEY = 'bc.coach';

export const TIPS = {
  firstMatch: 'coach.firstMatch',
  byzantine: 'coach.byzantine',
  withdrawals: 'coach.withdrawals',
  council: 'coach.council',
  partition: 'coach.partition',
  beach: 'coach.beach',
} as const satisfies Readonly<Record<string, PlainKey>>;
export type Tip = keyof typeof TIPS;

function seen(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw === null ? [] : (JSON.parse(raw) as unknown);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 20) : []);
  } catch {
    return new Set();
  }
}

export class Coach {
  readonly #root = el('coach', HTMLDivElement);
  readonly #text = el('coach-text', HTMLParagraphElement);
  readonly #seen = seen();

  constructor() {
    el('coach-ok', HTMLButtonElement).addEventListener('click', () => {
      this.#root.hidden = true;
    });
  }

  tip(id: Tip): void {
    // End-to-end builds click through scripted steps; a tip card would only get in the way.
    if (this.#seen.has(id) || import.meta.env.VITE_E2E === '1') return;
    this.#seen.add(id);
    try {
      localStorage.setItem(KEY, JSON.stringify([...this.#seen]));
    } catch {
      // Storage blocked: tips may repeat next visit.
    }
    this.#text.replaceChildren(h('b', '', t('coach.tip')), ` ${t(TIPS[id])}`);
    this.#root.hidden = false;
  }

  hide(): void {
    this.#root.hidden = true;
  }
}
