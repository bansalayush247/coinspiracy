// Postgres-backed profile store (pg in production, PGlite in tests). Parameterised queries only;
// each change is one transaction holding a row lock, with the idempotency key in the same transaction.
import type { PGlite } from '@electric-sql/pglite';
import type { Pool, PoolClient } from 'pg';
import { KEY_RETENTION_DAYS, RETENTION_DAYS, newProfileData, parseProfileData, utcDayOf, type Change, type ChangeOutcome, type ProfileData, type ProfileStore } from './store.js';

export interface Sql {
  query(text: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface SqlDatabase extends Sql {
  transaction<R>(fn: (tx: Sql) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS profiles (
    id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{22}$'),
    created_day integer NOT NULL,
    last_seen_day integer NOT NULL,
    data jsonb NOT NULL CHECK (octet_length(data::text) < 16384)
  )`,
  'CREATE INDEX IF NOT EXISTS profiles_last_seen ON profiles (last_seen_day)',
  `CREATE TABLE IF NOT EXISTS applied_keys (
    key text PRIMARY KEY CHECK (length(key) <= 128),
    day integer NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS applied_keys_day ON applied_keys (day)',
  `CREATE TABLE IF NOT EXISTS daily_stats (
    day integer NOT NULL,
    key text NOT NULL CHECK (length(key) <= 64),
    count bigint NOT NULL,
    PRIMARY KEY (day, key)
  )`,
] as const;

export function pgDatabase(pool: Pool): SqlDatabase {
  const wrap = (c: Pool | PoolClient): Sql => ({
    async query(text, params) {
      const r = await c.query(text, params === undefined ? [] : [...params]);
      return { rows: r.rows as Record<string, unknown>[] };
    },
  });
  return {
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export function pgliteDatabase(db: PGlite): SqlDatabase {
  const wrap = (c: Pick<PGlite, 'query'>): Sql => ({
    async query(text, params) {
      const r = await c.query(text, params === undefined ? [] : [...params]);
      return { rows: r.rows as Record<string, unknown>[] };
    },
  });
  return {
    ...wrap(db),
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx))),
    close: () => db.close(),
  };
}

export async function migrate(db: Sql): Promise<void> {
  for (const statement of SCHEMA) await db.query(statement);
}

// Signals a refused change so the transaction rolls back and the key is not consumed.
class Refused extends Error {}

export class SqlProfileStore implements ProfileStore {
  constructor(private readonly db: SqlDatabase) {}

  async change<R>(id: string, key: string | null, nowMs: number, fn: (data: ProfileData) => Change<R>): Promise<ChangeOutcome<R>> {
    const day = utcDayOf(nowMs);
    try {
      const result = await this.db.transaction(async (tx) => {
        if (key !== null) {
          const claimed = await tx.query('INSERT INTO applied_keys (key, day) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING RETURNING key', [key, day]);
          if (claimed.rows.length === 0) return { duplicate: true as const };
        }
        await tx.query('INSERT INTO profiles (id, created_day, last_seen_day, data) VALUES ($1, $2, $2, $3) ON CONFLICT (id) DO NOTHING', [id, day, JSON.stringify(newProfileData(nowMs))]);
        const row = await tx.query('SELECT data FROM profiles WHERE id = $1 FOR UPDATE', [id]);
        const raw = row.rows[0]?.['data'];
        const current = parseProfileData(typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw);
        const out = fn(current);
        if (out === null) throw new Refused();
        const next = parseProfileData(out.data);
        await tx.query('UPDATE profiles SET data = $2, last_seen_day = $3 WHERE id = $1', [id, JSON.stringify(next), day]);
        return { duplicate: false as const, value: out.result };
      });
      return result.duplicate ? { ok: false, reason: 'duplicate' } : { ok: true, result: result.value };
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: 'refused' };
      throw error;
    }
  }

  async count(day: number, key: string, n = 1): Promise<void> {
    await this.db.query('INSERT INTO daily_stats (day, key, count) VALUES ($1, $2, $3) ON CONFLICT (day, key) DO UPDATE SET count = daily_stats.count + EXCLUDED.count', [day, key, n]);
  }

  async purge(nowMs: number): Promise<{ profiles: number }> {
    const today = utcDayOf(nowMs);
    const gone = await this.db.query('DELETE FROM profiles WHERE last_seen_day < $1 RETURNING id', [today - RETENTION_DAYS]);
    await this.db.query('DELETE FROM applied_keys WHERE day < $1', [today - KEY_RETENTION_DAYS]);
    return { profiles: gone.rows.length };
  }

  close(): Promise<void> {
    return this.db.close();
  }
}
