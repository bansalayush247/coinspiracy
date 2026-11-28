// Port Concord: the open city, one region server. Movement is server-checked as in matches, and each
// guardian is only sent the players and coin piles near them, so the city can be large without every client
// syncing everyone. Fights are server-decided: a client only says "punch", the server picks who it lands on.
import { randomBytes } from 'node:crypto';
import { StateView } from '@colyseus/schema';
import { ErrorCode, Room, ServerError, validate, type AuthContext, type Client } from '@colyseus/core';
import { CLOSE_CODES, MovePayloadSchema, NoPayloadSchema, PLAYER_RADIUS, SERVER_TICK_HZ, TICK_SECONDS, cryptoRandom, isBlocked, stepMovement, uniqueNickname, type CitadelMap, type RandomSource } from '@byzantine-council/shared';
import { findPath } from '@byzantine-council/shared/pathfinding';
import { credit } from '@byzantine-council/shared/economy';
import { LOOK_GAP_MS, dress } from '../hub/look.js';
import { dayFor } from '@byzantine-council/shared/progression';
import {
  CITY_MAP,
  CITY_MAX_PLAYERS,
  CITY_MESSAGES,
  CITY_SPAWNS,
  CityDrop,
  CityJoinSchema,
  CityPlayer,
  ferryArrival,
  CityState,
  CityCar,
  BULLY_POCKET,
  CAR_COLORS,
  CAR_TOW_MS,
  DRIVE_INPUT_TTL_MS,
  DrivePayloadSchema,
  ENTER_RANGE,
  PARKING,
  carBlockedByMap,
  carsBlockCar,
  carsSolid,
  driveControls,
  resolveCrowd,
  toLocal,
  type CrowdBody,
  type PushBlocked,
  touchesCar,
  stepCar,
  type DrivePayload,
  type ParkingSpot,
  BULLY_RANGE,
  DROP_LIFETIME_MS,
  KNOCKOUT_MS,
  LOOSE_COINS_EVERY_MS,
  LOOSE_COINS_LIVE,
  LOOSE_COIN_MAX,
  LOOSE_COIN_MIN,
  MAX_DROPS,
  MAX_HEALTH,
  MAX_POCKET,
  PUNCH_COOLDOWN_MS,
  PUNCH_DAMAGE,
  PUNCH_RANGE,
  ROUGH_DISTRICTS,
  TOUGHS_PER_DISTRICT,
  TOUGH_ANGRY_MS,
  TOUGH_CHASE,
  TOUGH_CHASE_SPEED,
  TOUGH_COOLDOWN_MS,
  TOUGH_DAMAGE,
  TOUGH_NAMES,
  TOUGH_PURSE_MAX,
  TOUGH_PURSE_MIN,
  TOUGH_RESPAWN_MS,
  TOUGH_WANDER_SPEED,
  VAULT_DAILY_LIMIT,
  ROUGH_STREETS,
  SHIELD_MS,
  SIGHT_GRACE_MS,
  afterPunch,
  atVault,
  canHit,
  canPickUp,
  depositable,
  districtAt,
  inSight,
  isRough,
  keepsInView,
  pickTarget,
  regenerate,
  takeFromPile,
  type DepositReason,
  type DistrictId,
  type DepositResult,
  type Fighter,
  type PunchLine,
  DOOR_TUNING,
  atExit,
  doorAt,
  doorBySeed,
  layoutFor,
  roomMap,
  roomSpawn,
  spotAt,
  stepIndoors,
  toWorld,
  walkedOut,
  type DoorReason,
  type DoorResult,
  type RestReason,
  type RestResult,
  type RoomLayout,
  type SpotKind,
} from '@byzantine-council/shared/city';
import { EMOTE_GAP_MS, EmotePayloadSchema, JUMP_GAP_MS, type Emote } from '@byzantine-council/shared/hub';
import { VIEW_TAGS } from '@byzantine-council/shared/state';
import { ipKey } from '../clientIp.js';
import { InputQueue, type MoveInput } from '../inputQueue.js';
import { log } from '../logger.js';
import { roomPolicy } from '../policy.js';
import { profileIdFromCookieHeader } from '../profile/session.js';
import { loadProfile } from '../profile/store.js';
import { holdSeat } from '../scaling/index.js';

interface Auth {
  readonly nickname: string;
  readonly profileId: string | null;
  readonly byFerry: boolean;
}
type CityClient = Client<{ auth: Auth }>;

interface FightState {
  health: number;
  knockedOutUntil: number;
  shieldUntil: number;
  lastHitMs: number;
  lastPunchMs: number;
}

interface Tough extends FightState {
  readonly district: DistrictId;
  readonly n: number;
  readonly home: { readonly x: number; readonly y: number };
  readonly bully: boolean;
  foe: string | null;
  angryUntil: number;
  path: { x: number; y: number }[];
  repathAt: number;
  waitUntil: number;
}

// Rough street tiles by district, where each district's toughs live and wander.
const ROUGH_BY_DISTRICT = new Map<DistrictId, { x: number; y: number }[]>();
for (const p of ROUGH_STREETS) {
  const d = districtAt(p)?.id;
  if (d !== undefined) ROUGH_BY_DISTRICT.set(d, [...(ROUGH_BY_DISTRICT.get(d) ?? []), p]);
}

interface Car {
  readonly state: CityCar;
  readonly home: ParkingSpot;
  speed: number;
  input: DrivePayload;
  wantAt: number;
  parkedSince: number;
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }, range: number): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= range;
// Foot off the pedal, hands off the wheel.
const LET_GO: DrivePayload = Object.freeze({ throttle: 0, steer: 0 });

interface Sim {
  readonly client: CityClient;
  readonly view: StateView;
  readonly inputs: InputQueue;
  readonly profileId: string | null;
  // Session ids and coin piles this client is currently sent.
  readonly sees: Set<string>;
  readonly seesDrops: Set<string>;
  // When each player or pile was last in this guardian's line of sight.
  readonly lastSeen: Map<string, number>;
  readonly home: { readonly x: number; readonly y: number };
  health: number;
  knockedOutUntil: number;
  shieldUntil: number;
  lastHitMs: number;
  lastPunchMs: number;
  depositing: boolean;
  lastActiveMs: number;
  lastEmoteMs: number;
  lastJumpMs: number;
  lastLookMs: number;
  lookQueued: boolean;
  lastRestMs: number;
  // Where this guardian is: '' on the street, else the room they are in. Only those in the same place see each other.
  place: string;
  room: { readonly layout: RoomLayout; readonly map: CitadelMap } | null;
  lastDoorMs: number;
  // Moves sent across a doorway are acked but not applied until this time, so a late step can't land in the wrong place.
  doorLockUntil: number;
}

const REST_SPOTS: ReadonlySet<SpotKind | null | undefined> = new Set<SpotKind>(['bed', 'reception', 'kitchen', 'candles', 'cushion', 'diya']);

const IDLE_MS = 15 * 60_000;
const IDLE_CHECK_MS = 30_000;
// Who-sees-whom is refreshed five times a second; positions still sync every tick.
const INTEREST_EVERY_TICKS = 4;
// Leaving this soon after being hit still drops your pocket, so nobody escapes a fight by quitting.
const COMBAT_LOG_MS = 10_000;

interface Drop {
  readonly state: CityDrop;
  readonly expiresAt: number;
  readonly loose: boolean;
}

export class CityRoom extends Room<{ state: CityState; client: CityClient }> {
  override maxClients = CITY_MAX_PLAYERS;
  override state = new CityState();
  override maxMessagesPerSecond = 40;
  override seatReservationTimeout = 8;
  readonly #sims = new Map<string, Sim>();
  readonly #drops = new Map<string, Drop>();
  readonly #toughs = new Map<string, Tough>();
  readonly #cars = new Map<string, Car>();
  #nextTough = 0;
  #toughsOn = true;
  #nextDrop = 0;
  #lastLooseMs = 0;
  #tick = 0;
  // Swapped in tests for a fixed sequence.
  random: RandomSource = cryptoRandom;

  override messages = {
    move: validate(MovePayloadSchema, (client: CityClient, input: MoveInput) => {
      const sim = this.#sims.get(client.sessionId);
      if (sim === undefined) return;
      sim.lastActiveMs = Date.now();
      sim.inputs.push(input);
    }),
    emote: validate(EmotePayloadSchema, (client: CityClient, payload: { emote: Emote }) => {
      const sim = this.#sims.get(client.sessionId);
      const now = Date.now();
      if (sim === undefined || now - sim.lastEmoteMs < EMOTE_GAP_MS) return;
      sim.lastEmoteMs = now;
      sim.lastActiveMs = now;
      // Only the guardians who can see you see the emote.
      const line = { from: client.sessionId, emote: payload.emote };
      for (const other of this.#sims.values()) if (other.sees.has(client.sessionId)) other.client.send(CITY_MESSAGES.EMOTE, line);
    }),
    jump: validate(NoPayloadSchema, (client: CityClient) => {
      const sim = this.#sims.get(client.sessionId);
      const me = this.state.players.get(client.sessionId);
      const now = Date.now();
      if (sim === undefined || me === undefined || me.down || me.car !== '' || now - sim.lastJumpMs < JUMP_GAP_MS) return;
      sim.lastJumpMs = now;
      sim.lastActiveMs = now;
      for (const other of this.#sims.values()) if (other.sees.has(client.sessionId)) other.client.send(CITY_MESSAGES.JUMP, { from: client.sessionId });
    }),
    punch: validate(NoPayloadSchema, (client: CityClient) => {
      this.#punch(client.sessionId, Date.now());
    }),
    ride: validate(NoPayloadSchema, (client: CityClient) => {
      this.#ride(client.sessionId, Date.now());
    }),
    drive: validate(DrivePayloadSchema, (client: CityClient, payload: DrivePayload) => {
      const sim = this.#sims.get(client.sessionId);
      const car = this.#carOf(client.sessionId);
      if (sim === undefined || car === undefined) return;
      const now = Date.now();
      sim.lastActiveMs = now;
      car.input = payload;
      car.wantAt = now;
    }),
    enter: validate(NoPayloadSchema, (client: CityClient) => {
      this.#enter(client.sessionId, Date.now());
    }),
    exit: validate(NoPayloadSchema, (client: CityClient) => {
      this.#exit(client.sessionId, Date.now(), false);
    }),
    deposit: validate(NoPayloadSchema, (client: CityClient) => {
      void this.#deposit(client.sessionId);
    }),
    rest: validate(NoPayloadSchema, (client: CityClient) => {
      this.#rest(client.sessionId, Date.now());
    }),
    refreshLook: validate(NoPayloadSchema, (client: CityClient) => {
      const sim = this.#sims.get(client.sessionId);
      const now = Date.now();
      const profileId = sim?.profileId;
      if (sim === undefined || profileId == null || sim.lookQueued) return;
      sim.lookQueued = true;
      this.clock.setTimeout(() => {
        sim.lookQueued = false;
        sim.lastLookMs = Date.now();
        void this.#wearLook(client.sessionId, profileId);
      }, Math.max(0, sim.lastLookMs + LOOK_GAP_MS - now));
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

  override onCreate(): void {
    this.setFixedTimestep(() => {
      this.#step();
    }, SERVER_TICK_HZ);
    this.patchRate = null;
    PARKING.forEach((home, i) => {
      const state = new CityCar({ x: home.x, y: home.y, heading: home.heading, color: i % CAR_COLORS });
      this.#cars.set(`car${String(i)}`, { state, home, speed: 0, input: LET_GO, wantAt: 0, parkedSince: Date.now() });
      this.state.cars.set(`car${String(i)}`, state);
    });
    let n = 0;
    for (const district of ROUGH_DISTRICTS) for (let i = 0; i < TOUGHS_PER_DISTRICT; i++) this.#spawnTough(district, n++);
    this.clock.setInterval(() => {
      const cutoff = Date.now() - IDLE_MS;
      for (const sim of this.#sims.values()) if (sim.lastActiveMs < cutoff) sim.client.leave(CLOSE_CODES.IDLE, 'Removed for being idle too long.');
    }, IDLE_CHECK_MS);
  }

  override async onAuth(client: CityClient, options: unknown, context: AuthContext): Promise<Auth> {
    const parsed = CityJoinSchema.safeParse(options);
    if (!parsed.success) throw new ServerError(ErrorCode.AUTH_FAILED, 'Invalid nickname.');
    if (!(await holdSeat(roomPolicy().ipSlots, ipKey(context.ip), client.ref))) {
      throw new ServerError(CLOSE_CODES.TOO_MANY_CONNECTIONS, 'Too many players from your network.');
    }
    const profiles = roomPolicy().profiles;
    const profileId = profiles === null ? null : profileIdFromCookieHeader(profiles.keys, context.headers.get('cookie'), Date.now());
    return { nickname: parsed.data.nickname, profileId, byFerry: parsed.data.arrive === 'ferry' };
  }

  override onJoin(client: CityClient): void {
    const auth = client.auth;
    if (auth === undefined) throw new ServerError(ErrorCode.APPLICATION_ERROR, 'Not authorised.');
    const taken = new Set(Array.from(this.state.players.values(), (p) => p.seat));
    const seat = Array.from({ length: CITY_MAX_PLAYERS }, (_, i) => i).find((i) => !taken.has(i)) ?? 0;
    const spawn = CITY_SPAWNS[seat % CITY_SPAWNS.length] ?? { x: 73, y: 63 };
    const names = Array.from(this.state.players.values(), (p) => p.name);
    // Colours cycle through the ten guardian palettes.
    const at = auth.byFerry ? ferryArrival('city') : spawn;
    const player = new CityPlayer({ name: uniqueNickname(auth.nickname, names), seat: seat % 10, x: at.x, y: at.y, health: MAX_HEALTH, shielded: true });
    player.ack = 0;
    player.pocket = 0;
    const now = Date.now();
    this.state.players.set(client.sessionId, player);
    const view = new StateView();
    view.add(player);
    view.add(player, VIEW_TAGS.OWNER);
    client.view = view;
    this.#sims.set(client.sessionId, {
      client,
      view,
      inputs: new InputQueue(),
      profileId: auth.profileId,
      sees: new Set([client.sessionId]),
      seesDrops: new Set(),
      lastSeen: new Map(),
      home: spawn,
      health: MAX_HEALTH,
      knockedOutUntil: 0,
      shieldUntil: now + SHIELD_MS,
      lastHitMs: 0,
      lastPunchMs: 0,
      depositing: false,
      lastActiveMs: now,
      lastEmoteMs: 0,
      lastJumpMs: 0,
      lastLookMs: 0,
      lookQueued: false,
      lastRestMs: 0,
      place: '',
      room: null,
      lastDoorMs: 0,
      doorLockUntil: 0,
    });
    this.state.population = this.#sims.size;
    this.#refreshInterest();
    if (auth.profileId !== null) void this.#wearLook(client.sessionId, auth.profileId);
  }

  override onLeave(client: CityClient): void {
    const player = this.state.players.get(client.sessionId);
    const leaving = this.#sims.get(client.sessionId);
    const car = this.#carOf(client.sessionId);
    if (car !== undefined) this.#park(car, Date.now());
    if (player !== undefined && leaving !== undefined && Date.now() - leaving.lastHitMs < COMBAT_LOG_MS) this.#dropPocket(player, Date.now());
    for (const sim of this.#sims.values()) {
      if (player !== undefined && sim.sees.delete(client.sessionId) && sim.client !== client) sim.view.remove(player);
      sim.lastSeen.delete(client.sessionId);
    }
    this.state.players.delete(client.sessionId);
    this.#sims.delete(client.sessionId);
    this.state.population = this.#sims.size;
    client.view?.dispose();
  }

  #step(): void {
    const now = performance.now();
    const wall = Date.now();
    const cars = this.#carBodies();
    for (const [id, sim] of this.#sims) {
      const player = this.state.players.get(id);
      if (player === undefined) continue;
      this.#recover(player, sim, wall);
      const down = sim.knockedOutUntil > wall;
      const seated = player.car !== '';
      const room = sim.room;
      const locked = wall < sim.doorLockUntil;
      sim.inputs.drain(now, (input) => {
        if (down || seated || locked) return;
        const from = { x: player.x, y: player.y };
        const step = { x: input.dx, y: input.dy };
        const next = room === null ? stepMovement(from, step, TICK_SECONDS, CITY_MAP, carsSolid(cars, from, PLAYER_RADIUS)) : stepIndoors(from, step, TICK_SECONDS, room.map);
        if (next.x !== player.x) player.x = next.x;
        if (next.y !== player.y) player.y = next.y;
      });
      if (player.ack !== sim.inputs.ack) player.ack = sim.inputs.ack;
      if (room === null && !down) this.#collect(player);
      if (room !== null && !locked && walkedOut(player, room.layout)) this.#exit(id, wall, true);
    }
    this.#separate();
    this.#driveCars(wall);
    for (const [id, t] of this.#toughs) this.#brawl(id, t, wall);
    this.#tidyDrops(wall);
    this.#tick = (this.#tick + 1) % INTEREST_EVERY_TICKS;
    if (this.#tick === 0) this.#refreshInterest();
    this.broadcastPatch();
  }

  // Pushes apart guardians on foot standing too close, place by place; nobody is pushed into a wall, a car or out a door.
  #separate(): void {
    const places = new Map<string, { bodies: CrowdBody[]; room: Sim['room'] }>();
    for (const [id, sim] of this.#sims) {
      const p = this.state.players.get(id);
      if (p === undefined || p.car !== '') continue;
      const group = places.get(sim.place) ?? { bodies: [], room: sim.room };
      group.bodies.push({ id, x: p.x, y: p.y });
      places.set(sim.place, group);
    }
    let cars: { x: number; y: number; heading: number }[] | null = null;
    for (const { bodies, room } of places.values()) {
      if (bodies.length < 2) continue;
      let blocked: PushBlocked;
      if (room === null) {
        const solids = (cars ??= this.#carBodies());
        blocked = (from, to) => isBlocked(CITY_MAP, to, PLAYER_RADIUS) || carsSolid(solids, from, PLAYER_RADIUS)(to);
      } else {
        blocked = (_from, to) => isBlocked(room.map, toLocal(to), PLAYER_RADIUS) || walkedOut(to, room.layout);
      }
      for (const [id, at] of resolveCrowd(bodies, blocked)) {
        const p = this.state.players.get(id);
        if (p === undefined) continue;
        if (p.x !== at.x) p.x = at.x;
        if (p.y !== at.y) p.y = at.y;
      }
    }
  }

  // Adds what each guardian can see to their view: near enough, and not behind a building. The rest is never sent.
  #refreshInterest(): void {
    const wall = Date.now();
    const visible = (sim: Sim, me: CityPlayer, key: string, at: { x: number; y: number }, now: boolean): boolean => {
      if (!keepsInView(me, at, now)) return false;
      if (inSight(me, at)) {
        sim.lastSeen.set(key, wall);
        return true;
      }
      return now && wall - (sim.lastSeen.get(key) ?? 0) < SIGHT_GRACE_MS;
    };
    for (const [id, sim] of this.#sims) {
      const me = this.state.players.get(id);
      if (me === undefined) continue;
      const indoors = sim.place !== '';
      for (const [otherId, other] of this.state.players) {
        if (otherId === id) continue;
        const now = sim.sees.has(otherId);
        const together = (this.#sims.get(otherId)?.place ?? '') === sim.place;
        const next = together && (indoors || visible(sim, me, otherId, other, now));
        if (next === now) continue;
        if (next) {
          sim.view.add(other);
          sim.sees.add(otherId);
        } else {
          sim.view.remove(other);
          sim.sees.delete(otherId);
        }
      }
      for (const [carId, car] of this.#cars) {
        const now = sim.seesDrops.has(carId);
        const next = car.state.driver === id || (!indoors && visible(sim, me, carId, car.state, now));
        if (next === now) continue;
        if (next) {
          sim.view.add(car.state);
          sim.seesDrops.add(carId);
        } else {
          sim.view.remove(car.state);
          sim.seesDrops.delete(carId);
        }
      }
      for (const [dropId, drop] of this.#drops) {
        const now = sim.seesDrops.has(dropId);
        const next = !indoors && visible(sim, me, dropId, drop.state, now);
        if (next === now) continue;
        if (next) {
          sim.view.add(drop.state);
          sim.seesDrops.add(dropId);
        } else {
          sim.view.remove(drop.state);
          sim.seesDrops.delete(dropId);
        }
      }
    }
  }

  // In through the door the guardian stands at: not while down, driving, busy at the vault, just through a door, or
  // just hit (a door is no escape from a fight), and not into a full room. A house is the guardian's own flat.
  #enter(sessionId: string, now: number): void {
    const sim = this.#sims.get(sessionId);
    const me = this.state.players.get(sessionId);
    if (sim === undefined || me === undefined) return;
    sim.lastActiveMs = now;
    const answer = (ok: boolean, reason: DoorReason): void => {
      const result: DoorResult = { ok, inside: me.inside, reason };
      sim.client.send(CITY_MESSAGES.DOOR, result);
    };
    if (sim.place !== '') {
      answer(true, 'in');
      return;
    }
    const door = doorAt(me);
    const flat = door?.room === 'flat';
    const place = door === null ? '' : flat ? `flat:${sessionId}:${String(door.building.seed)}` : `b:${String(door.building.seed)}`;
    const crowd = [...this.#sims.values()].filter((s) => s.place === place).length;
    const refused: DoorReason | null = me.down || sim.knockedOutUntil > now
      ? 'down'
      : me.car !== ''
        ? 'inCar'
        : sim.depositing || now - sim.lastDoorMs < DOOR_TUNING.gapMs
          ? 'tooSoon'
          : now - sim.lastHitMs < DOOR_TUNING.hitLockMs
            ? 'fighting'
            : door === null
              ? 'notAtDoor'
              : !flat && crowd >= DOOR_TUNING.maxOccupants
                ? 'full'
                : null;
    if (refused !== null || door === null) {
      answer(false, refused ?? 'notAtDoor');
      return;
    }
    const layout = layoutFor(door.room, door.building.seed);
    const spawn = toWorld(roomSpawn(layout));
    sim.inputs.flush();
    me.ack = sim.inputs.ack;
    me.x = spawn.x + (crowd % 3) * 0.4 - 0.4;
    me.y = spawn.y;
    me.inside = door.building.seed;
    sim.place = place;
    sim.room = { layout, map: roomMap(layout) };
    sim.lastDoorMs = now;
    sim.doorLockUntil = now + DOOR_TUNING.lockMs;
    // The hospital's desk patches you up as you come in.
    if (door.room === 'hospital') {
      sim.health = MAX_HEALTH;
      me.health = MAX_HEALTH;
    }
    this.#refreshInterest();
    answer(true, 'in');
  }

  // Back out onto the street at the building's door: by the door button, or by walking out through the doorway.
  #exit(sessionId: string, now: number, walked: boolean): void {
    const sim = this.#sims.get(sessionId);
    const me = this.state.players.get(sessionId);
    if (sim === undefined || me === undefined || sim.room === null) return;
    sim.lastActiveMs = now;
    const answer = (ok: boolean, reason: DoorReason): void => {
      const result: DoorResult = { ok, inside: me.inside, reason };
      sim.client.send(CITY_MESSAGES.DOOR, result);
    };
    if (!walked && (now - sim.lastDoorMs < DOOR_TUNING.gapMs || now < sim.doorLockUntil)) {
      answer(false, 'tooSoon');
      return;
    }
    if (!walked && !atExit(me, sim.room.layout)) {
      answer(false, 'notAtDoor');
      return;
    }
    const door = doorBySeed(me.inside);
    const out = door?.at ?? sim.home;
    sim.inputs.flush();
    me.ack = sim.inputs.ack;
    me.x = out.x;
    me.y = out.y;
    me.inside = 0;
    sim.place = '';
    sim.room = null;
    sim.lastDoorMs = now;
    sim.doorLockUntil = now + DOOR_TUNING.lockMs;
    this.#refreshInterest();
    answer(true, 'out');
  }

  #fighter(body: CityPlayer, f: FightState): Fighter {
    return { x: body.x, y: body.y, health: f.health, knockedOutUntil: f.knockedOutUntil, shieldUntil: f.shieldUntil };
  }

  // A guardian or a street tough: whoever can be hit.
  #fight(id: string): FightState | undefined {
    return this.#sims.get(id) ?? this.#toughs.get(id);
  }

  // One swing per cooldown. The server picks the nearest guardian or tough it can legally hit, or records a miss.
  #punch(sessionId: string, now: number): void {
    const sim = this.#sims.get(sessionId);
    const me = this.state.players.get(sessionId);
    if (sim === undefined || me === undefined || sim.place !== '' || me.car !== '' || now - sim.lastPunchMs < PUNCH_COOLDOWN_MS || sim.knockedOutUntil > now) return;
    sim.lastPunchMs = now;
    sim.lastActiveMs = now;
    const attacker = this.#fighter(me, sim);
    const nearby: (readonly [string, Fighter])[] = [];
    for (const id of sim.sees) {
      const other = this.state.players.get(id);
      const f = this.#fight(id);
      if (id !== sessionId && other !== undefined && f !== undefined && other.car === '') nearby.push([id, this.#fighter(other, f)]);
    }
    const targetId = pickTarget(attacker, nearby, now);
    this.#swing(sessionId, me, sim, targetId, PUNCH_DAMAGE, now);
  }

  // Lands (or misses) a punch and shows it to everyone who can see the attacker.
  #swing(attackerId: string, attacker: CityPlayer, f: FightState, targetId: string | null, damage: number, now: number): void {
    const line: PunchLine = { from: attackerId, to: targetId, knockedOut: false };
    const target = targetId === null ? undefined : this.state.players.get(targetId);
    const tf = targetId === null ? undefined : this.#fight(targetId);
    if (targetId !== null && target !== undefined && tf !== undefined) {
      f.shieldUntil = 0;
      attacker.shielded = false;
      const hit = afterPunch(tf.health, damage);
      tf.health = hit.health;
      tf.lastHitMs = now;
      target.health = Math.round(hit.health);
      const tough = this.#toughs.get(targetId);
      if (tough !== undefined && this.#sims.has(attackerId)) {
        tough.foe = attackerId;
        tough.angryUntil = now + TOUGH_ANGRY_MS;
      }
      if (hit.knockedOut) {
        line.knockedOut = true;
        tf.knockedOutUntil = now + KNOCKOUT_MS;
        target.down = true;
        if (tough !== undefined) this.#addDrop(target.x, target.y, TOUGH_PURSE_MIN + this.random.int(TOUGH_PURSE_MAX - TOUGH_PURSE_MIN + 1), now, false);
        else this.#dropPocket(target, now);
      }
    }
    for (const other of this.#sims.values()) if (other.sees.has(attackerId)) other.client.send(CITY_MESSAGES.PUNCH, line);
  }

  #carOf(sessionId: string): Car | undefined {
    const id = this.state.players.get(sessionId)?.car ?? '';
    return id === '' ? undefined : this.#cars.get(id);
  }

  // Gets into the nearest free car in reach, or out of the one you are driving onto open ground beside it.
  #ride(sessionId: string, now: number): void {
    const sim = this.#sims.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (sim === undefined || player === undefined || player.down || sim.depositing || sim.place !== '') return;
    sim.lastActiveMs = now;
    const current = this.#carOf(sessionId);
    if (current !== undefined) {
      const h = current.state.heading;
      const spots = [h + Math.PI / 2, h - Math.PI / 2, h + Math.PI, h].map((a, i) => ({ x: current.state.x + Math.cos(a) * (i < 2 ? 1 : 1.3), y: current.state.y + Math.sin(a) * (i < 2 ? 1 : 1.3) }));
      const out = spots.find((p) => !isBlocked(CITY_MAP, p, PLAYER_RADIUS));
      if (out === undefined) return;
      this.#park(current, now);
      player.x = out.x;
      player.y = out.y;
      return;
    }
    let best: [string, Car] | null = null;
    for (const entry of this.#cars) {
      const car = entry[1];
      if (car.state.driver !== '' || !near(player, car.state, ENTER_RANGE)) continue;
      if (best === null || Math.hypot(car.state.x - player.x, car.state.y - player.y) < Math.hypot(best[1].state.x - player.x, best[1].state.y - player.y)) best = entry;
    }
    if (best === null) return;
    const [carId, car] = best;
    car.state.driver = sessionId;
    car.input = LET_GO;
    car.wantAt = 0;
    player.car = carId;
    player.x = car.state.x;
    player.y = car.state.y;
  }

  #park(car: Car, now: number): void {
    const driver = this.state.players.get(car.state.driver);
    if (driver !== undefined) driver.car = '';
    car.state.driver = '';
    car.speed = 0;
    car.parkedSince = now;
  }

  // Runs every driven car one tick and carries its driver along; tows long-abandoned cars back to their spot.
  #driveCars(now: number): void {
    for (const [carId, car] of this.#cars) {
      const s = car.state;
      if (s.driver === '') {
        if (now - car.parkedSince > CAR_TOW_MS && !near(s, car.home, 3) && ![...this.state.players.values()].some((p) => near(p, car.home, 2))) {
          s.x = car.home.x;
          s.y = car.home.y;
          s.heading = car.home.heading;
          car.parkedSince = now;
        }
        continue;
      }
      const driver = this.state.players.get(s.driver);
      if (driver === undefined) {
        this.#park(car, now);
        continue;
      }
      const c = driveControls(s.heading, car.speed, now - car.wantAt > DRIVE_INPUT_TTL_MS ? LET_GO : car.input);
      const others = [...this.#cars].flatMap(([id, o]) => (id === carId ? [] : [{ x: o.state.x, y: o.state.y, heading: o.state.heading }]));
      const hitsCar = carsBlockCar(others, s);
      const next = stepCar({ x: s.x, y: s.y, heading: s.heading, speed: car.speed }, c.throttle, c.steer, TICK_SECONDS, (p, heading) => this.#carBlocked(s.driver, p, heading) || hitsCar(p, heading));
      car.speed = next.speed;
      if (next.x !== s.x) s.x = next.x;
      if (next.y !== s.y) s.y = next.y;
      if (next.heading !== s.heading) s.heading = next.heading;
      driver.x = s.x;
      driver.y = s.y;
    }
  }

  // Every car's body where it stands now, for walkers to bump into.
  #carBodies(): { x: number; y: number; heading: number }[] {
    return [...this.#cars.values()].map((c) => ({ x: c.state.x, y: c.state.y, heading: c.state.heading }));
  }

  // Cars stop for walls, water and anyone on foot, wherever they touch the car's body; other cars are checked apart.
  #carBlocked(driverId: string, p: { x: number; y: number }, heading: number): boolean {
    if (carBlockedByMap(p)) return true;
    for (const [id, other] of this.state.players) if (id !== driverId && other.car === '' && touchesCar({ x: p.x, y: p.y, heading }, other, PLAYER_RADIUS)) return true;
    return false;
  }

  #spawnTough(district: DistrictId, n: number): void {
    if (!this.#toughsOn) return;
    const streets = ROUGH_BY_DISTRICT.get(district) ?? [];
    const home = streets[this.random.int(streets.length)];
    if (home === undefined) return;
    const id = `tough${String(this.#nextTough++)}`;
    const body = new CityPlayer({ name: TOUGH_NAMES[n % TOUGH_NAMES.length] ?? 'Tough', seat: 8 + (n % 2), x: home.x, y: home.y, health: MAX_HEALTH, npc: true });
    this.state.players.set(id, body);
    this.#toughs.set(id, {
      district, n, home, bully: n % 3 === 2, health: MAX_HEALTH, knockedOutUntil: 0, shieldUntil: 0, lastHitMs: 0, lastPunchMs: 0,
      foe: null, angryUntil: 0, path: [], repathAt: 0, waitUntil: 0,
    });
  }

  // Takes a tough off the street after a knockout; another turns up in the same district later.
  #retire(id: string): void {
    const tough = this.#toughs.get(id);
    const body = this.state.players.get(id);
    if (tough === undefined || body === undefined) return;
    for (const sim of this.#sims.values()) {
      if (sim.sees.delete(id)) sim.view.remove(body);
      sim.lastSeen.delete(id);
    }
    this.state.players.delete(id);
    this.#toughs.delete(id);
    this.clock.setTimeout(() => {
      this.#spawnTough(tough.district, tough.n);
    }, TOUGH_RESPAWN_MS);
  }

  // Each tick a tough heals, picks or drops a fight, swings when in reach, and otherwise walks: after a foe, or about.
  #brawl(id: string, t: Tough, now: number): void {
    const body = this.state.players.get(id);
    if (body === undefined) return;
    if (body.down) {
      if (t.knockedOutUntil <= now) this.#retire(id);
      return;
    }
    t.health = regenerate(t.health, t.lastHitMs, now, TICK_SECONDS);
    const shown = Math.round(t.health);
    if (body.health !== shown) body.health = shown;
    const reach = (p: CityPlayer): number => Math.hypot(p.x - body.x, p.y - body.y);
    if (t.foe !== null) {
      const foe = this.state.players.get(t.foe);
      const fs = this.#sims.get(t.foe);
      if (foe === undefined || fs === undefined || foe.car !== '' || now > t.angryUntil || fs.knockedOutUntil > now || !isRough(foe) || reach(foe) > TOUGH_CHASE) t.foe = null;
    }
    if (t.foe === null && t.bully) {
      for (const [pid, sim] of this.#sims) {
        const p = this.state.players.get(pid);
        if (p === undefined || p.car !== '' || (p.pocket ?? 0) < BULLY_POCKET || reach(p) > BULLY_RANGE || sim.shieldUntil > now || sim.knockedOutUntil > now || !isRough(p) || !inSight(body, p)) continue;
        t.foe = pid;
        t.angryUntil = now + TOUGH_ANGRY_MS;
        break;
      }
    }
    const foe = t.foe === null ? undefined : this.state.players.get(t.foe);
    const fs = t.foe === null ? undefined : this.#sims.get(t.foe);
    if (t.foe !== null && foe !== undefined && fs !== undefined) {
      if (reach(foe) <= PUNCH_RANGE * 0.85) {
        t.path = [];
        if (now - t.lastPunchMs >= TOUGH_COOLDOWN_MS) {
          t.lastPunchMs = now;
          this.#swing(id, body, t, canHit(this.#fighter(body, t), this.#fighter(foe, fs), now) ? t.foe : null, TOUGH_DAMAGE, now);
        }
        return;
      }
      if (now >= t.repathAt) {
        t.repathAt = now + 500;
        const path = findPath(CITY_MAP, body, foe);
        t.path = path.ok ? path.value : [];
      }
      this.#walk(body, t, TOUGH_CHASE_SPEED);
      return;
    }
    if (t.path.length === 0) {
      if (now < t.waitUntil) return;
      const streets = ROUGH_BY_DISTRICT.get(t.district) ?? [];
      const goal = streets[this.random.int(streets.length)];
      if (goal !== undefined && Math.hypot(goal.x - t.home.x, goal.y - t.home.y) <= 8) {
        const path = findPath(CITY_MAP, body, goal);
        t.path = path.ok ? path.value : [];
      }
      t.waitUntil = now + 2_000 + this.random.int(3_000);
      return;
    }
    this.#walk(body, t, TOUGH_WANDER_SPEED);
  }

  #walk(body: CityPlayer, t: Tough, speed: number): void {
    const next = t.path[0];
    if (next === undefined) return;
    const dx = next.x - body.x;
    const dy = next.y - body.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.15) {
      t.path.shift();
      return;
    }
    const from = { x: body.x, y: body.y };
    const moved = stepMovement(from, { x: (dx / dist) * speed, y: (dy / dist) * speed }, TICK_SECONDS, CITY_MAP, carsSolid(this.#carBodies(), from, PLAYER_RADIUS));
    if (!isRough(moved)) {
      t.path = [];
      return;
    }
    body.x = moved.x;
    body.y = moved.y;
  }

  // Wakes knocked-out guardians at home with full health and a shield, regenerates health, ends shields.
  #recover(player: CityPlayer, sim: Sim, now: number): void {
    if (player.down && sim.knockedOutUntil <= now) {
      player.down = false;
      player.x = sim.home.x;
      player.y = sim.home.y;
      sim.health = MAX_HEALTH;
      sim.shieldUntil = now + SHIELD_MS;
    }
    if (!player.down) sim.health = regenerate(sim.health, sim.lastHitMs, now, TICK_SECONDS);
    const shown = Math.round(sim.health);
    if (player.health !== shown) player.health = shown;
    const shielded = sim.shieldUntil > now;
    if (player.shielded !== shielded) player.shielded = shielded;
  }

  #dropPocket(player: CityPlayer, now: number): void {
    const amount = player.pocket ?? 0;
    if (amount <= 0) return;
    player.pocket = 0;
    this.#addDrop(player.x, player.y, amount, now, false);
  }

  // At the cap the oldest pile is swept away, so the room's memory stays bounded.
  #addDrop(x: number, y: number, amount: number, now: number, loose: boolean): void {
    if (this.#drops.size >= MAX_DROPS) {
      const oldest = this.#drops.keys().next().value;
      if (oldest !== undefined) this.#removeDrop(oldest);
    }
    const id = `d${String(this.#nextDrop++)}`;
    const state = new CityDrop({ x, y, amount });
    this.#drops.set(id, { state, expiresAt: now + DROP_LIFETIME_MS, loose });
    this.state.drops.set(id, state);
  }

  #removeDrop(id: string): void {
    const drop = this.#drops.get(id);
    if (drop === undefined) return;
    for (const sim of this.#sims.values()) {
      if (sim.seesDrops.delete(id)) sim.view.remove(drop.state);
      sim.lastSeen.delete(id);
    }
    this.#drops.delete(id);
    this.state.drops.delete(id);
  }

  #collect(player: CityPlayer): void {
    for (const [id, drop] of this.#drops) {
      if (!canPickUp(player, drop.state)) continue;
      const took = takeFromPile(player.pocket ?? 0, drop.state.amount);
      if (took.left === drop.state.amount) continue;
      player.pocket = took.pocket;
      if (took.left === 0) this.#removeDrop(id);
      else drop.state.amount = took.left;
    }
  }

  // Expires old piles and scatters new loose coins on the rough streets.
  #tidyDrops(now: number): void {
    for (const [id, drop] of this.#drops) if (drop.expiresAt <= now) this.#removeDrop(id);
    if (now - this.#lastLooseMs < LOOSE_COINS_EVERY_MS || ROUGH_STREETS.length === 0) return;
    this.#lastLooseMs = now;
    let loose = 0;
    for (const drop of this.#drops.values()) if (drop.loose) loose++;
    if (loose >= LOOSE_COINS_LIVE) return;
    const spot = ROUGH_STREETS[this.random.int(ROUGH_STREETS.length)];
    if (spot !== undefined) this.#addDrop(spot.x, spot.y, LOOSE_COIN_MIN + this.random.int(LOOSE_COIN_MAX - LOOSE_COIN_MIN + 1), now, true);
  }

  // Inside the Mint Hall at its counter, where a deposit is taken just as at the hall's walls.
  #atTeller(sim: Sim, me: CityPlayer): boolean {
    return sim.room !== null && doorBySeed(me.inside)?.room === 'mintHall' && spotAt(me, sim.room.layout)?.kind === 'counter';
  }

  // A bed or the kitchen at home, the hospital desk, the chapel's candles, a temple cushion or a mandir's diya: back to full health, only while standing at one.
  #rest(sessionId: string, now: number): void {
    const sim = this.#sims.get(sessionId);
    const me = this.state.players.get(sessionId);
    if (sim === undefined || me === undefined || now - sim.lastRestMs < DOOR_TUNING.restGapMs) return;
    sim.lastRestMs = now;
    sim.lastActiveMs = now;
    const kind = sim.room === null ? null : spotAt(me, sim.room.layout)?.kind;
    const reason: RestReason = me.down ? 'down' : !REST_SPOTS.has(kind) ? 'notHere' : sim.health >= MAX_HEALTH ? 'full' : 'healed';
    if (reason === 'healed') {
      sim.health = MAX_HEALTH;
      me.health = MAX_HEALTH;
    }
    const result: RestResult = { ok: reason === 'healed', reason };
    sim.client.send(CITY_MESSAGES.REST, result);
  }

  // Carries the pocket into the wallet. The pocket is emptied first so the same coins can never be spent twice,
  // then whatever today's allowance or the wallet did not take is handed back.
  async #deposit(sessionId: string): Promise<void> {
    const sim = this.#sims.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (sim === undefined || player === undefined) return;
    sim.lastActiveMs = Date.now();
    const answer = (reason: DepositReason, paid: number, kept: number, today: number): void => {
      const result: DepositResult = { paid, kept, reason, today, limit: VAULT_DAILY_LIMIT };
      sim.client.send(CITY_MESSAGES.VAULT, result);
    };
    const pocket = player.pocket ?? 0;
    const profiles = roomPolicy().profiles;
    const refused: DepositReason | null = sim.depositing
      ? 'busy'
      : player.down || player.car !== '' || !(atVault(player) || this.#atTeller(sim, player))
        ? 'notAtVault'
        : pocket <= 0
          ? 'empty'
          : profiles === null || sim.profileId === null
            ? 'noProfile'
            : null;
    if (refused !== null || profiles === null || sim.profileId === null) {
      answer(refused ?? 'noProfile', 0, pocket, 0);
      return;
    }
    sim.depositing = true;
    player.pocket = 0;
    let paid = 0;
    let today = 0;
    let reason: DepositReason = 'error';
    try {
      const now = Date.now();
      const out = await profiles.store.change<{ paid: number; today: number; reason: DepositReason }>(sim.profileId, `vault:${randomBytes(12).toString('base64url')}`, now, (data) => {
        const day = dayFor(data.progress.day, now);
        const before = day.vault ?? 0;
        const amount = depositable(pocket, before);
        if (amount === 0) return { data, result: { paid: 0, today: before, reason: 'dailyLimit' } };
        const fee = credit(data.wallet, amount);
        if (!fee.ok) return { data, result: { paid: 0, today: before, reason: 'walletFull' } };
        const progress = { ...data.progress, day: { ...day, vault: before + amount } };
        return { data: { ...data, wallet: fee.value.wallet, progress }, result: { paid: amount, today: before + amount, reason: 'paid' } };
      });
      if (out.ok) ({ paid, today, reason } = out.result);
    } catch (error) {
      log.error('vault deposit failed', error, { roomId: this.roomId });
    } finally {
      sim.depositing = false;
    }
    const back = pocket - paid;
    const still = this.state.players.get(sessionId);
    if (still === undefined) return;
    const fits = Math.min(back, MAX_POCKET - (still.pocket ?? 0));
    still.pocket = (still.pocket ?? 0) + fits;
    if (back > fits) this.#addDrop(still.x, still.y, back - fits, Date.now(), false);
    answer(reason, paid, back, today);
  }

  // For tests: clear the street toughs away and keep them away.
  toughsOff(): void {
    this.#toughsOn = false;
    for (const id of [...this.#toughs.keys()]) {
      const body = this.state.players.get(id);
      for (const sim of this.#sims.values()) if (body !== undefined && sim.sees.delete(id)) sim.view.remove(body);
      this.state.players.delete(id);
      this.#toughs.delete(id);
    }
  }

  // For tests: the parked and driven cars.
  carList(): { id: string; x: number; y: number; heading: number; driver: string }[] {
    return [...this.#cars].map(([id, c]) => ({ id, x: c.state.x, y: c.state.y, heading: c.state.heading, driver: c.state.driver }));
  }

  // For tests: move a parked car somewhere, as a tow truck would.
  placeCar(id: string, x: number, y: number, heading: number): void {
    const car = this.#cars.get(id);
    if (car === undefined || car.state.driver !== '') return;
    car.state.x = x;
    car.state.y = y;
    car.state.heading = heading;
  }

  // For tests: the street toughs and where they stand.
  toughs(): { id: string; x: number; y: number; bully: boolean }[] {
    return [...this.#toughs].flatMap(([id, t]) => {
      const body = this.state.players.get(id);
      return body === undefined ? [] : [{ id, x: body.x, y: body.y, bully: t.bully }];
    });
  }

  // For tests: end a guardian's spawn protection early.
  shieldOff(sessionId: string): void {
    const sim = this.#sims.get(sessionId);
    if (sim !== undefined) sim.shieldUntil = 0;
  }

  // For tests: set a guardian's health, as a fight would have left it.
  hurt(sessionId: string, health: number): void {
    const sim = this.#sims.get(sessionId);
    if (sim !== undefined) sim.health = health;
  }

  // For tests: put a pile on the ground.
  dropCoins(x: number, y: number, amount: number): void {
    this.#addDrop(x, y, amount, Date.now(), false);
  }

  // Only the ids a client is sent: for tests and the HUD's "nearby" count.
  seenBy(sessionId: string): readonly string[] {
    return [...(this.#sims.get(sessionId)?.sees ?? [])];
  }

  async #wearLook(sessionId: string, profileId: string): Promise<void> {
    const profiles = roomPolicy().profiles;
    if (profiles === null) return;
    try {
      const look = (await loadProfile(profiles.store, profileId, Date.now())).look;
      const player = this.state.players.get(sessionId);
      if (player === undefined) return;
      dress(player, look);
    } catch (error) {
      log.warn('city look not loaded', { roomId: this.roomId, error: error instanceof Error ? error.name : 'unknown' });
    }
  }
}
