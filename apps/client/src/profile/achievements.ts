// Achievement cards that slide in when a seal is earned or a look is unlocked, one after another.
import { audio } from '../audio/engine.js';
import { el, h } from '../ui/dom.js';

const SHOW_MS = 4200;
const GAP_MS = 500;
const MAX_QUEUE = 8;

export class Achievements {
  readonly #root = el('achievements', HTMLDivElement);
  readonly #queue: { title: string; name: string; kind: 'seal' | 'look' | 'rank' }[] = [];
  #busy = false;

  announce(kind: 'seal' | 'look' | 'rank', name: string): void {
    if (this.#queue.length >= MAX_QUEUE) return;
    const title = kind === 'seal' ? 'Seal earned!' : kind === 'look' ? 'New look unlocked!' : 'Rank up!';
    this.#queue.push({ title, name, kind });
    if (!this.#busy) this.#next();
  }

  #next(): void {
    const item = this.#queue.shift();
    if (item === undefined) {
      this.#busy = false;
      return;
    }
    this.#busy = true;
    const card = h('div', `achievement ${item.kind}`);
    card.setAttribute('role', 'status');
    const icon = h('span', 'achievement-icon');
    card.append(icon, h('span', 'achievement-text'));
    const text = card.lastElementChild;
    text?.append(h('b', '', item.title), h('span', '', item.name));
    this.#root.append(card);
    audio.play(item.kind === 'rank' ? 'rankUp' : 'coin');
    window.setTimeout(() => {
      card.classList.add('leaving');
      window.setTimeout(() => {
        card.remove();
        this.#next();
      }, GAP_MS);
    }, SHOW_MS);
  }
}
