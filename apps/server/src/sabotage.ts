// Byzantine sabotage for one match: partitions and freezes. Server-only; who triggered either
// is never sent anywhere, only the public effect (a partition timer, a frozen guardian).
import { RELAYS, relayAt, withinFreezeRange, type Role, type SabotageRefused, type SabotageTiming, type Vec2 } from '@byzantine-council/shared';

type Refusal = SabotageRefused['reason'];
export interface SabotageFailure {
  readonly ok: false;
  readonly reason: Refusal;
  readonly retryInMs?: number;
}

interface Partition {
  readonly startedBy: string;
  endsAt: number;
  // When both relays started being held together, or null.
  heldSince: number | null;
}

export type SabotageEvent =
  | { readonly kind: 'repaired'; readonly by: readonly string[] }
  | { readonly kind: 'outage'; readonly startedBy: string }
  | { readonly kind: 'thawed'; readonly id: string };

function wait(until: number, now: number): SabotageFailure {
  return { ok: false, reason: 'cooldown', retryInMs: Math.min(60_000, Math.max(0, Math.ceil(until - now))) };
}

export class Sabotage {
  readonly #timing: SabotageTiming;
  readonly #readyAt: number;
  #partition: Partition | null = null;
  #partitionReadyAt = 0;
  readonly #freezeReadyAt = new Map<string, number>();
  readonly #frozen = new Map<string, number>();
  #outages = 0;
  #relays = 0;

  // The two relays a repair needs, which move with the arena.
  readonly #relayPoints: readonly Vec2[];

  constructor(timing: SabotageTiming, now: number, relays: readonly Vec2[] = RELAYS) {
    this.#relayPoints = relays;
    this.#timing = timing;
    this.#readyAt = now + timing.openingMs;
  }

  get partitioned(): boolean {
    return this.#partition !== null;
  }

  get outages(): number {
    return this.#outages;
  }

  // Bitmask of relays held at the last tick.
  get relays(): number {
    return this.#relays;
  }

  partitionSecondsLeft(now: number): number {
    return this.#partition === null ? 0 : Math.max(0, Math.min(255, Math.ceil((this.#partition.endsAt - now) / 1000)));
  }

  repairPercent(now: number): number {
    const since = this.#partition?.heldSince ?? null;
    return since === null ? 0 : Math.min(100, Math.floor((100 * (now - since)) / this.#timing.repairMs));
  }

  isFrozen(id: string): boolean {
    return this.#frozen.has(id);
  }

  frozenSecondsLeft(id: string, now: number): number {
    const until = this.#frozen.get(id);
    return until === undefined ? 0 : Math.max(0, Math.min(255, Math.ceil((until - now) / 1000)));
  }

  // Milliseconds until this Byzantine may partition and freeze again.
  readiness(id: string, now: number): { partitionInMs: number; freezeInMs: number } {
    const opening = Math.max(0, this.#readyAt - now);
    const partition = this.#partition !== null ? this.#timing.partitionMs : Math.max(opening, this.#partitionReadyAt - now);
    const freeze = Math.max(opening, (this.#freezeReadyAt.get(id) ?? 0) - now);
    return { partitionInMs: Math.min(600_000, Math.ceil(partition)), freezeInMs: Math.min(600_000, Math.ceil(freeze)) };
  }

  partition(role: Role | undefined, now: number, by = ''): { ok: true } | SabotageFailure {
    if (role !== 'byzantine') return { ok: false, reason: 'cannotAct' };
    if (now < this.#readyAt) return { ok: false, reason: 'notYet', retryInMs: Math.min(60_000, Math.ceil(this.#readyAt - now)) };
    if (this.#partition !== null) return { ok: false, reason: 'active' };
    if (now < this.#partitionReadyAt) return wait(this.#partitionReadyAt, now);
    this.#partition = { startedBy: by, endsAt: now + this.#timing.partitionMs, heldSince: null };
    return { ok: true };
  }

  freeze(id: string, role: Role | undefined, pos: Vec2, targetId: string, target: Vec2 | undefined, targetIsMember: boolean, now: number): { ok: true } | SabotageFailure {
    if (role !== 'byzantine') return { ok: false, reason: 'cannotAct' };
    if (now < this.#readyAt) return { ok: false, reason: 'notYet', retryInMs: Math.min(60_000, Math.ceil(this.#readyAt - now)) };
    if (targetId === id || target === undefined || !targetIsMember || this.#frozen.has(targetId)) return { ok: false, reason: 'invalidTarget' };
    if (!withinFreezeRange(pos, target)) return { ok: false, reason: 'notHere' };
    const ready = this.#freezeReadyAt.get(id) ?? 0;
    if (now < ready) return wait(ready, now);
    this.#frozen.set(targetId, now + this.#timing.freezeMs);
    this.#freezeReadyAt.set(id, now + this.#timing.freezeCooldownMs);
    return { ok: true };
  }

  // Councils stop the clock on partitions and freezes.
  resume(pausedMs: number): void {
    if (this.#partition !== null) {
      this.#partition.endsAt += pausedMs;
      this.#partition.heldSince = null;
    }
    for (const [id, until] of this.#frozen) this.#frozen.set(id, until + pausedMs);
  }

  leave(id: string): void {
    this.#frozen.delete(id);
    this.#freezeReadyAt.delete(id);
  }

  // `holders` are the members who can act right now, with where they stand.
  tick(now: number, holders: readonly (Vec2 & { readonly id?: string })[]): SabotageEvent[] {
    const events: SabotageEvent[] = [];
    for (const [id, until] of this.#frozen) {
      if (now >= until) {
        this.#frozen.delete(id);
        events.push({ kind: 'thawed', id });
      }
    }
    const p = this.#partition;
    this.#relays = 0;
    if (p === null) return events;
    for (const pos of holders) {
      const relay = relayAt(pos, this.#relayPoints);
      if (relay !== null) this.#relays |= 1 << relay;
    }
    const both = this.#relays === (1 << this.#relayPoints.length) - 1;
    if (!both) p.heldSince = null;
    else p.heldSince ??= now;
    if (p.heldSince !== null && now - p.heldSince >= this.#timing.repairMs) {
      this.#partition = null;
      this.#partitionReadyAt = now + this.#timing.partitionCooldownMs;
      const by = holders.filter((h) => relayAt(h, this.#relayPoints) !== null).flatMap((h) => (h.id === undefined ? [] : [h.id]));
      events.push({ kind: 'repaired', by });
    } else if (now >= p.endsAt) {
      this.#partition = null;
      this.#outages += 1;
      this.#partitionReadyAt = now + this.#timing.partitionCooldownMs;
      events.push({ kind: 'outage', startedBy: p.startedBy });
    }
    return events;
  }
}
