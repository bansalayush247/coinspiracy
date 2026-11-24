// One match's hidden state: roles, task progress and open challenges. Server-only; the room
// copies what each player may see into the synced state and never sends this object anywhere.
import { randomBytes } from 'node:crypto';
import {
  ALL_TASKS,
  CITADEL,
  CEREMONY_TIMING,
  SABOTAGE_TIMING,
  CONSENSUS_GOAL,
  MAX_TASK_RETRY_MS,
  assignRoles,
  checkAnswer,
  consensusPercent,
  countTasks,
  cryptoRandom,
  evaluateWinner,
  generateChallenge,
  hasTask,
  inStationRange,
  STATION_RANGE,
  taskBit,
  type Arena,
  type Guardian,
  type CeremonyTiming,
  type Proposal,
  type RandomSource,
  type SabotageTiming,
  type Role,
  type TaskAnswer,
  type TaskChallenge,
  type TaskKind,
  type TaskTiming,
  type Vec2,
  type Winner,
} from '@byzantine-council/shared';
import type { PlayerFacts } from '@byzantine-council/shared/progression';
import { Ceremony } from './ceremony.js';
import { Sabotage } from './sabotage.js';

interface OpenChallenge {
  readonly id: string;
  readonly kind: TaskKind;
  readonly challenge: TaskChallenge;
  readonly openedAt: number;
}

interface Seat {
  readonly role: Role;
  readonly assigned: number;
  done: number;
  open: OpenChallenge | null;
  // Wrong-answer lockout and open cooldown, in ms timestamps.
  retryAt: number;
  nextOpenAt: number;
  // Key rotated out by a council: no longer a member, can no longer act.
  out: boolean;
}

export type OpenOutcome =
  | { readonly ok: true; readonly id: string; readonly challenge: TaskChallenge }
  | { readonly ok: false; readonly reason: 'outOfRange' | 'retryLater' | 'busy' | 'unavailable'; readonly retryInMs?: number };

export type AnswerOutcome =
  | { readonly ok: true; readonly counted: boolean; readonly done: number }
  | { readonly ok: false; readonly reason: 'wrong'; readonly retryInMs: number }
  | { readonly ok: false; readonly reason: 'moved' | 'expired' | 'ignored' };

export type CloseReason = 'moved' | 'expired';

// What each guardian did this match, for rewards. Server-only, like everything here.
interface Tally {
  moved: number;
  tasks: Record<TaskKind, number>;
  legitSigned: number;
  forgedRefused: number;
  forgedSigned: number;
  gathered: number;
  byzantineVotes: number;
  misdirections: number;
  repaired: number;
  runOut: number;
}

function newTally(): Tally {
  return { moved: 0, tasks: { deposit: 0, ledger: 0, route: 0, watchtower: 0 }, legitSigned: 0, forgedRefused: 0, forgedSigned: 0, gathered: 0, byzantineVotes: 0, misdirections: 0, repaired: 0, runOut: 0 };
}

// 72 random bits, URL-safe; matches TaskIdSchema.
function newTaskId(): string {
  return randomBytes(9).toString('base64url');
}

// Retry hints are clamped to what the client's schema accepts.
function retryHint(ms: number): number {
  return Math.min(MAX_TASK_RETRY_MS, Math.max(0, Math.ceil(ms)));
}

export class Match {
  readonly #seats = new Map<string, Seat>();
  readonly #timing: TaskTiming;
  readonly #rng: RandomSource;
  // Honest tasks dealt at the start. Fixed, so a player leaving never moves the public bar:
  // dropping only honest leavers' tasks would tell everyone which side the leaver was on.
  readonly #honestTotal: number;
  // Honest tasks finished by players who have since left still count toward consensus.
  #departedHonestDone = 0;
  #finished = false;
  readonly ceremony: Ceremony;
  readonly sabotage: Sabotage;
  // Where the match is played: station positions and the gateway's routing difficulty.
  readonly #arena: Arena;
  readonly #tally = new Map<string, Tally>();

  constructor(
    playerIds: readonly string[],
    timing: TaskTiming,
    ceremonyTiming: CeremonyTiming = CEREMONY_TIMING,
    now = 0,
    rng: RandomSource = cryptoRandom,
    sabotageTiming: SabotageTiming = SABOTAGE_TIMING,
    arena: Arena = CITADEL,
  ) {
    this.#timing = timing;
    this.#rng = rng;
    this.#arena = arena;
    this.ceremony = new Ceremony(playerIds, ceremonyTiming, rng, now, arena);
    this.sabotage = new Sabotage(sabotageTiming, now, arena.relays);
    let honestTotal = 0;
    for (const [id, role] of assignRoles(playerIds, rng)) {
      this.#seats.set(id, { role, assigned: ALL_TASKS, done: 0, open: null, retryAt: 0, nextOpenAt: 0, out: false });
      if (role === 'honest') honestTotal += countTasks(ALL_TASKS);
      this.#tally.set(id, newTally());
    }
    this.#honestTotal = honestTotal;
  }

  get finished(): boolean {
    return this.#finished;
  }

  role(id: string): Role | undefined {
    return this.#seats.get(id)?.role;
  }

  assigned(id: string): number {
    return this.#seats.get(id)?.assigned ?? 0;
  }

  done(id: string): number {
    return this.#seats.get(id)?.done ?? 0;
  }

  byzantines(): string[] {
    return [...this.#seats].filter(([, s]) => s.role === 'byzantine').map(([id]) => id);
  }

  hasOpenTask(id: string): boolean {
    return this.#seats.get(id)?.open != null;
  }

  openTask(id: string, kind: TaskKind, pos: Vec2, now: number, tipHeight: number): OpenOutcome {
    const seat = this.#seats.get(id);
    if (this.#finished || seat === undefined || seat.out || this.sabotage.isFrozen(id) || !hasTask(seat.assigned, kind) || hasTask(seat.done, kind)) {
      return { ok: false, reason: 'unavailable' };
    }
    if (seat.open !== null) return { ok: false, reason: 'busy' };
    const waitUntil = Math.max(seat.retryAt, seat.nextOpenAt);
    if (now < waitUntil) return { ok: false, reason: 'retryLater', retryInMs: retryHint(waitUntil - now) };
    if (!inStationRange(pos, kind, STATION_RANGE, this.#arena.stations)) return { ok: false, reason: 'outOfRange' };
    const challenge = generateChallenge(kind, this.#rng, { tipHeight, hardRoutes: this.#arena.hardRoutes });
    seat.open = { id: newTaskId(), kind, challenge, openedAt: now };
    seat.nextOpenAt = now + this.#timing.openCooldownMs;
    return { ok: true, id: seat.open.id, challenge };
  }

  answer(id: string, taskId: string, answer: TaskAnswer, pos: Vec2, now: number): AnswerOutcome {
    const seat = this.#seats.get(id);
    const open = seat?.open;
    if (this.#finished || seat === undefined || open == null || open.id !== taskId || answer.kind !== open.kind) {
      return { ok: false, reason: 'ignored' };
    }
    // Faster than a person could solve it: ignored, and the challenge stays open.
    if (now < open.openedAt + this.#timing.minSolveMs[open.kind]) return { ok: false, reason: 'ignored' };
    seat.open = null;
    if (now >= open.openedAt + this.#timing.expireMs) return { ok: false, reason: 'expired' };
    if (!inStationRange(pos, open.kind, STATION_RANGE, this.#arena.stations)) return { ok: false, reason: 'moved' };
    if (!checkAnswer(open.challenge, answer)) {
      seat.retryAt = now + this.#timing.retryMs;
      return { ok: false, reason: 'wrong', retryInMs: retryHint(this.#timing.retryMs) };
    }
    seat.done |= taskBit(open.kind);
    const t = this.#tally.get(id);
    if (t !== undefined) t.tasks[open.kind] += 1;
    // Byzantine tasks are fakes: their list fills up, the consensus bar does not.
    return { ok: true, counted: seat.role === 'honest', done: seat.done };
  }

  closeTask(id: string): boolean {
    const seat = this.#seats.get(id);
    if (seat?.open == null) return false;
    seat.open = null;
    return true;
  }

  // Closes challenges whose player walked away or left them too long.
  sweep(now: number, positionOf: (id: string) => Vec2 | undefined): { id: string; reason: CloseReason }[] {
    const closed: { id: string; reason: CloseReason }[] = [];
    for (const [id, seat] of this.#seats) {
      const open = seat.open;
      if (open === null) continue;
      const pos = positionOf(id);
      const reason: CloseReason | null =
        now >= open.openedAt + this.#timing.expireMs ? 'expired' : pos === undefined || !inStationRange(pos, open.kind, STATION_RANGE, this.#arena.stations) ? 'moved' : null;
      if (reason !== null) {
        seat.open = null;
        closed.push({ id, reason });
      }
    }
    return closed;
  }

  noteMove(id: string, distance: number): void {
    const t = this.#tally.get(id);
    if (t !== undefined && Number.isFinite(distance) && distance > 0) t.moved = Math.min(1_000_000, t.moved + distance);
  }

  // A signature or refusal that counted, on a proposal whose truth the server knows.
  noteResponse(id: string, p: Proposal, sign: boolean): void {
    const t = this.#tally.get(id);
    if (t === undefined) return;
    if (sign && !p.forged) t.legitSigned += 1;
    if (!sign && p.forged) t.forgedRefused += 1;
    if (sign && p.forged) {
      t.forgedSigned += 1;
      // An honest signature on a forgery counts for the Byzantine who filed it.
      const filer = this.#tally.get(p.requestedBy);
      if (filer !== undefined && this.role(id) === 'honest') filer.gathered += 1;
    }
  }

  // A council result: honest votes for Byzantines, and Byzantines credited when an honest key goes.
  noteCouncil(ballots: ReadonlyMap<string, string>, ejected: string | null): void {
    for (const [voter, target] of ballots) {
      const t = this.#tally.get(voter);
      if (t !== undefined && this.role(voter) === 'honest' && this.role(target) === 'byzantine') t.byzantineVotes += 1;
    }
    if (ejected !== null && this.role(ejected) === 'honest') {
      for (const id of this.byzantines()) {
        const t = this.#tally.get(id);
        if (t !== undefined && this.isMember(id)) t.misdirections += 1;
      }
    }
  }

  notePartitionRepaired(ids: readonly string[]): void {
    for (const id of ids) {
      const t = this.#tally.get(id);
      if (t !== undefined) t.repaired += 1;
    }
  }

  notePartitionRanOut(startedBy: string): void {
    const t = this.#tally.get(startedBy);
    if (t !== undefined) t.runOut += 1;
  }

  // Everything the reward rules need about one guardian, once the match is over.
  playerFacts(id: string, finished: boolean, afkKicked: boolean): PlayerFacts | null {
    const t = this.#tally.get(id);
    const role = this.role(id);
    if (t === undefined || role === undefined) return null;
    return {
      role,
      finished,
      afkKicked,
      movedTiles: Math.floor(t.moved),
      tasks: { ...t.tasks },
      legitSigned: t.legitSigned,
      forgedRefused: t.forgedRefused,
      forgedSigned: t.forgedSigned,
      forgedSignaturesGathered: t.gathered,
      byzantineVotes: t.byzantineVotes,
      misdirections: t.misdirections,
      partitionsRepaired: t.repaired,
      partitionsRunOut: t.runOut,
      rotatedOut: !this.isMember(id),
    };
  }

  // Still a member of the federation: seated and not rotated out.
  isMember(id: string): boolean {
    const seat = this.#seats.get(id);
    return seat !== undefined && !seat.out;
  }

  // A council removed this guardian's key. Their finished honest tasks still count toward the bar.
  rotateOut(id: string): boolean {
    const seat = this.#seats.get(id);
    if (seat === undefined || seat.out) return false;
    seat.out = true;
    seat.open = null;
    this.ceremony.cancelAudit(id);
    return true;
  }

  // A player left for good: they are no longer a member of the federation.
  leave(id: string): void {
    const seat = this.#seats.get(id);
    if (seat === undefined) return;
    if (seat.role === 'honest') this.#departedHonestDone += countTasks(seat.done & seat.assigned);
    this.#seats.delete(id);
    this.ceremony.leave(id);
    this.sabotage.leave(id);
  }

  // Public bar: honest tasks done out of all honest tasks dealt.
  consensus(): number {
    let done = this.#departedHonestDone;
    for (const seat of this.#seats.values()) {
      if (seat.role === 'honest') done += countTasks(seat.done & seat.assigned);
    }
    return consensusPercent(done, this.#honestTotal);
  }

  // Every honest guardian still in the federation has finished; leavers' unfinished tasks cannot be done.
  consensusReached(): boolean {
    let honest = 0;
    for (const seat of this.#seats.values()) {
      if (seat.role !== 'honest' || seat.out) continue;
      if ((seat.done & seat.assigned) !== seat.assigned) return false;
      honest += 1;
    }
    return honest > 0;
  }

  // Current federation members, as the shared rules see them.
  guardians(): Guardian[] {
    // Frozen guardians are still members but cannot act, exactly like a guardian whose server is down.
    return [...this.#seats].map(([id, s]) => ({ id, role: s.role, status: s.out ? 'rotatedOut' : this.sabotage.isFrozen(id) ? 'disconnected' : 'active' }));
  }

  winner(): Winner | null {
    const consensus = this.consensusReached() ? CONSENSUS_GOAL : this.consensus();
    return evaluateWinner({ guardians: this.guardians(), proposals: this.ceremony.proposals, consensus, outages: this.sabotage.outages });
  }

  // Closes every open challenge (a council was called); returns whose were closed.
  finishOpenTasks(): string[] {
    const closed: string[] = [];
    for (const [id, seat] of this.#seats) {
      if (seat.open === null) continue;
      seat.open = null;
      closed.push(id);
    }
    return closed;
  }

  // Stops play; returns the players whose open challenge was dropped.
  finish(): string[] {
    this.#finished = true;
    const hadOpen: string[] = [];
    for (const [id, seat] of this.#seats) {
      if (seat.open === null) continue;
      seat.open = null;
      hadOpen.push(id);
    }
    return hadOpen;
  }
}
