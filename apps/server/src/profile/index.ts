// Builds the profile store from config: Postgres when DATABASE_URL is set, else in memory (development).
import pg from 'pg';
import { log } from '../logger.js';
import { profileConfig } from './config.js';
import { migrate, pgDatabase, SqlProfileStore } from './sql.js';
import { MemoryProfileStore, type ProfileStore } from './store.js';
import type { SessionKeys } from './session.js';

export interface Profiles {
  readonly store: ProfileStore;
  readonly keys: SessionKeys;
  stop(): Promise<void>;
}

const PURGE_EVERY_MS = 6 * 3600 * 1000;

export async function openProfiles(env: NodeJS.ProcessEnv = process.env): Promise<Profiles> {
  const config = profileConfig(env);
  if (config.ephemeralSecret) log.warn('SESSION_SECRET is not set: guest sessions last only until this process restarts');
  let store: ProfileStore;
  if (config.databaseUrl === null) {
    log.warn('DATABASE_URL is not set: guest profiles are kept in memory and lost on restart');
    store = new MemoryProfileStore();
  } else {
    // Bounded pool with statement and idle timeouts, so a slow database cannot pile up work.
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, statement_timeout: 5_000, query_timeout: 6_000 });
    pool.on('error', (error) => {
      log.error('database pool error', error);
    });
    const db = pgDatabase(pool);
    await migrate(db);
    store = new SqlProfileStore(db);
  }
  const purge = (): void => {
    store
      .purge(Date.now())
      .then((r) => {
        if (r.profiles > 0) log.info('purged inactive guests', { profiles: r.profiles });
      })
      .catch((error: unknown) => {
        log.error('purge failed', error);
      });
  };
  purge();
  const timer = setInterval(purge, PURGE_EVERY_MS);
  timer.unref();
  return {
    store,
    keys: config.keys,
    async stop() {
      clearInterval(timer);
      await store.close();
    },
  };
}
