// Client-side prediction for the car this client drives: each tick's input moves the car at once, and every server
// update rebases it on the server's car and replays the inputs the server has not run yet.
import { TICK_SECONDS, type Vec2 } from '@byzantine-council/shared';
import { driveTick, type CarBody } from '@byzantine-council/shared/city';

/** One tick of a driver's input: a direction to head for, or pedal and wheel. */
export type DriveInput = { readonly dx: number; readonly dy: number } | { readonly throttle: number; readonly steer: number };

/** A numbered driving input, as sent to the server. */
export type NumberedDrive = DriveInput & { readonly seq: number };

// Past this many unanswered inputs (two seconds) the driver stops sending until the server catches up.
export const MAX_PENDING_DRIVES = 40;

/** The driver's own car, moved by its inputs before the server answers and put right when it does. */
export class CarPredictor {
  readonly #pending: NumberedDrive[] = [];
  #body: CarBody;
  #nextSeq = 1;

  /** Whether the car may stand at `p` facing `heading`: walls, water, people on foot and other cars. */
  blocked: (p: Vec2, heading: number) => boolean;

  constructor(start: CarBody, blocked: (p: Vec2, heading: number) => boolean) {
    this.#body = { x: start.x, y: start.y, heading: start.heading, speed: start.speed };
    this.blocked = blocked;
  }

  /** Where the car is now, as far as this client can tell. */
  get body(): CarBody {
    return this.#body;
  }

  /** How many inputs the server has not run yet. */
  get pendingCount(): number {
    return this.#pending.length;
  }

  /** Whether too many inputs are waiting on the server to send another. */
  get stalled(): boolean {
    return this.#pending.length >= MAX_PENDING_DRIVES;
  }

  #step(body: CarBody, input: DriveInput): CarBody {
    const next = driveTick(body, input, TICK_SECONDS, this.blocked);
    return { x: next.x, y: next.y, heading: next.heading, speed: next.speed };
  }

  /** Runs one tick of input on the predicted car and returns it numbered, to send. */
  apply(input: DriveInput): NumberedDrive {
    const numbered = { ...input, seq: this.#nextSeq++ };
    this.#pending.push(numbered);
    this.#body = this.#step(this.#body, input);
    return numbered;
  }

  /** The server's car after it ran input `ack`: drop what it has run and replay the rest on top. */
  reconcile(server: CarBody, ack: number): void {
    while (this.#pending.length > 0 && (this.#pending[0]?.seq ?? Infinity) <= ack) this.#pending.shift();
    let body: CarBody = { x: server.x, y: server.y, heading: server.heading, speed: server.speed };
    for (const input of this.#pending) body = this.#step(body, input);
    this.#body = body;
  }
}
