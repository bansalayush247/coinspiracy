// Bot movement: client-side prediction (the browser client's scheme) and waypoint steering.
import { CITADEL_MAP, MAX_INPUT_SEQ, TICK_SECONDS, stepMovement, type CitadelMap, type Vec2 } from '@byzantine-council/shared';
import { steerInput } from '@byzantine-council/shared/pathfinding';

export interface MoveInput {
  readonly seq: number;
  readonly dx: number;
  readonly dy: number;
}

// Past this many unacknowledged inputs (two seconds) the bot stops sending until acks catch up.
export const MAX_PENDING_INPUTS = 40;
// Intermediate waypoints count as reached this close; the last one is approached exactly.
export const ADVANCE_DISTANCE = 0.1;
export const ARRIVE_DISTANCE = 0.02;
// No progress toward a waypoint for this many ticks means the bot is stuck.
export const STUCK_TICKS = 20;
const PROGRESS = 0.05;

// Applies inputs locally at once, then rebases on each server update by replaying the unacknowledged ones.
export class BotMotor {
  readonly #pending: MoveInput[] = [];
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

  // Too far ahead of the server, or out of sequence numbers.
  get stalled(): boolean {
    return this.#pending.length >= MAX_PENDING_INPUTS || this.#nextSeq > MAX_INPUT_SEQ;
  }

  // Records and applies one tick of input; returns the move to send.
  apply(dx: number, dy: number): MoveInput {
    const input = { seq: this.#nextSeq++, dx, dy };
    this.#pending.push(input);
    this.#position = stepMovement(this.#position, { x: dx, y: dy }, TICK_SECONDS, this.map);
    return input;
  }

  reconcile(server: Vec2, ack: number): void {
    if (!Number.isFinite(server.x) || !Number.isFinite(server.y)) return;
    while (this.#pending.length > 0 && (this.#pending[0]?.seq ?? Infinity) <= ack) this.#pending.shift();
    let pos: Vec2 = { x: server.x, y: server.y };
    for (const input of this.#pending) pos = stepMovement(pos, { x: input.dx, y: input.dy }, TICK_SECONDS, this.map);
    this.#position = pos;
  }

  // After a reconnect the server forgets queued inputs; sequence numbers keep counting up.
  reset(server: Vec2): void {
    this.#pending.length = 0;
    this.#position = { x: server.x, y: server.y };
  }
}

// Steers along waypoints from the predicted position and notices when it stops making progress.
export class PathFollower {
  #path: readonly Vec2[] = [];
  #index = 0;
  #best = Infinity;
  #idleTicks = 0;
  #stuck = false;

  set(path: readonly Vec2[]): void {
    this.#path = [...path];
    this.#index = 0;
    this.#best = Infinity;
    this.#idleTicks = 0;
    this.#stuck = false;
  }

  clear(): void {
    this.set([]);
  }

  get arrived(): boolean {
    return this.#index >= this.#path.length;
  }

  get stuck(): boolean {
    return this.#stuck;
  }

  get destination(): Vec2 | null {
    return this.#path[this.#path.length - 1] ?? null;
  }

  // The input for the next tick, or null once arrived or stuck.
  steer(pos: Vec2): Vec2 | null {
    if (this.#stuck) return null;
    for (;;) {
      const wp = this.#path[this.#index];
      if (wp === undefined) return null;
      const last = this.#index === this.#path.length - 1;
      const d = Math.hypot(wp.x - pos.x, wp.y - pos.y);
      if (d > (last ? ARRIVE_DISTANCE : ADVANCE_DISTANCE)) {
        if (d < this.#best - PROGRESS) {
          this.#best = d;
          this.#idleTicks = 0;
        } else if (++this.#idleTicks >= STUCK_TICKS) {
          this.#stuck = true;
          return null;
        }
        return steerInput(pos, wp);
      }
      this.#index += 1;
      this.#best = Infinity;
      this.#idleTicks = 0;
    }
  }
}
