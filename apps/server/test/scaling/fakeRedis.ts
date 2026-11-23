// In-memory Redis for tests: exactly the commands the scaling lane sends, with Redis semantics,
// an injectable clock, MULTI atomicity and fault injection.
import type { CommandRunner, RedisCommand } from '../../src/scaling/redis.js';

type Entry = { readonly type: 'string'; value: string } | { readonly type: 'hash'; readonly value: Map<string, string> };

export class ReplyError extends Error {
  override name = 'ReplyError';
}

const WRONGTYPE = 'WRONGTYPE Operation against a key holding the wrong kind of value';

// How the next failing call fails: before anything applies, or after (the reply is lost, like a timeout).
export type FailMode = 'before' | 'after';

export class FakeRedis implements CommandRunner {
  readonly #data = new Map<string, Entry>();
  readonly #expires = new Map<string, number>();
  readonly #gates: (() => void)[] = [];
  #failures: FailMode[] = [];
  #gated = false;
  // Every call reaching the fake, failed or not.
  calls = 0;
  commands: RedisCommand[] = [];
  down = false;

  constructor(readonly now: () => number = Date.now) {}

  multi(commands: readonly RedisCommand[]): Promise<unknown[]> {
    return this.#call(commands);
  }

  pipeline(commands: readonly RedisCommand[]): Promise<unknown[]> {
    return this.#call(commands);
  }

  // The next `count` calls fail.
  failNext(count = 1, mode: FailMode = 'before'): void {
    for (let i = 0; i < count; i++) this.#failures.push(mode);
  }

  // Holds every call until release() is called, to interleave concurrent callers.
  gate(): void {
    this.#gated = true;
  }

  release(): void {
    this.#gated = false;
    for (const go of this.#gates.splice(0)) go();
  }

  get pending(): number {
    return this.#gates.length;
  }

  // Direct access for setup and assertions; also applies expiry.
  run(command: RedisCommand): unknown {
    const result = this.#apply(command);
    if (result instanceof Error) throw result;
    return result;
  }

  keys(): string[] {
    for (const key of [...this.#data.keys()]) this.#expire(key);
    return [...this.#data.keys()].sort();
  }

  hash(key: string): Record<string, string> {
    this.#expire(key);
    const entry = this.#data.get(key);
    return entry?.type === 'hash' ? Object.fromEntries(entry.value) : {};
  }

  pttl(key: string): number {
    return this.run(['pttl', key]) as number;
  }

  async #call(commands: readonly RedisCommand[]): Promise<unknown[]> {
    this.calls += 1;
    if (this.#gated) await new Promise<void>((resolve) => this.#gates.push(resolve));
    if (this.down) throw new Error('Connection is closed.');
    const failure = this.#failures.shift();
    if (failure === 'before') throw new Error('Command timed out');
    const results = commands.map((command) => {
      this.commands.push(command);
      return this.#apply(command);
    });
    if (failure === 'after') throw new Error('Command timed out');
    const error = results.find((r): r is Error => r instanceof Error);
    if (error !== undefined) throw error;
    return results;
  }

  #expire(key: string): void {
    const at = this.#expires.get(key);
    if (at !== undefined && at <= this.now()) {
      this.#data.delete(key);
      this.#expires.delete(key);
    }
  }

  #delete(key: string): boolean {
    this.#expires.delete(key);
    return this.#data.delete(key);
  }

  #hashFor(key: string, create: boolean): Map<string, string> | Error | undefined {
    const entry = this.#data.get(key);
    if (entry === undefined) {
      if (!create) return undefined;
      const value = new Map<string, string>();
      this.#data.set(key, { type: 'hash', value });
      return value;
    }
    return entry.type === 'hash' ? entry.value : new ReplyError(WRONGTYPE);
  }

  #apply(command: RedisCommand): unknown {
    const [rawName, ...args] = command;
    const name = rawName.toLowerCase();
    const text = (i: number): string => String(args[i] ?? '');
    const key = text(0);
    if (key !== '') this.#expire(key);
    switch (name) {
      case 'ping':
        return 'PONG';
      case 'incr': {
        const entry = this.#data.get(key);
        if (entry?.type === 'hash') return new ReplyError(WRONGTYPE);
        const current = entry === undefined ? 0 : Number(entry.value);
        if (entry !== undefined && !/^-?\d+$/.test(entry.value)) return new ReplyError('ERR value is not an integer or out of range');
        const next = current + 1;
        if (entry === undefined) this.#data.set(key, { type: 'string', value: String(next) });
        else entry.value = String(next);
        return next;
      }
      case 'set': {
        this.#data.set(key, { type: 'string', value: text(1) });
        this.#expires.delete(key);
        return 'OK';
      }
      case 'pexpire': {
        const ms = Number(args[1]);
        const flag = args[2] === undefined ? '' : text(2).toUpperCase();
        if (!Number.isInteger(ms)) return new ReplyError('ERR value is not an integer or out of range');
        if (!['', 'NX', 'XX', 'GT', 'LT'].includes(flag) || args.length > 3) return new ReplyError('ERR Unsupported option');
        if (!this.#data.has(key)) return 0;
        const has = this.#expires.has(key);
        if ((flag === 'NX' && has) || (flag === 'XX' && !has)) return 0;
        const at = this.now() + ms;
        const current = this.#expires.get(key);
        if (flag === 'GT' && (current === undefined || at <= current)) return 0;
        if (flag === 'LT' && current !== undefined && at >= current) return 0;
        if (ms <= 0) {
          this.#delete(key);
          return 1;
        }
        this.#expires.set(key, at);
        return 1;
      }
      case 'pttl': {
        if (!this.#data.has(key)) return -2;
        const at = this.#expires.get(key);
        return at === undefined ? -1 : Math.max(0, at - this.now());
      }
      case 'hset': {
        if (args.length < 3 || args.length % 2 === 0) return new ReplyError("ERR wrong number of arguments for 'hset' command");
        const hash = this.#hashFor(key, true);
        if (hash instanceof Error || hash === undefined) return hash;
        let added = 0;
        for (let i = 1; i + 1 < args.length; i += 2) {
          if (!hash.has(text(i))) added += 1;
          hash.set(text(i), text(i + 1));
        }
        return added;
      }
      case 'hdel': {
        const hash = this.#hashFor(key, false);
        if (hash instanceof Error) return hash;
        if (hash === undefined) return 0;
        let removed = 0;
        for (let i = 1; i < args.length; i++) if (hash.delete(text(i))) removed += 1;
        if (hash.size === 0) this.#delete(key);
        return removed;
      }
      case 'hget': {
        const hash = this.#hashFor(key, false);
        if (hash instanceof Error) return hash;
        return hash?.get(text(1)) ?? null;
      }
      case 'hgetall': {
        const hash = this.#hashFor(key, false);
        if (hash instanceof Error) return hash;
        return hash === undefined ? {} : Object.fromEntries(hash);
      }
      case 'del': {
        let removed = 0;
        for (let i = 0; i < args.length; i++) {
          this.#expire(text(i));
          if (this.#delete(text(i))) removed += 1;
        }
        return removed;
      }
      default:
        return new ReplyError(`ERR unknown command '${name}'`);
    }
  }
}
