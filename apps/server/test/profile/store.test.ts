import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { balanceOf } from '@byzantine-council/shared/economy';
import { migrate, pgliteDatabase, SqlProfileStore } from '../../src/profile/sql.js';
import { MemoryProfileStore, START_BALANCE, RETENTION_DAYS, loadProfile, type ProfileStore } from '../../src/profile/store.js';
import { newProfileId } from '../../src/profile/session.js';

const T0 = Date.UTC(2026, 10, 23, 12);
const DAY = 86_400_000;
let pglite: PGlite;
let sql: SqlProfileStore;

beforeAll(async () => {
  pglite = new PGlite();
  const db = pgliteDatabase(pglite);
  await migrate(db);
  await migrate(db);
  sql = new SqlProfileStore(db);
});

afterAll(async () => {
  await sql.close();
});

describe.each([
  ['memory', () => new MemoryProfileStore() as ProfileStore],
  ['postgres (PGlite)', () => sql as ProfileStore],
])('%s profile store', (_name, make) => {
  it('creates a guest on first use with the starting balance and quests', async () => {
    const store = make();
    const data = await loadProfile(store, newProfileId(), T0);
    expect(balanceOf(data.wallet)).toBe(START_BALANCE);
    expect(data.progress.quests).toHaveLength(3);
  });

  it('applies a keyed change exactly once', async () => {
    const store = make();
    const id = newProfileId();
    const bump = () => store.change(id, `match:test:${id}`, T0, (d) => ({ data: { ...d, progress: { ...d.progress, xp: d.progress.xp + 10 } }, result: 'paid' }));
    expect(await bump()).toEqual({ ok: true, result: 'paid' });
    expect(await bump()).toEqual({ ok: false, reason: 'duplicate' });
    expect((await loadProfile(store, id, T0)).progress.xp).toBe(10);
  });

  it('keeps a refused change from consuming its key or touching the profile', async () => {
    const store = make();
    const id = newProfileId();
    await loadProfile(store, id, T0);
    expect(await store.change(id, `k:${id}`, T0, () => null)).toEqual({ ok: false, reason: 'refused' });
    expect((await store.change(id, `k:${id}`, T0, (d) => ({ data: d, result: 1 }))).ok).toBe(true);
  });

  it('refuses to save data that breaks the schema', async () => {
    const store = make();
    const id = newProfileId();
    await expect(store.change(id, null, T0, (d) => ({ data: { ...d, wallet: [3] }, result: 0 }))).rejects.toThrow();
    expect((await loadProfile(store, id, T0)).wallet).not.toEqual([3]);
  });

  it('serialises concurrent changes to one profile', async () => {
    const store = make();
    const id = newProfileId();
    await loadProfile(store, id, T0);
    await Promise.all(Array.from({ length: 10 }, (_, i) => store.change(id, `c:${id}:${String(i)}`, T0, (d) => ({ data: { ...d, progress: { ...d.progress, xp: d.progress.xp + 1 } }, result: null }))));
    expect((await loadProfile(store, id, T0)).progress.xp).toBe(10);
  });

  it('deletes guests unseen for the retention period', async () => {
    const store = make();
    const id = newProfileId();
    await loadProfile(store, id, T0);
    await store.purge(T0 + (RETENTION_DAYS - 1) * DAY);
    expect((await loadProfile(store, id, T0)).progress.xp).toBe(0);
    const stale = newProfileId();
    await loadProfile(store, stale, T0 - 2 * RETENTION_DAYS * DAY);
    const r = await store.purge(T0);
    expect(r.profiles).toBeGreaterThanOrEqual(1);
  });
});

describe('daily aggregates', () => {
  it('count anonymously per day and key', async () => {
    await sql.count(20_000, 'matches');
    await sql.count(20_000, 'matches', 2);
    const rows = await pglite.query<{ count: string }>("SELECT count FROM daily_stats WHERE day = 20000 AND key = 'matches'");
    expect(Number(rows.rows[0]?.count)).toBe(3);
  });
});
