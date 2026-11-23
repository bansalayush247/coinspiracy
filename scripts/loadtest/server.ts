// Load-test server: the real game server in its own process, reporting tick timings to the parent.
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { createGameServer } from '../../apps/server/src/app.js';
import { CitadelRoom } from '../../apps/server/src/CitadelRoom.js';

const port = Number(process.env['LOADTEST_PORT'] ?? '3950');
if (!Number.isInteger(port) || port < 3950 || port > 3959) throw new Error('LOADTEST_PORT must be 3950-3959');

const ticks: number[] = [];
const proto = CitadelRoom.prototype as unknown as { step: () => void };
const original = proto.step;
proto.step = function timedStep(this: unknown) {
  const t0 = performance.now();
  original.call(this);
  ticks.push(performance.now() - t0);
};

const game = createGameServer({
  allowedOrigins: new Set(['http://127.0.0.1:5180']),
  // Clients claim their own test addresses (198.18.0.0/15) through X-Real-IP from loopback.
  ipPolicy: { trustedProxies: new Set(['127.0.0.1']) },
  gracefullyShutdown: false,
  maxSeatsPerIp: 64,
  matchmakePerMinute: 10_000,
  reservationsPerWindow: 10_000,
});
await game.listen(port, '127.0.0.1');
const delay = monitorEventLoopDelay({ resolution: 10 });
delay.enable();
let elu = performance.eventLoopUtilization();
setInterval(() => {
  const now = performance.eventLoopUtilization(elu);
  elu = performance.eventLoopUtilization();
  const sorted = ticks.splice(0).sort((a, b) => a - b);
  const pct = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  process.send?.({ ticks: sorted.length, p50: pct(0.5), p95: pct(0.95), max: sorted.at(-1) ?? 0, elu: now.utilization, lagP99: delay.percentile(99) / 1e6, rssMb: process.memoryUsage().rss / 1e6 });
  delay.reset();
}, 5000);
process.send?.({ ready: true });
