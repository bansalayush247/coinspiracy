// The story panel: lines typed out one by one, choices on a clock, and a note whenever a character will remember
// what you did. It only shows what the server's scene says; choosing and moving on are sent back as requests.
import { DUMP_MARKS, DUMP_SCRIPT, SPEAKER_NAMES, visibleLines, type ScriptChoice, type ScriptNode, type Speaker } from '@byzantine-council/shared/city';
import { audio } from '../audio/engine.js';
import { el, h } from '../ui/dom.js';

const TYPE_MS = 16;
const LINE_GAP_MS = 320;
const MAX_ENTRIES = 16;

export class Dialogue {
  readonly #root = el('story-talk', HTMLElement);
  readonly #log = el('story-log', HTMLElement);
  readonly #choices = el('story-choices', HTMLElement);
  readonly #hint = el('story-hint', HTMLElement);
  readonly #reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  #seq = -1;
  #node = '';
  #token = 0;
  #typing = false;
  #skipTyping = false;
  #waitingChoice: string | null = null;
  #canAdvance = false;
  onChoose: (node: string, choice: string) => void = () => undefined;
  onAdvance: (node: string) => void = () => undefined;

  constructor() {
    this.#root.addEventListener('click', (e) => {
      if (e.target instanceof HTMLElement && e.target.closest('button') !== null) return;
      this.next();
    });
  }

  get open(): boolean {
    return !this.#root.hidden;
  }

  show(id: string, seq: number, marks: ReadonlySet<string>): void {
    if (seq === this.#seq) return;
    const node = DUMP_SCRIPT[id];
    if (node === undefined) return;
    if (this.#waitingChoice !== null) this.#say('rook', '…', 'says nothing');
    this.#seq = seq;
    this.#node = id;
    this.#waitingChoice = null;
    this.#canAdvance = false;
    this.#root.hidden = false;
    this.#choices.replaceChildren();
    this.#hint.textContent = '';
    if (node.slug !== undefined) {
      this.#log.replaceChildren();
      this.#entry('story-slug', node.slug);
    }
    void this.#play(node, id, marks, ++this.#token);
  }

  hide(): void {
    this.#token++;
    this.#seq = -1;
    this.#node = '';
    this.#waitingChoice = null;
    this.#root.hidden = true;
    this.#log.replaceChildren();
    this.#choices.replaceChildren();
  }

  // A remembered choice or a clue, shown under the line that caused it.
  note(mark: string): void {
    const m = DUMP_MARKS[mark];
    if (m === undefined || !this.open) return;
    const text = m.clue === true ? `Clue: ${m.text}` : m.who === 'rook' ? 'You’ll remember that.' : `${SPEAKER_NAMES[m.who ?? 'rook']} will remember that.`;
    this.#entry(m.clue === true ? 'story-clue' : 'story-memory', text);
  }

  // Space, Enter or a tap: finish the typing, then move on when there is nothing to choose.
  next(): void {
    if (this.#typing) {
      this.#skipTyping = true;
      return;
    }
    if (!this.#canAdvance) return;
    this.#canAdvance = false;
    this.#hint.textContent = '';
    this.onAdvance(this.#node);
  }

  // Number keys pick a choice.
  pick(n: number): void {
    const button = this.#choices.querySelectorAll('button')[n - 1];
    if (button instanceof HTMLButtonElement) button.click();
  }

  async #play(node: ScriptNode, id: string, marks: ReadonlySet<string>, token: number): Promise<void> {
    this.#typing = true;
    this.#skipTyping = this.#reduced;
    if (node.action !== undefined) await this.#type('story-action', node.action, token);
    for (const line of visibleLines(node, marks)) {
      if (token !== this.#token) return;
      await this.#line(line.who, line.text, line.paren, token);
    }
    if (node.after !== undefined) await this.#type('story-action', node.after, token);
    if (token !== this.#token) return;
    this.#typing = false;
    const choices = node.choices ?? [];
    if (choices.length > 0) {
      this.#offer(id, choices, node.seconds);
      return;
    }
    this.#canAdvance = true;
    this.#hint.textContent = 'Space or tap to continue';
  }

  #offer(id: string, choices: readonly ScriptChoice[], seconds: number | undefined): void {
    this.#waitingChoice = id;
    const buttons = choices.map((c, i) => {
      const b = h('button', 'story-choice');
      b.type = 'button';
      b.append(h('kbd', '', String(i + 1)), h('em', '', c.tag), document.createTextNode(c.text));
      b.addEventListener('click', () => {
        if (this.#waitingChoice !== id) return;
        this.#waitingChoice = null;
        this.#choices.replaceChildren();
        this.#say('rook', c.text);
        audio.play('click');
        this.onChoose(id, c.id);
      });
      return b;
    });
    this.#choices.replaceChildren(...buttons);
    if (seconds !== undefined) {
      const bar = h('div', 'story-timer');
      const fill = h('i');
      bar.append(fill);
      this.#choices.append(bar);
      fill.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: seconds * 1000, fill: 'forwards' });
      this.#hint.textContent = 'Choose before the bar runs out. Silence is an answer too.';
    }
    buttons[0]?.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      this.#log.scrollTop = this.#log.scrollHeight;
    });
  }

  async #line(who: Speaker, text: string, paren: string | undefined, token: number): Promise<void> {
    const p = this.#say(who, '', paren);
    const say = p.querySelector('.story-say');
    if (say instanceof HTMLElement) await this.#typeInto(say, text, token);
    await this.#wait(LINE_GAP_MS);
  }

  #say(who: Speaker, text: string, paren?: string): HTMLElement {
    const p = h('p', `story-line story-${who}`);
    p.append(h('span', 'story-who', SPEAKER_NAMES[who]));
    if (paren !== undefined) p.append(h('span', 'story-paren', `(${paren})`));
    p.append(h('span', 'story-say', text));
    this.#push(p);
    return p;
  }

  async #type(cls: string, text: string, token: number): Promise<void> {
    const p = this.#entry(cls, '');
    await this.#typeInto(p, text, token);
    await this.#wait(LINE_GAP_MS);
  }

  async #typeInto(node: HTMLElement, text: string, token: number): Promise<void> {
    for (let i = 0; i <= text.length; i++) {
      if (token !== this.#token) return;
      if (this.#skipTyping) {
        node.textContent = text;
        return;
      }
      node.textContent = text.slice(0, i);
      await this.#wait(TYPE_MS);
    }
  }

  #wait(ms: number): Promise<void> {
    return this.#skipTyping ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
  }

  #entry(cls: string, text: string): HTMLElement {
    const p = h('p', cls, text);
    this.#push(p);
    return p;
  }

  #push(node: HTMLElement): void {
    this.#log.append(node);
    while (this.#log.childElementCount > MAX_ENTRIES) this.#log.firstElementChild?.remove();
    this.#log.scrollTop = this.#log.scrollHeight;
  }
}
