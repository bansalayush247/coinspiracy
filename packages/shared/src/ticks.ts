// Ticks are non-negative safe integers; anything else is a server bug.
export function assertTick(tick: number, name = 'nowTick'): void {
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer, got ${String(tick)}`);
  }
}
