// Load test: ramps private rooms of 5 SDK clients each, starts matches, walks everyone at 20 Hz,
// and prints the server's tick time, event-loop use and memory at each step.
// Run: npx tsx --conditions=source scripts/loadtest/run.ts [maxRooms]
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@colyseus/sdk';
import { ROOM_NAME } from '@byzantine-council/shared';
import { CitadelState } from '@byzantine-council/shared/state';

const PORT = 3950;
const STEPS = [5, 10, 20, 40, 60, 80].filter((n) => n <= Number(process.argv[2] ?? '80'));
const PER_ROOM = 5;
let ip = 0;
const nextIp = (): string => {
  ip += 1;
  return `198.18.${String(Math.floor(ip / 250))}.${String((ip % 250) + 1)}`;
};
const client = (): Client => new Client(`ws://127.0.0.1:${String(PORT)}`, { headers: { Origin: 'http://127.0.0.1:5180', 'X-Real-IP': nextIp() } });

interface Report { ticks: number; p50: number; p95: number; max: number; elu: number; lagP99: number; rssMb: number }

const child = fork(fileURLToPath(new URL('./server.ts', import.meta.url)), [], { execArgv: ['--import', 'tsx', '--conditions=source'], env: { ...process.env, LOADTEST_PORT: String(PORT), LOG_LEVEL: 'silent' } });
const reports: Report[] = [];
await new Promise<void>((resolve) => {
  child.on('message', (m: unknown) => {
    if (typeof m === 'object' && m !== null && 'ready' in m) resolve();
    else if (typeof m === 'object' && m !== null && 'p50' in m) reports.push(m as Report);
  });
});

type Room = Awaited<ReturnType<Client['create']>>;
const rooms: Room[][] = [];
let seq = 0;
// Every client walks in a slowly turning direction, sending one move per 50 ms tick.
const walker = setInterval(() => {
  seq += 1;
  for (const [r, group] of rooms.entries()) {
    for (const [i, room] of group.entries()) {
      const a = (seq / 40) + r + i;
      if (room.connection.isOpen) room.send('move', { seq, dx: Math.cos(a), dy: Math.sin(a) });
    }
  }
}, 50);

async function addRoom(): Promise<void> {
  const host = await client().create(ROOM_NAME, { nickname: 'Load', private: true }, CitadelState);
  const group = [host];
  for (let i = 1; i < PER_ROOM; i++) group.push(await client().joinById(host.roomId, { nickname: `Load${String(i)}` }, CitadelState));
  // Load clients read nothing but must accept every message type.
  for (const room of group) room.onMessage('*', () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 200));
  host.send('startMatch');
  rooms.push(group);
}

console.log('rooms  clients  ticks/5s  step p50 ms  step p95 ms  step max ms  event loop  lag p99 ms  rss MB');
for (const target of STEPS) {
  while (rooms.length < target) await addRoom();
  reports.length = 0;
  await new Promise((resolve) => setTimeout(resolve, 11_000));
  const r = reports.at(-1);
  if (r === undefined) continue;
  console.log(
    [String(rooms.length).padStart(5), String(rooms.length * PER_ROOM).padStart(8), String(r.ticks).padStart(9), r.p50.toFixed(3).padStart(12), r.p95.toFixed(3).padStart(12), r.max.toFixed(2).padStart(12), `${(r.elu * 100).toFixed(0)}%`.padStart(11), r.lagP99.toFixed(1).padStart(11), r.rssMb.toFixed(0).padStart(7)].join(''),
  );
}
clearInterval(walker);
for (const group of rooms) for (const room of group) await room.leave().catch(() => undefined);
child.kill();
process.exit(0);
