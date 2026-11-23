# Lane: bots (M7 part 1): practice mode against bots

Status: done (23 Nov 2026). Integrated into the room, the server start-up and the lobby UI; see Integration.

## Scope

- **Tile pathfinding** in `@byzantine-council/shared/pathfinding`: A* over the walkable tiles of a
  `CitadelMap`, with clearance for the player's square footprint, path smoothing, a bounded search,
  deterministic output, and a predicate for extra blocked tiles (doors later).
- **Practice bots** in `apps/server/src/bots/`: bots are in-process `@colyseus/sdk` clients that
  connect to this server over loopback, so every server check (schemas, rate limits, movement
  budget, station range, solve timing, phase rules) applies to them exactly as to a person.
  - `BotManager`: spawns N bots into a room by id, enforces per-room and per-process caps, drives
    every bot from one shared 20 Hz ticker, makes bots leave when no human remains, and shuts down
    cleanly.
  - Bot brain: follows paths with 20 Hz `move` inputs and local prediction (`stepMovement`), walks
    to stations, solves tasks with `solveChallenge` after a human-like delay (never under
    `TASK_TIMING.minSolveMs`), sometimes makes a mistake, and survives reconnects.
  - Strategies: honest bots work through their tasks; Byzantine bots fake tasks and wander. A
    strategy interface has hooks for signing, voting and chat, which the core lane is building for M4.
- **Not built here** (other lanes own the files; see Integration): the host-only `addBots`
  message, the public `bot` flag on `PlayerState`, the bot seat exemption in `CitadelRoom.onAuth`,
  wiring in `app.ts`, and the client badge.

## Files (all owned by this lane)

| File | What it is |
|---|---|
| `packages/shared/src/pathfinding.ts` | A*, smoothing, segment clearance, standability checks |
| `packages/shared/test/pathfinding.test.ts` | Pathfinding tests against `CITADEL_MAP` and small maps |
| `apps/server/src/bots/index.ts` | Public surface: `installBotManager`, `botManager`, `claimBotSeat`, types |
| `apps/server/src/bots/manager.ts` | `BotManager`: spawn, caps, ticker, watchdog, removal, shutdown |
| `apps/server/src/bots/brain.ts` | One bot: movement, task flow, phase reactions, reconnects |
| `apps/server/src/bots/motion.ts` | `BotMotor` (prediction) and `PathFollower` (steering, stuck detection) |
| `apps/server/src/bots/strategy.ts` | `BotStrategy` interface, honest and Byzantine strategies, M4 hooks |
| `apps/server/src/bots/answers.ts` | Correct and deliberately wrong (schema-valid) task answers |
| `apps/server/src/bots/profile.ts` | Timing and behaviour profiles (human-like default, fast for tests) |
| `apps/server/src/bots/seats.ts` | One-shot bot seat tickets that `CitadelRoom.onAuth` can check |
| `apps/server/src/bots/names.ts` | Original, friendly bot names |
| `apps/server/src/bots/random.ts` | Seeded `RandomSource` for reproducible tests and helpers |
| `apps/server/test/bots/*.test.ts` | Unit tests and end-to-end tests on ports 3900-3909 |

## Contracts and seams

### Pathfinding (`@byzantine-council/shared/pathfinding`)

```ts
findPath(map, from, to, options?): Result<Vec2[], PathError>
findPathNear(map, from, target, range, options?): Result<Vec2[], PathError>
isClearSegment(map, a, b, options?): boolean
canStand(map, pos, options?): boolean
options: { blocked?(col, row): boolean; radius?: number; maxExpansions?: number; smooth?: boolean }
PathError = 'invalidInput' | 'startBlocked' | 'goalBlocked' | 'noPath' | 'searchLimit'
```

- The returned waypoints follow `from` and end at the goal; an empty list means "already there".
- Grid search: 8 directions, integer costs (10 straight, 14 diagonal), octile heuristic, and a
  diagonal step only when both side tiles are free, so a footprint never clips a corner.
- Clearance: a tile is passable when the footprint at its centre (half-width `radius`, default
  `PLAYER_RADIUS`) overlaps only walkable, unblocked tiles. `radius` must be in `[0, 0.5)`.
- Smoothing: greedy string pulling. A shortcut is taken only if the segment is clear for the
  footprint plus a margin (`PATH_CLEARANCE`, sampled every `SEGMENT_STEP`), so axis-by-axis
  movement and slight corner cutting at waypoints stay clear of walls.
- Bounded: maps over `MAX_PATH_TILES` tiles are refused, and the search stops after
  `maxExpansions` expanded tiles (default and hard cap: the grid size).
- Deterministic: no randomness, fixed neighbour order, heap ties broken by `h` then insertion order.
- Extra blocked tiles: `blocked(col, row)` is called with integer tile coordinates at most once per
  tile per search; the result is cached for that search. The start tile ignores it, so a walker
  standing in a doorway that closes can still leave.

### Bots (`apps/server/src/bots`)

```ts
installBotManager(options: BotManagerOptions): BotManager   // process singleton for CitadelRoom
botManager(): BotManager | null                             // null while bots are disabled
claimBotSeat(sessionId, roomId, ip): boolean                // for CitadelRoom.onAuth, one-shot
class BotManager {
  spawn(roomId, count): Promise<SpawnResult>                // { added, refused?: SpawnRefusal }
  remove(roomId, sessionId): Promise<boolean>
  removeAll(roomId): Promise<void>
  count(roomId?): number
  shutdown(): Promise<void>
}
```

- Joining: the manager reserves a seat with `matchMaker.joinById(roomId, { nickname })` and no
  auth context, so the HTTP matchmaking route and its per-network rate limits are not involved
  (the matchmaker still refuses locked rooms). It records a one-shot seat ticket for the returned
  `sessionId`, then consumes the reservation over a loopback WebSocket with an allowed `Origin`.
  The reservation's `publicAddress` is dropped so a bot always dials its own process.
- The room's instance `onAuth` still runs for bots: nickname schema and the "lobby only" check
  apply. With the integration below it also recognises the ticket and skips the per-network seat
  count for that seat only.
- Bots only read what their own client receives (their own view of the synced state and their
  own messages). They never read server-side state, so a bot has no hidden information a person in
  its seat would not have.
- Outgoing messages are validated against the shared `CLIENT_MESSAGE_PAYLOADS` schemas before
  sending, and only types the room currently handles are allowed (`move`, `openTask`,
  `taskAnswer`, `closeTask`). The M4 intents (`signProposal`, `refuseProposal`, `callCouncil`,
  `castVote`, `quickChat`) are refused until the integration turns on `social: true`, because the
  room closes the socket on unknown types.
- Incoming task messages are parsed with the shared zod schemas; anything else is ignored.

### Strategy interface (M4 seams)

```ts
interface BotStrategy {
  next(view, rng): BotPlan                 // 'task' | 'visit' | 'wait'
  solve(view, task, rng): SolvePlan        // think time, mistake, abandon
  social?: BotSocialHooks                  // M4: proposals, council votes, quick chat
}
interface BotSocialHooks {
  onProposal?(view, proposal): 'sign' | 'refuse' | null
  onCouncil?(view, candidates): string | 'skip' | null
  onChat?(view, trigger): ChatMessage | null
}
```

The brain exposes `act.sign(id)`, `act.refuse(id)`, `act.callCouncil()`, `act.vote(target)` and
`act.chat(message)`, which validate the payload and send it only when social messages are enabled.

## How a bot plays

- 20 Hz: one shared interval drives every bot; each bot keeps a fixed-step accumulator so it sends
  at most one `move` per 50 ms tick and never bursts more than two after an event-loop stall.
- Prediction: `BotMotor` applies each input locally with `stepMovement` and, on every patch,
  replays unacknowledged inputs on the server position (`ack`), like the browser client. It stops
  sending after 40 unacknowledged inputs.
- Steering: `PathFollower` aims at the next waypoint from the predicted position, slows down for
  the last step so it stops on the waypoint, and reports "stuck" when it makes no progress for a
  second; the brain then replans, and gives up on a goal after three replans.
- Tasks: walk to the closest free tile in prompt range of the station, wait until the server has
  acknowledged every input and confirms the position in range, pause briefly, `openTask`, think
  for `minSolveMs` plus a per-task human delay, then answer. Wrong answers wait the server's
  `retryInMs`; refusals are handled per reason; a missing reply times out and the bot retries.
- Honest bots pick the nearest remaining task most of the time and sometimes detour. Byzantine
  bots visit stations, linger, fake tasks (the server counts them for nothing), sometimes walk off
  without answering, and wander between rooms.
- Phases: on `playing` the bot waits a short reaction time; on `ended` it stops and drops any task;
  in the lobby it stands near its seat and takes an occasional short stroll.
- Reconnects: the SDK reconnects automatically (`minUptime = 0`); the bot pauses while dropped,
  resets prediction to the server position on return, and reopens any task the server closed.

## Threat model

| Threat | Mitigation |
|---|---|
| A real client claims the bot exemption from per-network seat limits | Exemption only for a server-issued, one-shot seat ticket bound to a `sessionId` and room, valid for the seat reservation window, and only from a loopback address. Nothing a client sends (options, headers) can create a ticket; `sessionId`s of reservations never reach other clients before the join. |
| `X-Real-IP: 127.0.0.1` spoofing to look like a bot | Headers alone grant nothing: a ticket is still required. The proxy overwrites `X-Real-IP` (deploy rule), so a remote client cannot appear as loopback either. |
| Host spawns bots to exhaust the process | Per-room cap (8, and never more than free seats), per-process cap (default 16, never above `maxSeatsPerIp` so loopback sockets stay under the gate's cap), one spawn batch per room at a time, spawns only into local, unlocked rooms. |
| Bot-only rooms living forever | Watchdog: bots leave once no human holds a seat; a room left by everyone disposes. Leaves also happen on dispose, kick, shutdown. |
| A bot bug gets it kicked or crashes the server | Outgoing payloads validated before sending; message allowlist; per-bot errors caught; three errors make that bot leave; ticker callbacks never throw. |
| Bots cheating with hidden information | Bots only read their own client view and targeted messages, never server state. |
| Bots answering faster than people | Think time is at least `minSolveMs` + 50 ms; the server ignores faster answers anyway. |
| Logs leaking data | Logs carry room and session ids and counts only, never names, IPs or tokens; no `toJSON()` of state anywhere. |
| Resource leaks | Every bot has one socket and one entry; caps bound memory; tickets expire and are capped; timers are cleared on leave and shutdown; joins have a timeout and a late join leaves at once. |

## Scalability

- One process runs at most `maxBotsPerProcess` bots (default 16). They cost one loopback socket,
  one decoded state copy and about 20 small messages per second each.
- One shared 20 Hz interval drives all bots in a process; A* runs only on a new goal or a replan
  (the citadel is 896 tiles; a search expands at most that many).
- Bots never cross processes: they only join rooms hosted by their own process. With Redis
  presence (scaling lane) each process keeps its own manager and caps.

## Test plan

- `packages/shared/test/pathfinding.test.ts`: every task station reachable from every spawn
  point, with a real `stepMovement` walk that arrives in range; waypoints standable and segments
  clear; no corner cutting; extra blocked tiles respected and called once per tile with integers;
  determinism; bounded search; invalid inputs; optimal cost on open ground; empty path when
  already in range.
- `apps/server/test/bots/*.test.ts` (unit): motor reconcile and replay, follower steering and
  stuck detection, strategies with a seeded RNG, wrong answers schema-valid but wrong for every
  task kind, seat tickets (one-shot, expiry, wrong room, non-loopback, capacity), names valid.
- `apps/server/test/bots/*.test.ts` (end to end, ports 3900-3909): a private room with one human
  SDK client plus 4 bots; the host starts; bots walk to stations and finish tasks so consensus
  rises; a Byzantine bot fakes tasks; bots survive a dropped socket; bots leave when the human
  leaves and the room disposes. Abuse: caps per room and per process, invalid arguments, unknown
  and locked rooms, spawning after shutdown, a room that disposes with bots inside and while they
  are joining.

## Integration

- **Protocol:** `PlayerState.bot` (public); host-only `addBot` and `removeBot { targetId }`; `botsRefused { reason }` to the host.
- **Room:** `onAuth` claims the one-shot bot seat ticket (loopback only) and skips the per-network seat count for that seat;
  bots never get a profile, never become host, and a match with bots counts as practice (`humans < players`).
  Bots can only be added or removed in the lobby, by the host, while seats are free.
- **Server:** `createGameServer({ bots: {} })` starts the manager after `listen()`, dialling its own loopback address with
  the first allowed origin and `social: true`. `BOTS=on|off` (default on) controls it; the cap is
  `min(16, MAX_SEATS_PER_IP)` bots per process.
- **Social play (M4 hooks):** honest bots score public evidence (signers of revealed forgeries +2, refusers of failed real
  withdrawals +1), sign or refuse each withdrawal after a human delay (council warnings and audit claims sway them), vote
  for the top suspect or skip, name suspects in quick chat, call a council on strong evidence, and head for a free relay
  during a partition. Byzantine bots sign their own forgeries, refuse some real withdrawals, never vote for a fellow,
  forge from the Signing Hall and use partitions and freezes only when the server says they are ready.
- **Client:** "Add a practice bot" for the host in the lobby, a Bot tag in the roster, and a remove button per bot.

## Verification

- `apps/server/test/bots/bots.e2e.test.ts`: host-only add and remove, a full match with one person and four bots (tasks
  fill the bar, withdrawals answered, the match reaches a result), bots leave when the last person does, no bots mid-match.
- `apps/server/test/bots/strategy.test.ts`: votes, signing, chat validity, relay spreading, sabotage readiness.
- `npm run smoke`: the lobby button adds a bot and removes it in a real browser (67 checks).
