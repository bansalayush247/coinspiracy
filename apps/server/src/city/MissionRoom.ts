// Act one, The Dump: a private story instance of Port Concord for one player. The server walks the script, moves
// Ivor and Duncan, judges every dig and every catch, and pays the first finish once. The device's heap never
// leaves the server.
import { StateView } from '@colyseus/schema';
import { ErrorCode, Room, ServerError, validate, type AuthContext, type Client } from '@colyseus/core';
import { CLOSE_CODES, MovePayloadSchema, SERVER_TICK_HZ, TICK_SECONDS, cryptoRandom, stepMovement, type RandomSource, type Vec2 } from '@byzantine-council/shared';
import { findPath } from '@byzantine-council/shared/pathfinding';
import { credit } from '@byzantine-council/shared/economy';
import {
  AdvancePayloadSchema,
  ARRIVE_RANGE,
  CAUGHT_MS,
  CITY_MAP,
  ChoosePayloadSchema,
  CityJoinSchema,
  CityPlayer,
  DANI_SPOT,
  DEVICE_HEAPS,
  DIG_MS,
  DIG_WOBBLE,
  DUMP_REWARD_SATS,
  DUMP_SCENES,
  DUMP_SCRIPT,
  DUMP_START,
  DUNCAN_CATCH,
  DUNCAN_SMELL,
  DUNCAN_SPEED_SCALE,
  DUNCAN_WRONG_HEAPS,
  DigPayloadSchema,
  GATE_SPOT,
  GUITAR,
  HEAPS,
  JUNK,
  KENNEL,
  MISSION_MESSAGES,
  MissionHeap,
  MissionNpc,
  MissionState,
  PATROL,
  PATROL_SPEED,
  SKIP_HEAP,
  canDig,
  inTorch,
  inYard,
  isHonest,
  readMs,
  type CaughtLine,
  type DumpStep,
  type MissionResult,
  type ScriptNode,
} from '@byzantine-council/shared/city';
import { VIEW_TAGS } from '@byzantine-council/shared/state';
import { ipKey } from '../clientIp.js';
import { InputQueue, type MoveInput } from '../inputQueue.js';
import { log } from '../logger.js';
import { roomPolicy } from '../policy.js';
import { profileIdFromCookieHeader } from '../profile/session.js';
import { holdSeat } from '../scaling/index.js';

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
}

interface Dig {
  readonly heap: number;
  readonly at: Vec2;
  readonly until: number;
}

interface Dog {
  out: boolean;
  path: Vec2[];
  repathAt: number;
  restUntil: number;
}

const IDLE_MS = 10 * 60_000;
const IDLE_CHECK_MS = 30_000;
const LIFETIME_MS = 60 * 60_000;
// The first scene waits a moment so the city has drawn before Mr Pell rings.
const OPENING_MS = 1_200;
// Choices stay open a little past the clock the player sees, so a last-moment click still counts.
const CHOICE_GRACE_MS = 1_500;
const AUTO_PAUSE_MS = 900;
const MIN_SKIP_MS = 300;
const DUNCAN_REPATH_MS = 400;
const DUNCAN_REST_MS = 4_000;

const near = (a: Vec2, b: Vec2, range: number): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= range;

export class MissionRoom extends Room<{ state: MissionState; client: MissionClient }> {
  override maxClients = 1;
  override state = new MissionState();
  override maxMessagesPerSecond = 40;
  override seatReservationTimeout = 8;
  // Swapped in tests for a fixed sequence.
  random: RandomSource = cryptoRandom;
  #id: string | null = null;
  #inputs = new InputQueue();
  #profileId: string | null = null;
  #lastActiveMs = Date.now();
  #device = -1;
  #scene: Scene | null = null;
  readonly #marks = new Set<string>();
  #dig: Dig | null = null;
  #caughtUntil = 0;
  #wrong = 0;
  #junk = 0;
  #guitar = false;
  #leg = 0;
  readonly #dog: Dog = { out: false, path: [], repathAt: 0, restUntil: 0 };
  #finished = false;
  #quiet = false;

  override messages = {
    move: validate(MovePayloadSchema, (_client: MissionClient, input: MoveInput) => {
      this.#lastActiveMs = Date.now();
      this.#inputs.push(input);
    }),
    advance: validate(AdvancePayloadSchema, (_client: MissionClient, payload: { node: string }) => {
      this.#lastActiveMs = Date.now();
      this.#advance(payload.node, Date.now());
    }),
    choose: validate(ChoosePayloadSchema, (_client: MissionClient, payload: { node: string; choice: string }) => {
      this.#lastActiveMs = Date.now();
      this.#choose(payload.node, payload.choice, Date.now());
    }),
    dig: validate(DigPayloadSchema, (_client: MissionClient, payload: { heap: number }) => {
      this.#lastActiveMs = Date.now();
      this.#startDig(payload.heap, Date.now());
    }),
  };

  static override async onAuth(_token: string, options: unknown, context: AuthContext): Promise<true> {
    const key = ipKey(context.ip);
    const policy = roomPolicy();
    if (!(await policy.matchmake.take(key)) || !(await policy.reservations.take(key))) {
      throw new ServerError(CLOSE_CODES.RATE_LIMITED, 'Too many attempts. Wait a moment and try again.');
    }
    if (!CityJoinSchema.safeParse(options).success) throw new ServerError(ErrorCode.AUTH_FAILED, 'Invalid nickname.');
    return true;
  }

  override async onCreate(): Promise<void> {
    await this.setPrivate(true);
    this.#device = DEVICE_HEAPS[this.random.int(DEVICE_HEAPS.length)] ?? 0;
    for (let i = 0; i < HEAPS.length; i++) this.state.heaps.push(new MissionHeap());
    this.state.npcs.set('dani', new MissionNpc({ kind: 'dani', x: DANI_SPOT.x, y: DANI_SPOT.y - 0.8 }));
    this.state.npcs.set('mags', new MissionNpc({ kind: 'mags', x: GATE_SPOT.x, y: GATE_SPOT.y - 0.9 }));
    const first = PATROL[0] ?? GATE_SPOT;
    this.state.npcs.set('guard', new MissionNpc({ kind: 'guard', x: first.x, y: first.y }));
    this.state.npcs.set('duncan', new MissionNpc({ kind: 'duncan', x: KENNEL.x, y: KENNEL.y }));
    this.setFixedTimestep(() => {
      this.#step();
    }, SERVER_TICK_HZ);
    this.patchRate = null;
    this.clock.setInterval(() => {
      if (Date.now() - this.#lastActiveMs > IDLE_MS) for (const c of this.clients) c.leave(CLOSE_CODES.IDLE, 'Removed for being idle too long.');
    }, IDLE_CHECK_MS);
    this.clock.setTimeout(() => {
      void this.disconnect();
    }, LIFETIME_MS);
  }

  override async onAuth(client: MissionClient, options: unknown, context: AuthContext): Promise<Auth> {
    const parsed = CityJoinSchema.safeParse(options);
    if (!parsed.success) throw new ServerError(ErrorCode.AUTH_FAILED, 'Invalid nickname.');
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
    const player = new CityPlayer({ name: auth.nickname, seat: 0, x: DUMP_START.x, y: DUMP_START.y });
    player.ack = 0;
    player.pocket = 0;
    this.state.players.set(client.sessionId, player);
    const view = new StateView();
    view.add(player);
    view.add(player, VIEW_TAGS.OWNER);
    client.view = view;
    this.#id = client.sessionId;
    this.#profileId = auth.profileId;
    this.#lastActiveMs = Date.now();
    this.clock.setTimeout(() => {
      this.#setStep('call', Date.now());
    }, OPENING_MS);
  }

  override onLeave(client: MissionClient): void {
    this.state.players.delete(client.sessionId);
    if (this.#id === client.sessionId) this.#id = null;
    client.view?.dispose();
  }

  get #player(): CityPlayer | undefined {
    return this.#id === null ? undefined : this.state.players.get(this.#id);
  }

  #step(): void {
    const now = Date.now();
    const player = this.#player;
    if (player !== undefined) {
      const frozen = this.#scene !== null || now < this.#caughtUntil || this.state.step === 'done' || this.state.step === 'found';
      this.#inputs.drain(performance.now(), (input) => {
        if (frozen) return;
        const next = stepMovement({ x: player.x, y: player.y }, { x: input.dx, y: input.dy }, TICK_SECONDS, CITY_MAP);
        if (next.x !== player.x) player.x = next.x;
        if (next.y !== player.y) player.y = next.y;
      });
      if (player.ack !== this.#inputs.ack) player.ack = this.#inputs.ack;
      if (this.#scene === null) {
        if (this.state.step === 'toDani' && near(player, DANI_SPOT, ARRIVE_RANGE)) this.#setStep('dani', now);
        else if (this.state.step === 'toTip' && near(player, GATE_SPOT, ARRIVE_RANGE)) this.#setStep('mags', now);
      }
      this.#digging(player, now);
    }
    this.#sceneClock(now);
    if (!this.#quiet) this.#patrol();
    if (player !== undefined && !this.#quiet) {
      this.#walkDog(player, now);
      this.#catch(player, now);
    }
    this.broadcastPatch();
  }

  #setStep(step: DumpStep, now: number): void {
    this.state.step = step;
    if (step === 'toTip') this.#npc('dani', (n) => {
      n.shown = false;
    });
    if (step === 'dig' && this.#marks.has('bluffedMags')) this.#dog.out = true;
    if (step === 'done') void this.#complete();
    const scene = DUMP_SCENES[step];
    if (scene !== undefined) this.#enter(scene, now);
  }

  #npc(id: string, fn: (n: MissionNpc) => void): void {
    const n = this.state.npcs.get(id);
    if (n !== undefined) fn(n);
  }

  #mark(mark: string | undefined): void {
    if (mark === undefined || this.#marks.has(mark)) return;
    this.#marks.add(mark);
    this.state.marks.push(mark);
  }

  #enter(id: string, now: number): void {
    const node = DUMP_SCRIPT[id];
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
    };
    this.state.node = id;
    this.state.seq = (this.state.seq + 1) % 65_536;
    const player = this.#player;
    if (id === 'slip' && player !== undefined) this.#npc('dani', (n) => {
      n.x = player.x + 1;
      n.y = player.y + 0.4;
      n.shown = true;
    });
    if (id === 'selfie' && player !== undefined) {
      this.#dog.out = false;
      this.#npc('duncan', (n) => {
        n.x = player.x - 0.9;
        n.y = player.y + 0.5;
        n.chasing = false;
      });
    }
  }

  #finish(now: number): void {
    const scene = this.#scene;
    if (scene === null) return;
    if (scene.node.next !== undefined) {
      this.#enter(scene.node.next, now);
      return;
    }
    this.#scene = null;
    this.state.node = '';
    if (scene.node.then !== undefined) this.#setStep(scene.node.then as DumpStep, now);
  }

  #sceneClock(now: number): void {
    const scene = this.#scene;
    if (scene === null) return;
    if (scene.deadline !== null && now >= scene.deadline && scene.node.timeout !== undefined) this.#enter(scene.node.timeout, now);
    else if (scene.autoAt !== null && now >= scene.autoAt) this.#finish(now);
  }

  #advance(id: string, now: number): void {
    const scene = this.#scene;
    if (scene === null || scene.id !== id || scene.autoAt === null || now - scene.enteredAt < MIN_SKIP_MS) return;
    this.#finish(now);
  }

  #choose(id: string, choiceId: string, now: number): void {
    const scene = this.#scene;
    if (scene === null || scene.id !== id) return;
    const choice = scene.node.choices?.find((c) => c.id === choiceId);
    if (choice === undefined) return;
    this.#mark(choice.mark);
    this.#enter(choice.go, now);
  }

  #startDig(heap: number, now: number): void {
    const player = this.#player;
    const def = HEAPS[heap];
    const state = this.state.heaps[heap];
    if (player === undefined || def === undefined || state === undefined) return;
    if (this.state.step !== 'dig' || this.#scene !== null || now < this.#caughtUntil || this.#dig !== null || state.dug || !canDig(player, def)) return;
    this.#dig = { heap, at: { x: player.x, y: player.y }, until: now + DIG_MS };
    this.state.digging = heap;
  }

  #digging(player: CityPlayer, now: number): void {
    const dig = this.#dig;
    if (dig === null) return;
    if (this.state.step !== 'dig' || now < this.#caughtUntil || !near(player, dig.at, DIG_WOBBLE)) {
      this.#stopDig();
      return;
    }
    if (now < dig.until) return;
    this.#stopDig();
    const state = this.state.heaps[dig.heap];
    const def = HEAPS[dig.heap];
    if (state === undefined || def === undefined) return;
    state.dug = true;
    if (dig.heap === this.#device) {
      state.found = 'A small black device, flat as a coaster.';
      this.#setStep('found', now);
      return;
    }
    if (def.bySkip) state.found = SKIP_HEAP;
    else if (def.winter && !this.#guitar) {
      this.#guitar = true;
      state.found = GUITAR;
    } else state.found = JUNK[this.#junk++ % JUNK.length] ?? '';
    this.#wrong++;
    if (this.#wrong >= DUNCAN_WRONG_HEAPS && !this.#dog.out) {
      this.#dog.out = true;
      this.clients[0]?.send(MISSION_MESSAGES.DUNCAN, {});
    }
  }

  #stopDig(): void {
    this.#dig = null;
    this.state.digging = -1;
  }

  // Ivor walks his rounds at a steady pace, his torch pointing the way he walks.
  #patrol(): void {
    const guard = this.state.npcs.get('guard');
    if (guard === undefined || PATROL.length < 2) return;
    let budget = PATROL_SPEED * TICK_SECONDS;
    while (budget > 0) {
      const target = PATROL[(this.#leg + 1) % PATROL.length] ?? guard;
      const dx = target.x - guard.x;
      const dy = target.y - guard.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= budget) {
        guard.x = target.x;
        guard.y = target.y;
        budget -= dist;
        this.#leg = (this.#leg + 1) % PATROL.length;
        continue;
      }
      guard.x += (dx / dist) * budget;
      guard.y += (dy / dist) * budget;
      guard.facing = Math.atan2(dy, dx);
      budget = 0;
    }
  }

  // Duncan chases anyone he can smell in his yard, gives up at the fence, and goes home after a catch.
  #walkDog(player: CityPlayer, now: number): void {
    const dog = this.state.npcs.get('duncan');
    if (dog === undefined || !this.#dog.out) return;
    const hunting = this.state.step === 'dig' && this.#scene === null && now >= this.#dog.restUntil && now >= this.#caughtUntil && inYard(player) && near(dog, player, DUNCAN_SMELL);
    const goal: Vec2 = hunting ? player : KENNEL;
    if (dog.chasing !== hunting) dog.chasing = hunting;
    if (near(dog, goal, 0.2)) return;
    if (now >= this.#dog.repathAt) {
      this.#dog.repathAt = now + DUNCAN_REPATH_MS;
      const path = findPath(CITY_MAP, dog, goal);
      this.#dog.path = path.ok ? path.value : [];
    }
    const next = this.#dog.path[0];
    if (next === undefined) return;
    const dx = next.x - dog.x;
    const dy = next.y - dog.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.15) {
      this.#dog.path.shift();
      return;
    }
    const moved = stepMovement({ x: dog.x, y: dog.y }, { x: (dx / dist) * DUNCAN_SPEED_SCALE, y: (dy / dist) * DUNCAN_SPEED_SCALE }, TICK_SECONDS, CITY_MAP);
    dog.x = moved.x;
    dog.y = moved.y;
    dog.facing = Math.atan2(dy, dx);
  }

  #catch(player: CityPlayer, now: number): void {
    if (this.state.step !== 'dig' || this.#scene !== null || now < this.#caughtUntil) return;
    const guard = this.state.npcs.get('guard');
    const dog = this.state.npcs.get('duncan');
    const by: CaughtLine['by'] | null =
      guard !== undefined && inTorch(guard, guard.facing, player) ? 'guard' : dog !== undefined && this.#dog.out && dog.chasing && near(dog, player, DUNCAN_CATCH) ? 'duncan' : null;
    if (by === null) return;
    this.#stopDig();
    this.#caughtUntil = now + CAUGHT_MS;
    this.#dog.restUntil = now + DUNCAN_REST_MS;
    this.#dog.path = [];
    this.state.caught = Math.min(255, this.state.caught + 1);
    player.x = GATE_SPOT.x;
    player.y = GATE_SPOT.y;
    const line: CaughtLine = { by, count: this.state.caught };
    this.clients[0]?.send(MISSION_MESSAGES.CAUGHT, line);
  }

  // Saves what the characters remember and pays the first finish only; a replay changes the memory, never the wallet.
  async #complete(): Promise<void> {
    if (this.#finished) return;
    this.#finished = true;
    const honest = isHonest(this.#marks);
    const marks = [...this.#marks].slice(0, 32);
    const send = (result: MissionResult): void => {
      this.clients[0]?.send(MISSION_MESSAGES.RESULT, result);
    };
    const profiles = roomPolicy().profiles;
    if (profiles === null || this.#profileId === null) {
      send({ reason: 'noProfile', paid: 0, honest });
      return;
    }
    try {
      const out = await profiles.store.change<{ paid: number; first: boolean }>(this.#profileId, `story:dump:${this.roomId}`, Date.now(), (data) => {
        const before = data.progress.story?.dump;
        const first = before?.done !== true;
        let wallet = data.wallet;
        let paid = 0;
        if (first) {
          const fee = credit(wallet, DUMP_REWARD_SATS);
          if (fee.ok) {
            wallet = fee.value.wallet;
            paid = DUMP_REWARD_SATS;
          }
        }
        const dump = { done: true, honest: honest || before?.honest === true, marks };
        const progress = { ...data.progress, story: { ...data.progress.story, dump } };
        return { data: { ...data, wallet, progress }, result: { paid, first } };
      });
      send(out.ok ? { reason: out.result.first ? 'paid' : 'replay', paid: out.result.paid, honest } : { reason: 'error', paid: 0, honest });
    } catch (error) {
      log.error('story save failed', error, { roomId: this.roomId });
      send({ reason: 'error', paid: 0, honest });
    }
  }

  // For tests: the heap holding the device, which clients are never told.
  get deviceHeap(): number {
    return this.#device;
  }

  // For tests: no patrol and no dog.
  quietNight(): void {
    this.#quiet = true;
  }

  // For tests: run the clock out on the scene on screen.
  runOutClock(): void {
    const scene = this.#scene;
    if (scene !== null) this.#scene = { ...scene, deadline: scene.deadline === null ? null : 0, autoAt: scene.autoAt === null ? null : 0 };
  }

  // For tests: put the player somewhere.
  teleport(x: number, y: number): void {
    const p = this.#player;
    if (p === undefined) return;
    p.x = x;
    p.y = y;
  }
}
