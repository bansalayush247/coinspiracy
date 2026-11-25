// The story panel: lines typed out one by one, choices on a clock, and a note whenever a character will remember
// what you did. It only shows what the server's scene says; votes and moving on are sent back as requests, and in a
// crew the line Rook says is the one the crew's votes chose.
import { DUMP_ACT, SPEAKER_NAMES, visibleChoices, visibleLines, type ScriptChoice, type ScriptNode, type Speaker, type StoryAct } from '@byzantine-council/shared/city';
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
  #offered: readonly ScriptChoice[] | null = null;
  #canAdvance = false;
  #read = false;
  #crew = 1;
  // Notes earned by the choice being settled, held until the line that earned them is shown.
  #held: string[] = [];
  // The act whose script and marks this panel reads.
  act: StoryAct = DUMP_ACT;
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

  // `said` is the choice that settled the node before this one, '' when nobody chose in time.
  show(id: string, seq: number, marks: ReadonlySet<string>, said: string): void {
    if (seq === this.#seq) return;
    const node = this.act.script[id];
    if (node === undefined) return;
    if (this.#offered !== null) {
      const chosen = this.#offered.find((c) => c.id === said);
      if (chosen === undefined) this.#say('rook', '…', 'says nothing');
      else this.#say('rook', chosen.text);
    }
    const held = this.#held;
    this.#held = [];
    this.#seq = seq;
    this.#node = id;
    this.#waitingChoice = null;
    this.#offered = (node.choices?.length ?? 0) > 0 ? (node.choices ?? null) : null;
    this.#canAdvance = false;
    this.#read = false;
    this.#root.hidden = false;
    this.#choices.replaceChildren();
    this.#hint.textContent = '';
    if (node.slug !== undefined) {
      this.#log.replaceChildren();
      this.#entry('story-slug', node.slug);
    }
    for (const mark of held) this.#write(mark);
    void this.#play(node, id, marks, ++this.#token);
  }

  hide(): void {
    this.#token++;
    this.#seq = -1;
    this.#node = '';
    this.#waitingChoice = null;
    this.#offered = null;
    this.#held = [];
    this.#root.hidden = true;
    this.#log.replaceChildren();
    this.#choices.replaceChildren();
  }

  // A remembered choice or a clue, shown under the line that caused it.
  note(mark: string): void {
    if (this.act.marks[mark] === undefined || !this.open) return;
    if (this.#offered !== null) this.#held.push(mark);
    else this.#write(mark);
  }

  #write(mark: string): void {
    const m = this.act.marks[mark];
    if (m === undefined || (m.clue !== true && m.who === undefined)) return;
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
    this.#read = true;
    this.#hint.textContent = this.#crew > 1 ? 'Waiting for the rest of the crew to read on…' : '';
    this.onAdvance(this.#node);
  }

  set crew(size: number) {
    this.#crew = Math.max(1, size);
  }

  // Who in the crew has voted for what on the choice on screen, and how many have read the scene through.
  crewStatus(votes: ReadonlyMap<string, readonly string[]>, mine: string | null, ready: number): void {
    if (this.#offered !== null) {
      this.#choices.querySelectorAll<HTMLButtonElement>('button.story-choice').forEach((b) => {
        const id = b.dataset['choice'] ?? '';
        b.classList.toggle('voted', id === mine);
        b.setAttribute('aria-pressed', String(id === mine));
        const tally = b.querySelector('.story-votes');
        if (tally !== null) tally.textContent = this.#crew > 1 ? (votes.get(id) ?? []).join(', ') : '';
      });
    } else if (this.#read && this.#crew > 1) {
      this.#hint.textContent = `Waiting for the rest of the crew to read on (${String(ready)} of ${String(this.#crew)} ready)…`;
    }
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
    const choices = visibleChoices(node, marks);
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
      b.dataset['choice'] = c.id;
      b.append(h('kbd', '', String(i + 1)), h('em', '', c.tag), document.createTextNode(c.text), h('span', 'story-votes'));
      b.addEventListener('click', () => {
        if (this.#waitingChoice !== id) return;
        audio.play('click');
        if (this.#crew <= 1) {
          this.#waitingChoice = null;
          this.#choices.replaceChildren();
        }
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
    if (this.#crew > 1) this.#hint.textContent = 'The crew votes: most votes win, and a tie goes to the crew lead. You can change your vote.';
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
