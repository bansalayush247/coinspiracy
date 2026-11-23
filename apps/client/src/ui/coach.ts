// First-time tips: each one appears once per browser, the first time its situation comes up.
import { el, h } from './dom.js';

const KEY = 'bc.coach';

export const TIPS = {
  firstMatch: 'Your tasks are on the left. Walk to a glowing marker and press E (or tap Use) to start one. Every task you finish fills the Consensus bar.',
  byzantine: 'You are Byzantine. Blend in: fake your tasks, forge a withdrawal in the Signing Hall, and use your sabotage when it is ready. Never get caught signing your own forgery too eagerly.',
  withdrawals: 'Withdrawals need enough signatures to pass. Sign the real ones and refuse the forged ones. Not sure? An audit at the Ledger Archive shows you the truth, privately.',
  council: 'A council! Share what you saw with quick chat, then vote. If you are not sure, skip: every honest guardian rotated out by mistake brings the Byzantines closer to a third.',
  partition: 'The network is split, so no signatures get through. Stand on one of the two glowing relays; another guardian must hold the other at the same time.',
  beach: 'Welcome to Beach Town! Walk to a stall counter: press E to browse, or take a delivery job to earn play sats. Keys 1 to 6 send a friendly emote.',
} as const;
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
    this.#text.replaceChildren(h('b', '', 'Tip'), ` ${TIPS[id]}`);
    this.#root.hidden = false;
  }

  hide(): void {
    this.#root.hidden = true;
  }
}
