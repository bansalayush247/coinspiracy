// Local play-testing server where every guest has opened every island. Never for production.
// Run: npm run dev:islands, then open http://127.0.0.1:5181. Uses its own ports so the normal dev servers keep running.
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createGameServer } from '../../apps/server/src/app.js';
import { MemoryProfileStore, type Change, type ChangeOutcome, type ProfileData } from '../../apps/server/src/profile/store.js';

if (process.env['NODE_ENV'] === 'production') {
  console.error('all-islands is a local testing server and refuses to run in production');
  process.exit(1);
}

const HOST = '127.0.0.1';
const GAME_PORT = 2568;
const WEB_PORT = 5181;
const WEB = `http://${HOST}:${String(WEB_PORT)}`;

// Three stars on each Mint Island level (15 stars) opens every island; the guest's real progress is kept in memory only.
class AllIslandsStore extends MemoryProfileStore {
  override change<R>(id: string, key: string | null, nowMs: number, fn: (data: ProfileData) => Change<R>): Promise<ChangeOutcome<R>> {
    return super.change(id, key, nowMs, (data) => fn(data.progress.academy[0] === 3 ? data : { ...data, progress: { ...data.progress, academy: data.progress.academy.map((s, i) => (i < 5 ? 3 : s)) } }));
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
process.env['VITE_SERVER_URL'] = `http://${HOST}:${String(GAME_PORT)}`;
const web = await createServer({ root: fileURLToPath(new URL('../../apps/client', import.meta.url)), server: { host: HOST, port: WEB_PORT, strictPort: true } });
await web.listen();
console.log(`every island open: ${WEB}`);
