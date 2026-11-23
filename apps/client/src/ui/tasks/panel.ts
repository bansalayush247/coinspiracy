// The modal a task opens in. Owns the challenge lifecycle on the client; the server decides outcomes.
import {
  TASK_TIMING,
  type TaskAnswer,
  type TaskClosed,
  type TaskKind,
  type TaskOpened,
  type TaskRefused,
  type TaskResult,
} from '@byzantine-council/shared';
import { el, h } from '../dom.js';
import { TASK_COPY } from './copy.js';
import { depositGame } from './deposit.js';
import { ledgerGame } from './ledger.js';
import { routeGame } from './route.js';
import type { MinigameHost } from './types.js';
import { watchtowerGame } from './watchtower.js';

// Answers wait out the server's minimum solve time, plus a little for clock jitter.
const SEND_MARGIN_MS = 150;
const CLOSE_AFTER_MS = 1400;

const REFUSALS: Readonly<Record<TaskRefused['reason'], string>> = {
  outOfRange: 'Step a little closer to the station.',
  retryLater: 'The station is resetting.',
  busy: 'Finish the task you have open first.',
  unavailable: 'This task is already done.',
};

// Server reasons, plus 'offline' when this client lost its connection (the server drops the challenge then).
type CloseReason = TaskClosed['reason'] | 'offline';

const CLOSINGS: Readonly<Record<CloseReason, string>> = {
  moved: 'You walked away from the station.',
  expired: 'The task timed out. Open it again to retry.',
  ended: 'The match is over.',
  council: 'A council was called. Head to the seal.',
  frozen: 'You were disconnected. The task closed.',
  offline: 'Connection lost. Open the task again once you’re back.',
};

// Controls Tab can reach inside the dialog, in document order.
function tabStops(root: HTMLElement): (HTMLElement | SVGElement)[] {
  return Array.from(root.querySelectorAll<HTMLElement | SVGElement>('button, [tabindex="0"]')).filter(
    (node) => !(node instanceof HTMLButtonElement && node.disabled) && node.closest('[inert], [hidden]') === null,
  );
}

export class TaskPanel {
  readonly #root = el('task', HTMLElement);
  readonly #station = el('task-station', HTMLParagraphElement);
  readonly #title = el('task-title', HTMLHeadingElement);
  readonly #concept = el('task-concept', HTMLParagraphElement);
  readonly #fake = el('task-fake', HTMLParagraphElement);
  readonly #body = el('task-body', HTMLDivElement);
  readonly #status = el('task-status', HTMLParagraphElement);
  readonly #close = el('task-close', HTMLButtonElement);
  #kind: TaskKind | null = null;
  #task: { readonly id: string; readonly openedAt: number } | null = null;
  #timer = 0;
  // Called when the player closes the panel while a challenge is open on the server.
  onCancel: () => void = () => undefined;
  onAnswer: (id: string, answer: TaskAnswer) => void = () => undefined;
  onHidden: () => void = () => undefined;

  constructor() {
    this.#close.addEventListener('click', () => {
      this.cancel();
    });
    // A modal dialog keeps Tab inside itself.
    this.#root.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const stops = tabStops(this.#root);
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      if (first === undefined || last === undefined) {
        e.preventDefault();
      } else if (e.shiftKey && (active === first || active === this.#root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  get isOpen(): boolean {
    return !this.#root.hidden;
  }

  // Shown at once on the interact press; the challenge fills it when the server replies.
  opening(kind: TaskKind, fake: boolean): void {
    this.#reset();
    const copy = TASK_COPY[kind];
    this.#kind = kind;
    this.#station.textContent = copy.station;
    this.#title.textContent = copy.title;
    this.#concept.textContent = copy.concept;
    this.#fake.hidden = !fake;
    this.#body.replaceChildren(h('p', 'loading', 'Opening…'));
    this.#root.hidden = false;
    this.#root.focus();
  }

  opened(task: TaskOpened): void {
    if (!this.isOpen || this.#kind !== task.challenge.kind || this.#task !== null) return;
    this.#task = { id: task.id, openedAt: performance.now() };
    const host: MinigameHost = {
      submit: (answer) => {
        this.#submit(task.id, answer);
      },
    };
    this.#body.replaceChildren();
    const c = task.challenge;
    switch (c.kind) {
      case 'deposit':
        depositGame(this.#body, c, host);
        break;
      case 'ledger':
        ledgerGame(this.#body, c, host);
        break;
      case 'route':
        routeGame(this.#body, c, host);
        break;
      case 'watchtower':
        watchtowerGame(this.#body, c, host);
        break;
    }
  }

  result(r: TaskResult): void {
    if (this.#task?.id !== r.id) return;
    this.#task = null;
    this.#body.inert = true;
    if (r.ok) {
      this.#setStatus(this.#fake.hidden ? 'Done. The federation is closer to consensus.' : 'Faked. Nobody saw a thing.', 'good');
    } else {
      const seconds = Math.ceil((r.retryInMs ?? 0) / 1000);
      this.#setStatus(seconds > 0 ? `Not quite. The station resets in ${String(seconds)} s.` : 'Not quite.', 'bad');
    }
    this.#closeSoon();
  }

  refused(r: TaskRefused): void {
    if (!this.isOpen || this.#task !== null) return;
    const wait = r.retryInMs === undefined ? '' : ` Try again in ${String(Math.max(1, Math.ceil(r.retryInMs / 1000)))} s.`;
    this.#body.replaceChildren();
    this.#setStatus(`${REFUSALS[r.reason]}${wait}`, 'bad');
    this.#closeSoon();
  }

  closed(r: { readonly reason: CloseReason }): void {
    if (!this.isOpen) return;
    this.#task = null;
    this.#body.inert = true;
    this.#setStatus(CLOSINGS[r.reason], 'bad');
    this.#closeSoon();
  }

  // Player closed it: tell the server only if a challenge is still open there.
  cancel(): void {
    if (!this.isOpen) return;
    const wasOpen = this.#task !== null || this.#status.textContent === '';
    this.hide();
    if (wasOpen) this.onCancel();
  }

  // The station of the open task, if any.
  get kind(): TaskKind | null {
    return this.#kind;
  }

  hide(): void {
    if (this.#root.hidden) return;
    this.#reset();
    this.#root.hidden = true;
    this.onHidden();
  }

  #submit(id: string, answer: TaskAnswer): void {
    const task = this.#task;
    const kind = this.#kind;
    if (task?.id !== id || kind === null) return;
    this.#body.inert = true;
    this.#setStatus('Checking with the federation…', '');
    const wait = Math.max(0, TASK_TIMING.minSolveMs[kind] + SEND_MARGIN_MS - (performance.now() - task.openedAt));
    this.#timer = window.setTimeout(() => {
      if (this.#task?.id === id) this.onAnswer(id, answer);
    }, wait);
  }

  #closeSoon(): void {
    window.clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => {
      this.hide();
    }, CLOSE_AFTER_MS);
  }

  #setStatus(text: string, tone: '' | 'good' | 'bad'): void {
    this.#status.textContent = text;
    this.#status.dataset['tone'] = tone;
  }

  #reset(): void {
    window.clearTimeout(this.#timer);
    this.#kind = null;
    this.#task = null;
    this.#body.inert = false;
    this.#body.replaceChildren();
    this.#setStatus('', '');
  }
}
