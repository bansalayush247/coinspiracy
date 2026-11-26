import {
  ClientState,
  ErrorCode,
  Room,
  ServerError,
  validate,
  type AuthContext,
  type Client,
  type RoomException,
  type RoomMethodName,
} from '@colyseus/core';
import { randomBytes } from 'node:crypto';
import { StateView } from '@colyseus/schema';
import {
  CLOSE_CODES,
  CONSENSUS_GOAL,
  JoinOptionsSchema,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MovePayloadSchema,
  NoPayloadSchema,
  CastVotePayloadSchema,
  FreezePayloadSchema,
  RemoveBotPayloadSchema,
  OpenTaskPayloadSchema,
  QuickChatPayloadSchema,
  ProposalPayloadSchema,
  SERVER_MESSAGES,
  SERVER_TICK_HZ,
  SetArenaPayloadSchema,
  SetTierPayloadSchema,
  TICK_SECONDS,
  TaskAnswerPayloadSchema,
  ARENAS,
  ARENA_IDS,
  arenaById,
  cryptoRandom,
  movementMap,
  nearestStandable,
  FINAL_SPAWN_FACTOR,
  actAt,
  blocksLeft,
  livenessStrikes,
  messageAllowed,
  playerTier,
  roomTier,
  stepMovement,
  threshold,
  tierPickable,
  tierRules,
  uniqueNickname,
  type Arena,
  type ArenaId,
  type ArenaRefused,
  type Audit,
  type BotsRefused,
  type ChatLine,
  type ChatMessage,
  type ClientMessageType,
  type CouncilRefused,
  type SabotageReady,
  type SabotageRefused,
  type CeremonyRefused,
  type CloseCode,
  type Forged,
  type Proposal,
  type OpenTaskPayload,
  type TaskAnswerPayload,
  type TaskClosed,
  type TaskOpened,
  type TaskRefused,
  type TaskResult,
  type TierId,
  type TierRefused,
  type Role,
  type Vec2,
  type Winner,
} from '@byzantine-council/shared';
import { SEASON_EVENTS, islandOpenFor, type Award, type MatchFacts, type SeasonEvent } from '@byzantine-council/shared/progression';
import { seasonAt } from '@byzantine-council/shared/seasons';
import { CitadelState, PlayerState, ProposalState, RecapEntry, VIEW_TAGS } from '@byzantine-council/shared/state';
import type { CeremonyFailure } from './ceremony.js';
import { MeetingDesk, type CouncilFailure } from './meeting.js';
import { profileIdFromCookieHeader } from './profile/session.js';
import { loadProfile } from './profile/store.js';
import { isCosmeticId } from '@byzantine-council/shared/economy';
import { awardMatch, type Payee } from './profile/rewards.js';
import type { SabotageFailure } from './sabotage.js';
import { MAX_BOTS_PER_ROOM, botManager, claimBotSeat, type SpawnRefusal } from './bots/index.js';
import { ipKey } from './clientIp.js';
import { holdSeat } from './scaling/index.js';
import { InputQueue, type MoveInput } from './inputQueue.js';
import { log } from './logger.js';
import { Match } from './match.js';
import { roomPolicy } from './policy.js';
import { claimRoomCode, releaseRoomCode } from './roomCodes.js';

const IDLE_CHECK_MS = 5_000;
// Private rooms often wait a while for friends, so they tolerate longer idling.
const PRIVATE_IDLE_FACTOR = 3;
// A kicked socket that ignores the close handshake is cut off after this.
const KICK_GRACE_MS = 2_000;
const WS_CLOSED = 3;

// Task timing reads a monotonic clock, so a wall-clock jump cannot stretch or skip solve windows and lockouts.
function taskClock(): number {
  return performance.now();
}

interface Auth {
  readonly nickname: string;
  readonly ipKey: string;
  // The guest profile behind this socket, from its signed cookie; null for no profile.
  readonly profileId: string | null;
  // A practice bot seated by this process's bot manager.
  readonly bot: boolean;
}
interface UserData {
  kicked: boolean;
}
export type CitadelClient = Client<{ userData: UserData; auth: Auth }>;

// Server-only per-player bookkeeping; never part of the synced state.
interface PlayerSim {
  readonly inputs: InputQueue;
  readonly ipKey: string;
  lastActiveMs: number;
  // True while a dropped player's held seat counts against their network.
  holdingSlot: boolean;
  // Kept here as well as on the client, so a dropped player's view still gets role reveals.
  readonly view: StateView;
  readonly profileId: string | null;
  // Arenas this guest's profile has opened (checked server-side from their progress).
  opened: ReadonlySet<ArenaId>;
  // The highest rule tier this guest has learned, from their progress; null until known (and for bots).
  tier: TierId | null;
}

// Typed server-to-client payloads.
interface ServerPayloads {
  [SERVER_MESSAGES.TASK_OPENED]: TaskOpened;
  [SERVER_MESSAGES.TASK_RESULT]: TaskResult;
  [SERVER_MESSAGES.TASK_REFUSED]: TaskRefused;
  [SERVER_MESSAGES.TASK_CLOSED]: TaskClosed;
  [SERVER_MESSAGES.FORGED]: Forged;
  [SERVER_MESSAGES.AUDIT]: Audit;
  [SERVER_MESSAGES.CEREMONY_REFUSED]: CeremonyRefused;
  [SERVER_MESSAGES.COUNCIL_REFUSED]: CouncilRefused;
  [SERVER_MESSAGES.SABOTAGE_REFUSED]: SabotageRefused;
  [SERVER_MESSAGES.SABOTAGE_READY]: SabotageReady;
  [SERVER_MESSAGES.MATCH_REWARDS]: Award;
  [SERVER_MESSAGES.BOTS_REFUSED]: BotsRefused;
  [SERVER_MESSAGES.ARENA_REFUSED]: ArenaRefused;
  [SERVER_MESSAGES.TIER_REFUSED]: TierRefused;
}

// Bots seated per host network in this process, so one network cannot take every bot (one room's worth at most).
const botNetworks = new Map<string, { readonly key: string; count: number }>();
function botsOfNetwork(key: string, exceptRoom: string): number {
  let n = 0;
  for (const [roomId, entry] of botNetworks) if (entry.key === key && roomId !== exceptRoom) n += entry.count;
  return n;
}

// What the host is told when the bot manager could not seat a bot.
function botRefusal(reason: SpawnRefusal | undefined): BotsRefused['reason'] {
  if (reason === 'roomFull' || reason === 'roomCap') return 'roomFull';
  if (reason === 'roomLocked') return 'notLobby';
  if (reason === 'busy') return 'busy';
  if (reason === 'processCap') return 'limit';
  if (reason === 'stopped') return 'disabled';
  return 'failed';
}

// Colyseus types the transport socket only as an EventEmitter; at runtime it is a ws WebSocket.
function socketOf(client: CitadelClient): { readyState?: unknown; terminate?: unknown } {
  return client.ref as unknown as { readyState?: unknown; terminate?: unknown };
}

export class CitadelRoom extends Room<{ state: CitadelState; client: CitadelClient }> {
  override maxClients = MAX_PLAYERS;
  override state = new CitadelState();
  // 20 moves a second plus headroom; above this Colyseus closes the socket with 4002.
  override maxMessagesPerSecond = 40;
  // Seats reserved over HTTP but never claimed over WebSocket expire after this.
  override seatReservationTimeout = 8;

  readonly #sims = new Map<string, PlayerSim>();
  #code = '';
  #failed = false;
  #match: Match | null = null;
  // Players who left mid-match, kept server-side for the recap.
  #departed: { id: string; name: string; seat: number; role: Role }[] = [];
  // Set while this room holds an explicit lock for a match; cleared when it reopens.
  #matchLock = false;
  #ticks = 0;
  #desk: MeetingDesk | null = null;
  // The block clock: when the match started and how long councils have paused it.
  #clockStart = 0;
  #pausedMs = 0;
  // For rewards: this match's random id, when it began, who joined it, and who was removed for idling.
  #matchId = '';
  #matchStartedAt = 0;
  // The arena the current match started on, for its rewards.
  #matchArena: ArenaId = 'citadel';
  // The host's rule tier in a private lobby; null follows the players (see roomTier).
  #tierPick: TierId | null = null;
  #dealt = 0;
  #dealtHumans = 0;
  readonly #idled = new Set<string>();
  // Last lobby chat line per player, for pacing outside matches.
  readonly #lobbyChatAt = new Map<string, number>();

  // A payload that fails the shared schema closes the socket with 4002, as do unknown types.
  override messages = {
    move: validate(MovePayloadSchema, (client: CitadelClient, input: MoveInput) => {
      this.#onMove(client, input);
    }),
    startMatch: validate(NoPayloadSchema, (client: CitadelClient) => {
      this.#startMatch(client);
    }),
    openTask: validate(OpenTaskPayloadSchema, (client: CitadelClient, payload: OpenTaskPayload) => {
      this.#openTask(client, payload);
    }),
    taskAnswer: validate(TaskAnswerPayloadSchema, (client: CitadelClient, payload: TaskAnswerPayload) => {
      this.#answerTask(client, payload);
    }),
    closeTask: validate(NoPayloadSchema, (client: CitadelClient) => {
      if (this.#active(client) !== null) this.#match?.closeTask(client.sessionId);
    }),
    signProposal: validate(ProposalPayloadSchema, (client: CitadelClient, payload: { proposalId: string }) => {
      this.#respond(client, payload.proposalId, true);
    }),
    refuseProposal: validate(ProposalPayloadSchema, (client: CitadelClient, payload: { proposalId: string }) => {
      this.#respond(client, payload.proposalId, false);
    }),
    forgeProposal: validate(NoPayloadSchema, (client: CitadelClient) => {
      this.#forge(client);
    }),
    auditProposal: validate(ProposalPayloadSchema, (client: CitadelClient, payload: { proposalId: string }) => {
      this.#audit(client, payload.proposalId);
    }),
    callCouncil: validate(NoPayloadSchema, (client: CitadelClient) => {
      this.#callCouncil(client);
    }),
    castVote: validate(CastVotePayloadSchema, (client: CitadelClient, payload: { target: string }) => {
      this.#vote(client, payload.target);
    }),
    quickChat: validate(QuickChatPayloadSchema, (client: CitadelClient, payload: { chat: ChatMessage }) => {
      this.#chat(client, payload.chat);
    }),
    partition: validate(NoPayloadSchema, (client: CitadelClient) => {
      this.#partition(client);
    }),
    freeze: validate(FreezePayloadSchema, (client: CitadelClient, payload: { targetId: string }) => {
      this.#freeze(client, payload.targetId);
    }),
    addBot: validate(NoPayloadSchema, (client: CitadelClient) => {
      void this.#addBot(client);
    }),
    removeBot: validate(RemoveBotPayloadSchema, (client: CitadelClient, payload: { targetId: string }) => {
      void this.#removeBot(client, payload.targetId);
    }),
    setArena: validate(SetArenaPayloadSchema, (client: CitadelClient, payload: { arena: ArenaId }) => {
      this.#setArena(client, payload.arena);
    }),
    setTier: validate(SetTierPayloadSchema, (client: CitadelClient, payload: { tier: TierId }) => {
      this.#setTier(client, payload.tier);
    }),
  };

  // HTTP matchmake time, before any room or seat exists; the IP comes from the sanitized headers.
  static override async onAuth(_token: string, options: unknown, context: AuthContext): Promise<true> {
    const key = ipKey(context.ip);
    const policy = roomPolicy();
    // Each call reserves a seat for seatReservationTimeout, so bursts are capped as well as the rate.
    if (!(await policy.matchmake.take(key)) || !(await policy.reservations.take(key))) {
      throw new ServerError(CLOSE_CODES.RATE_LIMITED, 'Too many attempts. Wait a moment and try again.');
    }
    if (!JoinOptionsSchema.safeParse(options).success) {
      throw new ServerError(ErrorCode.AUTH_FAILED, 'Invalid nickname or room options.');
    }
    return true;
  }

  override async onCreate(options: unknown): Promise<void> {
    const parsed = JoinOptionsSchema.safeParse(options);
    if (!parsed.success) throw new ServerError(ErrorCode.APPLICATION_ERROR, 'Invalid room options.');
    this.#code = await claimRoomCode(this.presence, this.roomId);
    this.state.code = this.#code;
    if (parsed.data.private === true || parsed.data.ceremony === true) {
      this.state.isPrivate = true;
      this.state.ceremony = parsed.data.ceremony === true;
      await this.setPrivate(true);
    }
    this.#syncTier();
    // Order matters: start the loop, then disable timed patches, then patch once per step.
    this.setFixedTimestep(() => {
      this.step();
    }, SERVER_TICK_HZ);
    this.patchRate = null;
    this.clock.setInterval(() => {
      this.#kickIdle();
    }, IDLE_CHECK_MS);
    this.#syncChain();
    log.info('room created', { roomId: this.roomId, private: this.state.isPrivate });
  }

  // WebSocket connect time: the socket's address is known here and options are checked again.
  override async onAuth(client: CitadelClient, options: unknown, context: AuthContext): Promise<Auth> {
    const parsed = JoinOptionsSchema.safeParse(options);
    if (!parsed.success) throw new ServerError(ErrorCode.AUTH_FAILED, 'Invalid nickname or room options.');
    // The room is locked during a match, but a seat reserved just before the start still arrives here.
    if (this.state.phase !== 'lobby') throw new ServerError(CLOSE_CODES.MATCH_IN_PROGRESS, 'A match is in progress.');
    const key = ipKey(context.ip);
    // A seat the bot manager reserved (one-shot ticket, loopback only) skips the per-network count and has no profile.
    if (claimBotSeat(client.sessionId, this.roomId, context.ip)) return { nickname: parsed.data.nickname, ipKey: key, profileId: null, bot: true };
    // Released when the socket closes, including a close while the count is being checked.
    if (!(await holdSeat(roomPolicy().ipSlots, key, client.ref))) {
      throw new ServerError(CLOSE_CODES.TOO_MANY_CONNECTIONS, 'Too many players from your network.');
    }
    const profiles = roomPolicy().profiles;
    const profileId = profiles === null ? null : profileIdFromCookieHeader(profiles.keys, context.headers.get('cookie'), Date.now());
    return { nickname: parsed.data.nickname, ipKey: key, profileId, bot: false };
  }

  override onJoin(client: CitadelClient): void {
    const auth = client.auth;
    const seat = this.#freeSeat();
    const spawn = seat === null ? undefined : this.#arena().spawns[seat];
    if (auth === undefined || seat === null || spawn === undefined) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, 'This room is full.');
    }
    const names = Array.from(this.state.players.values(), (p) => p.name);
    const player = new PlayerState({ name: uniqueNickname(auth.nickname, names), seat, x: spawn.x, y: spawn.y, bot: auth.bot });
    player.ack = 0;
    this.state.players.set(client.sessionId, player);
    // Attach first: a StateView only accepts instances that are already in the state.
    const view = new StateView();
    view.add(player, VIEW_TAGS.OWNER);
    client.view = view;
    client.userData = { kicked: false };
    this.#sims.set(client.sessionId, { inputs: new InputQueue(), ipKey: auth.ipKey, lastActiveMs: Date.now(), holdingSlot: false, view, profileId: auth.profileId, opened: new Set<ArenaId>(), tier: null });
    if (this.state.hostId === '' && !auth.bot) this.state.hostId = client.sessionId;
    if (auth.profileId !== null) void this.#wearLook(client.sessionId, auth.profileId);
    // Bots dress up from the shop shelves, so practice lobbies look lived in.
    if (auth.bot) {
      const pick = (ids: readonly string[]): string => (cryptoRandom.int(2) === 0 ? '' : (ids[cryptoRandom.int(ids.length)] ?? ''));
      player.hat = pick(['hat:straw', 'hat:cap', 'hat:bucket']);
      player.shades = cryptoRandom.int(4) === 0 ? 'shades:classic' : '';
    }
    log.info('player joined', { roomId: this.roomId, sessionId: client.sessionId, seat, players: this.state.players.size });
  }

  // Unexpected disconnect: hold the seat. Kicked players are never allowed back.
  override async onDrop(client: CitadelClient, code?: number): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (player === undefined || client.userData?.kicked === true) return;
    player.status = 'disconnected';
    // A challenge cannot be finished from a dropped socket; the player reopens it on return.
    this.#match?.closeTask(client.sessionId);
    this.#match?.ceremony.cancelAudit(client.sessionId);
    const sim = this.#sims.get(client.sessionId);
    if (sim !== undefined) {
      sim.inputs.reset();
      // The socket's own slot was freed when it closed; the held seat still counts.
      if (!sim.holdingSlot) {
        roomPolicy().ipSlots.forceAcquire(sim.ipKey);
        sim.holdingSlot = true;
      }
    }
    log.info('player dropped', { roomId: this.roomId, sessionId: client.sessionId, code });
    try {
      await this.allowReconnection(client, roomPolicy().reconnectSeconds);
    } catch {
      // Window expired or the room is closing; onLeave runs next.
    }
  }

  // onAuth does not run on reconnect, so the new socket is counted here, but only while it is
  // open: a socket that already closed will never emit 'close' again to release the count.
  override onReconnect(client: CitadelClient): void {
    const { ipSlots } = roomPolicy();
    const sim = this.#sims.get(client.sessionId);
    if (sim?.holdingSlot === true) {
      ipSlots.release(sim.ipKey);
      sim.holdingSlot = false;
    }
    const key = client.auth?.ipKey;
    if (key !== undefined && socketOf(client).readyState !== WS_CLOSED) {
      ipSlots.forceAcquire(key);
      client.ref.once('close', () => {
        ipSlots.release(key);
      });
    }
    const player = this.state.players.get(client.sessionId);
    if (player !== undefined) {
      player.status = 'active';
      player.ack = 0;
    }
    if (sim !== undefined) {
      sim.inputs.reset();
      sim.lastActiveMs = Date.now();
    }
    log.info('player reconnected', { roomId: this.roomId, sessionId: client.sessionId });
  }

  // Final leave: consented, kicked, or the reconnection window expired.
  override onLeave(client: CitadelClient, code?: number): void {
    const sim = this.#sims.get(client.sessionId);
    if (sim?.holdingSlot === true) roomPolicy().ipSlots.release(sim.ipKey);
    const leaving = this.state.players.get(client.sessionId);
    const role = this.#match?.role(client.sessionId);
    if (leaving !== undefined && role !== undefined && this.state.phase === 'playing') {
      this.#departed.push({ id: client.sessionId, name: leaving.name, seat: leaving.seat, role });
    }
    this.state.players.delete(client.sessionId);
    this.#sims.delete(client.sessionId);
    this.#syncBotCount();
    this.#syncArenaAccess();
    this.#syncTier();
    this.#lobbyChatAt.delete(client.sessionId);
    client.view?.dispose();
    if (this.state.hostId === client.sessionId) this.state.hostId = this.#nextHost();
    if (this.#match !== null) {
      // Gone for good: no longer a member, which can end the match either way. The bar never moves here.
      this.#match.leave(client.sessionId);
      if (this.state.phase === 'playing') this.#checkWinner();
    } else if (this.#matchLock) {
      // Back in the lobby and a seat just freed up.
      this.#matchLock = false;
      void this.unlock();
    }
    log.info('player left', { roomId: this.roomId, sessionId: client.sessionId, code, players: this.state.players.size });
  }

  override async onDispose(): Promise<void> {
    botNetworks.delete(this.roomId);
    for (const sim of this.#sims.values()) if (sim.holdingSlot) roomPolicy().ipSlots.release(sim.ipKey);
    this.#sims.clear();
    if (this.#code !== '') await releaseRoomCode(this.presence, this.#code, this.roomId);
    log.info('room disposed', { roomId: this.roomId });
  }

  // Without this hook a throw in the step loop or a timer would take down the whole process.
  override onUncaughtException(error: RoomException, method: RoomMethodName): void {
    if (error.cause instanceof ServerError) return;
    log.error('room handler threw', error.cause ?? error, { roomId: this.roomId, method });
    const loop = method === 'setFixedTimestep' || method === 'setTimestep' || method === 'setInterval' || method === 'setTimeout';
    if (loop && !this.#failed) {
      // Fail closed: state may be inconsistent after a throw mid-step.
      this.#failed = true;
      this.disconnect(CLOSE_CODES.ROOM_FAILED).catch(() => undefined);
    }
  }

  // Sets LEAVING first so frames still in flight are ignored; onDrop sees `kicked` and holds no seat.
  kick(client: CitadelClient, code: CloseCode, reason: string): void {
    client.userData = { kicked: true };
    client.state = ClientState.LEAVING;
    client.leave(code, reason);
    setTimeout(() => {
      const socket = socketOf(client);
      if (socket.readyState !== WS_CLOSED && typeof socket.terminate === 'function') socket.terminate.call(socket);
    }, KICK_GRACE_MS).unref();
    log.info('player kicked', { roomId: this.roomId, sessionId: client.sessionId, code });
  }

  // One fixed tick: apply queued moves, then send a single patch.
  protected step(): void {
    const now = performance.now();
    const arena = this.#arena();
    // On Watchtower Peaks a partition takes the bridges between the ranges down.
    const ground = movementMap(arena, this.state.partition > 0);
    for (const [sessionId, sim] of this.#sims) {
      const player = this.state.players.get(sessionId);
      if (player === undefined || player.status !== 'active') continue;
      if (ground !== arena.map) {
        // Anyone on a bridge as it comes down steps back onto the nearest ledge.
        const safe = nearestStandable(ground, { x: player.x, y: player.y });
        if (safe.x !== player.x || safe.y !== player.y) {
          player.x = safe.x;
          player.y = safe.y;
          sim.inputs.reset();
        }
      }
      // Councils and rotated-out keys hold still; inputs are still acknowledged so prediction settles.
      const frozen = player.out || player.frozen > 0 || this.#desk?.active === true;
      sim.inputs.drain(now, (input) => {
        if (frozen) return;
        const next = stepMovement({ x: player.x, y: player.y }, { x: input.dx, y: input.dy }, TICK_SECONDS, ground);
        this.#match?.noteMove(sessionId, Math.hypot(next.x - player.x, next.y - player.y));
        if (next.x !== player.x) player.x = next.x;
        if (next.y !== player.y) player.y = next.y;
      });
      if (player.ack !== sim.inputs.ack) player.ack = sim.inputs.ack;
    }
    if (this.#match !== null && this.state.phase === 'playing') {
      if (this.#desk?.active === true) {
        this.#tickCouncil(this.#match, this.#desk);
      } else {
        for (const { id, reason } of this.#match.sweep(taskClock(), (id) => this.#positionOf(id))) {
          this.#sendTo(id, SERVER_MESSAGES.TASK_CLOSED, { reason });
        }
        this.#tickSabotage(this.#match);
        // An outage can end the match inside the sabotage tick.
        if (!this.#match.finished) this.#tickCeremony(this.#match);
        if (!this.#match.finished) this.#tickClock(this.#match);
      }
    }
    this.#ticks += 1;
    if (this.#ticks % SERVER_TICK_HZ === 0) this.#syncChain();
    this.broadcastPatch();
  }

  // Shows a guest's worn hat, eyewear and outfit trim; only catalogue ids ever reach the state.
  async #wearLook(sessionId: string, profileId: string): Promise<void> {
    const profiles = roomPolicy().profiles;
    if (profiles === null) return;
    try {
      const data = await loadProfile(profiles.store, profileId, Date.now());
      const player = this.state.players.get(sessionId);
      if (player === undefined) return;
      const look = data.look;
      player.hat = look.hat !== null && isCosmeticId(look.hat) ? look.hat : '';
      player.shades = look.shades !== null && isCosmeticId(look.shades) ? look.shades : '';
      player.outfit = isCosmeticId(look.outfit) ? look.outfit : '';
      const sim = this.#sims.get(sessionId);
      if (sim !== undefined) {
        const opened = new Set<ArenaId>();
        for (const arena of ARENA_IDS) if (islandOpenFor(ARENAS[arena].island, data.progress.xp, data.progress.academy)) opened.add(arena);
        sim.opened = opened;
        sim.tier = playerTier(data.progress.xp, data.progress.academy);
        this.#syncArenaAccess();
        this.#syncTier();
      }
    } catch (error) {
      log.warn('look not loaded', { roomId: this.roomId, error: error instanceof Error ? error.name : 'unknown' });
    }
  }

  // The host fills empty lobby seats with practice bots, one at a time.
  async #addBot(client: CitadelClient): Promise<void> {
    const refusal = this.#botRequestRefusal(client);
    if (refusal !== null) {
      this.#sendTo(client.sessionId, SERVER_MESSAGES.BOTS_REFUSED, { reason: refusal });
      return;
    }
    const manager = botManager();
    const key = this.#sims.get(client.sessionId)?.ipKey;
    if (manager === null || key === undefined) return;
    if (botsOfNetwork(key, this.roomId) + this.#botCount() >= MAX_BOTS_PER_ROOM) {
      this.#sendTo(client.sessionId, SERVER_MESSAGES.BOTS_REFUSED, { reason: 'limit' });
      return;
    }
    // Counted against the network that seated them, even if the host role later moves.
    if (!botNetworks.has(this.roomId)) botNetworks.set(this.roomId, { key, count: 0 });
    const result = await manager.spawn(this.roomId, 1);
    if (result.added === 0) this.#sendTo(client.sessionId, SERVER_MESSAGES.BOTS_REFUSED, { reason: botRefusal(result.refused) });
    this.#syncBotCount();
  }

  #botCount(): number {
    let n = 0;
    for (const p of this.state.players.values()) if (p.bot) n += 1;
    return n;
  }

  #syncBotCount(): void {
    const entry = botNetworks.get(this.roomId);
    if (entry === undefined) return;
    entry.count = this.#botCount();
    if (entry.count === 0) botNetworks.delete(this.roomId);
  }

  async #removeBot(client: CitadelClient, targetId: string): Promise<void> {
    const refusal = this.#botRequestRefusal(client, true);
    if (refusal !== null) {
      this.#sendTo(client.sessionId, SERVER_MESSAGES.BOTS_REFUSED, { reason: refusal });
      return;
    }
    if (this.state.players.get(targetId)?.bot !== true || !(await (botManager()?.remove(this.roomId, targetId) ?? Promise.resolve(false)))) {
      this.#sendTo(client.sessionId, SERVER_MESSAGES.BOTS_REFUSED, { reason: 'notABot' });
    }
  }

  #botRequestRefusal(client: CitadelClient, removing = false): BotsRefused['reason'] | null {
    if (this.#active(client) === null || client.auth?.bot === true) return 'notHost';
    if (botManager() === null) return 'disabled';
    if (client.sessionId !== this.state.hostId) return 'notHost';
    if (this.state.phase !== 'lobby' || this.#match !== null) return 'notLobby';
    if (!removing && this.state.players.size >= MAX_PLAYERS) return 'roomFull';
    return null;
  }

  #arena(): Arena {
    return arenaById(this.state.arena);
  }

  // An island arena is open to the room while anyone in it has opened the island; if they leave
  // before the match starts, the lobby goes back to the Citadel.
  #syncArenaAccess(): void {
    const opened = new Set<ArenaId>(['citadel']);
    for (const sim of this.#sims.values()) for (const a of sim.opened) opened.add(a);
    this.state.reefOpen = opened.has('reef');
    this.state.peaksOpen = opened.has('peaks');
    if (!opened.has(this.#arena().id) && this.state.phase === 'lobby' && this.#match === null) this.#moveTo('citadel');
  }

  #arenaOpen(arena: ArenaId): boolean {
    return arena === 'citadel' || (arena === 'reef' && this.state.reefOpen) || (arena === 'peaks' && this.state.peaksOpen);
  }

  // The host of a private lobby picks the arena; quick-match rooms always play the Citadel.
  #setArena(client: CitadelClient, arena: ArenaId): void {
    const refusal: ArenaRefused['reason'] | null =
      this.#active(client) === null || client.auth?.bot === true || client.sessionId !== this.state.hostId
        ? 'notHost'
        : !this.state.isPrivate
          ? 'notPrivate'
          : this.state.phase !== 'lobby' || this.#match !== null
            ? 'notLobby'
            : !this.#arenaOpen(arena)
              ? 'locked'
              : null;
    if (refusal !== null) this.#sendTo(client.sessionId, SERVER_MESSAGES.ARENA_REFUSED, { reason: refusal });
    else if (arena !== this.state.arena) this.#moveTo(arena);
  }

  // The host of a private lobby picks the rule tier; a story signing ceremony keeps its ceremonies.
  #setTier(client: CitadelClient, tier: TierId): void {
    const refusal: TierRefused['reason'] | null =
      this.#active(client) === null || client.auth?.bot === true || client.sessionId !== this.state.hostId
        ? 'notHost'
        : !this.state.isPrivate
          ? 'notPrivate'
          : this.state.phase !== 'lobby' || this.#match !== null
            ? 'notLobby'
            : !tierPickable(tier, this.state.ceremony)
              ? 'locked'
              : null;
    if (refusal !== null) {
      this.#sendTo(client.sessionId, SERVER_MESSAGES.TIER_REFUSED, { reason: refusal });
      return;
    }
    this.#tierPick = tier;
    this.#syncTier();
    log.info('tier picked', { roomId: this.roomId, tier });
  }

  // Lobby only: the tier follows who is seated (and the host's pick); a running match keeps the tier it started with.
  #syncTier(): void {
    if (this.state.phase !== 'lobby' || this.#match !== null) return;
    const players = [...this.#sims.values()].map((sim) => sim.tier);
    const tier = roomTier({ players, picked: this.state.isPrivate ? this.#tierPick : null, ceremonyRoom: this.state.ceremony });
    if (this.state.tier !== tier) this.state.tier = tier;
  }

  // A Byzantine or ceremony action this match's tier does not have is refused before anything else looks at it.
  #offTier(client: CitadelClient, type: ClientMessageType): boolean {
    if (messageAllowed(this.state.tier, type)) return false;
    if (type === 'partition' || type === 'freeze') this.#sabotageRefuse(client, { ok: false, reason: 'offTier' });
    else this.#refuse(client, { ok: false, reason: 'offTier' });
    return true;
  }

  // Everyone in the lobby walks over to the new arena's square, each to their own seat's spot.
  #moveTo(arena: ArenaId): void {
    this.state.arena = arena;
    const spawns = arenaById(arena).spawns;
    for (const [id, p] of this.state.players) {
      const spawn = spawns[p.seat];
      if (spawn === undefined) continue;
      p.x = spawn.x;
      p.y = spawn.y;
      this.#sims.get(id)?.inputs.reset();
    }
    log.info('arena changed', { roomId: this.roomId, arena });
  }

  // The host starts a match once 5-9 guardians are present and connected.
  #startMatch(client: CitadelClient): void {
    if (this.#active(client) === null || this.state.phase !== 'lobby' || this.#match !== null) return;
    if (client.sessionId !== this.state.hostId) return;
    const players = [...this.state.players];
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) return;
    if (players.some(([, p]) => p.status !== 'active')) return;

    const policy = roomPolicy();
    const arena = this.#arena();
    this.#syncTier();
    const match = new Match(players.map(([id]) => id), policy.taskTiming, policy.ceremonyTiming, taskClock(), cryptoRandom, policy.sabotageTiming, arena, tierRules(this.state.tier));
    this.#match = match;
    this.#desk = new MeetingDesk(policy.councilTiming, taskClock(), arena.seal);
    this.#clockStart = taskClock();
    this.#pausedMs = 0;
    this.#matchId = randomBytes(9).toString('base64url');
    this.#matchStartedAt = Date.now();
    this.#matchArena = arena.id;
    this.#dealt = players.length;
    this.#dealtHumans = players.filter(([, p]) => !p.bot).length;
    this.#idled.clear();
    this.state.act = 'calm';
    this.state.blocksLeft = policy.pacing.totalBlocks;
    this.#resetCouncil();
    for (const [id, player] of players) {
      player.role = match.role(id);
      player.out = false;
      player.frozen = 0;
      player.tasks = match.assigned(id);
      player.tasksDone = 0;
      const spawn = arena.spawns[player.seat];
      if (spawn !== undefined) {
        player.x = spawn.x;
        player.y = spawn.y;
      }
    }
    // Everyone sees their own role; Byzantines also see each other's.
    const byzantines = match.byzantines();
    for (const [id, sim] of this.#sims) {
      const own = this.state.players.get(id);
      if (own === undefined) continue;
      sim.view.add(own, VIEW_TAGS.ROLE);
      if (match.role(id) !== 'byzantine') continue;
      for (const other of byzantines) {
        const fellow = this.state.players.get(other);
        if (other !== id && fellow !== undefined) sim.view.add(fellow, VIEW_TAGS.ROLE);
      }
    }
    this.#departed = [];
    this.state.consensus = match.consensus();
    this.state.byzantines = byzantines.length;
    this.state.proposals.clear();
    this.state.livenessStrikes = 0;
    this.state.signaturesNeeded = threshold(players.length);
    this.#resetSabotageState();
    this.state.winner = '';
    this.state.winReason = '';
    this.state.phase = 'playing';
    this.#matchLock = true;
    void this.lock();
    this.#sendReadiness(match);
    log.info('match started', { roomId: this.roomId, players: players.length, arena: arena.id, tier: this.state.tier });
  }

  #openTask(client: CitadelClient, payload: OpenTaskPayload): void {
    const play = this.#inPlay(client);
    if (play === null) return;
    const { player, match } = play;
    const tip = roomPolicy().chain.current().height;
    const outcome = match.openTask(client.sessionId, payload.kind, { x: player.x, y: player.y }, taskClock(), tip);
    if (outcome.ok) {
      client.send(SERVER_MESSAGES.TASK_OPENED, { id: outcome.id, challenge: outcome.challenge } satisfies TaskOpened);
    } else {
      const refusal: TaskRefused = outcome.retryInMs === undefined ? { reason: outcome.reason } : { reason: outcome.reason, retryInMs: outcome.retryInMs };
      client.send(SERVER_MESSAGES.TASK_REFUSED, refusal);
    }
  }

  #answerTask(client: CitadelClient, payload: TaskAnswerPayload): void {
    const play = this.#inPlay(client);
    if (play === null) return;
    const { player, match } = play;
    const outcome = match.answer(client.sessionId, payload.id, payload.answer, { x: player.x, y: player.y }, taskClock());
    if (outcome.ok) {
      player.tasksDone = outcome.done;
      if (outcome.counted) this.state.consensus = match.consensus();
      client.send(SERVER_MESSAGES.TASK_RESULT, { id: payload.id, ok: true } satisfies TaskResult);
      this.#checkWinner();
    } else if (outcome.reason === 'wrong') {
      client.send(SERVER_MESSAGES.TASK_RESULT, { id: payload.id, ok: false, retryInMs: outcome.retryInMs } satisfies TaskResult);
    } else if (outcome.reason !== 'ignored') {
      client.send(SERVER_MESSAGES.TASK_CLOSED, { reason: outcome.reason } satisfies TaskClosed);
    }
  }

  // A guardian signs or refuses an open withdrawal, from anywhere in the citadel.
  #respond(client: CitadelClient, proposalId: string, sign: boolean): void {
    const play = this.#inPlay(client);
    if (play === null || this.#offTier(client, sign ? 'signProposal' : 'refuseProposal')) return;
    const { match } = play;
    // A partitioned federation cannot gather signatures; the deadlines keep running.
    if (match.sabotage.partitioned) {
      this.#refuse(client, { ok: false, reason: 'partitioned' });
      return;
    }
    const outcome = match.ceremony.respond(client.sessionId, proposalId, sign, match.guardians(), this.#ticks);
    if (!outcome.ok) {
      this.#refuse(client, outcome);
      return;
    }
    match.noteResponse(client.sessionId, outcome.proposal, sign);
    this.#syncProposals(match);
    if (outcome.proposal.status !== 'open') this.#checkWinner();
  }

  #forge(client: CitadelClient): void {
    const play = this.#inPlay(client);
    if (play === null || this.#offTier(client, 'forgeProposal')) return;
    const { player, match } = play;
    const outcome = match.ceremony.forge(client.sessionId, match.role(client.sessionId), { x: player.x, y: player.y }, taskClock(), this.#ticks);
    if (!outcome.ok) {
      this.#refuse(client, outcome);
      return;
    }
    // Byzantines work as a team: every one still here learns which proposal is theirs.
    for (const id of match.byzantines()) this.#sendTo(id, SERVER_MESSAGES.FORGED, { proposalId: outcome.proposalId });
    this.#syncProposals(match);
    log.info('proposal forged', { roomId: this.roomId });
  }

  #audit(client: CitadelClient, proposalId: string): void {
    const play = this.#inPlay(client);
    if (play === null || this.#offTier(client, 'auditProposal')) return;
    const { player, match } = play;
    const outcome = match.ceremony.startAudit(client.sessionId, proposalId, { x: player.x, y: player.y }, taskClock());
    if (!outcome.ok) {
      this.#refuse(client, outcome);
      return;
    }
    client.send(SERVER_MESSAGES.AUDIT, { status: 'started', proposalId, ms: roomPolicy().ceremonyTiming.auditMs } satisfies Audit);
  }

  #refuse(client: CitadelClient, outcome: CeremonyFailure): void {
    const refusal: CeremonyRefused = outcome.retryInMs === undefined ? { reason: outcome.reason } : { reason: outcome.reason, retryInMs: outcome.retryInMs };
    client.send(SERVER_MESSAGES.CEREMONY_REFUSED, refusal);
  }

  #tickCeremony(match: Match): void {
    const events = match.ceremony.tick(taskClock(), this.#ticks, match.guardians(), (id) => this.#positionOf(id));
    for (const a of events.audits) {
      const payload: Audit = a.status === 'done' ? { status: 'done', proposalId: a.proposalId, forged: a.forged } : { status: 'cancelled', proposalId: a.proposalId };
      this.#sendTo(a.id, SERVER_MESSAGES.AUDIT, payload);
    }
    this.#syncProposals(match);
    if (events.closed.length > 0) this.#checkWinner();
  }

  // Copies the visible proposals into the synced state, touching only fields that changed.
  #syncProposals(match: Match, revealAll = false): void {
    const visible = match.ceremony.visible();
    const list = this.state.proposals;
    // Lengths match before ids are compared, so every index read is in range.
    if (list.length !== visible.length || visible.some((p, i) => list.at(i).id !== p.id)) {
      list.clear();
      for (const p of visible) list.push(new ProposalState({ id: p.id, amount: p.amount }));
    }
    list.forEach((s, i) => {
      const p = visible[i];
      if (p !== undefined) this.#syncProposal(s, p, revealAll);
    });
    const strikes = livenessStrikes(match.ceremony.proposals) + match.sabotage.outages;
    if (this.state.livenessStrikes !== strikes) this.state.livenessStrikes = strikes;
    const needed = threshold(Math.max(1, match.guardians().filter((g) => g.status !== 'rotatedOut').length));
    if (this.state.signaturesNeeded !== needed) this.state.signaturesNeeded = needed;
  }

  #syncProposal(s: ProposalState, p: Proposal, revealAll: boolean): void {
    if (s.status !== p.status) s.status = p.status;
    const left = p.status === 'open' ? Math.max(0, Math.min(255, Math.ceil((p.expiresAtTick - this.#ticks) / SERVER_TICK_HZ))) : 0;
    if (s.secondsLeft !== left) s.secondsLeft = left;
    // Responses only ever grow, so appending keeps patches small.
    for (let i = s.signers.length; i < p.signatures.length; i++) s.signers.push(p.signatures[i] ?? '');
    for (let i = s.refusers.length; i < p.refusals.length; i++) s.refusers.push(p.refusals[i] ?? '');
    const verdict = p.status !== 'open' || revealAll ? (p.forged ? 'forged' : 'legit') : '';
    if (s.verdict !== verdict) s.verdict = verdict;
  }

  // A connected federation member during open play: not in a council, not rotated out.
  #inPlay(client: CitadelClient): { player: PlayerState; match: Match } | null {
    const player = this.#active(client);
    const match = this.#match;
    if (player === null || match === null || this.state.phase !== 'playing') return null;
    if (this.#desk?.active === true || !match.isMember(client.sessionId) || match.sabotage.isFrozen(client.sessionId)) return null;
    return { player, match };
  }

  #callCouncil(client: CitadelClient): void {
    const play = this.#inPlay(client);
    const desk = this.#desk;
    if (play === null || desk === null) {
      if (this.#desk?.active !== true && this.state.phase === 'playing') this.#councilRefuse(client, { ok: false, reason: 'cannotAct' });
      return;
    }
    const { player, match } = play;
    const outcome = desk.call(client.sessionId, { x: player.x, y: player.y }, match.guardians(), taskClock(), this.#ticks);
    if (!outcome.ok) {
      this.#councilRefuse(client, outcome);
      return;
    }
    // Everyone gathers at the seal; open tasks and audits stop.
    for (const id of match.finishOpenTasks()) this.#sendTo(id, SERVER_MESSAGES.TASK_CLOSED, { reason: 'council' });
    for (const [id, p] of this.state.players) {
      const proposalId = match.ceremony.cancelAudit(id);
      if (proposalId !== null) this.#sendTo(id, SERVER_MESSAGES.AUDIT, { status: 'cancelled', proposalId });
      const spawn = this.#arena().spawns[p.seat];
      if (spawn !== undefined && !p.out) {
        p.x = spawn.x;
        p.y = spawn.y;
      }
      this.#sims.get(id)?.inputs.reset();
    }
    const c = this.state.council;
    c.stage = 'voting';
    c.number = desk.number;
    c.calledBy = client.sessionId;
    c.voted.clear();
    c.ballots.clear();
    c.ejected = '';
    c.secondsLeft = desk.secondsLeft(this.#ticks, taskClock(), SERVER_TICK_HZ);
    log.info('council called', { roomId: this.roomId, number: desk.number });
  }

  #vote(client: CitadelClient, target: string): void {
    const match = this.#match;
    const desk = this.#desk;
    if (this.#active(client) === null || match === null || desk === null || this.state.phase !== 'playing') return;
    const outcome = desk.vote(client.sessionId, target, match.guardians(), this.#ticks);
    if (!outcome.ok) {
      this.#councilRefuse(client, outcome);
      return;
    }
    this.state.council.voted.push(client.sessionId);
  }

  // Quick chat: in the lobby and after a match freely (paced), during a match only in councils.
  #chat(client: CitadelClient, chat: ChatMessage): void {
    const player = this.#active(client);
    if (player === null) return;
    const now = taskClock();
    const desk = this.#desk;
    if (this.state.phase === 'playing') {
      if (desk?.stage !== 'voting' || this.#match?.isMember(client.sessionId) !== true) {
        this.#councilRefuse(client, { ok: false, reason: 'cannotAct' });
        return;
      }
    }
    // References must point at things that exist here, so a line can never name a stranger.
    const ref = 'playerId' in chat ? this.state.players.has(chat.playerId) : 'proposalId' in chat ? this.state.proposals.some((p) => p.id === chat.proposalId) : true;
    if (!ref) {
      this.#councilRefuse(client, { ok: false, reason: 'invalidTarget' });
      return;
    }
    const paced = desk !== null && this.state.phase === 'playing' ? desk.chat(client.sessionId, now) : this.#lobbyChat(client.sessionId, now);
    if (!paced.ok) {
      this.#councilRefuse(client, paced);
      return;
    }
    this.broadcast(SERVER_MESSAGES.CHAT, { from: client.sessionId, chat } satisfies ChatLine);
  }

  #lobbyChat(id: string, now: number): { ok: true } | CouncilFailure {
    const gap = roomPolicy().councilTiming.chatGapMs;
    const last = this.#lobbyChatAt.get(id) ?? -Infinity;
    if (now < last + gap) return { ok: false, reason: 'chatLimit', retryInMs: Math.ceil(last + gap - now) };
    this.#lobbyChatAt.set(id, now);
    return { ok: true };
  }

  #councilRefuse(client: CitadelClient, outcome: CouncilFailure): void {
    const refusal: CouncilRefused = outcome.retryInMs === undefined ? { reason: outcome.reason } : { reason: outcome.reason, retryInMs: outcome.retryInMs };
    client.send(SERVER_MESSAGES.COUNCIL_REFUSED, refusal);
  }

  #tickCouncil(match: Match, desk: MeetingDesk): void {
    const now = taskClock();
    const voters = [...this.state.players].filter(([id, p]) => p.status === 'active' && match.isMember(id)).map(([id]) => id);
    const event = desk.tick(now, this.#ticks, match.guardians(), voters);
    const c = this.state.council;
    if (event?.kind === 'tallied') {
      c.stage = 'result';
      for (const [voter, target] of event.ballots) c.ballots.set(voter, target);
      const ejected = event.tally.ejected;
      match.noteCouncil(event.ballots, ejected);
      if (ejected !== null && match.rotateOut(ejected)) {
        c.ejected = ejected;
        const out = this.state.players.get(ejected);
        if (out !== undefined) out.out = true;
        log.info('key rotated out', { roomId: this.roomId, number: desk.number });
      }
    } else if (event?.kind === 'ended') {
      match.ceremony.resume(event.pausedTicks, event.pausedMs);
      match.sabotage.resume(event.pausedMs);
      this.#pausedMs += event.pausedMs;
      c.stage = '';
      c.secondsLeft = 0;
      this.#checkWinner();
      return;
    }
    const left = desk.secondsLeft(this.#ticks, now, SERVER_TICK_HZ);
    if (c.secondsLeft !== left) c.secondsLeft = left;
  }

  #checkWinner(): void {
    if (this.#match === null || this.state.phase !== 'playing') return;
    const winner = this.#match.winner();
    if (winner !== null) this.#endMatch(winner);
  }

  // Reveals every role to everyone, then returns to the lobby after the result screen.
  #endMatch(winner: Winner): void {
    const match = this.#match;
    if (match === null) return;
    for (const id of match.finish()) this.#sendTo(id, SERVER_MESSAGES.TASK_CLOSED, { reason: 'ended' });
    for (const [id, p] of this.state.players) {
      const role = match.role(id);
      if (role !== undefined) this.state.recap.push(new RecapEntry({ id, name: p.name, seat: p.seat, role, left: false }));
    }
    for (const d of this.#departed) this.state.recap.push(new RecapEntry({ ...d, left: true }));
    // Every proposal still on screen shows its truth, open ones included.
    this.#syncProposals(match, true);
    this.#departed = [];
    this.#resetCouncil();
    this.#resetSabotageState();
    this.state.phase = 'ended';
    this.state.winner = winner.side;
    this.state.winReason = winner.reason;
    // Consensus is reached once every remaining honest guardian is done, which can be below 100% after departures.
    if (winner.reason === 'consensusReached') this.state.consensus = CONSENSUS_GOAL;
    for (const sim of this.#sims.values()) {
      for (const player of this.state.players.values()) sim.view.add(player, VIEW_TAGS.ROLE);
    }
    this.#payOut(match, winner);
    this.clock.setTimeout(() => {
      this.#backToLobby();
    }, roomPolicy().resultMs);
    log.info('match ended', { roomId: this.roomId, winner: winner.side, reason: winner.reason });
  }

  #backToLobby(): void {
    for (const sim of this.#sims.values()) {
      for (const player of this.state.players.values()) {
        if (sim.view.hasTag(player, VIEW_TAGS.ROLE)) sim.view.remove(player, VIEW_TAGS.ROLE);
      }
    }
    this.#desk = null;
    this.#resetCouncil();
    this.#resetSabotageState();
    this.state.outages = 0;
    this.state.act = '';
    this.state.blocksLeft = 0;
    for (const player of this.state.players.values()) {
      player.out = false;
      player.frozen = 0;
      player.role = undefined;
      player.tasks = undefined;
      player.tasksDone = undefined;
    }
    this.#match = null;
    this.state.recap.clear();
    this.state.phase = 'lobby';
    this.state.winner = '';
    this.state.winReason = '';
    this.state.consensus = 0;
    this.state.byzantines = 0;
    this.state.proposals.clear();
    this.state.livenessStrikes = 0;
    this.state.signaturesNeeded = 0;
    this.#syncTier();
    // A full room stays locked until someone leaves (see onLeave).
    if (this.#matchLock && !this.hasReachedMaxClients()) {
      this.#matchLock = false;
      void this.unlock();
    }
  }

  #partition(client: CitadelClient): void {
    const play = this.#inPlay(client);
    if (play === null || this.#offTier(client, 'partition')) return;
    const { match } = play;
    const outcome = match.sabotage.partition(match.role(client.sessionId), taskClock(), client.sessionId);
    if (!outcome.ok) {
      this.#sabotageRefuse(client, outcome);
      return;
    }
    this.#syncSabotage(match);
    this.#sendReadiness(match);
    log.info('partition started', { roomId: this.roomId });
  }

  #freeze(client: CitadelClient, targetId: string): void {
    const play = this.#inPlay(client);
    if (play === null || this.#offTier(client, 'freeze')) return;
    const { player, match } = play;
    const target = this.state.players.get(targetId);
    const targetPos = target === undefined || target.status !== 'active' ? undefined : { x: target.x, y: target.y };
    const outcome = match.sabotage.freeze(client.sessionId, match.role(client.sessionId), { x: player.x, y: player.y }, targetId, targetPos, match.isMember(targetId), taskClock());
    if (!outcome.ok) {
      this.#sabotageRefuse(client, outcome);
      return;
    }
    // The frozen guardian drops whatever they were doing.
    if (match.closeTask(targetId)) this.#sendTo(targetId, SERVER_MESSAGES.TASK_CLOSED, { reason: 'frozen' });
    const audit = match.ceremony.cancelAudit(targetId);
    if (audit !== null) this.#sendTo(targetId, SERVER_MESSAGES.AUDIT, { status: 'cancelled', proposalId: audit });
    this.#sims.get(targetId)?.inputs.reset();
    this.#syncSabotage(match);
    this.#sendReadiness(match);
  }

  #sabotageRefuse(client: CitadelClient, outcome: SabotageFailure): void {
    const refusal: SabotageRefused = outcome.retryInMs === undefined ? { reason: outcome.reason } : { reason: outcome.reason, retryInMs: outcome.retryInMs };
    client.send(SERVER_MESSAGES.SABOTAGE_REFUSED, refusal);
  }

  // Each Byzantine learns when their own actions are ready again; nobody else gets this, nor anyone in a tier without sabotage.
  #sendReadiness(match: Match): void {
    if (!match.rules.partition && !match.rules.freeze) return;
    const now = taskClock();
    for (const id of match.byzantines()) {
      if (match.isMember(id)) this.#sendTo(id, SERVER_MESSAGES.SABOTAGE_READY, match.sabotage.readiness(id, now));
    }
  }

  #tickSabotage(match: Match): void {
    const now = taskClock();
    const holders = [...this.state.players]
      .filter(([id, p]) => p.status === 'active' && match.isMember(id) && !match.sabotage.isFrozen(id))
      .map(([id, p]) => ({ id, x: p.x, y: p.y }));
    const events = match.sabotage.tick(now, holders);
    for (const e of events) {
      if (e.kind === 'repaired') match.notePartitionRepaired(e.by);
      if (e.kind === 'outage') match.notePartitionRanOut(e.startedBy);
    }
    this.#syncSabotage(match);
    if (events.some((e) => e.kind !== 'thawed')) {
      this.#sendReadiness(match);
      if (events.some((e) => e.kind === 'outage')) {
        this.state.outages = match.sabotage.outages;
        this.#syncProposals(match);
        this.#checkWinner();
      }
    }
  }

  #syncSabotage(match: Match): void {
    const now = taskClock();
    const s = match.sabotage;
    const left = s.partitionSecondsLeft(now);
    if (this.state.partition !== left) this.state.partition = left;
    const repair = s.repairPercent(now);
    if (this.state.repair !== repair) this.state.repair = repair;
    if (this.state.relays !== s.relays) this.state.relays = s.relays;
    for (const [id, p] of this.state.players) {
      const frozen = s.frozenSecondsLeft(id, now);
      if (p.frozen !== frozen) p.frozen = frozen;
    }
  }

  #resetSabotageState(): void {
    this.state.partition = 0;
    this.state.repair = 0;
    this.state.relays = 0;
    for (const p of this.state.players.values()) p.frozen = 0;
  }

  // Advances the block clock; the last block ends the match if nobody has won by then.
  #tickClock(match: Match): void {
    const pacing = roomPolicy().pacing;
    const elapsed = taskClock() - this.#clockStart - this.#pausedMs;
    const act = actAt(elapsed, pacing);
    if (this.state.act !== act) {
      this.state.act = act;
      if (act === 'final') match.ceremony.hurry(FINAL_SPAWN_FACTOR);
    }
    const left = blocksLeft(elapsed, pacing);
    if (this.state.blocksLeft !== left) this.state.blocksLeft = left;
    if (left === 0) this.#endMatch({ side: 'byzantine', reason: 'outOfTime' });
  }

  // Pays everyone still seated for the match, then tells each of them privately what they earned.
  #payOut(match: Match, winner: Winner): void {
    const profiles = roomPolicy().profiles;
    if (profiles === null) return;
    const now = Date.now();
    let events: SeasonEvent[] = [];
    try {
      const active = seasonAt(this.state.blockHeight, now).active.map((e) => e.id as string);
      events = SEASON_EVENTS.filter((id) => active.includes(id));
    } catch {
      // An implausible chain height means no seasonal events, never a failed payout.
    }
    const facts: MatchFacts = {
      matchId: this.#matchId,
      startedAtMs: this.#matchStartedAt,
      endedAtMs: now,
      players: this.#dealt,
      humans: this.#dealtHumans,
      privateRoom: this.state.isPrivate,
      winner: winner.side,
      reason: winner.reason,
      blockHeight: this.state.blockHeight,
      events,
      arena: this.#matchArena,
      ceremony: this.state.ceremony,
    };
    const payees: Payee[] = [];
    for (const [id] of this.state.players) {
      const profileId = this.#sims.get(id)?.profileId ?? null;
      const player = match.playerFacts(id, true, this.#idled.has(id));
      if (profileId !== null && player !== null) payees.push({ sessionId: id, profileId, facts: player });
    }
    awardMatch(profiles.store, facts, payees, now)
      .then((awards) => {
        for (const [sessionId, award] of awards) this.#sendTo(sessionId, SERVER_MESSAGES.MATCH_REWARDS, award);
        // A rank-up can open the next tier's island; reload so the next match in this room plays it.
        for (const payee of payees) void this.#wearLook(payee.sessionId, payee.profileId);
      })
      .catch((error: unknown) => {
        log.error('match payout failed', error, { roomId: this.roomId });
      });
  }

  #resetCouncil(): void {
    const c = this.state.council;
    c.stage = '';
    c.number = 0;
    c.calledBy = '';
    c.secondsLeft = 0;
    c.voted.clear();
    c.ballots.clear();
    c.ejected = '';
  }

  #syncChain(): void {
    const tip = roomPolicy().chain.current();
    if (this.state.blockHeight !== tip.height) this.state.blockHeight = tip.height;
    if (this.state.chainLive !== tip.live) this.state.chainLive = tip.live;
  }

  // The player behind a live, unkicked client, after noting the activity.
  #active(client: CitadelClient): PlayerState | null {
    const sim = this.#sims.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (sim === undefined || player === undefined || client.userData?.kicked === true) return null;
    sim.lastActiveMs = Date.now();
    return player.status === 'active' ? player : null;
  }

  #positionOf(id: string): Vec2 | undefined {
    const p = this.state.players.get(id);
    return p === undefined || p.status !== 'active' ? undefined : { x: p.x, y: p.y };
  }

  #sendTo<T extends keyof ServerPayloads>(id: string, type: T, payload: ServerPayloads[T]): void {
    this.clients.get(id)?.send(type, payload);
  }

  #onMove(client: CitadelClient, input: MoveInput): void {
    const sim = this.#sims.get(client.sessionId);
    if (sim === undefined || client.userData?.kicked === true) return;
    sim.lastActiveMs = Date.now();
    sim.inputs.push(input);
  }

  #kickIdle(): void {
    const cutoff = Date.now() - roomPolicy().idleKickMs * (this.state.isPrivate ? PRIVATE_IDLE_FACTOR : 1);
    for (const client of this.clients) {
      const sim = this.#sims.get(client.sessionId);
      if (sim !== undefined && sim.lastActiveMs < cutoff && client.userData?.kicked !== true) {
        if (this.state.phase === 'playing') this.#idled.add(client.sessionId);
        this.kick(client, CLOSE_CODES.IDLE, 'Removed for being idle too long.');
      }
    }
  }

  // Lowest free seat, counting seats held for disconnected players.
  #freeSeat(): number | null {
    const taken = new Set(Array.from(this.state.players.values(), (p) => p.seat));
    for (let seat = 0; seat < MAX_PLAYERS; seat++) if (!taken.has(seat)) return seat;
    return null;
  }

  // The connected player in the lowest seat, else anyone still holding a seat.
  // A person, never a bot; with only bots left there is no host and the bots leave.
  #nextHost(): string {
    let best: { id: string; seat: number; active: boolean } | null = null;
    for (const [id, p] of this.state.players) {
      if (p.bot) continue;
      const active = p.status === 'active';
      if (best === null || (active && !best.active) || (active === best.active && p.seat < best.seat)) {
        best = { id, seat: p.seat, active };
      }
    }
    return best?.id ?? '';
  }
}
