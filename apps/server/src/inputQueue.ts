import { SERVER_TICK_HZ } from '@byzantine-council/shared';

export interface MoveInput {
  readonly seq: number;
  readonly dx: number;
  readonly dy: number;
}

export type PushResult = 'queued' | 'stale' | 'refused';

// A run of inputs refused because the queue was full; acked without moving the player.
interface RefusedRun {
  readonly refusedUpTo: number;
}

type Entry = MoveInput | RefusedRun;

function isRefused(entry: Entry): entry is RefusedRun {
  return 'refusedUpTo' in entry;
}

// Applies a player's move inputs in order, one per tick of real time. The time budget absorbs
// network jitter, and its cap bounds how far a client sending too fast can get ahead.
// `ack` is the highest seq the state now reflects, counting refused inputs as no-ops, so the
// client's prediction drops them instead of waiting on them forever.
export class InputQueue {
  readonly #queue: Entry[] = [];
  #queued = 0;
  #lastSeq = 0;
  #ack = 0;
  #budget = 0;
  #lastDrainMs: number | null = null;

  constructor(
    readonly maxQueued = 8,
    readonly maxBurst = 4,
    readonly perSecond = SERVER_TICK_HZ,
  ) {}

  get ack(): number {
    return this.#ack;
  }

  get size(): number {
    return this.#queued;
  }

  push(input: MoveInput): PushResult {
    if (input.seq <= this.#lastSeq) return 'stale';
    this.#lastSeq = input.seq;
    if (this.#queued >= this.maxQueued) {
      // Consecutive refusals share one marker, so markers stay bounded by the queue cap.
      const last = this.#queue[this.#queue.length - 1];
      if (last !== undefined && isRefused(last)) this.#queue[this.#queue.length - 1] = { refusedUpTo: input.seq };
      else this.#queue.push({ refusedUpTo: input.seq });
      return 'refused';
    }
    this.#queue.push(input);
    this.#queued += 1;
    return 'queued';
  }

  // Earns budget for the time since the last drain, then applies the inputs it can afford.
  drain(nowMs: number, apply: (input: MoveInput) => void): void {
    const elapsedMs = this.#lastDrainMs === null ? 1000 / this.perSecond : Math.max(0, nowMs - this.#lastDrainMs);
    this.#lastDrainMs = nowMs;
    this.#budget = Math.min(this.maxBurst, this.#budget + (elapsedMs * this.perSecond) / 1000);
    for (;;) {
      const head = this.#queue[0];
      if (head === undefined) break;
      if (isRefused(head)) {
        this.#queue.shift();
        this.#ack = head.refusedUpTo;
        continue;
      }
      if (this.#budget < 1) break;
      this.#queue.shift();
      this.#queued -= 1;
      this.#budget -= 1;
      apply(head);
      this.#ack = head.seq;
    }
  }

  // After a drop: forget queued inputs and accept a fresh seq series from a reloaded page.
  reset(): void {
    this.#queue.length = 0;
    this.#queued = 0;
    this.#lastSeq = 0;
    this.#ack = 0;
    this.#budget = 0;
    this.#lastDrainMs = null;
  }
}
