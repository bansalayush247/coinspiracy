// Ledger Archive: reject the note with the wrong seal and the one already on the spent list.
import type { LedgerChallenge } from '@byzantine-council/shared';
import { h } from '../dom.js';
import { sealRow } from './glyphs.js';
import { button, formatSats, setPressed, type MinigameHost } from './types.js';

export function ledgerGame(root: HTMLElement, c: LedgerChallenge, host: MinigameHost): void {
  const prompt = h('p', 'prompt', 'Two notes are bad: one carries a seal that isn’t the federation’s, and one is already on the spent list. Reject both.');

  const reference = h('div', 'ledger-ref');
  const sealBox = h('div', 'ref-box');
  sealBox.append(h('span', 'label', 'Federation seal'), sealRow(c.seal));
  const spentBox = h('div', 'ref-box');
  const spent = h('ul', 'spent');
  spent.append(...c.spent.map((serial) => h('li', 'serial', serial)));
  spentBox.append(h('span', 'label', 'Spent list'), spent);
  reference.append(sealBox, spentBox);

  const picked = new Set<number>();
  const action = button('Reject 2 notes', 'cta');
  action.disabled = true;
  const grid = h('div', 'note-grid');
  const cards = c.notes.map((note, i) => {
    const card = button('', 'note-card');
    card.dataset['index'] = String(i);
    card.append(h('b', '', formatSats(note.amount)), h('span', 'serial', note.serial), sealRow(note.seal));
    card.setAttribute('aria-label', `Note ${note.serial}, ${formatSats(note.amount)}`);
    setPressed(card, false);
    card.addEventListener('click', () => {
      if (picked.has(i)) picked.delete(i);
      else if (picked.size < 2) picked.add(i);
      setPressed(card, picked.has(i));
      action.disabled = picked.size !== 2;
    });
    return card;
  });
  grid.append(...cards);

  action.addEventListener('click', () => {
    if (picked.size !== 2) return;
    action.disabled = true;
    const [a = 0, b = 0] = [...picked];
    host.submit({ kind: 'ledger', reject: [a, b] });
  });
  root.append(prompt, reference, grid, action);
}
