// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTE_EDGES, toDenominations, type RouteChallenge, type TaskAnswer } from '@byzantine-council/shared';
import { HOLD_MS, depositGame } from '../src/ui/tasks/deposit.js';
import { RELEASE_GUARD_MS } from '../src/ui/tasks/hold.js';
import { nodeDescription, routeGame } from '../src/ui/tasks/route.js';
import type { MinigameHost } from '../src/ui/tasks/types.js';

function mount(): { root: HTMLDivElement; answers: TaskAnswer[]; host: MinigameHost } {
  const root = document.createElement('div');
  document.body.append(root);
  const answers: TaskAnswer[] = [];
  return { root, answers, host: { submit: (answer) => answers.push(answer) } };
}

function query<T extends Element = Element>(root: ParentNode, selector: string, type?: new () => T): T {
  const node = root.querySelector(selector);
  if (node === null || (type !== undefined && !(node instanceof type))) throw new Error(`missing ${selector}`);
  return node as T;
}

const pointer = (type: string): PointerEvent => new PointerEvent(type, { pointerId: 1, isPrimary: true, button: 0, bubbles: true, cancelable: true });
const mouseClick = (): MouseEvent => new MouseEvent('click', { detail: 1, bubbles: true, cancelable: true });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => {
    cb(performance.now());
  }, 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    window.clearTimeout(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('depositGame', () => {
  function toHoldStep(amount: number) {
    const m = mount();
    depositGame(m.root, { kind: 'deposit', amount }, m.host);
    const action = query(m.root, ':scope > button.cta', HTMLButtonElement);
    for (const value of toDenominations(amount)) query(m.root, `.note-chip[data-value="${String(value)}"]`).dispatchEvent(mouseClick());
    action.dispatchEvent(mouseClick());
    expect(action.textContent).toBe('Send for signing');
    action.dispatchEvent(mouseClick());
    expect(action.textContent).toBe('Hold to sign');
    return { ...m, action };
  }

  it('only offers to blind once the picked notes add up exactly', () => {
    const { root } = mount();
    depositGame(root, { kind: 'deposit', amount: 43 }, { submit: () => undefined });
    const action = query(root, ':scope > button.cta', HTMLButtonElement);
    const chip = (value: number) => query(root, `.note-chip[data-value="${String(value)}"]`);
    expect(action.disabled).toBe(true);
    chip(64).dispatchEvent(mouseClick());
    expect(query(root, '.tally').classList.contains('over')).toBe(true);
    expect(chip(64).getAttribute('aria-pressed')).toBe('true');
    chip(64).dispatchEvent(mouseClick());
    for (const value of [32, 8, 2]) chip(value).dispatchEvent(mouseClick());
    expect(action.disabled).toBe(true);
    chip(1).dispatchEvent(mouseClick());
    expect(action.disabled).toBe(false);
    expect(query(root, '.tally').textContent).toBe('Picked 43 sats of 43 sats');
  });

  it('signs on a full hold, ignores the click its release fires, then unblinds on a fresh press', () => {
    const { root, answers, action } = toHoldStep(43);
    action.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(HOLD_MS + 50);
    expect(root.querySelectorAll('.ecash.stamped')).toHaveLength(4);
    action.dispatchEvent(pointer('pointerup'));
    action.dispatchEvent(mouseClick());
    expect(answers).toStrictEqual([]);
    vi.advanceTimersByTime(RELEASE_GUARD_MS);
    expect(action.textContent).toBe('Unblind');
    expect(action.disabled).toBe(false);
    action.dispatchEvent(mouseClick());
    expect(answers).toHaveLength(1);
    const [answer] = answers;
    expect(answer?.kind === 'deposit' ? [...answer.notes].sort((a, b) => b - a) : null).toStrictEqual([32, 8, 2, 1]);
    expect(action.disabled).toBe(true);
    // A second press cannot hand the answer in twice.
    action.dispatchEvent(mouseClick());
    expect(answers).toHaveLength(1);
  });

  it('asks the player to keep holding after a short press', () => {
    const { root, answers, action } = toHoldStep(5);
    action.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(HOLD_MS / 4);
    action.dispatchEvent(pointer('pointerup'));
    action.dispatchEvent(mouseClick());
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(query(root, '.prompt').textContent).toContain('Keep holding');
    expect(action.textContent).toBe('Hold to sign');
    expect(answers).toStrictEqual([]);
  });

  it('can be finished with the keyboard alone', () => {
    const { answers, action } = toHoldStep(6);
    action.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(HOLD_MS + 50);
    action.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(RELEASE_GUARD_MS);
    expect(action.textContent).toBe('Unblind');
    // Enter on a button clicks it, with no pointer behind the click.
    action.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true, cancelable: true }));
    expect(answers).toHaveLength(1);
  });
});

describe('routeGame', () => {
  // Gateway, A, C, E, shop is the only route wide enough for 40k.
  const capacities = ROUTE_EDGES.map(([from, to]) => ([[0, 1], [1, 3], [3, 5], [5, 7]].some(([a, b]) => a === from && b === to) ? 60 : 20));
  const challenge: RouteChallenge = { kind: 'route', amount: 40, capacities };
  const node = (root: ParentNode, i: number) => query(root, `.node[data-node="${String(i)}"]`, SVGGElement);

  it('builds a route hop by hop and sends it', () => {
    const { root, answers, host } = mount();
    routeGame(root, challenge, host);
    const action = query(root, ':scope > button.cta', HTMLButtonElement);
    expect(action.disabled).toBe(true);
    for (const i of [1, 3, 5, 7]) node(root, i).dispatchEvent(mouseClick());
    expect(node(root, 3).getAttribute('aria-pressed')).toBe('true');
    expect(node(root, 4).getAttribute('aria-pressed')).toBe('false');
    expect(action.disabled).toBe(false);
    action.dispatchEvent(mouseClick());
    expect(answers).toStrictEqual([{ kind: 'route', path: [0, 1, 3, 5, 7] }]);
  });

  it('refuses a hop with no channel and cuts back to a node already on the route', () => {
    const { root, host } = mount();
    routeGame(root, challenge, host);
    const status = query(root, '.tally');
    node(root, 5).dispatchEvent(mouseClick());
    expect(status.textContent).toBe('No channel goes there from the end of your route.');
    node(root, 1).dispatchEvent(mouseClick());
    node(root, 4).dispatchEvent(mouseClick());
    node(root, 1).dispatchEvent(mouseClick());
    expect(status.textContent).toBe('Route: Gateway → A');
  });

  it('works from the keyboard and ignores held-key repeats', () => {
    const { root, host } = mount();
    routeGame(root, challenge, host);
    const press = (i: number, k: string, repeat = false) => {
      const e = new KeyboardEvent('keydown', { key: k, repeat, bubbles: true, cancelable: true });
      node(root, i).dispatchEvent(e);
      return e;
    };
    expect(press(1, 'Enter').defaultPrevented).toBe(true);
    press(3, ' ');
    // A held key's repeat is ignored; acting on it would report that no channel reaches D.
    press(4, 'Enter', true);
    expect(query(root, '.tally').textContent).toBe('Route: Gateway → A → C');
    expect(node(root, 1).getAttribute('tabindex')).toBe('0');
  });

  it('tells screen readers every channel leaving a node and its capacity', () => {
    expect(nodeDescription(challenge, 0)).toBe('Gateway, where the payment starts. Channel to A holds 60k, channel to B holds 20k');
    expect(nodeDescription(challenge, 1)).toBe('A. Channel to C holds 60k, channel to D holds 20k');
    expect(nodeDescription(challenge, 7)).toBe('Shop, where the payment ends');
    const { root, host } = mount();
    routeGame(root, challenge, host);
    expect(node(root, 1).getAttribute('aria-label')).toBe(nodeDescription(challenge, 1));
    for (const label of root.querySelectorAll('.capacity')) expect(label.getAttribute('aria-hidden')).toBe('true');
  });
});
