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

  constructor(
    start: Vec2,
    readonly map: CitadelMap = CITADEL_MAP,
  ) {
    this.#position = { x: start.x, y: start.y };
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
    this.#position = stepMovement(this.#position, { x: dx, y: dy }, TICK_SECONDS, this.map);
    return input;
  }

  // Server state at `ack`: drop acknowledged inputs and replay the rest from the server position.
  reconcile(server: Vec2, ack: number): void {
    while (this.#pending.length > 0 && (this.#pending[0]?.seq ?? Infinity) <= ack) this.#pending.shift();
    let pos: Vec2 = { x: server.x, y: server.y };
    for (const input of this.#pending) pos = stepMovement(pos, { x: input.dx, y: input.dy }, TICK_SECONDS, this.map);
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
