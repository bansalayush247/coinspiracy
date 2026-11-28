// Local play-testing server with max-rank guests and every island open. Never for production.
// Run: npm run dev:islands, then open http://127.0.0.1:5181.
// With --separate, http://localhost:5182 uses separate ports and browser cookies.
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RANK_START } from '@byzantine-council/shared/progression';
import { createServer } from 'vite';
import { createGameServer } from '../../apps/server/src/app.js';
import { MemoryProfileStore, type Change, type ChangeOutcome, type ProfileData } from '../../apps/server/src/profile/store.js';

if (process.env['NODE_ENV'] === 'production') {
  console.error('all-islands is a local testing server and refuses to run in production');
  process.exit(1);
}

const HOST = '127.0.0.1';
const separate = process.argv.includes('--separate');
const browserHost = separate ? 'localhost' : HOST;
const GAME_PORT = separate ? 2569 : 2568;
const WEB_PORT = separate ? 5182 : 5181;
const WEB = `http://${browserHost}:${String(WEB_PORT)}`;
const MAX_RANK_XP = RANK_START.at(-1) ?? 0;

// Keep preview progress in memory. Seed the rank and Mint Island stars once per guest.
class AllIslandsStore extends MemoryProfileStore {
  override change<R>(id: string, key: string | null, nowMs: number, fn: (data: ProfileData) => Change<R>): Promise<ChangeOutcome<R>> {
    return super.change(id, key, nowMs, (data) => {
      const { progress } = data;
      if (progress.xp >= MAX_RANK_XP && progress.academy[0] === 3) return fn(data);
      return fn({
        ...data,
        progress: {
          ...progress,
          xp: Math.max(progress.xp, MAX_RANK_XP),
          academy: progress.academy.map((stars, i) => (i < 5 ? 3 : stars)),
        },
      });
    });
  }
}

const { listen } = createGameServer({
  allowedOrigins: new Set([WEB]),
  ipPolicy: { trustedProxies: new Set() },
  profiles: { store: new AllIslandsStore(), keys: { current: randomBytes(32), previous: null, secure: false } },
  bots: {},
  gracefullyShutdown: true,
});

// Loopback only, so nobody else on the network can join this unlocked server.
await listen(GAME_PORT, HOST);
// A second client dev server pointed at this game server.
process.env['VITE_SERVER_URL'] = `http://${browserHost}:${String(GAME_PORT)}`;
const web = await createServer({ root: fileURLToPath(new URL('../../apps/client', import.meta.url)), server: { host: HOST, port: WEB_PORT, strictPort: true } });
await web.listen();
console.log(`every island open: ${WEB}`);
