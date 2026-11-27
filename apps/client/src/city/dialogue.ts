// The story panel: one line at a time, typed at the player's pace beside the speaker's portrait, which wears the face
// the line is said with. Choices come up on a clock that starts once the crew has read up to them, and a note shows
// whenever a character will remember what you did. It only shows what the server's scene says; reading on and votes
// are sent back as requests, and in a crew the line Rook says is the one the crew's votes chose.
import { DUMP_ACT, SPEAKER_NAMES, faceOf, visibleChoices, visibleLines, type Face, type ScriptChoice, type ScriptNode, type Speaker, type StoryAct } from '@byzantine-council/shared/city';
import { audio } from '../audio/engine.js';
import { NO_WEAR } from '../game/guardianArt.js';
import { el, h } from '../ui/dom.js';
import { onLocaleChange, t } from '../i18n/index.js';
import { storyT } from '../i18n/story.js';
import { portrait, rookSitter, showFrame, sitterColor, sitterFor, type Sitter } from './portraits.js';
import { READING, charDelayMs, graphemes, holdMs, isTextSpeed, nextSpeed, type TextSpeed } from './readingPace.js';

const MAX_ENTRIES = 80;
const STORAGE_KEY = 'bc.story';
const TALK_EVERY = 3;

type Beat =
  | { readonly kind: 'line'; readonly who: Speaker; readonly text: string; readonly paren: string | undefined; readonly face: Face; readonly notes: readonly string[] }
  | { readonly kind: 'action'; readonly text: string; readonly notes: readonly string[] };

interface Slot {
  readonly root: HTMLElement;
  who: Speaker | null;
  face: Face;
  art: SVGSVGElement | null;
}

const SPEED_KEYS = { slow: 'dialogue.speedSlow', normal: 'dialogue.speedNormal', fast: 'dialogue.speedFast', instant: 'dialogue.speedInstant' } as const;

function loadPrefs(): { speed: TextSpeed; auto: boolean } {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const v = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    return { speed: isTextSpeed(v['speed']) ? v['speed'] : 'normal', auto: v['auto'] === true };
  } catch {
    return { speed: 'normal', auto: false };
  }
}

export class Dialogue {
  readonly #root = el('story-talk', HTMLElement);
  readonly #slug = el('story-slug', HTMLElement);
  readonly #name = el('story-name', HTMLElement);
  readonly #direction = el('story-direction', HTMLElement);
  readonly #now = el('story-now', HTMLElement);
  readonly #notes = el('story-notes', HTMLElement);
  readonly #more = el('story-more', HTMLElement);
  readonly #log = el('story-log', HTMLElement);
  readonly #choices = el('story-choices', HTMLElement);
  readonly #hint = el('story-hint', HTMLElement);
  readonly #autoButton = el('story-auto', HTMLButtonElement);
  readonly #speedButton = el('story-speed', HTMLButtonElement);
  readonly #historyButton = el('story-history', HTMLButtonElement);
  readonly #them: Slot = { root: el('story-face-them', HTMLElement), who: null, face: 'calm', art: null };
  readonly #rook: Slot = { root: el('story-face-rook', HTMLElement), who: null, face: 'calm', art: null };
  readonly #reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  #speed: TextSpeed;
  #auto: boolean;
  #rookSitter: Sitter = rookSitter(0, NO_WEAR);
  #seq = -1;
  #node = '';
  #token = 0;
  #typing = false;
  #skipTyping = false;
  #tap: (() => void) | null = null;
  #pending: Beat[] = [];
  #waitingChoice: string | null = null;
  #offered: readonly ScriptChoice[] | null = null;
  #clockSeconds: number | undefined;
  #clockRunning = false;
  #answering = false;
  #canAdvance = false;
  #read = false;
  #crew = 1;
  #ready = 0;
  #blinkTimer = 0;
  #blinks = 0;
  // Notes earned by the choice being settled, held until the line that earned them is shown.
  #held: string[] = [];
  // The act whose script and marks this panel reads.
  act: StoryAct = DUMP_ACT;
  onChoose: (node: string, choice: string) => void = () => undefined;
  // Sent when the player has read a node through: to move on, or, on a choice, to start its clock.
  onAdvance: (node: string) => void = () => undefined;

  constructor() {
    const prefs = loadPrefs();
    this.#speed = prefs.speed;
    this.#auto = prefs.auto;
    this.#root.addEventListener('click', (e) => {
      if (e.target instanceof Element && (e.target.closest('button') !== null || e.target.closest('#story-log') !== null)) return;
      this.next();
    });
    this.#autoButton.addEventListener('click', () => {
      this.#auto = !this.#auto;
      this.#savePrefs();
      this.#renderTools();
      if (this.#auto) this.#tap?.();
    });
    this.#speedButton.addEventListener('click', () => {
      this.#speed = nextSpeed(this.#speed);
      this.#savePrefs();
      this.#renderTools();
    });
    this.#historyButton.addEventListener('click', () => {
      this.#log.hidden = !this.#log.hidden;
      this.#renderTools();
      if (!this.#log.hidden) this.#log.scrollTop = this.#log.scrollHeight;
    });
    onLocaleChange(() => {
      this.#renderTools();
    });
    this.#renderTools();
  }

  get open(): boolean {
    return !this.#root.hidden;
  }

  /** Dresses Rook's portrait as the player: their seat's colours and what they wear. */
  dressRook(seat: number, wear: { readonly hat: string; readonly shades: string; readonly outfit: string }): void {
    this.#rookSitter = rookSitter(seat, wear);
    if (this.#rook.who !== null) this.#paint(this.#rook, 'rook', this.#rook.face, -1);
  }

  // `said` is the choice that settled the node before this one, '' when nobody chose in time.
  show(id: string, seq: number, marks: ReadonlySet<string>, said: string): void {
    if (seq === this.#seq) return;
    const node = this.act.script[id];
    if (node === undefined) return;
    this.#flush();
    const held = this.#held;
    this.#held = [];
    const beats: Beat[] = [];
    if (this.#offered !== null) {
      const chosen = this.#offered.find((c) => c.id === said);
      beats.push(chosen === undefined
        ? { kind: 'line', who: 'rook', text: '…', paren: t('dialogue.saysNothing'), face: 'worried', notes: held }
        : { kind: 'line', who: 'rook', text: storyT(chosen.text), paren: undefined, face: 'calm', notes: held });
    }
    const opening = this.#offered === null ? held : [];
    this.#seq = seq;
    this.#node = id;
    this.#waitingChoice = null;
    this.#offered = (node.choices?.length ?? 0) > 0 ? (node.choices ?? null) : null;
    this.#clockSeconds = undefined;
    this.#clockRunning = false;
    this.#answering = false;
    this.#canAdvance = false;
    this.#read = false;
    this.#ready = 0;
    this.#choices.replaceChildren();
    this.#hint.textContent = '';
    audio.setDialogueOpen(true);
    if (this.#root.hidden) {
      this.#root.hidden = false;
      this.#log.hidden = true;
      this.#them.who = null;
      this.#startBlinking();
    }
    if (node.slug !== undefined) {
      this.#log.replaceChildren();
      this.#slug.textContent = storyT(node.slug);
      this.#entry('story-slug', storyT(node.slug));
    }
    if (node.action !== undefined) beats.push({ kind: 'action', text: storyT(node.action), notes: [] });
    for (const line of visibleLines(node, marks)) {
      beats.push({ kind: 'line', who: line.who, text: storyT(line.text), paren: line.paren === undefined ? undefined : storyT(line.paren), face: faceOf(line), notes: [] });
    }
    if (node.after !== undefined) beats.push({ kind: 'action', text: storyT(node.after), notes: [] });
    const first = beats[0];
    if (first !== undefined && opening.length > 0) beats[0] = { ...first, notes: [...first.notes, ...opening] };
    this.#meetThem(beats);
    this.#renderTools();
    void this.#play(node, id, marks, beats, ++this.#token);
  }

  hide(): void {
    this.#token++;
    this.#seq = -1;
    this.#node = '';
    this.#waitingChoice = null;
    this.#offered = null;
    this.#held = [];
    this.#release();
    this.#pending = [];
    this.#root.hidden = true;
    audio.setDialogueOpen(false);
    this.#log.replaceChildren();
    this.#choices.replaceChildren();
    this.#slug.textContent = '';
    this.#them.who = null;
    this.#them.root.replaceChildren();
    this.#rook.who = null;
    this.#rook.root.replaceChildren();
    window.clearTimeout(this.#blinkTimer);
  }

  // A remembered choice or a clue, shown under the line that caused it.
  note(mark: string): void {
    if (this.act.marks[mark] === undefined || !this.open) return;
    if (this.#offered !== null) this.#held.push(mark);
    else this.#showNote(mark);
  }

  // Space, Enter or a tap: finish the line being typed, then the next line, then move on when there is nothing to choose.
  next(): void {
    if (this.#typing) {
      this.#skipTyping = true;
      return;
    }
    const tap = this.#tap;
    if (tap !== null) {
      this.#tap = null;
      tap();
      return;
    }
    if (!this.#canAdvance) return;
    this.#canAdvance = false;
    this.#read = true;
    this.#more.hidden = true;
    this.#hint.textContent = this.#crew > 1 ? t('dialogue.waiting') : '';
    this.onAdvance(this.#node);
  }

  set crew(size: number) {
    this.#crew = Math.max(1, size);
  }

  /** The clock on the choice on screen has started, or is not running yet. */
  set answering(on: boolean) {
    this.#answering = on;
    if (on) this.#runClock();
    this.#renderChoiceHint();
  }

  // Who in the crew has voted for what on the choice on screen, and how many have read the scene through.
  crewStatus(votes: ReadonlyMap<string, readonly string[]>, mine: string | null, ready: number): void {
    this.#ready = ready;
    if (this.#offered !== null) {
      this.#choices.querySelectorAll<HTMLButtonElement>('button.story-choice').forEach((b) => {
        const id = b.dataset['choice'] ?? '';
        b.classList.toggle('voted', id === mine);
        b.setAttribute('aria-pressed', String(id === mine));
        const tally = b.querySelector('.story-votes');
        if (tally !== null) tally.textContent = this.#crew > 1 ? (votes.get(id) ?? []).join(', ') : '';
      });
      this.#renderChoiceHint();
    } else if (this.#read && this.#crew > 1) {
      this.#hint.textContent = t('dialogue.waitingCount', { ready: String(ready), crew: String(this.#crew) });
    }
  }

  // Number keys pick a choice.
  pick(n: number): void {
    const button = this.#choices.querySelectorAll('button.story-choice')[n - 1];
    if (button instanceof HTMLButtonElement) button.click();
  }

  async #play(node: ScriptNode, id: string, marks: ReadonlySet<string>, beats: readonly Beat[], token: number): Promise<void> {
    this.#pending = [...beats];
    const choices = visibleChoices(node, marks);
    while (this.#pending.length > 0) {
      if (token !== this.#token) return;
      const beat = this.#pending.shift();
      if (beat === undefined) break;
      await this.#perform(beat, token);
      if (token !== this.#token) return;
      if (this.#pending.length === 0 && choices.length > 0) break;
      await this.#awaitTap(beat);
      if (token !== this.#token) return;
    }
    if (choices.length > 0) {
      this.#offer(id, choices, node.seconds);
      this.onAdvance(id);
      return;
    }
    this.#canAdvance = true;
    this.next();
  }

  // Puts a beat on stage: who is speaking and how, then types the line.
  async #perform(beat: Beat, token: number): Promise<void> {
    this.#notes.replaceChildren();
    this.#more.hidden = true;
    if (beat.kind === 'action') {
      this.#speaking(null);
      this.#name.textContent = '';
      this.#name.style.removeProperty('--who');
      this.#direction.textContent = '';
      this.#now.className = 'story-now story-now-action';
      this.#entry('story-action', beat.text);
    } else {
      const slot = beat.who === 'rook' ? this.#rook : this.#them;
      this.#paint(slot, beat.who, beat.face, beat.who === 'rook' ? -1 : 1);
      this.#speaking(slot);
      const sitter = sitterFor(beat.who, this.#rookSitter);
      this.#name.textContent = storyT(SPEAKER_NAMES[beat.who]);
      this.#name.style.setProperty('--who', sitterColor(sitter));
      this.#direction.textContent = beat.paren === undefined ? '' : `(${beat.paren})`;
      this.#now.className = `story-now story-face-${beat.face}`;
      this.#logLine(beat.who, beat.text, beat.paren);
    }
    for (const mark of beat.notes) this.#showNote(mark);
    await this.#typeLine(beat, token);
  }

  // Waits for Space or a tap before the next beat, or for long enough to read it when auto is on.
  #awaitTap(beat: Beat): Promise<void> {
    this.#more.hidden = false;
    this.#hint.textContent = this.#auto ? '' : t('dialogue.continue');
    return new Promise((resolve) => {
      let timer = 0;
      const done = (): void => {
        window.clearTimeout(timer);
        this.#more.hidden = true;
        this.#hint.textContent = '';
        resolve();
      };
      this.#tap = done;
      if (this.#auto) {
        timer = window.setTimeout(() => {
          if (this.#tap === done) {
            this.#tap = null;
            done();
          }
        }, holdMs(beat.text, this.#speed));
      }
    });
  }

  async #typeLine(beat: Beat, token: number): Promise<void> {
    this.#typing = true;
    this.#skipTyping = this.#reduced || this.#speed === 'instant';
    const chars = graphemes(beat.text);
    const slot = beat.kind === 'line' ? (beat.who === 'rook' ? this.#rook : this.#them) : null;
    let shown = '';
    for (let i = 0; i < chars.length; i++) {
      if (token !== this.#token) return;
      if (this.#skipTyping) break;
      const ch = chars[i] ?? '';
      shown += ch;
      this.#now.textContent = shown;
      if (slot?.art != null) showFrame(slot.art, /\p{L}/u.test(ch) && Math.floor(i / TALK_EVERY) % 2 === 0 ? 'talk' : 'rest');
      const wait = charDelayMs(ch, chars[i + 1], this.#speed);
      if (wait > 0) await this.#sleep(wait);
    }
    if (token !== this.#token) return;
    this.#now.textContent = beat.text;
    if (slot?.art != null) showFrame(slot.art, 'rest');
    this.#typing = false;
  }

  #sleep(ms: number): Promise<void> {
    return this.#skipTyping ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
  }

  #offer(id: string, choices: readonly ScriptChoice[], seconds: number | undefined): void {
    this.#waitingChoice = id;
    this.#more.hidden = true;
    const buttons = choices.map((c, i) => {
      const b = h('button', 'story-choice');
      b.type = 'button';
      b.dataset['choice'] = c.id;
      b.append(h('kbd', '', String(i + 1)), h('em', '', storyT(c.tag)), document.createTextNode(storyT(c.text)), h('span', 'story-votes'));
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
    this.#clockSeconds = seconds;
    if (seconds !== undefined) {
      const bar = h('div', 'story-timer');
      bar.append(h('i'));
      this.#choices.append(bar);
    }
    if (this.#answering) this.#runClock();
    this.#renderChoiceHint();
    buttons[0]?.focus({ preventScroll: true });
  }

  #runClock(): void {
    const seconds = this.#clockSeconds;
    const fill = this.#choices.querySelector('.story-timer i');
    if (this.#clockRunning || seconds === undefined || !(fill instanceof HTMLElement)) return;
    this.#clockRunning = true;
    fill.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: seconds * 1000, fill: 'forwards' });
  }

  #renderChoiceHint(): void {
    if (this.#offered === null || this.#waitingChoice === null) return;
    if (this.#crew > 1 && !this.#answering) this.#hint.textContent = t('dialogue.crewReading', { ready: String(this.#ready), crew: String(this.#crew) });
    else if (this.#crew > 1) this.#hint.textContent = t('dialogue.crewVotes');
    else this.#hint.textContent = this.#clockSeconds !== undefined ? t('dialogue.timed') : '';
  }

  // Lines the server moved past before they were read go straight into the history, so nothing is lost.
  #flush(): void {
    this.#release();
    for (const beat of this.#pending) {
      if (beat.kind === 'action') this.#entry('story-action', beat.text);
      else this.#logLine(beat.who, beat.text, beat.paren);
      for (const mark of beat.notes) this.#logNote(mark);
    }
    this.#pending = [];
    this.#typing = false;
  }

  // Lets a wait for a tap from a scene that has moved on finish, so its reading loop ends instead of hanging.
  #release(): void {
    const tap = this.#tap;
    this.#tap = null;
    tap?.();
  }

  // Seats the node's first speaker other than Rook opposite Rook before anyone speaks, so the scene opens on both.
  #meetThem(beats: readonly Beat[]): void {
    const other = beats.find((b): b is Extract<Beat, { kind: 'line' }> => b.kind === 'line' && b.who !== 'rook');
    if (other !== undefined && this.#them.who === null) this.#paint(this.#them, other.who, other.face, 1);
    if (this.#rook.who === null) this.#paint(this.#rook, 'rook', 'calm', -1);
  }

  #paint(slot: Slot, who: Speaker, face: Face, facing: 1 | -1): void {
    const sitter = sitterFor(who, this.#rookSitter);
    const art = portrait(sitter, face, facing);
    showFrame(art, 'rest');
    const arriving = slot.who !== who;
    slot.who = who;
    slot.face = face;
    if (slot.art !== art) {
      slot.root.replaceChildren(art);
      slot.art = art;
    }
    slot.root.style.setProperty('--who', sitterColor(sitter));
    if (arriving && !this.#reduced) slot.root.animate([{ opacity: 0, translate: '0 10px', scale: '0.86' }, { opacity: 1, translate: '0 0', scale: '1' }], { duration: 300, easing: 'ease-out' });
  }

  #speaking(slot: Slot | null): void {
    for (const s of [this.#them, this.#rook]) s.root.classList.toggle('speaking', s === slot);
  }

  #startBlinking(): void {
    window.clearTimeout(this.#blinkTimer);
    if (this.#reduced) return;
    const gaps = READING.blinkEveryMs;
    this.#blinkTimer = window.setTimeout(() => {
      if (this.#root.hidden) return;
      for (const slot of [this.#them, this.#rook]) {
        const art = slot.art;
        if (art === null || art.getAttribute('data-frame') === 'talk') continue;
        showFrame(art, 'blink');
        window.setTimeout(() => {
          if (art.getAttribute('data-frame') === 'blink') showFrame(art, 'rest');
        }, READING.blinkMs);
      }
      this.#blinks++;
      this.#startBlinking();
    }, gaps[this.#blinks % gaps.length] ?? 3_000);
  }

  #showNote(mark: string): void {
    const text = this.#noteText(mark);
    if (text === null) return;
    this.#notes.append(h('span', text.cls, text.text));
    this.#entry(text.cls, text.text);
  }

  #logNote(mark: string): void {
    const text = this.#noteText(mark);
    if (text !== null) this.#entry(text.cls, text.text);
  }

  #noteText(mark: string): { cls: string; text: string } | null {
    const m = this.act.marks[mark];
    if (m === undefined || (m.clue !== true && m.who === undefined)) return null;
    if (m.clue === true) return { cls: 'story-clue', text: t('dialogue.clue', { text: storyT(m.text) }) };
    return { cls: 'story-memory', text: m.who === 'rook' ? t('dialogue.youRemember') : t('dialogue.remembers', { name: storyT(SPEAKER_NAMES[m.who ?? 'rook']) }) };
  }

  #logLine(who: Speaker, text: string, paren: string | undefined): void {
    const p = h('p', `story-line story-${who}`);
    p.append(h('span', 'story-who', storyT(SPEAKER_NAMES[who])));
    if (paren !== undefined) p.append(h('span', 'story-paren', `(${paren})`));
    p.append(h('span', 'story-say', text));
    p.style.setProperty('--who', sitterColor(sitterFor(who, this.#rookSitter)));
    this.#push(p);
  }

  #entry(cls: string, text: string): HTMLElement {
    const p = h('p', cls, text);
    this.#push(p);
    return p;
  }

  #push(node: HTMLElement): void {
    this.#log.append(node);
    while (this.#log.childElementCount > MAX_ENTRIES) this.#log.firstElementChild?.remove();
    if (!this.#log.hidden) this.#log.scrollTop = this.#log.scrollHeight;
  }

  #renderTools(): void {
    this.#autoButton.textContent = t('dialogue.auto');
    this.#autoButton.setAttribute('aria-pressed', String(this.#auto));
    this.#speedButton.textContent = t('dialogue.speed', { speed: t(SPEED_KEYS[this.#speed]) });
    this.#historyButton.textContent = t('dialogue.history');
    this.#historyButton.setAttribute('aria-expanded', String(!this.#log.hidden));
  }

  #savePrefs(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ speed: this.#speed, auto: this.#auto }));
    } catch {
      // Storage blocked: the setting lasts for this visit only.
    }
  }
}
