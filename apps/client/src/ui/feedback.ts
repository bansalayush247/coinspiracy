// The playtest feedback form: a 1–5 "how fun was that", an optional note, and where in the game it was sent from.
// It posts without cookies, so nothing ties a note to the player who wrote it.
import { FEEDBACK_MAX_TEXT, FEEDBACK_PATH, FeedbackSchema, type FeedbackInput } from '@byzantine-council/shared';
import { getLocale, onLocaleChange, t } from '../i18n/index.js';
import { el, h } from './dom.js';

const TIMEOUT_MS = 8000;
const FUN_KEYS = ['feedback.fun1', 'feedback.fun2', 'feedback.fun3', 'feedback.fun4', 'feedback.fun5'] as const;

/** The build this client reports with feedback: `VITE_BUILD` when the deploy sets it, else `dev`. */
export function feedbackBuild(raw: string | undefined = import.meta.env.VITE_BUILD): string {
  return raw !== undefined && /^[A-Za-z0-9._-]{1,40}$/.test(raw) ? raw : 'dev';
}

/** How a send went, for the status line. */
export type FeedbackOutcome = 'sent' | 'limited' | 'failed';

/** Posts one piece of feedback; never sends cookies or credentials. */
export async function sendFeedback(base: string, body: FeedbackInput, fetchFn: typeof fetch = fetch): Promise<FeedbackOutcome> {
  if (!FeedbackSchema.safeParse(body).success) return 'failed';
  try {
    const res = await fetchFn(`${base}${FEEDBACK_PATH}`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 204) return 'sent';
    return res.status === 429 ? 'limited' : 'failed';
  } catch {
    return 'failed';
  }
}

/** The feedback dialog. */
export class FeedbackForm {
  readonly #root = el('feedback', HTMLElement);
  readonly #funs = el('feedback-fun', HTMLDivElement);
  readonly #text = el('feedback-text', HTMLTextAreaElement);
  readonly #count = el('feedback-count', HTMLSpanElement);
  readonly #send = el('feedback-send', HTMLButtonElement);
  readonly #status = el('feedback-status', HTMLParagraphElement);
  readonly #buttons: HTMLButtonElement[];
  #fun = 0;
  #where = 'menu';
  #busy = false;

  constructor(
    private readonly base: string,
    private readonly send: typeof sendFeedback = sendFeedback,
  ) {
    this.#text.maxLength = FEEDBACK_MAX_TEXT;
    this.#buttons = FUN_KEYS.map((_, i) => {
      const b = h('button', 'feedback-fun-choice', String(i + 1));
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        this.#pick(i + 1);
      });
      return b;
    });
    this.#funs.replaceChildren(...this.#buttons);
    this.#label();
    onLocaleChange(() => {
      this.#label();
    });
    this.#text.addEventListener('input', () => {
      this.#renderCount();
    });
    this.#send.addEventListener('click', () => {
      void this.#submit();
    });
    el('feedback-close', HTMLButtonElement).addEventListener('click', () => {
      this.close();
    });
    this.#root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  /** Opens the form for a place in the game, such as `menu`, `match` or `story:book`. */
  open(where: string): void {
    this.#where = where;
    this.#fun = 0;
    this.#text.value = '';
    this.#status.textContent = '';
    this.#send.disabled = false;
    this.#buttons.forEach((b) => {
      b.setAttribute('aria-pressed', 'false');
    });
    this.#renderCount();
    this.#root.hidden = false;
    this.#root.focus();
  }

  close(): void {
    this.#root.hidden = true;
  }

  #label(): void {
    this.#buttons.forEach((b, i) => {
      const key = FUN_KEYS[i];
      if (key === undefined) return;
      b.title = t(key);
      b.setAttribute('aria-label', `${String(i + 1)}: ${t(key)}`);
    });
    this.#renderCount();
  }

  #pick(fun: number): void {
    this.#fun = fun;
    this.#buttons.forEach((b, i) => {
      b.setAttribute('aria-pressed', String(i + 1 === fun));
    });
    if (this.#status.textContent === t('feedback.pickFun')) this.#status.textContent = '';
  }

  #renderCount(): void {
    this.#count.textContent = t('feedback.count', { n: this.#text.value.length, max: FEEDBACK_MAX_TEXT });
  }

  async #submit(): Promise<void> {
    if (this.#busy) return;
    if (this.#fun === 0) {
      this.#status.textContent = t('feedback.pickFun');
      return;
    }
    this.#busy = true;
    this.#send.disabled = true;
    this.#status.textContent = t('feedback.sending');
    const outcome = await this.send(this.base, { fun: this.#fun, text: this.#text.value, where: this.#where, locale: getLocale(), build: feedbackBuild() });
    this.#busy = false;
    if (outcome === 'sent') {
      this.#status.textContent = t('feedback.thanks');
      return;
    }
    this.#send.disabled = false;
    this.#status.textContent = t(outcome === 'limited' ? 'feedback.limited' : 'feedback.failed');
  }
}
