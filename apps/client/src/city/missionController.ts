// Runs a story mission: the private mission room and its crew, the dialogue, the objective, the act's work (digging
// at the tip, asking guardians to sign), and the end card. The server decides everything; this only sends moves,
// votes and work, and draws what comes back.
import { Callbacks } from '@colyseus/sdk';
import { formatRoomCode, isRoomCode } from '@byzantine-council/shared';
import {
  CaughtLineSchema,
  DUMP_ACT,
  MISSION_MESSAGES,
  MissionNoteSchema,
  MissionResultSchema,
  SPEAKER_NAMES,
  actOf,
  canWork,
  workLabel,
  nightAt,
  type ActId,
  type CityPlayer,
  type MissionNpc,
  type MissionResult,
  type MissionSpot,
  type Speaker,
  type StoryAct,
} from '@byzantine-council/shared/city';
import { audio } from '../audio/engine.js';
import type { PlayerInput } from '../game/input.js';
import { cssColor, seatColors } from '../game/palette.js';
import { inviteLink } from '../net/invite.js';
import type { Session } from '../net/session.js';
import type { ProfileApi, ProfileSummary } from '../profile/api.js';
import { el, h } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { storyT } from '../i18n/story.js';
import type { CityScene } from './CityScene.js';
import { drawMapDot, paintMinimap } from './cityController.js';
import { Dialogue } from './dialogue.js';

type MissionRoom = Awaited<ReturnType<Session['mission']>>;

export class MissionController {
  readonly #hud = el('story-hud', HTMLElement);
  readonly #objective = el('story-objective', HTMLElement);
  readonly #clues = el('story-clues', HTMLElement);
  readonly #caught = el('story-caught', HTMLElement);
  readonly #dig = el('story-dig', HTMLButtonElement);
  readonly #dots = el('story-dots', HTMLCanvasElement);
  readonly #end = el('story-end', HTMLElement);
  readonly #code = el('story-code', HTMLElement);
  readonly #invite = el('story-invite', HTMLButtonElement);
  readonly #crewList = el('story-crew', HTMLElement);
  readonly #goal = el('story-goal', HTMLElement);
  readonly #clock = el('story-clock', HTMLElement);
  readonly #dialogue = new Dialogue();
  #room: MissionRoom | null = null;
  #marks = new Set<string>();
  #step = 'call';
  #act: StoryAct = DUMP_ACT;
  #near = -1;
  #found: string[] = [];
  #poll = 0;
  #codeValue = '';
  #crewSeen = false;
  #digHeap = -1;
  #actShown = false;
  onLeft: () => void = () => undefined;
  onToast: (text: string) => void = () => undefined;
  onProfile: (p: ProfileSummary) => void = () => undefined;
  // The end card's finale button: what comes after the story, such as a council match.
  onFinale: () => void = () => undefined;

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
    el('story-finale', HTMLButtonElement).addEventListener('click', () => {
      void this.leave().then(() => {
        this.onFinale();
      });
    });
    this.#dig.addEventListener('click', () => {
      this.#startDig();
    });
    this.#invite.addEventListener('click', () => {
      void this.#copyInvite();
    });
    this.#dialogue.onChoose = (node, choice) => {
      this.#room?.send('choose', { node, choice });
    };
    this.#dialogue.onAdvance = (node) => {
      this.#room?.send('advance', { node });
    };
    this.#dialogue.onSpeaker = (who) => {
      this.scene.mission?.speaking(who === 'rook' ? null : who);
      this.scene.talking(who === 'rook' ? this.scene.myId : null);
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

  /** The act being played (or last played), e.g. for tagging feedback. */
  get actId(): string {
    return this.#act.id;
  }

  get active(): boolean {
    return this.#room !== null;
  }

  // Starts a new night of the given act, or joins a friend's crew (whatever act it is playing) by its room id.
  async enter(nickname: string, start: { readonly act?: ActId; readonly roomId?: string }): Promise<void> {
    const room = await this.session.mission(nickname, start);
    this.#setAct(actOf(room.state.act));
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
      if (id === room.sessionId) this.#dialogue.dressRook(player.seat, { hat: player.hat, shades: player.shades, outfit: player.outfit });
      callbacks.onChange(player, () => {
        this.scene.updatePlayer(id, player);
      });
      this.#renderCrew();
      if (id !== room.sessionId && this.#crewSeen) this.onToast(t('mission.joined', { name: player.name }));
    });
    callbacks.onRemove('players', (p: CityPlayer, id: string) => {
      this.scene.removePlayer(id);
      this.#renderCrew();
      if (id !== room.sessionId) this.onToast(t('mission.left', { name: p.name }));
    });
    callbacks.listen('lead', () => {
      this.#renderCrew();
    });
    callbacks.listen('code', (code: string) => {
      this.#codeValue = isRoomCode(code) ? code : '';
      this.#renderCode();
    });
    callbacks.onAdd('votes', () => {
      this.#renderCrewStatus();
    });
    callbacks.onRemove('votes', () => {
      this.#renderCrewStatus();
    });
    callbacks.onChange('votes', () => {
      this.#renderCrewStatus();
    });
    callbacks.listen('ready', () => {
      this.#renderCrewStatus();
    });
    callbacks.listen('answering', (on: boolean) => {
      this.#dialogue.answering = on;
    });
    callbacks.onAdd('npcs', (npc: MissionNpc, id: string) => {
      view?.setNpc(id, npc);
      callbacks.onChange(npc, () => {
        view?.setNpc(id, npc);
      });
    });
    callbacks.listen('act', (act: string) => {
      this.#setAct(actOf(act));
    });
    callbacks.onAdd('spots', (spot: MissionSpot, index: number) => {
      this.#found[index] = spot.note;
      view?.setSpot(index, spot.done);
      callbacks.onChange(spot, () => {
        view?.setSpot(index, spot.done);
        this.#diggers(room);
        this.#renderGoal();
        if (spot.note !== '' && spot.note !== this.#found[index]) {
          this.#found[index] = spot.note;
          this.#dug(storyT(spot.note));
        }
      });
    });
    callbacks.listen('clock', (seconds: number) => {
      this.#renderClock(seconds);
    });
    callbacks.listen('step', (step: string) => {
      this.#setStep(step);
    });
    callbacks.listen('caught', (n: number) => {
      this.#caught.textContent = n > 0 ? t('mission.caught', { n: String(n) }) : '';
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
      const catcher = this.#act.catchers[line.data.by];
      if (catcher === undefined) return;
      if (line.data.name !== undefined) {
        this.onToast(t('mission.caughtCrew', { catcher: storyT(catcher.name), name: line.data.name, where: storyT(catcher.where) }));
        return;
      }
      audio.play('refuse');
      this.onToast(storyT(catcher.lines[Math.min(catcher.lines.length - 1, line.data.count - 1)] ?? ''));
    });
    room.onMessage(MISSION_MESSAGES.NOTE, (payload: unknown) => {
      const note = MissionNoteSchema.safeParse(payload);
      if (!note.success) return;
      audio.play('refuse');
      this.onToast(storyT(note.data.text));
    });
    room.onMessage(MISSION_MESSAGES.DUNCAN, () => {
      audio.play('whiff');
      this.onToast(t('mission.duncanHeard'));
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
    this.#crewSeen = true;
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
    this.#actShown = false;
    this.#goal.textContent = '';
    this.#clock.textContent = '';
    this.#near = -1;
    this.#clues.replaceChildren();
    this.#crewList.replaceChildren();
    this.#codeValue = '';
    this.#crewSeen = false;
    this.#digHeap = -1;
    this.#renderCode();
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
    this.#dialogue.show(node, seq, this.#marks, this.#room?.state.said ?? '');
    this.#renderCrewStatus();
  }

  // Lights the heap each crew member is digging, and runs the bar on the dig button for this player's own.
  #diggers(room: MissionRoom): void {
    let mine = -1;
    const digging: number[] = [];
    room.state.spots.forEach((spot, i) => {
      if (spot.worker === '') return;
      digging.push(i);
      if (spot.worker === room.sessionId) mine = i;
    });
    this.scene.mission?.setDigging(digging);
    if (mine === this.#digHeap) return;
    this.#digHeap = mine;
    this.#dig.classList.toggle('digging', mine >= 0);
    if (mine >= 0) {
      audio.play(this.#act.markers === 'heaps' ? 'stepSand' : 'click');
      this.#dig.style.setProperty('--dig-ms', `${String(this.#act.workMs)}ms`);
    }
  }

  #renderCrew(): void {
    const room = this.#room;
    if (room === null) return;
    const items = [...room.state.players.entries()]
      .sort(([, a], [, b]) => a.seat - b.seat)
      .map(([id, p]) => {
        const li = h('li');
        const dot = h('i');
        dot.style.setProperty('--seat', cssColor(seatColors(p.seat).lit));
        li.append(dot, document.createTextNode(id === room.sessionId ? t('mission.youNamed', { name: p.name }) : p.name));
        if (id === room.state.lead) li.append(h('small', '', 'lead'));
        return li;
      });
    this.#crewList.replaceChildren(...(items.length > 1 ? items : []));
    this.#dialogue.crew = room.state.players.size;
    this.#renderCrewStatus();
  }

  #renderCrewStatus(): void {
    const room = this.#room;
    if (room === null) return;
    const votes = new Map<string, string[]>();
    room.state.votes.forEach((choice, id) => {
      const name = id === room.sessionId ? t('mission.you') : (room.state.players.get(id)?.name ?? '');
      const list = votes.get(choice) ?? [];
      list.push(name);
      votes.set(choice, list);
    });
    this.#dialogue.crewStatus(votes, room.state.votes.get(room.sessionId) ?? null, room.state.ready);
  }

  // Streamer mode hides the code on screen; the invite link is still copied, so it can be sent privately.
  #renderCode(): void {
    const streaming = document.documentElement.dataset['streamer'] === 'on';
    this.#code.textContent = this.#codeValue === '' ? '······' : streaming ? '•••-•••' : formatRoomCode(this.#codeValue);
    this.#invite.disabled = this.#codeValue === '' || this.#act.closed.includes(this.#step);
  }

  async #copyInvite(): Promise<void> {
    if (this.#codeValue === '') return;
    const link = inviteLink(window.location.href, this.#codeValue);
    try {
      await navigator.clipboard.writeText(link);
      this.onToast(t('mission.copied'));
    } catch {
      this.onToast(document.documentElement.dataset['streamer'] === 'on' ? t('mission.copyFailedStreamer') : t('mission.copyFailed', { code: formatRoomCode(this.#codeValue) }));
    }
  }

  // Steps where the crew walks about: going somewhere, working the act's spots, or sneaking.
  #free(): boolean {
    return this.#act.arrivals[this.#step] !== undefined || this.#step === this.#act.workStep;
  }

  #setAct(act: StoryAct): void {
    if (act === this.#act && this.#actShown) return;
    this.#act = act;
    this.#actShown = true;
    this.#dialogue.act = act;
    this.scene.mission?.setAct(act);
    this.#room?.state.spots.forEach((spot, i) => {
      this.scene.mission?.setSpot(i, spot.done);
    });
    this.scene.mission?.setDark(nightAt(act, this.#step));
    el('story-eyebrow', HTMLElement).textContent = act.kind === 'case' ? t('mission.eyebrowCase', { title: storyT(act.title) }) : t('mission.eyebrowAct', { number: storyT(act.number), title: storyT(act.title) });
    this.#hud.setAttribute('aria-label', act.kind === 'case' ? t('mission.caseAria', { title: storyT(act.title) }) : t('mission.storyAria', { number: storyT(act.number).toLowerCase() }));
    this.#objective.textContent = storyT(act.objectives[this.#step] ?? '');
  }

  #setStep(step: string): void {
    const before = this.#step;
    this.#step = step;
    this.#renderCode();
    this.#renderGoal();
    this.#objective.textContent = storyT(this.#act.objectives[step] ?? '');
    this.scene.mission?.setTarget(this.#act.targets[step] ?? null);
    this.scene.mission?.setDark(nightAt(this.#act, step));
    if (step === this.#act.workStep) {
      audio.setMood('proposals');
      this.onToast(storyT(this.#act.hint));
    }
    if (step === 'sneak') audio.setMood('proposals');
    if (before === this.#act.workStep && step !== before) {
      audio.setMood('story');
      audio.play('taskDone');
    }
    this.input.enabled = this.#room !== null && this.#free() && !this.#dialogue.open;
  }

  // Progress on the act's work, when it has a goal: "Signatures: 2 of 3".
  // The act's clock, if one is running: what it counts down to, in minutes and seconds.
  #renderClock(seconds: number): void {
    const label = this.#act.clockLabel;
    if (seconds <= 0 || label === undefined) {
      this.#clock.textContent = '';
      return;
    }
    this.#clock.textContent = `${storyT(label)} ${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
    this.#clock.classList.toggle('short', seconds <= 30);
  }

  #renderGoal(): void {
    const room = this.#room;
    const goal = this.#act.workGoal;
    if (room === null || goal === 0 || this.#step !== this.#act.workStep) {
      this.#goal.textContent = '';
      return;
    }
    let n = 0;
    room.state.spots.forEach((spot, i) => {
      if (spot.done && this.#act.spots[i]?.refuses !== true) n++;
    });
    this.#goal.textContent = t('mission.goal', { label: this.#act.goalLabel === undefined ? t('common.done') : storyT(this.#act.goalLabel), n: String(Math.min(n, goal)), goal: String(goal) });
  }

  #dug(found: string): void {
    audio.play(this.#act.markers === 'heaps' ? 'taskFail' : 'taskDone');
    this.onToast(found);
  }

  #startDig(): void {
    if (this.#dig.hidden || this.#near < 0) return;
    this.#room?.send('work', { spot: this.#near });
  }

  #renderClues(): void {
    const clues = [...this.#marks].flatMap((m) => {
      const mark = this.#act.marks[m];
      return mark?.clue === true ? [storyT(mark.text)] : [];
    });
    this.#clues.replaceChildren(...clues.map((c) => h('li', '', c)));
  }

  #render(): void {
    const room = this.#room;
    const pos = this.scene.predictedPosition();
    if (room === null || pos === null) return;
    this.#renderCode();
    this.#renderCrewStatus();
    let near = -1;
    const act = this.#act;
    if (this.#step === act.workStep && !this.#dialogue.open) {
      near = act.spots.findIndex((spot, i) => room.state.spots[i]?.done !== true && canWork(pos, spot, act.workReach));
    }
    if (near !== this.#near) this.#near = near;
    const spot = act.spots[near];
    this.#dig.hidden = spot === undefined;
    if (spot !== undefined) this.#dig.firstChild?.replaceWith(document.createTextNode(workLabel(act, spot, storyT)));
    const ctx = this.#dots.getContext('2d');
    if (ctx === null) return;
    this.#dots.width = el('story-minimap', HTMLCanvasElement).width;
    this.#dots.height = el('story-minimap', HTMLCanvasElement).height;
    const target = act.targets[this.#step];
    if (target !== undefined) drawMapDot(ctx, target, '#ffd27a', 5);
    room.state.players.forEach((p, id) => {
      if (id !== room.sessionId) drawMapDot(ctx, p, cssColor(seatColors(p.seat).lit), 3);
    });
    drawMapDot(ctx, pos, '#fff1de', 3.5);
  }

  #ending(r: MissionResult): void {
    audio.play('rankUp');
    const who = new Map<string, string[]>();
    for (const m of this.#marks) {
      const mark = this.#act.marks[m];
      if (mark?.who === undefined || mark.who === 'rook') continue;
      const list = who.get(mark.who) ?? [];
      list.push(storyT(mark.text));
      who.set(mark.who, list);
    }
    const act = this.#act;
    const voice = (k: string): string => (k === 'voice' ? t('mission.voiceOnPhone') : storyT(SPEAKER_NAMES[k as Speaker]));
    el('story-remembers', HTMLElement).replaceChildren(...[...who].map(([k, list]) => h('li', '', t('mission.remembers', { who: voice(k), list: list.join('; ') }))));
    el('story-honest', HTMLElement).textContent = t(r.honest ? 'mission.honest' : 'mission.dishonest');
    const number = act.kind === 'case' ? t('mission.theCase') : storyT(act.number).toLowerCase();
    const reward: Record<MissionResult['reason'], string> = {
      paid: r.paid > 0 ? t('mission.paid', { sats: String(r.paid), act: number }) : t('mission.saved', { act: storyT(act.kind === 'case' ? act.title : act.number) }),
      replay: t('mission.replay'),
      noProfile: t('mission.noProfile', { sats: String(act.rewardSats) }),
      error: t('mission.error'),
    };
    el('story-end-eyebrow', HTMLElement).textContent = act.kind === 'case' ? t('mission.caseClosed') : t('mission.endOf', { act: number });
    el('story-end-title', HTMLElement).textContent = storyT(act.title);
    el('story-lesson', HTMLElement).textContent = storyT(act.lesson);
    el('story-end-next', HTMLElement).textContent = storyT(act.next);
    const finale = el('story-finale', HTMLButtonElement);
    finale.hidden = act.finale === undefined;
    finale.textContent = storyT(act.finale ?? '');
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
