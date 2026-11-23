// Signing ceremonies for one match: proposals, forgeries and audits. Server-only; which
// proposals are forged and who forged them never leave this object except through
// targeted messages to Byzantines, audit results to the auditor, and verdicts once a proposal closes.
import {
  atAuditDesk,
  createProposal,
  inSigningHall,
  msToTicks,
  refuseProposal,
  settleProposal,
  signProposal,
  withdrawalAmount,
  type CeremonyRefused,
  type CeremonyTiming,
  type Guardian,
  type Proposal,
  type RandomSource,
  type Role,
  type Vec2,
} from '@byzantine-council/shared';

// Hard cap per match so a very long match cannot grow this list without bound.
const MAX_PROPOSALS = 80;
// Closed proposals kept on screen after they settle.
export const RECENT_CLOSED = 4;

type Refusal = CeremonyRefused['reason'];
export interface CeremonyFailure {
  readonly ok: false;
  readonly reason: Refusal;
  readonly retryInMs?: number;
}
export type CeremonyOutcome = { readonly ok: true } | CeremonyFailure;

interface Actor {
  forgeReadyAt: number;
  auditReadyAt: number;
  audit: { readonly proposalId: string; readonly startedAt: number } | null;
  readonly audited: Set<string>;
}

export type AuditEvent =
  | { readonly id: string; readonly status: 'cancelled'; readonly proposalId: string }
  | { readonly id: string; readonly status: 'done'; readonly proposalId: string; readonly forged: boolean };

export interface CeremonyEvents {
  // Proposals that closed during this tick, with their truth.
  readonly closed: readonly Proposal[];
  readonly audits: readonly AuditEvent[];
}

function wait(until: number, now: number): CeremonyFailure {
  return { ok: false, reason: 'cooldown', retryInMs: Math.min(60_000, Math.max(0, Math.ceil(until - now))) };
}

export class Ceremony {
  readonly #timing: CeremonyTiming;
  readonly #rng: RandomSource;
  readonly #startedAt: number;
  readonly #actors = new Map<string, Actor>();
  #proposals: Proposal[] = [];
  #nextId = 1;
  #nextSpawnAt: number;
  // Spawn gaps are multiplied by this; the final blocks speed withdrawals up.
  #pace = 1;

  constructor(playerIds: readonly string[], timing: CeremonyTiming, rng: RandomSource, now: number) {
    this.#timing = timing;
    this.#rng = rng;
    this.#startedAt = now;
    this.#nextSpawnAt = now + timing.firstProposalMs;
    for (const id of playerIds) this.#actors.set(id, { forgeReadyAt: 0, auditReadyAt: 0, audit: null, audited: new Set() });
  }

  get proposals(): readonly Proposal[] {
    return this.#proposals;
  }

  // Open proposals first, then the most recently closed few.
  visible(): Proposal[] {
    const open = this.#proposals.filter((p) => p.status === 'open');
    const closed = this.#proposals.filter((p) => p.status !== 'open').slice(-RECENT_CLOSED);
    return [...open, ...closed];
  }

  forgedOpen(): string[] {
    return this.#proposals.filter((p) => p.forged && p.status === 'open').map((p) => p.id);
  }

  #open(): number {
    return this.#proposals.filter((p) => p.status === 'open').length;
  }

  #started(now: number): boolean {
    return now >= this.#startedAt + this.#timing.firstProposalMs;
  }

  #file(amount: number, requestedBy: string, forged: boolean, nowTick: number): Proposal {
    const proposal = createProposal({
      id: String(this.#nextId++),
      amount,
      requestedBy,
      forged,
      expiresAtTick: nowTick + msToTicks(this.#timing.ttlMs),
    });
    this.#proposals.push(proposal);
    return proposal;
  }

  #replace(next: Proposal): void {
    this.#proposals = this.#proposals.map((p) => (p.id === next.id ? next : p));
  }

  // A Byzantine standing in the Signing Hall files a forged withdrawal.
  forge(id: string, role: Role | undefined, pos: Vec2, now: number, nowTick: number): { ok: true; proposalId: string } | CeremonyFailure {
    const actor = this.#actors.get(id);
    if (actor === undefined || role !== 'byzantine') return { ok: false, reason: 'cannotAct' };
    if (!this.#started(now)) return { ok: false, reason: 'notYet' };
    if (!inSigningHall(pos)) return { ok: false, reason: 'notHere' };
    if (now < actor.forgeReadyAt) return wait(actor.forgeReadyAt, now);
    if (this.#open() >= this.#timing.maxOpen || this.#proposals.length >= MAX_PROPOSALS) return { ok: false, reason: 'tooMany' };
    actor.forgeReadyAt = now + this.#timing.forgeCooldownMs;
    // Same amounts and the same counter as real withdrawals, so nothing on screen tells them apart.
    const proposal = this.#file(withdrawalAmount(this.#rng), id, true, nowTick);
    return { ok: true, proposalId: proposal.id };
  }

  respond(id: string, proposalId: string, sign: boolean, guardians: readonly Guardian[], nowTick: number): { ok: true; proposal: Proposal } | CeremonyFailure {
    const proposal = this.#proposals.find((p) => p.id === proposalId);
    if (proposal === undefined) return { ok: false, reason: 'notOpen' };
    const result = sign ? signProposal(proposal, id, guardians, nowTick) : refuseProposal(proposal, id, guardians, nowTick);
    if (!result.ok) {
      const reason: Refusal = result.error === 'alreadyResponded' ? 'alreadyResponded' : result.error === 'cannotAct' || result.error === 'notGuardian' ? 'cannotAct' : 'notOpen';
      return { ok: false, reason };
    }
    this.#replace(result.value);
    return { ok: true, proposal: result.value };
  }

  // Standing at the Ledger Archive desk for auditMs reveals one open proposal's truth to this player.
  startAudit(id: string, proposalId: string, pos: Vec2, now: number): CeremonyOutcome {
    const actor = this.#actors.get(id);
    const proposal = this.#proposals.find((p) => p.id === proposalId);
    if (actor === undefined) return { ok: false, reason: 'cannotAct' };
    if (proposal?.status !== 'open') return { ok: false, reason: 'notOpen' };
    if (actor.audit !== null) return { ok: false, reason: 'busy' };
    if (actor.audited.has(proposalId)) return { ok: false, reason: 'audited' };
    if (!atAuditDesk(pos)) return { ok: false, reason: 'notHere' };
    if (now < actor.auditReadyAt) return wait(actor.auditReadyAt, now);
    actor.audit = { proposalId, startedAt: now };
    return { ok: true };
  }

  cancelAudit(id: string): string | null {
    const actor = this.#actors.get(id);
    const audit = actor?.audit ?? null;
    if (actor === undefined || audit === null) return null;
    actor.audit = null;
    return audit.proposalId;
  }

  leave(id: string): void {
    this.#actors.delete(id);
  }

  hurry(factor: number): void {
    this.#pace = Math.min(1, Math.max(0.1, factor));
  }

  // Councils stop the clock: open proposals and the next real withdrawal move back by the pause.
  resume(pausedTicks: number, pausedMs: number): void {
    this.#proposals = this.#proposals.map((p) => (p.status === 'open' ? { ...p, expiresAtTick: p.expiresAtTick + pausedTicks } : p));
    this.#nextSpawnAt += pausedMs;
  }

  // Spawns real withdrawals, settles proposals against the current members, and finishes audits.
  tick(now: number, nowTick: number, guardians: readonly Guardian[], positionOf: (id: string) => Vec2 | undefined): CeremonyEvents {
    if (this.#started(now) && now >= this.#nextSpawnAt) {
      const gap = this.#timing.spawnMinMs + this.#rng.int(Math.max(1, this.#timing.spawnMaxMs - this.#timing.spawnMinMs + 1));
      this.#nextSpawnAt = now + Math.round(gap * this.#pace);
      if (this.#open() < this.#timing.maxOpen && this.#proposals.length < MAX_PROPOSALS) {
        this.#file(withdrawalAmount(this.#rng), 'federation', false, nowTick);
      }
    }
    const closed: Proposal[] = [];
    this.#proposals = this.#proposals.map((p) => {
      if (p.status !== 'open') return p;
      const next = settleProposal(p, guardians, nowTick);
      if (next.status !== 'open') closed.push(next);
      return next;
    });
    const audits: AuditEvent[] = [];
    for (const [id, actor] of this.#actors) {
      const audit = actor.audit;
      if (audit === null) continue;
      const proposal = this.#proposals.find((p) => p.id === audit.proposalId);
      const pos = positionOf(id);
      if (proposal?.status !== 'open' || pos === undefined || !atAuditDesk(pos)) {
        actor.audit = null;
        audits.push({ id, status: 'cancelled', proposalId: audit.proposalId });
      } else if (now >= audit.startedAt + this.#timing.auditMs) {
        actor.audit = null;
        actor.audited.add(audit.proposalId);
        actor.auditReadyAt = now + this.#timing.auditCooldownMs;
        audits.push({ id, status: 'done', proposalId: audit.proposalId, forged: proposal.forged });
      }
    }
    return { closed, audits };
  }
}
