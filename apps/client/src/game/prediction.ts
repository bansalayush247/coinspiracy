// Client-side prediction for the local player: apply inputs immediately, then rebase on every
// server update by replaying the inputs the server has not acknowledged yet.
import { CITADEL_MAP, TICK_SECONDS, stepMovement, type CitadelMap, type Vec2 } from '@byzantine-council/shared';

export interface PendingInput {
  readonly seq: number;
  readonly dx: number;
  readonly dy: number;
}

// Past this many unacknowledged inputs (two seconds) the client stops sending until acks catch up.
export const MAX_PENDING = 40;

export class Predictor {
  readonly #pending: PendingInput[] = [];
  #position: Vec2;
  #nextSeq = 1;

  // The ground can change mid-match (bridges on Watchtower Peaks come down in a partition).
  map: CitadelMap;

  // Obstacles off the map (the city's cars) as the server sees them, for a walker starting a step at `from`.
  solidFrom: ((from: Vec2) => (p: Vec2) => boolean) | null = null;

  // Where the map's tile (0, 0) sits in the world: a room indoors lies far off the city map.
  origin: Vec2 = { x: 0, y: 0 };

  constructor(start: Vec2, map: CitadelMap = CITADEL_MAP) {
    this.#position = { x: start.x, y: start.y };
    this.map = map;
  }

  #step(pos: Vec2, dx: number, dy: number): Vec2 {
    const o = this.origin;
    const next = stepMovement({ x: pos.x - o.x, y: pos.y - o.y }, { x: dx, y: dy }, TICK_SECONDS, this.map, this.solidFrom?.(pos));
    return { x: next.x + o.x, y: next.y + o.y };
  }

  get position(): Vec2 {
    return this.#position;
  }

  get pendingCount(): number {
    return this.#pending.length;
  }

  get stalled(): boolean {
    return this.#pending.length >= MAX_PENDING;
  }

  // Records and applies one tick of input; returns the message to send.
  apply(dx: number, dy: number): PendingInput {
    const input = { seq: this.#nextSeq++, dx, dy };
    this.#pending.push(input);
    this.#position = this.#step(this.#position, dx, dy);
    return input;
  }

  // Server state at `ack`: drop acknowledged inputs and replay the rest from the server position.
  reconcile(server: Vec2, ack: number): void {
    while (this.#pending.length > 0 && (this.#pending[0]?.seq ?? Infinity) <= ack) this.#pending.shift();
    let pos: Vec2 = { x: server.x, y: server.y };
    for (const input of this.#pending) pos = this.#step(pos, input.dx, input.dy);
    this.#position = pos;
  }

  // After a reconnect the server forgets queued inputs, so start over from its position.
  reset(server: Vec2): void {
    this.#pending.length = 0;
    this.#position = { x: server.x, y: server.y };
  }
}

// Hides small corrections: the drawn position eases toward the predicted one instead of jumping.
export class CorrectionSmoother {
  #offset: Vec2 = { x: 0, y: 0 };

  constructor(
    readonly snapDistance = 1.5,
    readonly halfLifeMs = 60,
  ) {}

  get offset(): Vec2 {
    return this.#offset;
  }

  // Call with the prediction before and after a reconcile.
  correct(before: Vec2, after: Vec2): void {
    const ox = this.#offset.x + before.x - after.x;
    const oy = this.#offset.y + before.y - after.y;
    this.#offset = Math.hypot(ox, oy) > this.snapDistance ? { x: 0, y: 0 } : { x: ox, y: oy };
  }

  decay(deltaMs: number): void {
    const k = Math.pow(0.5, Math.max(0, deltaMs) / this.halfLifeMs);
    const x = this.#offset.x * k;
    const y = this.#offset.y * k;
    this.#offset = Math.hypot(x, y) < 1e-4 ? { x: 0, y: 0 } : { x, y };
  }

  clear(): void {
    this.#offset = { x: 0, y: 0 };
  }
}
