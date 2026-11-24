// Council meetings for one match: calling, voting, tallying and quick-chat limits. Server-only.
import {
  COUNCIL_SEAL,
  atCouncilSeal,
  castVote,
  msToTicks,
  openCouncil,
  tallyVotes,
  type Council,
  type CouncilRefused,
  type CouncilTiming,
  type Guardian,
  type Tally,
  type Vec2,
} from '@byzantine-council/shared';

type Refusal = CouncilRefused['reason'];
export interface CouncilFailure {
  readonly ok: false;
  readonly reason: Refusal;
  readonly retryInMs?: number;
}

interface Running {
  council: Council;
  readonly number: number;
  readonly startedMs: number;
  readonly startedTick: number;
  stage: 'voting' | 'result';
  tally: Tally | null;
  resultUntil: number;
}

export type MeetingEvent =
  | { readonly kind: 'tallied'; readonly tally: Tally; readonly ballots: ReadonlyMap<string, string> }
  | { readonly kind: 'ended'; readonly pausedTicks: number; readonly pausedMs: number };

function wait(until: number, now: number): CouncilFailure {
  return { ok: false, reason: 'cooldown', retryInMs: Math.min(60_000, Math.max(0, Math.ceil(until - now))) };
}

export class MeetingDesk {
  readonly #timing: CouncilTiming;
  readonly #calls = new Map<string, number>();
  readonly #chat = new Map<string, { count: number; lastAt: number }>();
  #readyAt: number;
  #running: Running | null = null;
  #number = 0;

  // Where a council may be called from, which moves with the arena.
  readonly #seal: Vec2;

  constructor(timing: CouncilTiming, now: number, seal: Vec2 = COUNCIL_SEAL) {
    this.#seal = seal;
    this.#timing = timing;
    this.#readyAt = now + timing.openingMs;
  }

  get active(): boolean {
    return this.#running !== null;
  }

  get stage(): 'voting' | 'result' | null {
    return this.#running?.stage ?? null;
  }

  get number(): number {
    return this.#running?.number ?? 0;
  }

  get calledBy(): string {
    return this.#running?.council.calledBy ?? '';
  }

  // Voters so far, without their choices.
  voted(): string[] {
    return [...(this.#running?.council.votes.keys() ?? [])];
  }

  secondsLeft(nowTick: number, nowMs: number, tickHz: number): number {
    const r = this.#running;
    if (r === null) return 0;
    const left = r.stage === 'voting' ? (r.council.closesAtTick - nowTick) / tickHz : (r.resultUntil - nowMs) / 1000;
    return Math.max(0, Math.min(255, Math.ceil(left)));
  }

  call(id: string, pos: Vec2, guardians: readonly Guardian[], nowMs: number, nowTick: number): { ok: true } | CouncilFailure {
    if (this.#running !== null) return { ok: false, reason: 'notYet' };
    if (!atCouncilSeal(pos, this.#seal)) return { ok: false, reason: 'notHere' };
    if ((this.#calls.get(id) ?? 0) >= this.#timing.perPlayer) return { ok: false, reason: 'usedUp' };
    if (nowMs < this.#readyAt) return wait(this.#readyAt, nowMs);
    const opened = openCouncil(id, guardians, nowTick, msToTicks(this.#timing.votingMs));
    if (!opened.ok) return { ok: false, reason: 'cannotAct' };
    this.#calls.set(id, (this.#calls.get(id) ?? 0) + 1);
    this.#chat.clear();
    this.#number += 1;
    this.#running = { council: opened.value, number: this.#number, startedMs: nowMs, startedTick: nowTick, stage: 'voting', tally: null, resultUntil: 0 };
    return { ok: true };
  }

  vote(id: string, target: string, guardians: readonly Guardian[], nowTick: number): { ok: true } | CouncilFailure {
    const r = this.#running;
    if (r?.stage !== 'voting') return { ok: false, reason: 'votingClosed' };
    const result = castVote(r.council, id, target, guardians, nowTick);
    if (!result.ok) {
      const reason: Refusal =
        result.error === 'alreadyVoted' || result.error === 'selfVote' || result.error === 'invalidTarget' || result.error === 'votingClosed'
          ? result.error
          : 'cannotAct';
      return { ok: false, reason };
    }
    r.council = result.value;
    return { ok: true };
  }

  // Per-council quick-chat budget and pacing; outside councils only the pacing applies.
  chat(id: string, nowMs: number): { ok: true } | CouncilFailure {
    const used = this.#chat.get(id) ?? { count: 0, lastAt: -Infinity };
    if (nowMs < used.lastAt + this.#timing.chatGapMs) return { ok: false, reason: 'chatLimit', retryInMs: Math.ceil(used.lastAt + this.#timing.chatGapMs - nowMs) };
    if (this.#running !== null && used.count >= this.#timing.chatPerCouncil) return { ok: false, reason: 'chatLimit' };
    this.#chat.set(id, { count: used.count + 1, lastAt: nowMs });
    return { ok: true };
  }

  // `voters` are the members who can vote right now; once all of them have, voting closes early.
  tick(nowMs: number, nowTick: number, guardians: readonly Guardian[], voters: readonly string[]): MeetingEvent | null {
    const r = this.#running;
    if (r === null) return null;
    if (r.stage === 'voting') {
      const everyone = voters.length > 0 && voters.every((v) => r.council.votes.has(v));
      if (nowTick < r.council.closesAtTick && !everyone) return null;
      const tally = tallyVotes(r.council, guardians);
      r.stage = 'result';
      r.tally = tally;
      r.resultUntil = nowMs + this.#timing.resultMs;
      return { kind: 'tallied', tally, ballots: new Map(r.council.votes) };
    }
    if (nowMs < r.resultUntil) return null;
    this.#running = null;
    this.#readyAt = nowMs + this.#timing.cooldownMs;
    return { kind: 'ended', pausedTicks: nowTick - r.startedTick, pausedMs: nowMs - r.startedMs };
  }
}

