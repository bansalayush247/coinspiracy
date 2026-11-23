// Watchtower: pick the median of the guardians' block-height reports.
import type { WatchtowerChallenge } from '@byzantine-council/shared';
import { h } from '../dom.js';
import { button, setPressed, type MinigameHost } from './types.js';

export function watchtowerGame(root: HTMLElement, c: WatchtowerChallenge, host: MinigameHost): void {
  const prompt = h(
    'p',
    'prompt',
    'Seven guardians report the block height they see. Two of them are faulty. Pick the median: the middle value once they are in order.',
  );
  const list = h('div', 'reports');
  const action = button('Confirm height', 'cta');
  action.disabled = true;
  let picked: number | null = null;
  const cards = c.reports.map((height, i) => {
    const card = button('', 'report');
    card.dataset['height'] = String(height);
    card.append(h('span', 'label', `Guardian ${String(i + 1)}`), h('b', '', height.toLocaleString('en-US')));
    setPressed(card, false);
    card.addEventListener('click', () => {
      picked = i;
      cards.forEach((other, j) => {
        setPressed(other, j === i);
      });
      action.disabled = false;
    });
    return card;
  });
  list.append(...cards);
  action.addEventListener('click', () => {
    const height = picked === null ? undefined : c.reports[picked];
    if (height === undefined) return;
    action.disabled = true;
    host.submit({ kind: 'watchtower', height });
  });
  root.append(prompt, list, action);
}
