// One practice bot. It plays through its own SDK client and reads only what that client receives:
// its own view of the synced state and the messages sent to it.
import {
  CITADEL_MAP,
  CLIENT_MESSAGE_PAYLOADS,
  CeremonyRefusedSchema,
  ChatLineSchema,
  CouncilRefusedSchema,
  ForgedSchema,
  SabotageReadySchema,
  SERVER_MESSAGES,
  SERVER_TICK_HZ,
  STATION_PROMPT_RANGE,
  STATION_RANGE,
  TASK_KINDS,
  TaskClosedSchema,
  TaskOpenedSchema,
  TaskRefusedSchema,
  TaskResultSchema,
  hasTask,
  inStationRange,
  stationCenter,
  type ChatMessage,
  type CitadelMap,
  type RandomSource,
  type TaskChallenge,
  type TaskClosed,
  type TaskKind,
  type TaskOpened,
  type TaskRefused,
  type TaskResult,
  type TaskTiming,
  type Vec2,
} from '@byzantine-council/shared';
import { findPath, findPathNear } from '@byzantine-council/shared/pathfinding';
import type { CitadelState, MatchPhase, PlayerState } from '@byzantine-council/shared/state';
import type { z } from 'zod';
import { log } from '../logger.js';
import { botAnswer } from './answers.js';
import { BotMotor, PathFollower } from './motion.js';
import type { BotProfile } from './profile.js';
import { between } from './random.js';
import { SOLVE_MARGIN_MS, lobbyStroll, type BotAction, type BotPlan, type BotPlayerView, type BotStrategy, type BotView, type ProposalSeen, type SolvePlan, type StrategySet } from './strategy.js';

export const BOT_TICK_MS = 1000 / SERVER_TICK_HZ;
// After an event-loop stall at most this much input is caught up, so a bot never bursts.
const MAX_CATCHUP_MS = 2 * BOT_TICK_MS;
// A request the server never answered is dropped after this.
const REPLY_TIMEOUT_MS = 5000;
// Opens a station only from this far inside the server's range.
const RANGE_MARGIN = 0.1;
// Replans of one goal before the bot gives up on it.
const MAX_REPLANS = 3;
// Longest a strategy may ask a bot to wait or think; challenges expire after two minutes.
const MAX_PLAN_MS = 60_000;
// Errors before a bot gives up and leaves.
export const MAX_BOT_ERRORS = 3;

// Types the room handles today; the M4 intents only once the room handles them too, since an
// unknown type closes the socket.
const PLAY_MESSAGES: ReadonlySet<string> = new Set(['move', 'openTask', 'taskAnswer', 'closeTask']);
const SOCIAL_MESSAGES: ReadonlySet<string> = new Set(['signProposal', 'refuseProposal', 'callCouncil', 'castVote', 'quickChat', 'forgeProposal', 'partition', 'freeze']);
// How often the bot looks at proposals and councils.
const SOCIAL_EVERY_MS = 250;
// Reading a new withdrawal before answering it, and taking part in a council, like a person would.
const PROPOSAL_DELAY_MS: readonly [number, number] = [2500, 9000];
const VOTE_DELAY_MS: readonly [number, number] = [4000, 15_000];
const CHAT_DELAY_MS: readonly [number, number] = [1500, 6000];
// A response the server did not record (a partition blocks signing) is retried this often, this many times.
const RETRY_RESPONSE_MS = 4000;
const MAX_RESPONSE_TRIES = 5;
// Byzantine: a guess at the forge cooldown until the server says otherwise.
const FORGE_GAP_MS = 20_000;
// How close an action spot must be reached.
const ACT_RANGE = 1;
const PAYLOADS: Readonly<Record<string, z.ZodType | undefined>> = CLIENT_MESSAGE_PAYLOADS;

// What the brain needs from a joined room; the manager adapts the SDK room to it.
export interface BotLink {
  readonly sessionId: string;
  readonly isOpen: boolean;
  readonly state: CitadelState;
  send(type: string, payload?: unknown): void;
}

export interface BrainOptions {
  readonly roomId: string;
  readonly profile: BotProfile;
  readonly timing: TaskTiming;
  readonly strategies: StrategySet;
  readonly rng: RandomSource;
  // M4 intents (sign, refuse, council, vote, chat) are sent only when true.
  readonly social?: boolean;
  readonly map?: CitadelMap;
  // Called once after repeated errors; the manager then makes the bot leave.
  readonly onFatal?: () => void;
  // Monotonic milliseconds.
  readonly now?: () => number;
}

type Goal =
  | { readonly kind: 'task'; readonly task: TaskKind }
  | { readonly kind: 'visit'; readonly to: Vec2; readonly lingerMs: number }
  | { readonly kind: 'act'; readonly to: Vec2; readonly action: BotAction; readonly lingerMs: number };

export type Activity =
  | { readonly kind: 'wait'; readonly until: number }
  | { readonly kind: 'walk'; readonly goal: Goal; readonly replans: number }
  | { readonly kind: 'settle'; readonly task: TaskKind; readonly until: number; readonly replans: number }
  | { readonly kind: 'opening'; readonly task: TaskKind; readonly since: number }
  | {
      readonly kind: 'solving';
      readonly task: TaskKind;
      readonly id: string;
      readonly challenge: TaskChallenge;
      readonly answerAt: number;
      readonly plan: SolvePlan;
    }
  | { readonly kind: 'answered'; readonly task: TaskKind; readonly id: string; readonly since: number }
  // Arrived for an action; sends it once the server has applied every move.
  | { readonly kind: 'acting'; readonly action: BotAction; readonly since: number; readonly lingerMs: number }
  // A council is on: everyone stands at the seal.
  | { readonly kind: 'council' };

function wait(until: number): Activity {
  return { kind: 'wait', until };
}

function clampMs(ms: number): number {
  return Number.isFinite(ms) ? Math.max(0, Math.min(MAX_PLAN_MS, Math.round(ms))) : 0;
}

export class BotBrain {
  readonly #link: BotLink;
  readonly #roomId: string;
  readonly #profile: BotProfile;
  readonly #timing: TaskTiming;
  readonly #strategies: StrategySet;
  readonly #rng: RandomSource;
  readonly #social: boolean;
  readonly #map: CitadelMap;
  readonly #onFatal: (() => void) | undefined;
  readonly #now: () => number;
  readonly #follower = new PathFollower();
  // Tasks the server called unavailable this match; the synced list may lag behind.
  readonly #unavailable = new Set<TaskKind>();
  #motor: BotMotor | null = null;
  #activity: Activity = wait(0);
  #phase: MatchPhase | null = null;
  #lastStep: number | null = null;
  #acc = 0;
  #connected = true;
  #errors = 0;
  #disposed = false;
  // Social memory for one match, built only from what this bot's client received.
  readonly #forged = new Set<string>();
  readonly #warned = new Set<string>();
  readonly #vouched = new Set<string>();
  readonly #suspicion = new Map<string, number>();
  readonly #scored = new Set<string>();
  readonly #responses = new Map<string, { at: number; tries: number }>();
  #socialAt = 0;
  #votedIn = -1;
  #voteAt: number | null = null;
  #chattedIn = -1;
  #chatAt: number | null = null;
  #calledCouncil = false;
  #forgeAt = 0;
  #partitionAt = Infinity;
  #freezeAt = Infinity;

  constructor(link: BotLink, options: BrainOptions) {
    this.#link = link;
    this.#roomId = options.roomId;
    this.#profile = options.profile;
    this.#timing = options.timing;
    this.#strategies = options.strategies;
    this.#rng = options.rng;
    this.#social = options.social ?? false;
    this.#map = options.map ?? CITADEL_MAP;
    this.#onFatal = options.onFatal;
    this.#now = options.now ?? (() => performance.now());
  }

  get sessionId(): string {
    return this.#link.sessionId;
  }

  get activity(): Activity {
    return this.#activity;
  }

  // Predicted position, once the bot has seen itself in the state.
  get position(): Vec2 | null {
    return this.#motor?.position ?? null;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  // M4 intents; each is validated and refused until the room handles social messages.
  readonly act = {
    sign: (proposalId: string): boolean => this.#send('signProposal', { proposalId }),
    refuse: (proposalId: string): boolean => this.#send('refuseProposal', { proposalId }),
    callCouncil: (): boolean => this.#send('callCouncil'),
    vote: (target: string): boolean => this.#send('castVote', { target }),
    chat: (chat: ChatMessage): boolean => this.#send('quickChat', { chat }),
  };

  // Called by the shared 20 Hz ticker; never throws.
  tick(): void {
    if (this.#disposed) return;
    try {
      this.#tick(this.#now());
    } catch (error) {
      this.#fail(error);
    }
  }

  // Every state patch: rebase prediction on the server position and ack.
  onState(): void {
    if (this.#disposed) return;
    try {
      const me = this.#me();
      if (me !== undefined) this.#motor?.reconcile({ x: me.x, y: me.y }, me.ack ?? 0);
    } catch (error) {
      this.#fail(error);
    }
  }

  // Server messages are validated like any untrusted input; unknown ones are ignored.
  onMessage(type: string, payload: unknown): void {
    if (this.#disposed) return;
    try {
      const now = this.#now();
      if (type === SERVER_MESSAGES.TASK_OPENED) {
        const msg = TaskOpenedSchema.safeParse(payload);
        if (msg.success) this.#opened(now, msg.data);
      } else if (type === SERVER_MESSAGES.TASK_REFUSED) {
        const msg = TaskRefusedSchema.safeParse(payload);
        if (msg.success) this.#refused(now, msg.data);
      } else if (type === SERVER_MESSAGES.TASK_RESULT) {
        const msg = TaskResultSchema.safeParse(payload);
        if (msg.success) this.#result(now, msg.data);
      } else if (type === SERVER_MESSAGES.TASK_CLOSED) {
        const msg = TaskClosedSchema.safeParse(payload);
        if (msg.success) this.#closed(now, msg.data);
      } else if (type === SERVER_MESSAGES.FORGED) {
        const msg = ForgedSchema.safeParse(payload);
        if (msg.success) this.#forged.add(msg.data.proposalId);
      } else if (type === SERVER_MESSAGES.CHAT) {
        const msg = ChatLineSchema.safeParse(payload);
        if (msg.success && msg.data.from !== this.#link.sessionId) this.#heard(msg.data.chat);
      } else if (type === SERVER_MESSAGES.SABOTAGE_READY) {
        const msg = SabotageReadySchema.safeParse(payload);
        if (msg.success) {
          this.#partitionAt = now + msg.data.partitionInMs;
          this.#freezeAt = now + msg.data.freezeInMs;
        }
      } else if (type === SERVER_MESSAGES.CEREMONY_REFUSED) {
        const msg = CeremonyRefusedSchema.safeParse(payload);
        if (msg.success && msg.data.retryInMs !== undefined) this.#forgeAt = Math.max(this.#forgeAt, now + msg.data.retryInMs);
      } else if (type === SERVER_MESSAGES.COUNCIL_REFUSED) {
        const msg = CouncilRefusedSchema.safeParse(payload);
        if (msg.success && msg.data.reason === 'usedUp') this.#calledCouncil = true;
      }
    } catch (error) {
      this.#fail(error);
    }
  }

  // The server closes any open challenge on a drop; the bot just pauses.
  onDrop(): void {
    this.#connected = false;
    this.#follower.clear();
    this.#lastStep = null;
  }

  // The server forgot queued inputs, so prediction restarts from its position.
  onReconnect(): void {
    if (this.#disposed) return;
    this.#connected = true;
    const me = this.#me();
    if (me !== undefined) this.#motor?.reset({ x: me.x, y: me.y });
    this.#follower.clear();
    this.#lastStep = null;
    this.#activity = wait(this.#now() + between(this.#rng, 300, 800));
  }

  dispose(): void {
    this.#disposed = true;
    this.#follower.clear();
  }

  #tick(now: number): void {
    const me = this.#me();
    if (me === undefined || !this.#connected || !this.#link.isOpen) {
      this.#lastStep = null;
      return;
    }
    this.#motor ??= new BotMotor({ x: me.x, y: me.y }, this.#map);
    const motor = this.#motor;
    this.#syncPhase(now);
    if (this.#phase === 'playing') {
      // Rotated out: a spectator until the match ends.
      if (me.out) return;
      this.#syncCouncil(now);
      if (this.#social && me.role !== undefined && now >= this.#socialAt) {
        this.#socialAt = now + SOCIAL_EVERY_MS;
        this.#socialTick(now, me, motor);
      }
      // Frozen guardians cannot move or act until it wears off.
      if (me.frozen > 0) return;
    }
    this.#think(now, me, motor);
    this.#move(now, motor);
  }

  // Councils gather everyone at the seal; when one ends, play resumes after a moment.
  #syncCouncil(now: number): void {
    const inCouncil = this.#link.state.council.stage !== '';
    if (inCouncil && this.#activity.kind !== 'council') {
      if (this.#activity.kind === 'opening' || this.#activity.kind === 'solving' || this.#activity.kind === 'answered') this.#send('closeTask');
      this.#follower.clear();
      this.#activity = { kind: 'council' };
    } else if (!inCouncil && this.#activity.kind === 'council') {
      const [min, max] = this.#profile.reactMs;
      this.#motor?.reset({ x: this.#me()?.x ?? 0, y: this.#me()?.y ?? 0 });
      this.#activity = wait(now + between(this.#rng, min, max));
    }
  }

  // Proposals and councils: evidence, answers, votes and quick chat.
  #socialTick(now: number, me: PlayerState, motor: BotMotor): void {
    const state = this.#link.state;
    const self = this.#link.sessionId;
    for (const p of state.proposals) {
      if (p.verdict === '' || this.#scored.has(p.id)) continue;
      this.#scored.add(p.id);
      if (p.verdict === 'forged') for (const id of p.signers) this.#suspect(id, 2);
      else if (p.status === 'rejected' || p.status === 'expired') for (const id of p.refusers) this.#suspect(id, 1);
    }
    const strategy = this.#strategy(me);
    const council = state.council;
    if (council.stage === '') {
      for (const p of state.proposals) {
        if (p.status !== 'open' || p.signers.includes(self) || p.refusers.includes(self)) continue;
        let r = this.#responses.get(p.id);
        if (r === undefined) {
          r = { at: now + between(this.#rng, PROPOSAL_DELAY_MS[0], PROPOSAL_DELAY_MS[1]), tries: 0 };
          this.#responses.set(p.id, r);
        }
        if (now < r.at || r.tries >= MAX_RESPONSE_TRIES) continue;
        const seen: ProposalSeen = {
          id: p.id,
          signers: [...p.signers],
          forged: me.role === 'byzantine' ? this.#forged.has(p.id) : null,
          warned: this.#warned.has(p.id),
          vouched: this.#vouched.has(p.id),
        };
        const choice = strategy.social.onProposal(this.#view(me, motor), seen, this.#rng);
        r.at = now + RETRY_RESPONSE_MS;
        r.tries += 1;
        if (choice === 'sign') this.act.sign(p.id);
        else if (choice === 'refuse') this.act.refuse(p.id);
      }
      return;
    }
    if (council.stage !== 'voting') return;
    if (this.#chattedIn !== council.number) {
      this.#chatAt ??= now + between(this.#rng, CHAT_DELAY_MS[0], CHAT_DELAY_MS[1]);
      if (now >= this.#chatAt) {
        this.#chattedIn = council.number;
        this.#chatAt = null;
        const line = strategy.social.onChat(this.#view(me, motor), 'councilOpened', this.#rng);
        if (line !== null) this.act.chat(line);
      }
    }
    if (this.#votedIn !== council.number && !council.voted.includes(self)) {
      this.#voteAt ??= now + between(this.#rng, VOTE_DELAY_MS[0], VOTE_DELAY_MS[1]);
      if (now < this.#voteAt) return;
      this.#votedIn = council.number;
      this.#voteAt = null;
      const candidates = [...state.players].filter(([id, p]) => id !== self && !p.out).map(([id]) => id);
      const target = strategy.social.onCouncil(this.#view(me, motor), candidates, this.#rng);
      this.act.vote(target ?? 'skip');
    }
  }

  #suspect(id: string, by: number): void {
    if (id === this.#link.sessionId) return;
    this.#suspicion.set(id, (this.#suspicion.get(id) ?? 0) + by);
  }

  // Council claims; a Byzantine may be lying, which is part of the game.
  #heard(chat: ChatMessage): void {
    if (chat.phrase === 'dontSign' || (chat.phrase === 'audited' && chat.forged)) this.#warned.add(chat.proposalId);
    else if (chat.phrase === 'signIt' || (chat.phrase === 'audited' && !chat.forged)) this.#vouched.add(chat.proposalId);
  }

  #perform(now: number, action: BotAction): void {
    switch (action.type) {
      case 'forge':
        if (this.#send('forgeProposal')) this.#forgeAt = now + FORGE_GAP_MS;
        return;
      case 'partition':
        if (this.#send('partition')) this.#partitionAt = Infinity;
        return;
      case 'freeze':
        if (this.#send('freeze', { targetId: action.targetId })) this.#freezeAt = Infinity;
        return;
      case 'callCouncil':
        this.#calledCouncil = true;
        this.#send('callCouncil');
        return;
    }
  }

  #resetSocial(): void {
    for (const set of [this.#forged, this.#warned, this.#vouched, this.#scored]) set.clear();
    this.#suspicion.clear();
    this.#responses.clear();
    this.#votedIn = -1;
    this.#voteAt = null;
    this.#chattedIn = -1;
    this.#chatAt = null;
    this.#calledCouncil = false;
    this.#forgeAt = 0;
    this.#partitionAt = Infinity;
    this.#freezeAt = Infinity;
  }

  #me(): PlayerState | undefined {
    return this.#link.state.players.get(this.#link.sessionId);
  }

  #syncPhase(now: number): void {
    const phase = this.#link.state.phase;
    if (phase === this.#phase) return;
    this.#phase = phase;
    this.#follower.clear();
    this.#unavailable.clear();
    if (phase === 'playing') this.#resetSocial();
    const p = this.#profile;
    if (phase === 'playing') this.#activity = wait(now + between(this.#rng, p.reactMs[0], p.reactMs[1]));
    else if (phase === 'lobby') this.#activity = wait(now + between(this.#rng, p.lobbyStrollMs[0], p.lobbyStrollMs[1]));
    // Result screen and any phase this bot does not know yet: stand still.
    else this.#activity = wait(Infinity);
  }

  #think(now: number, me: PlayerState, motor: BotMotor): void {
    const a = this.#activity;
    switch (a.kind) {
      case 'wait':
        if (now >= a.until) this.#choose(now, me, motor);
        return;
      case 'walk':
        if (this.#follower.stuck) this.#walk(now, a.goal, a.replans + 1, motor);
        else if (this.#follower.arrived) this.#arrive(now, a);
        return;
      case 'settle': {
        if (now < a.until) return;
        // Open only once the server has applied every move and agrees the bot is in range.
        if (motor.pendingCount > 0 && now < a.until + REPLY_TIMEOUT_MS) return;
        if (motor.pendingCount > 0 || !inStationRange({ x: me.x, y: me.y }, a.task, STATION_RANGE - RANGE_MARGIN)) {
          this.#walk(now, { kind: 'task', task: a.task }, a.replans + 1, motor);
          return;
        }
        if (this.#send('openTask', { kind: a.task })) this.#activity = { kind: 'opening', task: a.task, since: now };
        return;
      }
      case 'council':
        return;
      case 'acting':
        // Act only once the server has the bot where it thinks it is.
        if (motor.pendingCount > 0 && now - a.since < REPLY_TIMEOUT_MS) return;
        this.#perform(now, a.action);
        this.#activity = wait(now + a.lingerMs);
        return;
      case 'opening':
      case 'answered':
        if (now - a.since > REPLY_TIMEOUT_MS) {
          this.#send('closeTask');
          this.#activity = wait(now + 1000);
        }
        return;
      case 'solving':
        if (now < a.answerAt) return;
        if (a.plan.abandon) {
          this.#send('closeTask');
          this.#activity = wait(now + between(this.#rng, this.#profile.lingerMs[0], this.#profile.lingerMs[1]));
        } else if (this.#send('taskAnswer', { id: a.id, answer: botAnswer(a.challenge, a.plan.mistake) })) {
          this.#activity = { kind: 'answered', task: a.task, id: a.id, since: now };
        }
        return;
    }
  }

  #arrive(now: number, a: Extract<Activity, { kind: 'walk' }>): void {
    if (a.goal.kind === 'visit') {
      this.#activity = wait(now + a.goal.lingerMs);
      return;
    }
    if (a.goal.kind === 'act') {
      this.#activity = { kind: 'acting', action: a.goal.action, since: now, lingerMs: a.goal.lingerMs };
      return;
    }
    const [min, max] = this.#profile.settleMs;
    this.#activity = { kind: 'settle', task: a.goal.task, until: now + between(this.#rng, min, max), replans: a.replans };
  }

  // Picks the next thing to do for the current phase.
  #choose(now: number, me: PlayerState, motor: BotMotor): void {
    const view = this.#view(me, motor);
    if (this.#phase === 'playing') {
      const plan: BotPlan = me.role === undefined ? { kind: 'wait', ms: 500 } : this.#strategy(me).next(view, this.#rng);
      this.#start(now, plan, motor);
    } else if (this.#phase === 'lobby') {
      const [min, max] = this.#profile.lobbyStrollMs;
      const to = lobbyStroll(view, this.#rng);
      const lingerMs = between(this.#rng, min, max);
      if (to === null) this.#activity = wait(now + lingerMs);
      else this.#walk(now, { kind: 'visit', to, lingerMs: clampMs(lingerMs) }, 0, motor);
    } else {
      this.#activity = wait(Infinity);
    }
  }

  #start(now: number, plan: BotPlan, motor: BotMotor): void {
    switch (plan.kind) {
      case 'wait':
        this.#activity = wait(now + clampMs(plan.ms));
        return;
      case 'task':
        this.#walk(now, { kind: 'task', task: plan.task }, 0, motor);
        return;
      case 'visit':
        this.#walk(now, { kind: 'visit', to: plan.to, lingerMs: clampMs(plan.lingerMs) }, 0, motor);
        return;
      case 'act':
        this.#walk(now, { kind: 'act', to: plan.to, action: plan.action, lingerMs: clampMs(plan.lingerMs) }, 0, motor);
        return;
      case 'now':
        this.#perform(now, plan.action);
        this.#activity = wait(now + 500);
        return;
    }
  }

  // Plans a path to the goal; a goal that cannot be reached, or keeps getting the bot stuck, is dropped.
  #walk(now: number, goal: Goal, replans: number, motor: BotMotor): void {
    if (replans > MAX_REPLANS) {
      this.#activity = wait(now + between(this.#rng, 1000, 2000));
      return;
    }
    const from = motor.position;
    const result =
      goal.kind === 'task'
        ? findPathNear(this.#map, from, stationCenter(goal.task), STATION_PROMPT_RANGE)
        : goal.kind === 'act'
          ? findPathNear(this.#map, from, goal.to, ACT_RANGE)
          : findPath(this.#map, from, goal.to);
    if (!result.ok) {
      this.#activity = wait(now + 1000);
      return;
    }
    this.#follower.set(result.value);
    this.#activity = { kind: 'walk', goal, replans };
  }

  // Fixed 20 Hz steps, like the browser client: one predicted, sent move per step while walking.
  #move(now: number, motor: BotMotor): void {
    if (this.#lastStep === null) {
      this.#lastStep = now;
      return;
    }
    this.#acc = Math.min(this.#acc + Math.max(0, now - this.#lastStep), MAX_CATCHUP_MS);
    this.#lastStep = now;
    while (this.#acc >= BOT_TICK_MS) {
      this.#acc -= BOT_TICK_MS;
      if (this.#activity.kind !== 'walk' || motor.stalled || !this.#link.isOpen) continue;
      const input = this.#follower.steer(motor.position);
      if (input === null) continue;
      this.#send('move', motor.apply(input.x, input.y));
    }
  }

  #strategy(me: PlayerState): BotStrategy {
    return me.role === 'byzantine' ? this.#strategies.byzantine : this.#strategies.honest;
  }

  #view(me: PlayerState, motor: BotMotor): BotView {
    const tasks = me.tasks ?? 0;
    const done = me.tasksDone ?? 0;
    const others: BotPlayerView[] = [];
    for (const [id, p] of this.#link.state.players) {
      if (id === this.#link.sessionId) continue;
      others.push({ id, x: p.x, y: p.y, active: p.status === 'active', fellow: me.role === 'byzantine' && p.role === 'byzantine' });
    }
    return {
      selfId: this.#link.sessionId,
      position: motor.position,
      role: me.role,
      phase: this.#link.state.phase,
      todo: TASK_KINDS.filter((k) => hasTask(tasks, k) && !hasTask(done, k) && !this.#unavailable.has(k)),
      others: others.filter((o) => !this.#link.state.players.get(o.id)?.out),
      now: this.#now(),
      suspicion: this.#suspicion,
      partition: this.#link.state.partition,
      relays: this.#link.state.relays,
      forgeAt: this.#forgeAt,
      partitionAt: this.#partitionAt,
      freezeAt: this.#freezeAt,
      canCallCouncil: !this.#calledCouncil,
    };
  }

  #opened(now: number, msg: TaskOpened): void {
    const a = this.#activity;
    const me = this.#me();
    const motor = this.#motor;
    if (a.kind !== 'opening' || msg.challenge.kind !== a.task || me === undefined || motor === null) {
      // Not something this bot asked for: close it rather than leave it hanging.
      this.#send('closeTask');
      return;
    }
    const plan = this.#strategy(me).solve(this.#view(me, motor), a.task, this.#rng);
    // Never faster than the server's minimum, whatever the strategy says.
    const floor = this.#timing.minSolveMs[a.task] + SOLVE_MARGIN_MS;
    const thinkMs = Math.max(floor, clampMs(plan.thinkMs));
    this.#activity = { kind: 'solving', task: a.task, id: msg.id, challenge: msg.challenge, answerAt: now + thinkMs, plan };
  }

  #refused(now: number, msg: TaskRefused): void {
    const a = this.#activity;
    if (a.kind !== 'opening') return;
    switch (msg.reason) {
      case 'retryLater':
        this.#activity = { kind: 'settle', task: a.task, until: now + (msg.retryInMs ?? 1000) + between(this.#rng, 100, 400), replans: 0 };
        return;
      case 'outOfRange':
        if (this.#motor !== null) this.#walk(now, { kind: 'task', task: a.task }, 1, this.#motor);
        return;
      case 'busy':
        this.#send('closeTask');
        this.#activity = { kind: 'settle', task: a.task, until: now + 500, replans: 0 };
        return;
      case 'unavailable':
        this.#unavailable.add(a.task);
        this.#activity = wait(now + 500);
        return;
    }
  }

  #result(now: number, msg: TaskResult): void {
    const a = this.#activity;
    if (a.kind !== 'answered' || a.id !== msg.id) return;
    if (msg.ok) {
      const [min, max] = this.#profile.afterTaskMs;
      this.#activity = wait(now + between(this.#rng, min, max));
    } else {
      const lockout = msg.retryInMs ?? this.#timing.retryMs;
      this.#activity = { kind: 'settle', task: a.task, until: now + lockout + between(this.#rng, 200, 600), replans: 0 };
    }
  }

  #closed(now: number, msg: TaskClosed): void {
    const a = this.#activity;
    if (a.kind !== 'opening' && a.kind !== 'solving' && a.kind !== 'answered') return;
    if (msg.reason === 'ended' || this.#motor === null) this.#activity = wait(now + 1000);
    else this.#walk(now, { kind: 'task', task: a.task }, 1, this.#motor);
  }

  // Validates against the shared schemas and the allowlist, so a bot bug never gets it kicked.
  #send(type: string, payload?: unknown): boolean {
    if (this.#disposed || !this.#link.isOpen) return false;
    const allowed = PLAY_MESSAGES.has(type) || (this.#social && SOCIAL_MESSAGES.has(type));
    const schema = allowed ? PAYLOADS[type] : undefined;
    if (schema === undefined || !schema.safeParse(payload).success) {
      log.warn('bot held back a message', { roomId: this.#roomId, sessionId: this.#link.sessionId, type });
      return false;
    }
    this.#link.send(type, payload);
    return true;
  }

  #fail(error: unknown): void {
    this.#errors += 1;
    log.error('bot error', error, { roomId: this.#roomId, sessionId: this.#link.sessionId, errors: this.#errors });
    if (this.#errors >= MAX_BOT_ERRORS && !this.#disposed) {
      this.dispose();
      this.#onFatal?.();
    }
  }
}
