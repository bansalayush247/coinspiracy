# Byzantine Council

A browser social-deduction game that teaches how a Fedimint-style federation stays safe.
Guardians run a shared vault, sign withdrawal proposals and vote out suspects, while one or
two hidden Byzantine guardians try to slip a forged proposal past the signing threshold.

v1 uses play money only. No real bitcoin or ecash moves.

## Status

Milestones 1–7 are done and M8 has begun:

- **The match (M1–M4):** lobby, private rooms and quick match; the isometric Mint Citadel with synced movement; secret
  roles; four task minigames and the Consensus bar; signing ceremonies with forged withdrawals and audits; councils
  with hidden votes; partitions and freezes; a 72-block clock in three acts.
- **Progression (M5):** Guardian Rank, the Seal Book, quests, the Epoch Road, the solo Academy, rewards after every
  match, guest profiles, the island map, a wardrobe, and worn hats, eyewear and robe trims shown in matches.
- **Site, app and deploy (M6):** the Astro site and Codex (`apps/site`), an installable offline-capable client, and
  production config in `deploy/` (see `docs/deploy.md`).
- **Bots, scaling and seasons (M7):** practice bots the host can add to a lobby, Redis-backed scaling, and seasonal
  events (halvings, Genesis Day, Pizza Day) on the menu.
- **Beach Town and the islands (M8):** a shared hub with seven stalls and shopkeepers, where you pay with your own
  ecash notes and get change reissued, wear what you buy on the spot, take courier jobs for play sats and greet
  others with emotes. Lightning Reef adds two Academy levels; event islands rise on the map during seasonal events.
- **Mass audience (M9, started):** first-time tips, a graphics quality setting that defaults to Low on small
  devices, streamer mode (room codes masked), share cards after a match, and achievement cards for seals and
  unlocks.
- **Look and feel:** a painted world with soft shadows, wind, flocking birds, rain, thunder (delayed by the speed of
  sound), rainbows and meteors, each with a short science note; light that moves from afternoon to dusk through a
  match, and Beach Town lit by the visitor's own clock; townsfolk strolling when the world is quiet; physics-based
  effects for every action; seasonal bunting hung as a true catenary; procedural music and sound; and the Chronicle
  of Concordia, a story told chapter by chapter as islands open.
- **Capacity:** one server process holds about 200 rooms (1,000 players) in the load test (`npm run loadtest`,
  results in `docs/lanes/scaling.md`).

## Layout

| Path | What it is |
|---|---|
| `packages/shared` | Rules and contracts shared by client and server: federation maths, roles, proposals, votes, win checks, ecash notes, the citadel map, movement, lobby rules, message schemas and the synced state (`@byzantine-council/shared/state`) |
| `apps/server` | Authoritative Colyseus 0.18 game server |
| `apps/client` | Phaser 4 isometric client with a DOM menu and HUD, built with Vite |
| `e2e/smoke.ts`, `e2e/offline.ts`, `e2e/beach.ts` | End-to-end tests in headless Brave: a full match, the offline app, Beach Town |
| `apps/site` | Astro landing page and Codex |
| `deploy/` | nginx, systemd, env template and backups (see `docs/deploy.md`) |

## Commands

Requires Node 22 (see `.nvmrc`).

```sh
npm install
npm run check      # typecheck + lint + all unit and integration tests
npm run smoke      # end-to-end test in headless Brave; screenshots go to .scratch/e2e/
npm run offline    # the installed app works offline and updates safely
npm run beach      # Beach Town: walk, buy with notes, take a courier job
npm run build      # shared, client and server to dist/ (needs VITE_SERVER_URL, see below)
```

### Play locally

Run these in two terminals, then open http://127.0.0.1:5180 in two browser windows:

```sh
npm run dev -w @byzantine-council/server   # game server on 127.0.0.1:2567
npm run dev -w @byzantine-council/client   # Vite on 127.0.0.1:5180, proxies /colyseus to the server
```

Create a private room in one window and join with its code (or the copied invite link) in the
other. Move with WASD or the arrow keys; on touch screens a stick appears where your thumb lands.

## Deploying

The game server binds `127.0.0.1` and expects a TLS reverse proxy (nginx, Caddy) on the same host.

| Server variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | Set `production` in production |
| `PORT` / `HOST` | `2567` / `127.0.0.1` | Keep loopback behind the proxy |
| `ALLOWED_ORIGINS` | the Vite dev origins | **Required in production.** Comma-separated client origins, e.g. `https://play.example.com` |
| `TRUSTED_PROXIES` | none | **Required in production.** Proxy addresses allowed to set `X-Real-IP`, e.g. `127.0.0.1`, or `none` when clients connect directly |
| `MAX_SEATS_PER_IP` | `16` | Concurrent seats per network (IPv6 counts per /64); open sockets are capped at twice this |

- The proxy must overwrite `X-Real-IP` with the real client address and pass WebSocket upgrades.
- Build the client with `VITE_SERVER_URL` set to the server (`wss://game.example.com`) or to a
  same-origin path behind the proxy (`/colyseus`). The build refuses to run without it.
- `apps/client/dist/_headers` holds the page headers (strict CSP, `nosniff`, `no-referrer`,
  COOP). Static hosts that read `_headers` use it directly; otherwise copy them into the proxy config.
- No source maps are published.

## How movement works

- Each client samples input at 20 Hz and sends one `move {seq, dx, dy}` per tick while moving.
- The server applies inputs in order, one per tick of real time, using the same
  `stepMovement` as the client, and writes exact `float64` positions to the synced state.
- The last applied `seq` (`ack`) goes only to the player who sent it.
- The client predicts its own movement immediately, then on every server update replays its
  unacknowledged inputs on top of the server position. Small corrections are eased out;
  other players are drawn 100 ms in the past and interpolated.

## Core rules

- **Match size:** 5–9 players. The number of hidden Byzantine guardians is `f = floor((n - 1) / 3)`: 1 for 5–6 players, 2 for 7–9.
- **Signing threshold:** `t = n - f` signatures from current members. Byzantines alone can never reach it.
- **Halt rule:** the federation halts, and Byzantines win, once they make up a third or more of the members. Every honest guardian voted out by mistake brings that closer.
- **Proposals:** passing a forged proposal is a Byzantine win.
- **Council:** a guardian is rotated out only if they get the most votes, with no tie, and more votes than "skip".
- **Ecash notes:** amounts split into power-of-two notes, as in Fedimint. Spending a note twice is rejected.
- **Withdrawals:** real ones arrive from users; Byzantines forge others from the Signing Hall. Both look the same.
  Signatures are public. A closed proposal shows whether it was real, so signer lists become evidence.
- **Audits:** standing at the Ledger Archive desk for 3 seconds shows one proposal's truth to that player only.
- **Liveness:** three failures end the match for the Byzantines. A failure is a real withdrawal blocked or expired, or a partition not repaired in time.
  Refusing everything is no defence.
- **Councils:** called from the seal in the plaza, one per guardian per match. Votes stay secret until the result.
  A rotated-out guardian's role stays hidden until the match ends.
- **Sabotage:** a partition blocks every signature until two guardians hold both relays at once. A freeze stops one
  guardian for 15 seconds; they are not told who did it.
- **Block clock:** 72 blocks of 10 seconds in three acts (calm, withdrawals, final blocks). Councils pause it. If the last
  block arrives before consensus, the Byzantines win.

## Security model

- **Server-authoritative.** Clients send only intents. Every message must pass the strict zod
  schemas in `packages/shared/src/schemas.ts`; an invalid payload or unknown message type
  disconnects the sender. Free-text chat does not exist in public rooms.
- **No speed hacks.** Movement inputs are budgeted against real time: however fast a client
  sends, the server applies at most one input per tick plus a small burst, and a full queue
  refuses the rest. Refused inputs are still acknowledged, so the sender's prediction drops
  them instead of drawing the player in the wrong place.
- **Hidden information stays on the server.**
  - Roles come from a CSPRNG shuffle; the role map keeps input order, so its order never reveals the deal.
  - Secret fields use Colyseus StateView tags, one bit per secret. Never declare default-tag
    view fields, never send or log `state.toJSON()` (it includes view fields), and never
    replace `room.state` while views exist.
  - Proposals carry a server-only `forged` flag. Clients see them only through `ProposalState`,
    which has no such field; its `verdict` is filled in once the proposal closes.
- **Who can connect.** WebSocket upgrades from origins outside `ALLOWED_ORIGINS` get a 403.
  Matchmaking and code lookups from a foreign `Origin` get a 403, and matchmake bodies must be
  JSON, so another site cannot reserve seats through its visitors' browsers. CORS answers
  only the allowed origins (never `*`). IP headers are rewritten from the socket or a trusted
  proxy, so clients cannot spoof their address.
- **Abuse limits.** Per network: matchmaking 30/min and at most 6 per 8-second reservation
  window, code lookups 30/min, a cap on concurrent seats (a dropped player's held seat still
  counts) and on open sockets, which also covers reconnect attempts that skip room auth.
  Seat reservations expire after 8 s; matchmake bodies over 2 KB are refused; frames over
  1 KB or more than 40 messages a second close the socket. Idle players are removed after
  10 minutes in public rooms and 30 in private ones. A kicked socket that ignores the close
  is cut off after 2 s.
- **Room codes.** Six characters from a 31-symbol alphabet, claimed atomically, resolved only
  through the rate-limited lookup. Room ids are separate random strings.
- **Reconnection.** A dropped player's seat is held for 30 s. The reconnection token is a
  bearer credential, so it lives in `sessionStorage` only. Kicked players are never let back.
- **Failures stay contained.** A throw in one room's loop closes only that room.
- **Client hardening.** A strict CSP with no `unsafe-eval` or inline code (zod runs jitless),
  player names rendered only as text, and invite codes carried in the URL fragment so they
  never reach web server logs.
- **Deadlines fail closed.** Every rule that takes a game tick throws on anything that isn't a
  non-negative safe integer. An overdue proposal expires before it can be counted.
- **Double-spend checks don't leak.** Spending an unknown note and spending an already-spent
  note return the same error.
- **Logs** carry room and session ids only: no IP addresses, nicknames or tokens.

## Scaling

One server process today. Room codes already go through Colyseus presence, so moving to Redis
presence and driver is a configuration change; the per-network limiters are per process and
would move to Redis counters at the same time.
