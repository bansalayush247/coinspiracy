// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TASK_TIMING, type TaskAnswer, type TaskOpened } from '@byzantine-council/shared';
import page from '../index.html?raw';
import { TaskPanel } from '../src/ui/tasks/panel.js';

const WATCHTOWER: TaskOpened = {
  id: 'task-id-0001',
  challenge: { kind: 'watchtower', reports: [925_100, 925_101, 925_101, 925_102, 925_103, 930_000, 900_000] },
};

// The real page markup, without its script.
function loadPage(): void {
  const doc = new DOMParser().parseFromString(page, 'text/html');
  for (const script of doc.querySelectorAll('script')) script.remove();
  document.body.replaceChildren(...Array.from(doc.body.childNodes, (n) => document.importNode(n, true)));
}

function setup() {
  loadPage();
  const panel = new TaskPanel();
  const answers: [string, TaskAnswer][] = [];
  let cancels = 0;
  panel.onAnswer = (id, answer) => answers.push([id, answer]);
  panel.onCancel = () => {
    cancels += 1;
  };
  return { panel, answers, cancels: () => cancels };
}

function root(): HTMLElement {
  const node = document.getElementById('task');
  if (node === null) throw new Error('no task panel');
  return node;
}

function status(): string {
  return document.getElementById('task-status')?.textContent ?? '';
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('TaskPanel', () => {
  it('waits out the minimum solve time before handing an answer to the server', () => {
    const { panel, answers } = setup();
    panel.opening('watchtower', false);
    panel.opened(WATCHTOWER);
    root().querySelector<HTMLButtonElement>('.report[data-height="925101"]')?.click();
    root().querySelector<HTMLButtonElement>('#task-body > button.cta')?.click();
    expect(status()).toBe('Checking with the federation…');
    vi.advanceTimersByTime(TASK_TIMING.minSolveMs.watchtower);
    expect(answers).toStrictEqual([]);
    vi.advanceTimersByTime(200);
    expect(answers).toStrictEqual([['task-id-0001', { kind: 'watchtower', height: 925_101 }]]);
  });

  it('closes on a lost connection without asking the server to close a challenge it already dropped', () => {
    const { panel, answers, cancels } = setup();
    panel.opening('watchtower', false);
    panel.opened(WATCHTOWER);
    root().querySelector<HTMLButtonElement>('.report')?.click();
    root().querySelector<HTMLButtonElement>('#task-body > button.cta')?.click();
    panel.closed({ reason: 'offline' });
    expect(status()).toBe('Connection lost. Open the task again once you’re back.');
    vi.advanceTimersByTime(TASK_TIMING.minSolveMs.watchtower + 200);
    // The pending answer was dropped with the challenge.
    expect(answers).toStrictEqual([]);
    panel.cancel();
    expect(cancels()).toBe(0);
    expect(panel.isOpen).toBe(false);
  });

  it('tells the server when the player closes a challenge that is still open', () => {
    const { panel, cancels } = setup();
    panel.opening('watchtower', false);
    panel.cancel();
    expect(cancels()).toBe(1);
    panel.opening('watchtower', false);
    panel.opened(WATCHTOWER);
    panel.cancel();
    expect(cancels()).toBe(2);
  });

  it('ignores a challenge for another station or a second one for the same panel', () => {
    const { panel } = setup();
    panel.opening('ledger', false);
    panel.opened(WATCHTOWER);
    expect(root().querySelector('.report')).toBeNull();
    panel.opening('watchtower', false);
    panel.opened(WATCHTOWER);
    panel.opened({ ...WATCHTOWER, id: 'task-id-0002' });
    expect(root().querySelectorAll('.report')).toHaveLength(7);
  });

  it('keeps Tab inside the dialog', () => {
    const { panel } = setup();
    panel.opening('watchtower', false);
    panel.opened(WATCHTOWER);
    const first = root().querySelector<HTMLButtonElement>('.report');
    const close = document.getElementById('task-close');
    if (first === null || close === null) throw new Error('missing controls');
    close.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    close.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    first.dispatchEvent(back);
    expect(document.activeElement).toBe(close);
  });
});
