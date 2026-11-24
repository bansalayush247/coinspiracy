// Bot decision making. Strategies only see a BotView built from the bot's own client view, so a
// bot never knows more than a person in its seat would.
import {
  CITADEL,
  ROOMS,
  isWalkableTile,
  movementMap,
  roomAt,
  stationCenter,
  type Arena,
  type ArenaId,
  type ChatMessage,
  type RandomSource,
  type Role,
  type RoomId,
  type TaskKind,
  type TaskTiming,
  type Vec2,
} from '@byzantine-council/shared';
import { findPath } from '@byzantine-council/shared/pathfinding';
import type { MatchPhase } from '@byzantine-council/shared/state';
import type { BotProfile } from './profile.js';
import { between, chance, pickOne } from './random.js';

// Answers land this long after the server's minimum, so clock jitter never makes them too early.
export const SOLVE_MARGIN_MS = 50;
// Honest bots take the closest task this often, otherwise any remaining one.
const NEAREST_PERCENT = 75;
// While roaming, how often a bot drifts toward another guardian instead of a room.
const FOLLOW_PERCENT = 40;
// Lobby strolls stay within this distance.
const STROLL_RADIUS = 3;

export interface BotPlayerView {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly active: boolean;
  // Only ever true for a Byzantine bot looking at a fellow Byzantine.
  readonly fellow: boolean;
}

export interface BotView {
  readonly selfId: string;
  readonly position: Vec2;
  readonly role: Role | undefined;
  readonly phase: MatchPhase;
  // Own tasks still to do (assigned, not done, not refused as unavailable).
  readonly todo: readonly TaskKind[];
  readonly others: readonly BotPlayerView[];
  // Monotonic ms, the clock the ready times below use.
  readonly now: number;
  // Evidence from public proposal results: a higher score is more suspicious.
  readonly suspicion: ReadonlyMap<string, number>;
  // Seconds left on a network partition (0 when whole) and which relays are held, as a bitmask.
  readonly partition: number;
  readonly relays: number;
  // Byzantine only: when each action should next be allowed, from the server's own readiness messages.
  readonly forgeAt: number;
  readonly partitionAt: number;
  readonly freezeAt: number;
  // Whether this bot may still call a council this match.
  readonly canCallCouncil: boolean;
  // Where the match is played, from the public room state.
  readonly arena: Arena;
}

export type BotPlan =
  | { readonly kind: 'task'; readonly task: TaskKind }
  | { readonly kind: 'visit'; readonly to: Vec2; readonly lingerMs: number }
  | { readonly kind: 'wait'; readonly ms: number }
  // Walk somewhere, then send one action on arrival.
  | { readonly kind: 'act'; readonly to: Vec2; readonly action: BotAction; readonly lingerMs: number }
  // An action that needs no walking.
  | { readonly kind: 'now'; readonly action: BotAction };

export type BotAction = { readonly type: 'forge' } | { readonly type: 'partition' } | { readonly type: 'freeze'; readonly targetId: string } | { readonly type: 'callCouncil' };

export interface SolvePlan {
  readonly thinkMs: number;
  readonly mistake: boolean;
  // Walk off without answering (a Byzantine faking the task).
  readonly abandon: boolean;
}

// An open withdrawal as this bot sees it.
export interface ProposalSeen {
  readonly id: string;
  readonly signers: readonly string[];
  // Known only to Byzantines, from the server's private notice; null when unknown.
  readonly forged: boolean | null;
  // Someone said in a council not to sign it, or claimed an audit found it forged.
  readonly warned: boolean;
  // Someone vouched for it, or claimed an audit found it real.
  readonly vouched: boolean;
}
export type ProposalChoice = 'sign' | 'refuse';
export type ChatTrigger = 'councilOpened';

export interface BotSocialHooks {
  // A proposal awaits this bot's signature; null decides later.
  onProposal(view: BotView, proposal: ProposalSeen, rng: RandomSource): ProposalChoice | null;
  // A council vote is open; returns a player id or 'skip', or null to wait.
  onCouncil(view: BotView, candidates: readonly string[], rng: RandomSource): string | null;
  // Something worth a quick-chat line happened; null stays quiet.
  onChat(view: BotView, trigger: ChatTrigger, rng: RandomSource): ChatMessage | null;
}

export const QUIET_SOCIAL: BotSocialHooks = Object.freeze({
  onProposal: () => null,
  onCouncil: () => null,
  onChat: () => null,
});

export interface BotStrategy {
  // The next thing to do while the match is on and the bot is free.
  next(view: BotView, rng: RandomSource): BotPlan;
  // How to handle a challenge that just opened.
  solve(view: BotView, task: TaskKind, rng: RandomSource): SolvePlan;
  readonly social: BotSocialHooks;
}

// Floor tiles with all eight neighbours walkable, by room: comfortable places to stand. Worked out
// once per arena.
const roomyCache = new Map<ArenaId, ReadonlyMap<RoomId, readonly Vec2[]>>();
function roomy(arena: Arena): ReadonlyMap<RoomId, readonly Vec2[]> {
  const cached = roomyCache.get(arena.id);
  if (cached !== undefined) return cached;
  const byRoom = new Map<RoomId, Vec2[]>();
  const map = arena.map;
  for (let row = 1; row < map.height - 1; row++) {
    for (let col = 1; col < map.width - 1; col++) {
      let open = true;
      for (let dr = -1; dr <= 1 && open; dr++) {
        for (let dc = -1; dc <= 1 && open; dc++) open = isWalkableTile(map, col + dc, row + dr);
      }
      const at = { x: col + 0.5, y: row + 0.5 };
      const room = roomAt(at, arena.regions);
      if (!open || room === null) continue;
      const list = byRoom.get(room) ?? [];
      list.push(at);
      byRoom.set(room, list);
    }
  }
  roomyCache.set(arena.id, byRoom);
  return byRoom;
}

// A comfortable spot in a random room, preferring a room other than `avoid`.
export function wanderPoint(rng: RandomSource, avoid: RoomId | null = null, arena: Arena = CITADEL): Vec2 {
  const spots = roomy(arena);
  const rooms = ROOMS.filter((r) => (spots.get(r)?.length ?? 0) > 0);
  const choices = rooms.filter((r) => r !== avoid);
  const room = pickOne(rng, choices.length > 0 ? choices : rooms) ?? 'plaza';
  return pickOne(rng, spots.get(room) ?? []) ?? arena.seal;
}

// A comfortable spot within `radius` of `pos`, if there is one.
export function nearbyPoint(rng: RandomSource, pos: Vec2, radius: number, arena: Arena = CITADEL): Vec2 | null {
  const room = roomAt(pos, arena.regions);
  const all = [...roomy(arena).values()].flat();
  const spots = all.filter((p) => Math.hypot(p.x - pos.x, p.y - pos.y) <= radius && (room === null || roomAt(p, arena.regions) === room));
  return pickOne(rng, spots) ?? null;
}

export function lobbyStroll(view: BotView, rng: RandomSource): Vec2 | null {
  return nearbyPoint(rng, view.position, STROLL_RADIUS, view.arena);
}

function nearestTask(pos: Vec2, todo: readonly TaskKind[], arena: Arena): TaskKind | undefined {
  let best: TaskKind | undefined;
  let bestDistance = Infinity;
  for (const task of todo) {
    const c = stationCenter(task, arena.stations);
    const d = Math.hypot(c.x - pos.x, c.y - pos.y);
    if (d < bestDistance) {
      best = task;
      bestDistance = d;
    }
  }
  return best;
}

function thinkTime(profile: BotProfile, timing: TaskTiming, task: TaskKind, rng: RandomSource): number {
  const [min, max] = profile.thinkMs[task];
  return timing.minSolveMs[task] + SOLVE_MARGIN_MS + between(rng, min, max);
}

// Drift toward another guardian now and then, otherwise visit some other room.
function roam(view: BotView, rng: RandomSource, profile: BotProfile): BotPlan {
  const lingerMs = between(rng, profile.lingerMs[0], profile.lingerMs[1]);
  const other = chance(rng, FOLLOW_PERCENT) ? pickOne(rng, view.others.filter((o) => o.active)) : undefined;
  const near = other === undefined ? null : nearbyPoint(rng, other, 2, view.arena);
  return { kind: 'visit', to: near ?? wanderPoint(rng, roomAt(view.position, view.arena.regions), view.arena), lingerMs };
}

export function honestStrategy(profile: BotProfile, timing: TaskTiming, social: BotSocialHooks = HONEST_SOCIAL): BotStrategy {
  return {
    social,
    next(view, rng) {
      const social = honestSocialPlan(view, rng);
      if (social !== null) return social;
      if (view.todo.length === 0) return roam(view, rng, profile);
      if (chance(rng, profile.detourPercent)) {
        return { kind: 'visit', to: wanderPoint(rng, roomAt(view.position, view.arena.regions), view.arena), lingerMs: between(rng, profile.lingerMs[0], profile.lingerMs[1]) };
      }
      const task = (chance(rng, NEAREST_PERCENT) ? nearestTask(view.position, view.todo, view.arena) : pickOne(rng, view.todo)) ?? view.todo[0];
      return task === undefined ? { kind: 'wait', ms: 1000 } : { kind: 'task', task };
    },
    solve(_view, task, rng) {
      return { thinkMs: thinkTime(profile, timing, task, rng), mistake: chance(rng, profile.mistakePercent), abandon: false };
    },
  };
}

// Byzantines fake tasks (the server counts them for nothing), sometimes leave one half-done,
// and spend more time wandering, so from outside they look like anyone else.
export function byzantineStrategy(profile: BotProfile, timing: TaskTiming, social: BotSocialHooks = BYZANTINE_SOCIAL): BotStrategy {
  return {
    social,
    next(view, rng) {
      const sabotage = byzantineSocialPlan(view, rng);
      if (sabotage !== null) return sabotage;
      const task = pickOne(rng, view.todo);
      if (task !== undefined && !chance(rng, profile.byzantineWanderPercent)) return { kind: 'task', task };
      return roam(view, rng, profile);
    },
    solve(_view, task, rng) {
      return {
        thinkMs: thinkTime(profile, timing, task, rng),
        mistake: chance(rng, Math.floor(profile.mistakePercent / 2)),
        abandon: chance(rng, profile.fakeAbandonPercent),
      };
    },
  };
}

// Seconds a relay keeps a bot waiting at most, so it never stands there forever.
const RELAY_WAIT_MS = 20_000;
// How likely a bot is to answer a partition by heading to a relay, so not every bot drops its work.
const RELAY_PERCENT = 70;
// Spread of bots between the two relays when neither is held.
function preferredRelay(selfId: string, count: number): number {
  let h = 0;
  for (const c of selfId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % count;
}

function relayPlan(view: BotView, rng: RandomSource): BotPlan | null {
  if (view.partition === 0 || !chance(rng, RELAY_PERCENT)) return null;
  const relays = view.arena.relays;
  // Only relays this bot can walk to now: on Watchtower Peaks the cut bridges leave one per range.
  const ground = movementMap(view.arena, view.partition > 0);
  const free = relays.map((_, i) => i).filter((i) => (view.relays & (1 << i)) === 0 && relays[i] !== undefined && findPath(ground, view.position, relays[i]).ok);
  if (free.length === 0) return null;
  const preferred = preferredRelay(view.selfId, relays.length);
  const index = free.includes(preferred) ? preferred : (free[0] ?? 0);
  const to = relays[index] ?? relays[0];
  return to === undefined ? null : { kind: 'visit', to, lingerMs: RELAY_WAIT_MS };
}

function topSuspect(view: BotView, among: readonly string[]): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null;
  for (const id of among) {
    const score = view.suspicion.get(id) ?? 0;
    if (best === null || score > best.score) best = { id, score };
  }
  return best;
}

const activeOthers = (view: BotView): string[] => view.others.filter((o) => o.active).map((o) => o.id);

// Honest bots go by public evidence: signers of revealed forgeries are suspects.
export const HONEST_SOCIAL: BotSocialHooks = Object.freeze({
  onProposal(view: BotView, p: ProposalSeen, rng: RandomSource): ProposalChoice {
    if (p.warned) return chance(rng, 80) ? 'refuse' : 'sign';
    if (p.vouched) return chance(rng, 90) ? 'sign' : 'refuse';
    const tainted = p.signers.some((id) => (view.suspicion.get(id) ?? 0) >= 2);
    if (tainted) return chance(rng, 60) ? 'refuse' : 'sign';
    return chance(rng, 80) ? 'sign' : 'refuse';
  },
  onCouncil(view: BotView, candidates: readonly string[], rng: RandomSource): string {
    const top = topSuspect(view, candidates.filter((id) => id !== view.selfId));
    if (top !== null && top.score >= 2) return top.id;
    if (top !== null && top.score === 1 && chance(rng, 50)) return top.id;
    return 'skip';
  },
  onChat(view: BotView, _trigger: ChatTrigger, rng: RandomSource): ChatMessage | null {
    const top = topSuspect(view, activeOthers(view));
    if (top !== null && top.score >= 2) return { phrase: 'suspect', playerId: top.id };
    if (!chance(rng, 50)) return null;
    return { phrase: chance(rng, 50) ? 'showEvidence' : 'whereWereYou' };
  },
});

// Byzantines sign their own forgeries, refuse some real withdrawals, and steer votes at honest guardians.
export const BYZANTINE_SOCIAL: BotSocialHooks = Object.freeze({
  onProposal(_view: BotView, p: ProposalSeen, rng: RandomSource): ProposalChoice {
    if (p.forged === true) return 'sign';
    return chance(rng, 35) ? 'refuse' : 'sign';
  },
  onCouncil(view: BotView, candidates: readonly string[], rng: RandomSource): string {
    const honest = candidates.filter((id) => id !== view.selfId && view.others.find((o) => o.id === id)?.fellow !== true);
    const top = topSuspect(view, honest);
    if (top !== null && top.score >= 1) return top.id;
    if (chance(rng, 30)) return pickOne(rng, honest) ?? 'skip';
    return 'skip';
  },
  onChat(view: BotView, _trigger: ChatTrigger, rng: RandomSource): ChatMessage | null {
    if (!chance(rng, 60)) return null;
    const target = pickOne(rng, view.others.filter((o) => o.active && !o.fellow).map((o) => o.id));
    if (target !== undefined && chance(rng, 50)) return { phrase: 'suspect', playerId: target };
    return { phrase: chance(rng, 50) ? 'iAgree' : 'skipVote' };
  },
});

// Honest bots answer partitions and call a council on strong evidence; otherwise the task plan applies.
function honestSocialPlan(view: BotView, rng: RandomSource): BotPlan | null {
  const relay = relayPlan(view, rng);
  if (relay !== null) return relay;
  if (view.canCallCouncil) {
    const top = topSuspect(view, activeOthers(view));
    if (top !== null && top.score >= 2 && chance(rng, 60)) return { kind: 'act', to: view.arena.seal, action: { type: 'callCouncil' }, lingerMs: 1000 };
  }
  return null;
}

// Byzantine sabotage, only when the server says each action is ready.
function byzantineSocialPlan(view: BotView, rng: RandomSource): BotPlan | null {
  if (view.partition === 0 && view.now >= view.partitionAt && chance(rng, 35)) return { kind: 'now', action: { type: 'partition' } };
  if (view.now >= view.forgeAt && chance(rng, 50)) {
    const spot = pickOne(rng, roomy(view.arena).get('signingHall') ?? []);
    if (spot !== undefined) return { kind: 'act', to: spot, action: { type: 'forge' }, lingerMs: 1500 };
  }
  if (view.now >= view.freezeAt && chance(rng, 25)) {
    const near = view.others.filter((o) => o.active && !o.fellow && Math.hypot(o.x - view.position.x, o.y - view.position.y) <= 5);
    const target = pickOne(rng, near);
    if (target !== undefined) return { kind: 'act', to: { x: target.x, y: target.y }, action: { type: 'freeze', targetId: target.id }, lingerMs: 1000 };
  }
  return null;
}

export interface StrategySet {
  readonly honest: BotStrategy;
  readonly byzantine: BotStrategy;
}

export function defaultStrategies(profile: BotProfile, timing: TaskTiming): StrategySet {
  return { honest: honestStrategy(profile, timing), byzantine: byzantineStrategy(profile, timing) };
}
