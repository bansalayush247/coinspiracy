// Runs a story mission: the private mission room, the dialogue, the objective, digging at the tip, and the
// end card. The server decides everything; this only sends moves, choices and digs, and draws what comes back.
import { Callbacks } from '@colyseus/sdk';
import type { Vec2 } from '@byzantine-council/shared';
import {
  CaughtLineSchema,
  DANI_SPOT,
  DIG_MS,
  DUMP_MARKS,
  DUMP_OBJECTIVES,
  DUMP_REWARD_SATS,
  GATE_SPOT,
  HEAPS,
  MISSION_MESSAGES,
  MissionResultSchema,
  canDig,
  type CaughtLine,
  type CityPlayer,
  type DumpStep,
  type MissionHeap,
  type MissionNpc,
  type MissionResult,
} from '@byzantine-council/shared/city';
import { audio } from '../audio/engine.js';
import type { PlayerInput } from '../game/input.js';
import type { Session } from '../net/session.js';
import type { ProfileApi, ProfileSummary } from '../profile/api.js';
import { el, h } from '../ui/dom.js';
import type { CityScene } from './CityScene.js';
import { drawMapDot, paintMinimap } from './cityController.js';
import { Dialogue } from './dialogue.js';

type MissionRoom = Awaited<ReturnType<Session['mission']>>;

const TARGETS: Readonly<Partial<Record<DumpStep, Vec2>>> = { toDani: DANI_SPOT, toTip: GATE_SPOT };

const CAUGHT_LINES: Readonly<Record<CaughtLine['by'], readonly string[]>> = {
  guard: [
    'Ivor: “Oi! Gate! Now! And wipe your feet.”',
    'Ivor: “You again. I’m writing this down. I’m not, but I could.”',
    'Ivor: “Third time. Mags says you’re ‘persistent’. I say you’re paperwork.”',
  ],
  duncan: [
    'Duncan sits on you. Mags walks you back to the gate, tutting.',
    'Duncan licks your whole face, then escorts you out. He has principles.',
    'Duncan brings you back to the gate by the sleeve. Mags: “He likes you. That’s worse.”',
  ],
};

export class MissionController {
  readonly #hud = el('story-hud', HTMLElement);
  readonly #objective = el('story-objective', HTMLElement);
  readonly #clues = el('story-clues', HTMLElement);
  readonly #caught = el('story-caught', HTMLElement);
  readonly #dig = el('story-dig', HTMLButtonElement);
  readonly #dots = el('story-dots', HTMLCanvasElement);
  readonly #end = el('story-end', HTMLElement);
  readonly #dialogue = new Dialogue();
  #room: MissionRoom | null = null;
  #marks = new Set<string>();
  #step: DumpStep = 'call';
  #near = -1;
  #found: string[] = [];
  #poll = 0;
  onLeft: () => void = () => undefined;
  onToast: (text: string) => void = () => undefined;
  onProfile: (p: ProfileSummary) => void = () => undefined;

  constructor(
    private readonly session: Session,
    private readonly profiles: ProfileApi,
    private readonly scene: CityScene,
    private readonly input: PlayerInput,
  ) {
    paintMinimap(el('story-minimap', HTMLCanvasElement));
    el('story-leave', HTMLButtonElement).addEventListener('click', () => {
      void this.leave();
    });
    el('story-end-leave', HTMLButtonElement).addEventListener('click', () => {
      void this.leave();
    });
    this.#dig.addEventListener('click', () => {
      this.#startDig();
    });
    this.#dialogue.onChoose = (node, choice) => {
      this.#room?.send('choose', { node, choice });
    };
    this.#dialogue.onAdvance = (node) => {
      this.#room?.send('advance', { node });
    };
    window.addEventListener('keydown', (e) => {
      if (this.#room === null || this.#hud.hidden || e.target instanceof HTMLInputElement) return;
      if (this.#dialogue.open) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          if (!(document.activeElement instanceof HTMLButtonElement && document.activeElement.classList.contains('story-choice'))) this.#dialogue.next();
          return;
        }
        const n = Number(e.key);
        if (Number.isInteger(n) && n >= 1 && n <= 4) this.#dialogue.pick(n);
        return;
      }
      if ((e.key === 'e' || e.key === 'E') && !e.repeat) this.#startDig();
    });
  }

  get active(): boolean {
    return this.#room !== null;
  }

  async enter(nickname: string): Promise<void> {
    const room = await this.session.mission(nickname);
    this.#room = room;
    this.scene.attach(room.sessionId, this.input, {
      get canSend() {
        return room.connection.isOpen;
      },
      send: (input) => {
        room.send('move', input);
      },
    });
    const view = this.scene.mission;
    const callbacks = Callbacks.get(room);
    callbacks.onAdd('players', (player: CityPlayer, id: string) => {
      this.scene.addPlayer(id, player);
      callbacks.onChange(player, () => {
        this.scene.updatePlayer(id, player);
      });
    });
    callbacks.onRemove('players', (_p: CityPlayer, id: string) => {
      this.scene.removePlayer(id);
    });
    callbacks.onAdd('npcs', (npc: MissionNpc, id: string) => {
      view?.setNpc(id, npc);
      callbacks.onChange(npc, () => {
        view?.setNpc(id, npc);
      });
    });
    callbacks.onAdd('heaps', (heap: MissionHeap, index: number) => {
      this.#found[index] = heap.found;
      view?.setHeap(index, heap.dug);
      callbacks.onChange(heap, () => {
        view?.setHeap(index, heap.dug);
        if (heap.found !== '' && heap.found !== this.#found[index]) {
          this.#found[index] = heap.found;
          this.#dug(heap.found);
        }
      });
    });
    callbacks.listen('step', (step: string) => {
      this.#setStep(step as DumpStep);
    });
    callbacks.listen('digging', (heap: number) => {
      view?.setDigging(heap);
      this.#dig.classList.toggle('digging', heap >= 0);
      if (heap >= 0) {
        audio.play('stepSand');
        this.#dig.style.setProperty('--dig-ms', `${String(DIG_MS)}ms`);
      }
    });
    callbacks.listen('caught', (n: number) => {
      this.#caught.textContent = n > 0 ? `Caught ${String(n)}×` : '';
    });
    callbacks.onAdd('marks', (mark: string) => {
      if (this.#marks.has(mark)) return;
      this.#marks.add(mark);
      this.#dialogue.note(mark);
      this.#renderClues();
    });
    const scene = (): void => {
      queueMicrotask(() => {
        if (this.#room === room) this.#scene(room.state.node, room.state.seq);
      });
    };
    callbacks.listen('seq', scene);
    callbacks.listen('node', scene);
    room.onMessage(MISSION_MESSAGES.CAUGHT, (payload: unknown) => {
      const line = CaughtLineSchema.safeParse(payload);
      if (!line.success) return;
      const lines = CAUGHT_LINES[line.data.by];
      audio.play('refuse');
      this.onToast(lines[Math.min(lines.length - 1, line.data.count - 1)] ?? '');
    });
    room.onMessage(MISSION_MESSAGES.DUNCAN, () => {
      audio.play('whiff');
      this.onToast('A chain rattles behind the gatehouse. Duncan heard the digging.');
    });
    room.onMessage(MISSION_MESSAGES.RESULT, (payload: unknown) => {
      const result = MissionResultSchema.safeParse(payload);
      if (result.success) this.#ending(result.data);
    });
    room.onLeave(() => {
      this.#exit();
    });
    this.#hud.hidden = false;
    this.#end.hidden = true;
    this.input.enabled = false;
    audio.setMood('story');
    this.#poll = window.setInterval(() => {
      this.#render();
    }, 150);
    this.#render();
  }

  async leave(): Promise<void> {
    const room = this.#room;
    if (room === null) return;
    await room.leave().catch(() => undefined);
    this.#exit();
  }

  #exit(): void {
    if (this.#room === null) return;
    this.#room = null;
    window.clearInterval(this.#poll);
    this.#dialogue.hide();
    this.#marks = new Set();
    this.#found = [];
    this.#step = 'call';
    this.#near = -1;
    this.#clues.replaceChildren();
    this.#caught.textContent = '';
    this.#dig.hidden = true;
    this.#end.hidden = true;
    this.scene.detach();
    this.#hud.hidden = true;
    this.input.enabled = false;
    audio.setMood('menu');
    this.onLeft();
  }

  #scene(node: string, seq: number): void {
    if (node === '') {
      this.#dialogue.hide();
      this.input.enabled = this.#room !== null && this.#free();
      return;
    }
    this.input.enabled = false;
    if (node === 'pell' || node === 'selfie') audio.play('chirp');
    this.#dialogue.show(node, seq, this.#marks);
  }

  #free(): boolean {
    return this.#step === 'toDani' || this.#step === 'toTip' || this.#step === 'dig';
  }

  #setStep(step: DumpStep): void {
    this.#step = step;
    this.#objective.textContent = DUMP_OBJECTIVES[step];
    this.scene.mission?.setTarget(TARGETS[step] ?? null);
    if (step === 'dig') {
      audio.setMood('proposals');
      this.onToast('Find the right heap. Signs show the year and season.');
    }
    if (step === 'found') {
      audio.setMood('story');
      audio.play('taskDone');
    }
    this.input.enabled = this.#room !== null && this.#free() && !this.#dialogue.open;
  }

  #dug(found: string): void {
    audio.play('taskFail');
    this.onToast(found);
  }

  #startDig(): void {
    if (this.#dig.hidden || this.#near < 0) return;
    this.#room?.send('dig', { heap: this.#near });
  }

  #renderClues(): void {
    const clues = [...this.#marks].flatMap((m) => {
      const mark = DUMP_MARKS[m];
      return mark?.clue === true ? [mark.text] : [];
    });
    this.#clues.replaceChildren(...clues.map((c) => h('li', '', c)));
  }

  #render(): void {
    const room = this.#room;
    const pos = this.scene.predictedPosition();
    if (room === null || pos === null) return;
    let near = -1;
    if (this.#step === 'dig' && !this.#dialogue.open) {
      near = HEAPS.findIndex((heap, i) => room.state.heaps[i]?.dug !== true && canDig(pos, heap));
    }
    if (near !== this.#near) this.#near = near;
    const heap = HEAPS[near];
    this.#dig.hidden = heap === undefined;
    if (heap !== undefined) this.#dig.firstChild?.replaceWith(document.createTextNode(`Dig the ${heap.label} heap`));
    const ctx = this.#dots.getContext('2d');
    if (ctx === null) return;
    this.#dots.width = el('story-minimap', HTMLCanvasElement).width;
    this.#dots.height = el('story-minimap', HTMLCanvasElement).height;
    const target = TARGETS[this.#step];
    if (target !== undefined) drawMapDot(ctx, target, '#ffd27a', 5);
    drawMapDot(ctx, pos, '#fff1de', 3.5);
  }

  #ending(r: MissionResult): void {
    audio.play('rankUp');
    const who = new Map<string, string[]>();
    for (const m of this.#marks) {
      const mark = DUMP_MARKS[m];
      if (mark?.who === undefined || mark.who === 'rook') continue;
      const list = who.get(mark.who) ?? [];
      list.push(mark.text);
      who.set(mark.who, list);
    }
    const names: Record<string, string> = { dani: 'Dani', mags: 'Mags', pell: 'Mr Pell' };
    el('story-remembers', HTMLElement).replaceChildren(...[...who].map(([k, list]) => h('li', '', `${names[k] ?? k} remembers: ${list.join('; ')}.`)));
    el('story-honest', HTMLElement).textContent = r.honest ? 'You chose honesty at least once tonight. Someone at the tip noticed.' : 'You never once told the plain truth tonight. Someone at the tip noticed that too.';
    const reward: Record<MissionResult['reason'], string> = {
      paid: r.paid > 0 ? `+${String(r.paid)} play sats in your wallet for finishing act one.` : 'Act one is saved to your profile.',
      replay: 'Replayed: your choices are saved; the reward is only paid once.',
      noProfile: `Playing as a guest without a saved profile: nothing was saved, and the ${String(DUMP_REWARD_SATS)} play sats wait for a profile.`,
      error: 'Your progress couldn’t be saved just now.',
    };
    el('story-reward', HTMLElement).textContent = reward[r.reason];
    this.#end.hidden = false;
    this.#dig.hidden = true;
    if (r.reason === 'paid') {
      void this.profiles.profile().then((p) => {
        if (p !== null) this.onProfile(p);
      });
    }
    el('story-end-leave', HTMLButtonElement).focus({ preventScroll: true });
  }
}
