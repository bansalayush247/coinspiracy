// A story mission: a private instance of Port Concord where a crew of one to four, joined by code, plays one act of
// "The Cold Key". The room walks the act's script, counts the crew's votes, brings stragglers to scenes, times
// every dig or signature, sends caught players back, and pays each crew member's first finish once. What only the
// act knows (where the device is, how the guards walk) lives in its rules and never in the state.
import { StateView } from '@colyseus/schema';
import { ErrorCode, Room, ServerError, validate, type AuthContext, type Client } from '@colyseus/core';
import { CLOSE_CODES, MovePayloadSchema, SERVER_TICK_HZ, TICK_SECONDS, cryptoRandom, stepMovement, uniqueNickname, type RandomSource, type Vec2 } from '@byzantine-council/shared';
import { credit } from '@byzantine-council/shared/economy';
import {
  AdvancePayloadSchema,
  CAUGHT_MS,
  CITY_MAP,
  CREW_GATHER,
  CREW_MAX,
  CREW_VOTE_MS,
  ChoosePayloadSchema,
  CityPlayer,
  MISSION_MESSAGES,
  MissionJoinSchema,
  MissionSpot,
  MissionState,
  STORY_ACTS,
  WorkPayloadSchema,
  besideSpot,
  canWork,
  crewChoice,
  carriedMarks,
  honestIn,
  nextOf,
  readMs,
  visibleChoices,
  type ActId,
  type CaughtLine,
  type MissionResult,
  type ScriptNode,
  type StoryAct,
} from '@byzantine-council/shared/city';
import { VIEW_TAGS } from '@byzantine-council/shared/state';
import { ipKey } from '../clientIp.js';
import { InputQueue, type MoveInput } from '../inputQueue.js';
import { log } from '../logger.js';
import { roomPolicy } from '../policy.js';
import { profileIdFromCookieHeader } from '../profile/session.js';
import type { ProfileData, ProfileStore } from '../profile/store.js';
import { claimRoomCode, releaseRoomCode } from '../roomCodes.js';
import { holdSeat } from '../scaling/index.js';
import { DumpRules } from './acts/dumpRules.js';
import { FounderRules } from './acts/founderRules.js';
import { InsiderRules } from './acts/insiderRules.js';
import { RansomRules } from './acts/ransomRules.js';
import { near, type ActContext, type ActRules } from './acts/rules.js';

interface Auth {
  readonly nickname: string;
  readonly profileId: string | null;
}
type MissionClient = Client<{ auth: Auth }>;

interface Scene {
  readonly id: string;
  readonly node: ScriptNode;
  readonly enteredAt: number;
  readonly deadline: number | null;
  readonly autoAt: number | null;
  readonly voteBy: number | null;
}

interface Work {
  readonly spot: number;
  readonly at: Vec2;
  readonly until: number;
}

interface Member {
  readonly id: string;
  readonly client: MissionClient;
  readonly player: CityPlayer;
  readonly inputs: InputQueue;
  readonly profileId: string | null;
  lastActiveMs: number;
  caughtUntil: number;
  work: Work | null;
}

const IDLE_MS = 10 * 60_000;
const IDLE_CHECK_MS = 30_000;
const LIFETIME_MS = 60 * 60_000;
// The first scene waits a moment so the city has drawn before the phone rings.
const OPENING_MS = 1_200;
// Choices stay open a little past the clock the crew sees, so a last-moment click still counts.
const CHOICE_GRACE_MS = 1_500;
const AUTO_PAUSE_MS = 900;
const MIN_SKIP_MS = 300;
// Moving further than this from where you started working a spot stops the work.
const WORK_WOBBLE = 0.35;

const RULES: Readonly<Record<ActId, () => ActRules>> = { dump: () => new DumpRules(), ransom: () => new RansomRules(), insider: () => new InsiderRules(), founder: () => new FounderRules() };

export class MissionRoom extends Room<{ state: MissionState; client: MissionClient }> {
  override maxClients = CREW_MAX;
  override state = new MissionState();
  override maxMessagesPerSecond = 40;
  override seatReservationTimeout = 8;
  // Swapped in tests for a fixed sequence.
  random: RandomSource = cryptoRandom;
  act: StoryAct = STORY_ACTS.dump;
  rules: ActRules = new DumpRules();
  readonly #crew = new Map<string, Member>();
  #code = '';
  #scene: Scene | null = null;
  readonly #votes = new Map<string, string>();
  readonly #ready = new Set<string>();
  readonly #marks = new Set<string>();
  // Whoever the story is happening to right now: the one who arrived first, or dug the device up.
  #hero: string | null = null;
  #opened = false;
  #finished = false;
  #quiet = false;
  #ctx: ActContext = this.#context();

  override messages = {
    move: validate(MovePayloadSchema, (client: MissionClient, input: MoveInput) => {
      this.#active(client)?.inputs.push(input);
    }),
    advance: validate(AdvancePayloadSchema, (client: MissionClient, payload: { node: string }) => {
      if (this.#active(client) !== undefined) this.#advance(client.sessionId, payload.node, Date.now());
    }),
    choose: validate(ChoosePayloadSchema, (client: MissionClient, payload: { node: string; choice: string }) => {
      if (this.#active(client) !== undefined) this.#choose(client.sessionId, payload.node, payload.choice, Date.now());
    }),
    work: validate(WorkPayloadSchema, (client: MissionClient, payload: { spot: number }) => {
      const m = this.#active(client);
      if (m !== undefined) this.#startWork(m, payload.spot, Date.now());
    }),
  };

  static override async onAuth(_token: string, options: unknown, context: AuthContext): Promise<true> {
    const key = ipKey(context.ip);
    const policy = roomPolicy();
    if (!(await policy.matchmake.take(key)) || !(await policy.reservations.take(key))) {
      throw new ServerError(CLOSE_CODES.RATE_LIMITED, 'Too many attempts. Wait a moment and try again.');
    }
    if (!MissionJoinSchema.safeParse(options).success) throw new ServerError(ErrorCode.AUTH_FAILED, 'Invalid nickname.');
    return true;
  }

  override async onCreate(options: unknown): Promise<void> {
    const parsed = MissionJoinSchema.safeParse(options);
    const actId: ActId = parsed.success ? (parsed.data.act ?? 'dump') : 'dump';
    this.act = STORY_ACTS[actId];
    this.rules = RULES[actId]();
    this.#ctx = this.#context();
    this.state.act = actId;
    await this.setPrivate(true);
    this.#code = await claimRoomCode(this.presence, this.roomId);
    this.state.code = this.#code;
    for (let i = 0; i < this.act.spots.length; i++) this.state.spots.push(new MissionSpot());
    this.rules.setup(this.#ctx);
    this.setFixedTimestep(() => {
      this.#step();
    }, SERVER_TICK_HZ);
    this.patchRate = null;
    this.clock.setInterval(() => {
      const now = Date.now();
      for (const m of this.#crew.values()) if (now - m.lastActiveMs > IDLE_MS) m.client.leave(CLOSE_CODES.IDLE, 'Removed for being idle too long.');
    }, IDLE_CHECK_MS);
    this.clock.setTimeout(() => {
      void this.disconnect();
    }, LIFETIME_MS);
  }

  override async onAuth(client: MissionClient, options: unknown, context: AuthContext): Promise<Auth> {
    const parsed = MissionJoinSchema.safeParse(options);
    if (!parsed.success) throw new ServerError(ErrorCode.AUTH_FAILED, 'Invalid nickname.');
    if (this.#closed()) throw new ServerError(ErrorCode.MATCHMAKE_INVALID_ROOM_ID, 'That night is nearly over.');
    if (!(await holdSeat(roomPolicy().ipSlots, ipKey(context.ip), client.ref))) {
      throw new ServerError(CLOSE_CODES.TOO_MANY_CONNECTIONS, 'Too many players from your network.');
    }
    const profiles = roomPolicy().profiles;
    const profileId = profiles === null ? null : profileIdFromCookieHeader(profiles.keys, context.headers.get('cookie'), Date.now());
    return { nickname: parsed.data.nickname, profileId };
  }

  override onJoin(client: MissionClient): void {
    const auth = client.auth;
    if (auth === undefined) throw new ServerError(ErrorCode.APPLICATION_ERROR, 'Not authorised.');
    const name = uniqueNickname(auth.nickname, [...this.#crew.values()].map((m) => m.player.name));
    const taken = new Set([...this.#crew.values()].map((m) => m.player.seat));
    let seat = 0;
    while (taken.has(seat)) seat++;
    const anchor = this.#anchor();
    const spot = anchor === null ? this.act.start : besideSpot(anchor, this.#positions());
    const player = new CityPlayer({ name, seat, x: spot.x, y: spot.y });
    player.ack = 0;
    player.pocket = 0;
    this.state.players.set(client.sessionId, player);
    const view = new StateView();
    for (const m of this.#crew.values()) {
      view.add(m.player);
      m.client.view?.add(player);
    }
    view.add(player);
    view.add(player, VIEW_TAGS.OWNER);
    client.view = view;
    const now = Date.now();
    this.#crew.set(client.sessionId, { id: client.sessionId, client, player, inputs: new InputQueue(), profileId: auth.profileId, lastActiveMs: now, caughtUntil: 0, work: null });
    if (this.state.lead === '') this.state.lead = client.sessionId;
    if (!this.#opened) {
      this.#opened = true;
      if (this.act.carries === true) void this.#carry(auth.profileId);
      this.clock.setTimeout(() => {
        this.#setStep(this.act.steps[0] ?? 'call', Date.now());
      }, OPENING_MS);
    }
  }

  override onLeave(client: MissionClient): void {
    const m = this.#crew.get(client.sessionId);
    if (m !== undefined) {
      if (m.work !== null) this.#stopWork(m);
      for (const other of this.#crew.values()) if (other !== m) other.client.view?.remove(m.player);
    }
    this.#crew.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    if (this.#hero === client.sessionId) this.#hero = null;
    if (this.state.lead === client.sessionId) this.state.lead = this.#crew.keys().next().value ?? '';
    client.view?.dispose();
    this.#votes.delete(client.sessionId);
    this.state.votes.delete(client.sessionId);
    this.#ready.delete(client.sessionId);
    this.state.ready = this.#ready.size;
    if (this.#crew.size > 0) this.#settle(Date.now());
  }

  override async onDispose(): Promise<void> {
    if (this.#code !== '') await releaseRoomCode(this.presence, this.#code, this.roomId);
  }

  // What the act's rules may see and touch, fixed once the act is chosen.
  #context(): ActContext {
    return {
      act: this.act,
      state: this.state,
      random: this.random,
      marks: this.#marks,
      crew: () => this.#crew.values(),
      anchor: () => this.#anchor(),
      inScene: () => this.#scene !== null,
      setStep: (step, now) => {
        this.#setStep(step, now);
      },
      mark: (mark) => {
        this.#mark(mark);
      },
      catchMember: (m, by, to, now) => {
        const member = this.#crew.get(m.id);
        if (member !== undefined) this.#caught(member, by, to, now);
      },
      broadcast: (type, payload) => {
        this.broadcast(type, payload);
      },
      moveCrew: (to) => {
        const placed: Vec2[] = [];
        for (const m of this.#crew.values()) {
          if (m.work !== null) this.#stopWork(m);
          const spot = besideSpot(to, placed);
          m.player.x = spot.x;
          m.player.y = spot.y;
          placed.push(spot);
        }
      },
    };
  }

  // Brings in what the lead's earlier acts and the ceremony left behind, before the first scene opens.
  async #carry(profileId: string | null): Promise<void> {
    const profiles = roomPolicy().profiles;
    if (profiles === null || profileId === null) return;
    try {
      let story: ProfileData['progress']['story'];
      await profiles.store.change(profileId, null, Date.now(), (data) => {
        story = data.progress.story;
        return null;
      });
      for (const mark of carriedMarks(story)) this.#mark(mark);
    } catch (error) {
      log.error('story history load failed', error, { roomId: this.roomId });
    }
  }

  #closed(): boolean {
    return this.act.closed.includes(this.state.step);
  }

  #active(client: MissionClient): Member | undefined {
    const m = this.#crew.get(client.sessionId);
    if (m !== undefined) m.lastActiveMs = Date.now();
    return m;
  }

  // Where a newcomer or a straggler is brought: beside the hero, else beside the lead.
  #anchor(): Vec2 | null {
    const hero = this.#hero === null ? undefined : this.#crew.get(this.#hero);
    return hero?.player ?? this.#crew.get(this.state.lead)?.player ?? null;
  }

  #positions(): Vec2[] {
    return [...this.#crew.values()].map((m) => m.player);
  }

  #gather(): void {
    const anchor = this.#anchor();
    if (anchor === null) return;
    for (const m of this.#crew.values()) {
      if (m.player === anchor || near(m.player, anchor, CREW_GATHER)) continue;
      const spot = besideSpot(anchor, this.#positions().filter((p) => p !== m.player));
      if (m.work !== null) this.#stopWork(m);
      m.player.x = spot.x;
      m.player.y = spot.y;
    }
  }

  #step(): void {
    const now = Date.now();
    const sceneFrozen = this.#scene !== null || this.#closed();
    for (const m of this.#crew.values()) {
      const frozen = sceneFrozen || now < m.caughtUntil;
      const player = m.player;
      m.inputs.drain(performance.now(), (input) => {
        if (frozen) return;
        const next = stepMovement({ x: player.x, y: player.y }, { x: input.dx, y: input.dy }, TICK_SECONDS, CITY_MAP);
        if (next.x !== player.x) player.x = next.x;
        if (next.y !== player.y) player.y = next.y;
      });
      if (player.ack !== m.inputs.ack) player.ack = m.inputs.ack;
    }
    if (this.#scene === null) this.#arrivals(now);
    for (const m of this.#crew.values()) this.#working(m, now);
    this.#sceneClock(now);
    if (!this.#quiet) this.rules.tick(this.#ctx, now);
    this.broadcastPatch();
  }

  #arrivals(now: number): void {
    const arrival = this.act.arrivals[this.state.step];
    if (arrival === undefined) return;
    for (const [id, m] of this.#crew) {
      if (now < m.caughtUntil || !near(m.player, arrival.at, arrival.range)) continue;
      this.#hero = id;
      this.#gather();
      this.#setStep(arrival.to, now);
      return;
    }
  }

  #setStep(step: string, now: number): void {
    this.state.step = step;
    if (this.#closed()) {
      void this.lock();
      this.#gather();
    }
    this.rules.onStep?.(this.#ctx, step, now);
    if (step === 'done') this.#complete();
    const scene = this.act.scenes[step];
    if (scene !== undefined) this.#enter(scene, now);
  }

  #mark(mark: string | undefined): void {
    if (mark === undefined || this.#marks.has(mark)) return;
    this.#marks.add(mark);
    this.state.marks.push(mark);
  }

  #enter(id: string, now: number): void {
    const node = this.act.script[id];
    if (node === undefined) return;
    this.#mark(node.mark);
    const read = readMs(node, this.#marks);
    const choices = (node.choices?.length ?? 0) > 0;
    this.#scene = {
      id,
      node,
      enteredAt: now,
      deadline: choices && node.seconds !== undefined ? now + read + node.seconds * 1000 + CHOICE_GRACE_MS : null,
      autoAt: choices ? null : now + read + AUTO_PAUSE_MS,
      voteBy: null,
    };
    this.#votes.clear();
    this.state.votes.clear();
    this.#ready.clear();
    this.state.ready = 0;
    this.state.node = id;
    this.state.seq = (this.state.seq + 1) % 65_536;
    this.rules.onScene?.(this.#ctx, id);
  }

  #finish(now: number): void {
    const scene = this.#scene;
    if (scene === null) return;
    const next = nextOf(scene.node, this.#marks);
    if (next !== undefined) {
      this.#enter(next, now);
      return;
    }
    this.#scene = null;
    this.state.node = '';
    if (scene.node.then !== undefined) this.#setStep(scene.node.then, now);
  }

  #sceneClock(now: number): void {
    const scene = this.#scene;
    if (scene === null) return;
    if (scene.voteBy !== null && now >= scene.voteBy) this.#decide(now);
    else if (scene.deadline !== null && now >= scene.deadline) {
      if (this.#votes.size > 0) this.#decide(now);
      else if (scene.node.timeout !== undefined) {
        this.state.said = '';
        this.#enter(scene.node.timeout, now);
      }
    } else if (scene.autoAt !== null && now >= scene.autoAt) this.#finish(now);
  }

  // Moves on as soon as the whole crew has voted, or has read the scene through.
  #settle(now: number): void {
    const scene = this.#scene;
    if (scene === null) return;
    if (scene.autoAt === null) {
      if (this.#votes.size > 0 && this.#votes.size >= this.#crew.size) this.#decide(now);
    } else if (this.#ready.size > 0 && this.#ready.size >= this.#crew.size) this.#finish(now);
  }

  #decide(now: number): void {
    const winner = crewChoice(this.#votes, this.state.lead);
    const node = this.#scene?.node;
    const choice = node === undefined ? undefined : visibleChoices(node, this.#marks).find((c) => c.id === winner);
    if (choice === undefined) return;
    this.state.said = choice.id;
    this.#mark(choice.mark);
    this.#enter(choice.go, now);
  }

  #advance(id: string, node: string, now: number): void {
    const scene = this.#scene;
    if (scene === null || scene.id !== node || scene.autoAt === null || now - scene.enteredAt < MIN_SKIP_MS) return;
    this.#ready.add(id);
    this.state.ready = this.#ready.size;
    this.#settle(now);
  }

  #choose(id: string, node: string, choiceId: string, now: number): void {
    const scene = this.#scene;
    if (scene === null || scene.id !== node) return;
    if (!visibleChoices(scene.node, this.#marks).some((c) => c.id === choiceId)) return;
    this.#votes.set(id, choiceId);
    this.state.votes.set(id, choiceId);
    if (scene.voteBy === null) this.#scene = { ...scene, voteBy: now + CREW_VOTE_MS };
    this.#settle(now);
  }

  #startWork(m: Member, index: number, now: number): void {
    const def = this.act.spots[index];
    const spot = this.state.spots[index];
    if (def === undefined || spot === undefined) return;
    if (this.state.step !== this.act.workStep || this.#scene !== null || now < m.caughtUntil || m.work !== null) return;
    if (spot.done || spot.worker !== '' || !canWork(m.player, def, this.act.workReach)) return;
    m.work = { spot: index, at: { x: m.player.x, y: m.player.y }, until: now + this.act.workMs };
    spot.worker = m.id;
  }

  #working(m: Member, now: number): void {
    const work = m.work;
    if (work === null) return;
    if (this.state.step !== this.act.workStep || now < m.caughtUntil || !near(m.player, work.at, WORK_WOBBLE)) {
      this.#stopWork(m);
      return;
    }
    if (now < work.until) return;
    this.#stopWork(m);
    const spot = this.state.spots[work.spot];
    if (spot === undefined) return;
    spot.done = true;
    const step = this.state.step;
    const note = this.rules.worked(this.#ctx, work.spot, m, now);
    spot.note = note;
    if (this.state.step !== step) {
      this.#hero = m.id;
      for (const other of this.#crew.values()) if (other.work !== null) this.#stopWork(other);
      this.#gather();
    }
  }

  #stopWork(m: Member): void {
    const work = m.work;
    m.work = null;
    const spot = work === null ? undefined : this.state.spots[work.spot];
    if (spot !== undefined && spot.worker === m.id) spot.worker = '';
  }

  #caught(m: Member, by: CaughtLine['by'], to: Vec2, now: number): void {
    this.#stopWork(m);
    m.caughtUntil = now + CAUGHT_MS;
    this.state.caught = Math.min(255, this.state.caught + 1);
    const spot = besideSpot(to, this.#positions().filter((p) => p !== m.player));
    m.player.x = spot.x;
    m.player.y = spot.y;
    const line: CaughtLine = { by, count: this.state.caught };
    for (const other of this.#crew.values()) other.client.send(MISSION_MESSAGES.CAUGHT, other === m ? line : { ...line, name: m.player.name });
  }

  // Saves what the characters remember and pays each crew member's first finish only; a replay changes the memory,
  // never the wallet. Two seats on one profile share one save.
  #complete(): void {
    if (this.#finished) return;
    this.#finished = true;
    const honest = honestIn(this.act, this.#marks);
    const marks = [...this.#marks].slice(0, 32);
    const profiles = roomPolicy().profiles;
    const saves = new Map<string, Promise<MissionResult>>();
    for (const m of this.#crew.values()) {
      const id = m.profileId;
      let save: Promise<MissionResult>;
      if (profiles === null || id === null) save = Promise.resolve({ reason: 'noProfile', paid: 0, honest });
      else {
        save = saves.get(id) ?? this.#save(profiles.store, id, honest, marks);
        saves.set(id, save);
      }
      void save.then((result) => {
        if (this.#crew.get(m.id) === m) m.client.send(MISSION_MESSAGES.RESULT, result);
      });
    }
  }

  async #save(store: ProfileStore, profileId: string, honest: boolean, marks: string[]): Promise<MissionResult> {
    const act = this.act;
    try {
      const out = await store.change<{ paid: number; first: boolean }>(profileId, `story:${act.id}:${this.roomId}:${profileId}`, Date.now(), (data) => {
        const before = data.progress.story?.[act.id];
        const first = before?.done !== true;
        let wallet = data.wallet;
        let paid = 0;
        if (first) {
          const fee = credit(wallet, act.rewardSats);
          if (fee.ok) {
            wallet = fee.value.wallet;
            paid = act.rewardSats;
          }
        }
        const record = { done: true, honest: honest || before?.honest === true, marks };
        const progress = { ...data.progress, story: { ...data.progress.story, [act.id]: record } };
        return { data: { ...data, wallet, progress }, result: { paid, first } };
      });
      return out.ok ? { reason: out.result.first ? 'paid' : 'replay', paid: out.result.paid, honest } : { reason: 'error', paid: 0, honest };
    } catch (error) {
      log.error('story save failed', error, { roomId: this.roomId, act: act.id });
      return { reason: 'error', paid: 0, honest };
    }
  }

  // For tests: the spot only the server knows (the device's heap, the buyer's terminal), or -1.
  get secretSpot(): number {
    return this.rules.secret ?? -1;
  }

  // For tests: no patrols, no dog, no catches.
  quietNight(): void {
    this.#quiet = true;
  }

  // For tests: run the clock out on the scene on screen.
  runOutClock(): void {
    const scene = this.#scene;
    if (scene !== null) this.#scene = { ...scene, deadline: scene.deadline === null ? null : 0, autoAt: scene.autoAt === null ? null : 0, voteBy: scene.voteBy === null ? null : 0 };
  }

  // For tests: put a crew member (the lead by default) somewhere.
  teleport(x: number, y: number, sessionId = this.state.lead): void {
    const p = this.#crew.get(sessionId)?.player;
    if (p === undefined) return;
    p.x = x;
    p.y = y;
  }
}
