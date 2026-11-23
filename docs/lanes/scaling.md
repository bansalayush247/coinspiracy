# Lane: scaling (M7 part 2)

Horizontal scaling for the game server, a load test with a capacity estimate, and seasonal events
driven by the live block height and the UTC date.

Status: wired (23 Nov 2026). The room policy, code lookups, presence, driver and public address come from `createScaling()`; `index.ts` starts it before `listen()`. Tested on the in-memory Redis fake (`test/scaling/scaling.test.ts`); the real-Redis suite and the load test have not been run yet.

## Scope and files

| File | What it holds |
|---|---|
| `apps/server/src/scaling/index.ts` | `createScaling(options)`: Colyseus presence and driver, rate limiters, the seat counter, lifecycle (`start`, `stop`) |
| `apps/server/src/scaling/config.ts` | `loadScalingConfig(env, production)`: zod parse of `REDIS_URL`, `SCALING_KEY_SECRET`, `PUBLIC_ADDRESS` |
| `apps/server/src/scaling/redis.ts` | The narrow command interface the lane uses (`CommandRunner`), the ioredis adapter, safe connection options, Redis URL parsing |
| `apps/server/src/scaling/health.ts` | Circuit breaker shared by every Redis-backed limiter and the seat counter |
| `apps/server/src/scaling/keys.ts` | Redis key names; network keys are HMAC'd before they reach Redis |
| `apps/server/src/scaling/limiter.ts` | `RateLimiter` (async), `LocalRateLimiter` (today's `FixedWindowLimiter`), `RedisRateLimiter` |
| `apps/server/src/scaling/seats.ts` | `SeatCounter` (async `IpSlots`), `LocalSeatCounter`, `RedisSeatCounter`, `holdSeat()` |
| `apps/server/test/scaling/*` | Unit tests on an in-memory Redis fake, abuse cases, and a real-Redis suite that runs only with `REDIS_URL` |
| `scripts/loadtest/*` | Load test: its own server on ports 3950-3959, N rooms x M SDK clients, report |
| `packages/shared/src/seasons.ts` | Pure seasonal events (`@byzantine-council/shared/seasons`) |
| `packages/shared/test/seasons.test.ts` | Exact boundary tests |

Everything else is read only. Changes other files need are listed under Integration.

## Part 1: horizontal scaling

### What runs where

One Node process per core, all equal. Each process hosts its own rooms. Colyseus needs three
things to spread across processes, and this lane provides all of them:

1. **Presence** (`RedisPresence`): pub/sub for inter-process calls (remote room creation, seat
   reservations, health checks) and the shared hashes room codes already use (`bc:code-*`).
2. **Driver** (`RedisDriver`): the room listing (`roomcaches` hash), so quick match and code
   lookups see rooms on every process.
3. **Public address** per process: a seat reservation carries the address of the process that
   owns the room, and the SDK opens the WebSocket at
   `<scheme>://<publicAddress>/<processId>/<roomId>`. The room only exists in that process, so the
   proxy must route that path to that process.

The per-network abuse limits move to Redis at the same time, otherwise each process would grant
its own quota:

| Limit | Today (per process) | With Redis (global) |
|---|---|---|
| Matchmake calls, 30 per minute per network | `FixedWindowLimiter` | `RedisRateLimiter('matchmake')` |
| Matchmake calls, 6 per 8 s reservation window | `FixedWindowLimiter` | `RedisRateLimiter('reservations')` |
| Code lookups, 30 per minute per network | `FixedWindowLimiter` | `RedisRateLimiter('lookups')` |
| Concurrent seats per network (`MAX_SEATS_PER_IP`) | `IpSlots` | `RedisSeatCounter` |
| Open sockets per network (2 x seats) | `httpGate` map | unchanged: sockets are a per-process resource, so a per-process cap is the right unit |

Without `REDIS_URL` nothing changes: `createScaling()` returns `LocalPresence`, `LocalDriver` and
in-memory limiters with exactly today's behaviour.

### Contracts

```ts
interface RateLimiter {
  take(key: string): Promise<boolean>; // counts one hit; true while within the limit
  stop(): void;
}

interface SeatCounter {
  readonly max: number;
  tryAcquire(key: string): Promise<boolean>; // false once the network holds `max` seats
  forceAcquire(key: string): void;           // reconnect reclaiming its held seat; ignores the cap
  release(key: string): void;                // never goes below zero
  count(key: string): Promise<number>;       // seats the network holds on every process
  stop(): Promise<void>;
}

// Takes a seat and releases it when the socket closes, including a close during the await.
function holdSeat(seats: SeatCounter, key: string, socket: CloseEmitter): Promise<boolean>;

interface Scaling {
  readonly mode: 'local' | 'redis';
  readonly presence: Presence;              // pass to defineServer
  readonly driver: MatchMakerDriver;        // pass to defineServer
  readonly publicAddress: string | undefined;
  rateLimiter(name: string, limit: number, windowMs: number): RateLimiter;
  seatCounter(max: number): SeatCounter;
  healthy(): boolean;                       // false while Redis limits run on the local fallback
  start(): Promise<void>;                   // connect and first heartbeat; call before listen()
  stop(): Promise<void>;                    // after Colyseus shut down presence and driver
}
```

`forceAcquire` and `release` stay synchronous on purpose: they update the process-local mirror at
once and write to Redis in the background, so `onDrop`, `onReconnect`, `onLeave` and
`onDispose` keep their current shape. Only `tryAcquire` and `take` need an `await`, because
their answer matters.

### Rate limiter on Redis

Atomic fixed window, one round trip:

```
MULTI
INCR   bc:rl:<name>:<token>
PEXPIRE bc:rl:<name>:<token> <windowMs> NX
EXEC
```

`INCR` keeps an existing TTL and `PEXPIRE ... NX` only sets one when the key has none, so the
window starts at the first hit (the same semantics as `FixedWindowLimiter`), and a key that
somehow lost its TTL is repaired by the next hit instead of limiting that network forever.
`PEXPIRE NX` needs Redis 7.0 or newer (or Valkey 7.2+).

### Seat counter on Redis

A seat cap must survive a process crash: a plain shared counter would keep a crashed process's
seats forever. Each process therefore writes its *own* count per network under a random
generation id, and every reader ignores generations that stopped heart-beating.

| Key | Type | Content |
|---|---|---|
| `bc:{seats}:n:<token>` | hash | generation id -> seats this generation holds for the network; TTL `leaseMs` (120 s) |
| `bc:{seats}:procs` | hash | generation id -> last heartbeat (ms); TTL refreshed by every beat |

Both share the `{seats}` hash tag, so the transaction below is also valid on Redis Cluster.

- **Writes are absolute.** The process keeps an authoritative local mirror (network -> count) and
  always writes `HSET n:<token> <gen> <localCount>`. Retries, timeouts and reordering cannot
  drift the value; the next write or lease refresh restores it.
- **tryAcquire** increments the local count, then in one `MULTI`: `HSET` own field, `PEXPIRE`
  lease, `HGETALL` the network hash, `HGETALL` procs. The total is the sum of fields whose
  generation is live (own, or heartbeat within `deadAfterMs` = 30 s). Over `max` rolls the local
  count back and writes it again. Every attempt writes its own increment before it reads, so the
  later of two racing attempts always sees both: the cap is never exceeded. Two racing attempts
  at the very last seat can both lose (a rare false "full", never an extra seat).
- **forceAcquire / release** update the mirror and write the new absolute value in the background.
- **Heartbeat** every `beatMs` (5 s): `HSET procs <gen> now`, refresh leases of networks not written
  for `leaseMs / 3`, delete procs entries dead for 4 x `deadAfterMs`. Dead generations' fields in
  network hashes are deleted lazily by the next `tryAcquire` on that network.
- **Presumed dead.** If a beat finds its own procs entry missing or stale (a long event-loop stall
  or partition), other processes may have dropped its fields. The process then rotates to a new
  generation and rewrites every count.
- **Crash.** A crashed process stops beating; after 30 s its fields no longer count anywhere.

### When Redis is down

ioredis is configured to fail fast for the lane's own commands (offline queue off, 500 ms command
timeout, no resend of unanswered commands). A failure trips a shared circuit breaker; while it is
open nothing waits on Redis. The heartbeat probes every 5 s and closes it again.

| Limiter | Behaviour while Redis is down | Why |
|---|---|---|
| matchmake, reservations, lookups | **Fail closed to a per-process limit**: the same limit enforced by an in-memory window in each process | Refusing everyone would turn a Redis blip into a full outage that an attacker could trigger by loading Redis; allowing everyone would remove the protection. The per-process limit keeps the bound at N x the global one for N processes, only during the outage. Matchmaking itself needs Redis (driver, presence), so in a real outage these requests fail anyway; the fallback matters for partial failures (slow Redis, OOM on writes) |
| seat cap, `tryAcquire` | **Fail closed to a per-process cap**: the same `max` against this process's own seats | A process never admits more than `max` seats per network on its own, and reconnects are never blocked |
| seat cap, `forceAcquire` / `release` | Local mirror updated; Redis catches up on recovery | Reconnects and leaves must never fail |

On recovery the seat counter rotates to a new generation and rewrites every local count, which
also drops anything written before or during the outage. Transitions are logged once each
(`scaling: redis limits degraded` / `restored`) with the error class only.

At startup the process fails closed: `start()` throws if Redis does not answer within 10 s, and
the supervisor restarts it.

### Process layout and public address

```
             TLS (443)
client ---> nginx ---- /matchmake/*, /api/*, /healthz ----> any process (least_conn)
                  \--- /<prefix>/s1/<processId>/<roomId> -> 127.0.0.1:2567 (process 1)
                  \--- /<prefix>/s2/<processId>/<roomId> -> 127.0.0.1:2568 (process 2)
                                ...
all processes ----> Redis 7+ (loopback, or rediss:// off-host)
```

Per process (systemd template `byzantine-council@<i>.service`, one per core):

| Variable | Value |
|---|---|
| `PORT` | `2566 + i` |
| `PUBLIC_ADDRESS` | host plus route prefix, no scheme: `game.example.com/s<i>` for a separate game origin, or `play.example.com/colyseus/s<i>` when the client uses the same-origin path `/colyseus` |
| `REDIS_URL` | identical in every process |
| `SCALING_KEY_SECRET` | identical in every process, 32+ characters, from the secret store |
| everything else | identical (`ALLOWED_ORIGINS`, `TRUSTED_PROXIES`, `MAX_SEATS_PER_IP`, ...) |

nginx must map each prefix to its port with an explicit allowlist (one `location` per process, or
a `map` with fixed entries). Never build the upstream port from the URL: that would let a
client reach any local port. The WebSocket transport only reads the last two path segments, so
the prefix needs no rewrite. Reconnects reuse the same URL and reach the same process.

Matchmaking HTTP can land on any process: the driver finds rooms everywhere, and Colyseus asks
the owning process to reserve the seat over presence IPC. New rooms go to the process with the
fewest rooms (Colyseus default `selectProcessIdToCreateRoom`).

Redis: version 7.0+ (or Valkey 7.2+), one instance (or database) per deployment, persistence off
(`save ""`, `appendonly no`: everything here is ephemeral), `maxmemory` with
`maxmemory-policy volatile-ttl` (only TTL keys, i.e. limiter windows and seat leases, can be
evicted; the room listing and codes have none), an ACL user without `@admin` and `@dangerous`,
bound to loopback or reached over `rediss://`. Custom CAs go through Node's `NODE_EXTRA_CA_CERTS`.

## Part 2: load test

`scripts/loadtest/run.ts` *(design; results below)*:

- Starts a real game server in a child process on a port in 3950-3959 (validated), loopback only,
  trusting `X-Real-IP` from 127.0.0.1 so every SDK client gets its own address from
  198.18.0.0/15 (the benchmarking range).
- The server child wraps `CitadelRoom.prototype.step` to time every tick and samples CPU,
  event-loop utilisation, event-loop delay and memory. It never touches room state.
- Client processes create N private rooms with M SDK clients each, start matches, and drive
  every client the way a person plays: 20 Hz movement while walking, a BFS path on the citadel
  map to the next unfinished station, `openTask`, a human-speed wait, the right answer, then on
  to the next station; the host restarts after each result screen.
- Reports join latency (p50/p95/p99/max), patches and bytes per client per second, server ticks
  per room per second, step time percentiles, CPU, event-loop utilisation and delay, memory per
  client, and a capacity estimate per core. JSON goes to `.scratch/scaling/`.

Run: `npx tsx --conditions=source scripts/loadtest/run.ts --rooms 10 --players 8 --seconds 60`.

### Results *(results)*

Filled from real runs at the end of the lane.

## Part 3: seasonal events

`@byzantine-council/shared/seasons`: pure and deterministic. The only inputs are the block height
and a UTC timestamp in ms; nothing reads the clock or the network.

| Event | Trigger | Window | Hat id | Decorations |
|---|---|---|---|---|
| `halving` | height is a multiple of 210,000 (epoch 1-33) | 1,008 blocks (about a week) from the halving block | `hat:halving-party` | confetti, bunting, half-coin banners |
| `genesisDay` | 3 January (UTC), from 2010 | the whole UTC day | `hat:genesis-cap` | lanterns, block garlands, stars |
| `whitepaperDay` | 31 October (UTC), from 2009 | the whole UTC day | `hat:paper-boat` | paper cranes, scroll banners |
| `pizzaDay` | 22 May (UTC), from 2011 | the whole UTC day | `hat:pizza-chef` | pizza flags, bunting |
| `halvingCountdown` | the 4,032 blocks before a halving | until the halving block | `hat:countdown-cap` | countdown board |
| `retarget` | height is a multiple of 2,016 (from 2,016) | 144 blocks (about a day) | `hat:retarget-visor` | difficulty dial |

The table is in priority order: `featured` is the highest active event. Hat ids follow the
economy catalogue's `category:value` form so the catalogue can add them later.

## Threat model

| Threat | Mitigation |
|---|---|
| A network takes more than its seats by spreading over processes | Global seat count in Redis; atomic write-then-read per attempt; cap never exceeded |
| A crashed process leaks seats forever | Per-generation fields, heartbeat liveness, dead generations ignored after 30 s and deleted lazily |
| IP addresses stored in Redis (and in its RDB/AOF or replicas) | Network keys are `HMAC-SHA256(SCALING_KEY_SECRET, "bc-net:v1:" + ipKey)`, 132 bits, base64url. IPv4 is small enough to brute-force a plain hash; the keyed hash cannot be reversed without the secret. Persistence off is recommended on top |
| Logs leak addresses or keys | The lane logs fixed messages with the error class only; never keys, tokens, URLs or Redis error text (ioredis errors can carry command arguments) |
| Redis credentials or secrets in code | `REDIS_URL` and `SCALING_KEY_SECRET` from env only; config errors name the variable, never the value |
| Option injection through the Redis URL | The URL is parsed by the lane (zod + WHATWG URL): `redis:` or `rediss:` only, no query or fragment, db 0-15; ioredis gets an explicit options object, never the raw URL |
| Plain-text Redis across a network | Production refuses `redis://` to anything but loopback; use `rediss://` |
| Slow or hung Redis stalls joins | 500 ms command timeout, offline queue off, circuit breaker; startup fails closed |
| Redis outage turns into a game outage | Fallback to per-process limits (see table above) |
| Corrupt or hostile values in Redis | Every reply is validated with zod; bad seat fields count as nothing and are deleted, bad replies trip the breaker |
| Socket closes while the seat is being acquired | `holdSeat` registers the close listener before awaiting and releases exactly once |
| Memory growth | Local mirror holds only networks with seats on this process; limiter fallback is the capped `FixedWindowLimiter` (50k keys); every Redis key has a TTL except `procs`, whose entries are pruned |
| Key flooding in Redis from many addresses | Keys expire with their window; `volatile-ttl` eviction; upstream rate limiting at the proxy for floods |
| Proxy routes to arbitrary local ports | Explicit prefix-to-port allowlist in nginx (documented above) |
| Load test leaking into real ports or the network | Ports 3950-3959 only, loopback only, addresses from 198.18.0.0/15, every child killed on exit |
| Seasonal input abuse (NaN, negative, huge heights, odd dates) | `RangeError` on anything outside safe integer ranges, like `assertTick`; outputs frozen |

## Scalability

- Redis work per join: 1 round trip for each matchmake limiter, 1 for the seat. Per heartbeat
  (5 s): 1 transaction plus lease refreshes for networks idle for 40 s or more. All keys are
  O(1) or bounded small hashes (fields = live processes).
- Rate-limiter keys per window are bounded by distinct networks hitting the server in that window.
- No hot key except `bc:{seats}:procs`, which is tiny and read once per seat attempt.
- Seasons are O(1) arithmetic per call.

## Test plan

- `apps/server/test/scaling/fakeRedis.ts`: an in-memory implementation of exactly the commands the
  lane sends (`INCR`, `PEXPIRE` with `NX`, `HSET`, `HDEL`, `HGETALL`, `DEL`, `PING`, `PTTL`), with an
  injectable clock, `MULTI` atomicity and fault injection (down, timeouts, wrong replies).
- Limiters: window semantics and exact boundaries, TTL repair, fallback while down, recovery,
  hostile keys, validation of construction arguments, local implementation parity.
- Seats: cap, release, force past the cap, never negative, cross-process sharing, crash expiry,
  presumed-dead rotation, outage fallback and recovery rewrite, lease refresh, corrupt fields,
  `holdSeat` close races.
- Config: every variable, production rules, no echo of secrets.
- Real Redis: the same contract suite against `REDIS_URL` when it is set.
- Seasons: exact block and date boundaries, overlaps and priority, invalid inputs, determinism.
- Load test: a small run in CI-size (1 room x 5 clients) as part of verification.

## Integration

Filled at the end of the lane.

## Verification

Filled at the end of the lane.

## Load test results (23 Nov 2026)

`npm run loadtest` (`scripts/loadtest/`) runs the real server in a child process on port 3950, times every
`CitadelRoom` tick, and ramps private rooms of 5 SDK clients each. Every room starts a real match (roles, tasks,
withdrawals, the block clock) and every client walks at 20 moves a second. One server process on a 10-core Apple
silicon laptop, no Redis:

| Rooms | Players | Tick p50 | Tick p95 | Tick max | Event loop busy | Event-loop lag p99 | RSS |
|---|---|---|---|---|---|---|---|
| 5 | 25 | 0.20 ms | 0.49 ms | 0.73 ms | 5% | 12.9 ms | 117 MB |
| 10 | 50 | 0.14 ms | 0.35 ms | 0.55 ms | 6% | 13.1 ms | 87 MB |
| 20 | 100 | 0.14 ms | 0.26 ms | 0.46 ms | 12% | 12.9 ms | 102 MB |
| 40 | 200 | 0.11 ms | 0.21 ms | 0.42 ms | 19% | 13.1 ms | 122 MB |
| 60 | 300 | 0.08 ms | 0.17 ms | 1.31 ms | 22% | 12.7 ms | 125 MB |
| 80 | 400 | 0.08 ms | 0.13 ms | 0.41 ms | 27% | 13.4 ms | 130 MB |

- A tick has a 50 ms budget; room logic uses well under 1 ms. The process cost is network work (patch encoding and
  socket writes), which grows linearly: about 0.3% of one core per room.
- **Capacity estimate:** keeping the event loop under 70% busy, one process holds about 200 rooms (1,000 players)
  on this hardware. Plan for half that on a small cloud vCPU, and run one process per core with Redis (Part 1)
  beyond it.
- Lag p99 stays at the timer resolution (about 13 ms) throughout, so players see no added latency at these loads.
- Not yet measured: multiple processes on a real Redis (none on the test machine), and the bot manager under load.
