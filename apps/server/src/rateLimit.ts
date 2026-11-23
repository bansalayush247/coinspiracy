// Fixed-window counter per key. Memory is bounded: expired keys are swept and the oldest key is evicted at the cap.
export class FixedWindowLimiter {
  readonly #hits = new Map<string, { count: number; resetAt: number }>();
  readonly #sweep: NodeJS.Timeout;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    readonly maxKeys = 50_000,
    readonly now: () => number = Date.now,
  ) {
    this.#sweep = setInterval(() => {
      this.sweep();
    }, windowMs);
    this.#sweep.unref();
  }

  take(key: string): boolean {
    const now = this.now();
    const hit = this.#hits.get(key);
    if (hit === undefined || hit.resetAt <= now) {
      if (hit === undefined && this.#hits.size >= this.maxKeys) {
        const oldest = this.#hits.keys().next();
        if (oldest.done !== true) this.#hits.delete(oldest.value);
      }
      this.#hits.delete(key);
      this.#hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    hit.count += 1;
    return hit.count <= this.limit;
  }

  sweep(): void {
    const now = this.now();
    for (const [key, hit] of this.#hits) if (hit.resetAt <= now) this.#hits.delete(key);
  }

  get size(): number {
    return this.#hits.size;
  }

  stop(): void {
    clearInterval(this.#sweep);
  }
}
