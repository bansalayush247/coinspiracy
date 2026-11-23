// Deposit Gate: split the amount into power-of-two notes, blind them, collect signatures, unblind.
import { NOTE_DENOMINATIONS, type DepositChallenge } from '@byzantine-council/shared';
import { h } from '../dom.js';
import { holdToConfirm } from './hold.js';
import { button, formatSats, setPressed, stepper, type MinigameHost } from './types.js';

export const HOLD_MS = 1200;
const SCRAMBLE = '▚▞▙▟▛▜';

function scrambled(seed: number): string {
  return Array.from({ length: 4 }, (_, i) => SCRAMBLE[(seed * 7 + i * 3) % SCRAMBLE.length] ?? '▚').join('');
}

export function depositGame(root: HTMLElement, c: DepositChallenge, host: MinigameHost): void {
  const steps = stepper(['Split', 'Blind', 'Sign', 'Unblind']);
  const prompt = h('p', 'prompt');
  const stage = h('div', 'stage');
  const action = button('', 'cta');
  root.append(steps.el, prompt, stage, action);

  // One button walks through the steps, so keyboard focus stays put; each step sets what a click does next.
  let next: (() => void) | null = null;
  action.addEventListener('click', () => {
    next?.();
  });

  const chosen = new Set<number>();
  const total = (): number => [...chosen].reduce((a, b) => a + b, 0);
  let cards: HTMLElement[] = [];

  // Step 1: pick notes that add up exactly.
  const tally = h('p', 'tally');
  tally.setAttribute('aria-live', 'polite');
  const chips = NOTE_DENOMINATIONS.map((value) => {
    const chip = button(String(value), 'note-chip');
    chip.dataset['value'] = String(value);
    chip.setAttribute('aria-label', formatSats(value));
    setPressed(chip, false);
    chip.addEventListener('click', () => {
      if (chosen.has(value)) chosen.delete(value);
      else chosen.add(value);
      setPressed(chip, chosen.has(value));
      renderTally();
    });
    return chip;
  });
  const chipRow = h('div', 'chips');
  chipRow.dataset['amount'] = String(c.amount);
  chipRow.append(...chips);
  const renderTally = (): void => {
    const sum = total();
    tally.textContent = `Picked ${formatSats(sum)} of ${formatSats(c.amount)}`;
    tally.classList.toggle('over', sum > c.amount);
    action.disabled = sum !== c.amount;
  };

  // Step 2: the notes go into envelopes the guardians cannot see through.
  const toBlind = (): void => {
    steps.set(1);
    prompt.textContent = 'Each note is blinded with a secret only you know. The guardians will sign without seeing what they sign.';
    const notes = [...chosen].sort((a, b) => b - a);
    cards = notes.map((value, i) => {
      const card = h('div', 'ecash');
      card.append(h('b', '', formatSats(value)), h('span', 'serial', scrambled(value + i)));
      return card;
    });
    const wallet = h('div', 'wallet');
    wallet.append(...cards);
    stage.replaceChildren(wallet);
    window.setTimeout(() => {
      for (const card of cards) card.classList.add('blinded');
    }, 60);
    action.disabled = false;
    action.textContent = 'Send for signing';
    next = toSign;
  };

  // Step 3: hold to collect the guardians' threshold signature.
  const toSign = (): void => {
    steps.set(2);
    prompt.textContent = 'Press and hold to collect the guardians’ signatures on your blinded notes.';
    action.textContent = 'Hold to sign';
    next = null;
    holdToConfirm(action, {
      durationMs: HOLD_MS,
      onShortPress: () => {
        prompt.textContent = 'Keep holding until the bar fills: the guardians need a moment to sign.';
      },
      onFilled: () => {
        for (const card of cards) card.classList.add('stamped');
        steps.set(3);
        prompt.textContent = 'Signed. Unblind the notes: the signatures now work on your real notes, and no guardian can link them to this deposit.';
        action.textContent = 'Signed';
      },
      onDone: () => {
        action.textContent = 'Unblind';
        next = unblind;
      },
    });
  };

  // Step 4: unblinding keeps the signatures and drops the link to this deposit.
  const unblind = (): void => {
    next = null;
    action.disabled = true;
    for (const card of cards) card.classList.remove('blinded');
    steps.set(4);
    host.submit({ kind: 'deposit', notes: [...chosen] });
  };

  steps.set(0);
  prompt.textContent = `Deposit ${formatSats(c.amount)}. Pick the notes that add up to it exactly: one of each power of two, the way Fedimint splits amounts.`;
  stage.append(chipRow, tally);
  action.textContent = 'Blind these notes';
  renderTally();
  next = toBlind;
}
