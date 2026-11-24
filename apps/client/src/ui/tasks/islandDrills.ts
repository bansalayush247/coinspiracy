// Academy drills for Signing Isle, Council Isle and Watchtower Peaks. Each shows the federation as a row
// of guardians and asks one question; the server checks the answer.
import { COUNCIL_NAMES, type CouncilChallenge, type DrillAnswer, type PartitionChallenge, type QuorumChallenge, type ThresholdChallenge } from '@byzantine-council/shared';
import { cssColor, seatColors } from '../../game/palette.js';
import { h } from '../dom.js';
import { button, setPressed } from './types.js';

export interface DrillHost {
  submit(answer: DrillAnswer): void;
}

// A row of guardian dots, coloured by seat; `mark` dims or tags some of them.
function federation(count: number, mark: (i: number) => string = () => ''): HTMLElement {
  const row = h('div', 'drill-guardians');
  row.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i++) {
    const dot = h('span', ['g', mark(i)].filter(Boolean).join(' '));
    dot.style.background = cssColor(seatColors(i % 9).lit);
    row.append(dot);
  }
  return row;
}

// One choice among numbered or labelled buttons, then a confirm button.
function choose(root: HTMLElement, prompt: HTMLElement[], options: readonly { label: string; value: number }[], confirm: string, submit: (value: number) => void, wide = false): void {
  const list = h('div', wide ? 'reports drill-options wide' : 'reports drill-options');
  const action = button(confirm, 'cta');
  action.disabled = true;
  let picked: number | null = null;
  const cards = options.map((o) => {
    const card = button('', 'report');
    card.append(h('b', '', o.label));
    setPressed(card, false);
    card.addEventListener('click', () => {
      picked = o.value;
      for (const other of cards) setPressed(other, other === card);
      action.disabled = false;
    });
    return card;
  });
  list.append(...cards);
  action.addEventListener('click', () => {
    if (picked === null) return;
    action.disabled = true;
    submit(picked);
  });
  root.append(...prompt, list, action);
}

function range(from: number, to: number): { label: string; value: number }[] {
  return Array.from({ length: to - from + 1 }, (_, i) => ({ label: String(from + i), value: from + i }));
}

export function thresholdGame(root: HTMLElement, c: ThresholdChallenge, host: DrillHost): void {
  choose(
    root,
    [
      h('p', 'prompt', `A federation of ${String(c.guardians)} guardians. How many signatures must a withdrawal collect before it passes?`),
      federation(c.guardians),
      h('p', 'hint', 'It must survive the most faulty guardians n ≥ 3f + 1 allows, without letting them pass anything alone.'),
    ],
    range(1, c.guardians),
    'Set the threshold',
    (signatures) => {
      host.submit({ kind: 'threshold', signatures });
    },
  );
}

export function quorumGame(root: HTMLElement, c: QuorumChallenge, host: DrillHost): void {
  const honest = c.guardians - c.byzantine;
  choose(
    root,
    [
      h(
        'p',
        'prompt',
        `${String(c.guardians)} guardians are active and ${String(c.byzantine)} of them are secretly Byzantine. How many honest guardians can councils rotate out by mistake before the Byzantines are a third and the federation halts?`,
      ),
      federation(c.guardians, (i) => (i >= honest ? 'byz' : '')),
      h('p', 'hint', 'The Byzantine guardians are marked here; in a match you would not know.'),
    ],
    range(0, Math.min(honest - 1, 12)),
    'Answer',
    (rotations) => {
      host.submit({ kind: 'quorum', rotations });
    },
  );
}

export function councilGame(root: HTMLElement, c: CouncilChallenge, host: DrillHost): void {
  const names = COUNCIL_NAMES.slice(0, c.guardians);
  const evidence = h('ul', 'drill-evidence');
  names.forEach((name, i) => {
    const facts: string[] = [];
    if (c.inHall.includes(i)) facts.push('seen in the Signing Hall when it was filed');
    if (c.signed.includes(i)) facts.push(`signed #${String(c.forgery)}`);
    const li = h('li', facts.length === 0 ? 'quiet' : '');
    const dot = h('span', 'g');
    dot.style.background = cssColor(seatColors(i).lit);
    li.append(dot, h('b', '', name), h('span', '', facts.length === 0 ? 'nothing noted' : facts.join(' · ')));
    evidence.append(li);
  });
  choose(
    root,
    [
      h('p', 'prompt', `Withdrawal #${String(c.forgery)} was a forgery, filed from the Signing Hall. Rotate out the guardian the evidence proves, or skip the vote.`),
      evidence,
      h('p', 'hint', 'Standing in the hall is not proof, and neither is signing: honest guardians do both. Only both together point at the forger.'),
    ],
    [...names.map((name, i) => ({ label: `Rotate out ${name}`, value: i })), { label: 'Skip the vote', value: -1 }],
    'Cast the vote',
    (suspect) => {
      host.submit({ kind: 'council', suspect });
    },
    true,
  );
}

export function partitionGame(root: HTMLElement, c: PartitionChallenge, host: DrillHost): void {
  const letters = ['A', 'B', 'C'];
  const sides = h('div', 'drill-sides');
  let seat = 0;
  c.sides.forEach((size, i) => {
    const box = h('div', 'drill-side');
    const start = seat;
    box.append(h('b', '', `Side ${letters[i] ?? '?'} · ${String(size)} guardian${size === 1 ? '' : 's'}`), federation(size, () => ''));
    // Keep the seat colours continuous across sides, so each guardian keeps their colour.
    box.querySelectorAll<HTMLElement>('.g').forEach((dot, j) => {
      dot.style.background = cssColor(seatColors((start + j) % 9).lit);
    });
    seat += size;
    sides.append(box);
  });
  choose(
    root,
    [h('p', 'prompt', `A partition has split a federation of ${String(c.guardians)} guardians. Which side can still pass a withdrawal on its own?`), sides],
    [...c.sides.map((_, i) => ({ label: `Side ${letters[i] ?? '?'}`, value: i })), { label: 'No side can', value: -1 }],
    'Answer',
    (side) => {
      host.submit({ kind: 'partition', side });
    },
    true,
  );
}

// Headings for the Academy's drill banner.
export const ISLAND_DRILL_TITLES = Object.freeze({
  threshold: 'Set the signing threshold',
  quorum: 'Count the safe mistakes',
  council: 'Vote on the evidence',
  partition: 'Read the split network',
});
