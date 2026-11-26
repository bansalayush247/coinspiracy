# Deploying Byzantine Council

One Linux host runs everything: nginx in front, the Node game server on loopback, and Postgres for guest profiles.
Replace `example.org` with your domain throughout. All files referred to here are in `deploy/`.

| Host | Serves | From |
|---|---|---|
| `example.org` | The Astro site and Codex | `apps/site/dist/` |
| `www.example.org` | Redirect to `example.org` | |
| `play.example.org` | The game client, installable as an app | `apps/client/dist/` |
| `play.example.org/colyseus/` | The game server (matchmaking, API, room sockets) | `127.0.0.1:2567` |

The game server sits under the same origin as the client. The page CSP then needs only `connect-src 'self'`, and the
guest cookie is first-party.

## Requirements

- Node 22, npm, nginx 1.25.1 or newer (`http2 on`, `ssl_reject_handshake`), Postgres 15 or newer, certbot.
- A user for the server: `useradd --system --home /nonexistent --shell /usr/sbin/nologin bcouncil`.

## First install

1. **Database.**
   ```sh
   sudo -u postgres createuser bcouncil --pwprompt
   sudo -u postgres createdb bcouncil --owner bcouncil
   ```
   The server creates its tables on start.
2. **Environment.** Copy `deploy/env/server.env.example` to `/etc/byzantine-council/server.env`. Set a real
   `DATABASE_URL` and generate `SESSION_SECRET` with `openssl rand -base64 48`. Then
   `chown root:root` the file and `chmod 600` it. The server refuses to start in production without `ALLOWED_ORIGINS`,
   `TRUSTED_PROXIES`, `DATABASE_URL` or `SESSION_SECRET`, and its error names the variable, never the value.
3. **Build** a release into `/opt/byzantine-council/releases/<date>` (see Releases), then point the
   `/opt/byzantine-council/current` symlink at it.
4. **TLS.** Create `/var/www/acme`, install the port-80 server block, then run
   `certbot certonly --webroot -w /var/www/acme -d example.org -d www.example.org -d play.example.org`.
5. **nginx.** Copy `deploy/nginx/byzantine-council.conf` to `/etc/nginx/conf.d/` and `deploy/nginx/snippets/*` to
   `/etc/nginx/snippets/`. Then run `nginx -t && systemctl reload nginx`. Copying the snippets resets
   `bc-frame-ancestors.conf` to `'none'`. If `FRAME_ANCESTORS` is set, run `deploy/scripts/frame-ancestors.sh` again
   before you reload.
6. **Service.** Copy the three units from `deploy/systemd/` to `/etc/systemd/system/`, then run
   `systemctl daemon-reload` and `systemctl enable --now byzantine-council byzantine-council-backup.timer`.
7. **Check.** `curl -fsS https://play.example.org/colyseus/healthz` answers `ok`, and the site and the game load with no
   console errors.

## Releases

```sh
cd /opt/byzantine-council/releases && git clone --depth 1 <repo> "$(date -u +%Y%m%d%H%M)" && cd "$_"
npm ci
SITE_URL=https://example.org VITE_SERVER_URL=/colyseus VITE_SITE_URL=https://example.org npm run build
npm run check && npm run smoke && npm run offline            # on a build machine with Brave
SITE_URL=https://example.org npm run check:dist -w @byzantine-council/site
ln -sfn "$PWD" /opt/byzantine-council/current && systemctl restart byzantine-council
```

- The client and the site are static. Players who have the game open keep their version until they choose
  "Reload" on the update banner, so a deploy never interrupts a match in progress.
- Restarting the server drains rooms for up to 10 seconds. Restart when few matches are running, or announce it.
- Rolling back means pointing `current` at the previous release and restarting.

### Release checklist

- [ ] `npm run check` (typecheck, lint, all tests) passes.
- [ ] `npm run smoke` and `npm run offline` pass in headless Brave.
- [ ] `npm run verify -w @byzantine-council/site` passes with the production `SITE_URL`.
- [ ] `nginx -t` passes on the host after any change in `deploy/nginx/`.
- [ ] After the restart, `/colyseus/healthz` answers and one private room can be created and joined from two browsers.

## Security

- **Network.** The game server binds `127.0.0.1` and trusts `X-Real-IP` only from `TRUSTED_PROXIES`. nginx overwrites
  `X-Real-IP` and clears `X-Forwarded-For`, `X-Client-IP` and `Forwarded`, so clients cannot choose their address.
- **Headers.** `deploy/nginx/snippets/bc-site-headers.conf` matches `apps/site/public/_headers`, and
  `bc-play-headers.conf` matches `apps/client/csp.ts` for `VITE_SERVER_URL=/colyseus`. Tests compare them. nginx
  drops inherited `add_header` lines in any location that adds its own, so every such location includes the snippet again.
- **Framing.** Nobody may frame the game unless `FRAME_ANCESTORS` lists them. The same list feeds the server's CSP,
  the client build's `_headers` and, through `deploy/scripts/frame-ancestors.sh`, nginx's `$bc_frame_ancestors` map in
  `snippets/bc-frame-ancestors.conf`. The default for all three is `frame-ancestors 'none'`.
- **Caching.** Only hashed files are cached for long. HTML, `sw.js` and the manifest always revalidate. There is no
  catch-all fallback to `index.html`, so a missing script is a 404 and never cached HTML.
- **Rate limits.** nginx limits matchmaking (30 a minute per address), the API and static files, and caps concurrent
  sockets per address. The server enforces its own per-network limits as well (see the README).
- **Process.** The unit runs as `bcouncil` with no capabilities, a read-only filesystem, no devices, a syscall filter,
  1 GB of memory and 256 tasks. `MemoryDenyWriteExecute` stays off because V8 needs it.
- **Secrets.** Only `/etc/byzantine-council/server.env` holds secrets. To rotate `SESSION_SECRET`, move the old value to
  `SESSION_SECRET_PREVIOUS`, set a new one, restart, and clear the previous value after 30 days.

## Privacy

- nginx access logs hold no client address and no query string (socket URLs carry reconnection tokens). Requests to the
  game server are logged under a coarse route label. The error log is at `crit`.
- The game server logs room and session ids only. Guest profiles are random ids with game progress, and there are no
  emails, names or analytics. Profiles idle for 400 days and idempotency keys older than 30 days are deleted.

## Backups and monitoring

- `byzantine-council-backup.timer` runs `deploy/scripts/backup.sh` every day at 03:15 (plus up to 10 minutes). It
  writes a checked `pg_dump` to `/var/backups/byzantine-council/` and keeps 14 days. Create that directory owned by
  `postgres` with mode 700, and copy it off the host as well.
- To restore: `pg_restore --clean --if-exists -d bcouncil <file>.dump`, then restart the service.
- Monitor `https://play.example.org/colyseus/healthz` and the age of the newest backup (alert at 26 hours).
  `journalctl -u byzantine-council` holds the server's JSON logs.

## Discord Activity

The web build also runs as a Discord Activity. The client detects Discord from the `frame_id` and `instance_id` launch
parameters inside a frame. It then loads `@discord/embedded-app-sdk` (only there, as a separate chunk) and sends every
request and socket through Discord's `/.proxy/` URL mapping. Service worker, install prompts and plain external links are
off. Links open through the SDK, and sound pauses while the Activity is hidden.

1. **Developer portal** (discord.com/developers, your application):
   - **Activities → URL Mappings**, most specific first:

     | Prefix | Target |
     |---|---|
     | `/colyseus` | `play.example.org/colyseus` (the game server, HTTP and WebSocket) |
     | `/` | `play.example.org` (the client) |

     The client calls `/.proxy/colyseus/...`, the path of `VITE_SERVER_URL` under `/.proxy`. For an absolute
     `VITE_SERVER_URL`, map its path (or `/colyseus` when it has none) to that host and path. With several server
     processes, every `PUBLIC_ADDRESS` must live under the mapped host and prefix.
   - **Activities → Settings**: turn Activities on and pick the platforms.
   - **OAuth2**: copy the client id and reset and copy the client secret. The Activity requests the `identify` scope
     only. The embedded flow uses no redirect; Discord's Activity guide adds `https://127.0.0.1` as a harmless placeholder.
2. **Server env** (`/etc/byzantine-council/server.env`):
   ```sh
   DISCORD_CLIENT_ID=<application id>
   DISCORD_CLIENT_SECRET=<client secret>
   DISCORD_PROFILE_SECRET=<openssl rand -base64 48>
   ALLOWED_ORIGINS=https://play.example.org,https://<application id>.discordsays.com
   FRAME_ANCESTORS=https://discord.com,https://*.discordsays.com
   ```
   Then run `deploy/scripts/frame-ancestors.sh`, reload nginx and restart the service. Add `https://ptb.discord.com` and
   `https://canary.discord.com` to `FRAME_ANCESTORS` to test in those clients.
3. **Build** with the application id (public, not a secret): `VITE_DISCORD_CLIENT_ID=<application id>` next to the
   usual `VITE_SERVER_URL=/colyseus`. One build serves the web and Discord.

How sign-in works: the SDK's `authorize` (identify) gives the client a one-time code, and `POST /colyseus/api/discord/token`
exchanges it with the client secret, reads the user id and discards the Discord token. The server then answers with a
signed guest session token. Its signing is the same as the `bc_guest` cookie's, and it lasts 24 hours. The Activity
iframe blocks third-party cookies, so the client sends the token as `Authorization: Bearer` (HTTP) and `_authToken`
(sockets). The HTTP gate turns a valid token into the guest cookie, so rooms and routes verify it the usual way. The
profile id is an HMAC of the Discord id under `DISCORD_PROFILE_SECRET`. Nothing stores the Discord id, token, name or
avatar, and other players see only the nickname a player types. Never rotate `DISCORD_PROFILE_SECRET`: Discord players
would get new, empty profiles.

The route is zod-validated, takes a 1 KB JSON body, needs an allowed `Origin`, and allows 20 exchanges a minute per
network and 600 a minute per process, with 32 in flight. Without the three `DISCORD_*` variables it does not exist (404).
A partial or invalid setup answers 503 and logs the variable names. The web game is never affected.

Before launch, test inside Discord. Check which client address Discord's proxy passes on. nginx and the server rate-limit
per address, so if every Activity player arrives from a few Discord proxy addresses, raise the limits for that traffic.

Known advisory, accepted on 26 November 2026: `@discord/embedded-app-sdk` 2.5.0 bundles zod 3.25.76, which `npm audit`
flags as high (GHSA-mrhx-c7xc-m3w5, memory exhaustion on oversized collections; fixed only in zod 4.6.6+). The SDK loads
only inside Discord, as its own chunk, and validates only messages from Discord's parent window, so the worst case is a
slow tab inside Discord. No server code uses it. Upgrade the SDK as soon as a release moves to zod 4, and re-run
`npm audit --omit=dev` before each release.

## Web portals

Portals such as CrazyGames and Poki host an uploaded build in their own iframe:

```sh
VITE_SERVER_URL=https://play.example.org/colyseus npm run build -w @byzantine-council/client -- --mode portal
```

- `--mode portal` (or `VITE_PLATFORM=portal`) gives relative asset paths, no service worker, manifest or install
  prompts, and no external links. A portal build needs an absolute `VITE_SERVER_URL`, and the build stops without one.
- Add the portal's game-file origin to `ALLOWED_ORIGINS`, so its sockets and API calls are accepted.
- The portal page loads its SDK. The client feature-detects `window.CrazyGames.SDK` (v3) or `window.PokiSDK` (v2). It
  reports loading start and stop, and it reports gameplay start and stop as the main menu hides and shows. It mutes when
  hidden or when CrazyGames asks for silence. Without an SDK every call is a no-op. No portal SDK is bundled. If a portal
  needs its script tag in the game's own `index.html`, add it to the uploaded copy.
- Portals are third-party frames, so there is no guest cookie. Players there play as guests without saved progress, and
  the client makes no profile calls.
- If a portal frames `play.example.org` directly instead of hosting files, add its origin to `FRAME_ANCESTORS`. The
  normal build then switches to portal behaviour with `?bc_host=portal` in the frame URL, or from a referrer on
  `VITE_PORTAL_REFERRERS` (default `crazygames.com,poki.com` and their subdomains).

## More than one server process

One process handles many rooms. When it is not enough, set `REDIS_URL`, `SCALING_KEY_SECRET` and a per-process
`PUBLIC_ADDRESS` (for example `play.example.org/colyseus/s1`), run one unit per process on its own port, and route
`/colyseus/s1/` to process 1 and so on in nginx. Matchmaking and the per-network limits then go through Redis. See
`docs/lanes/scaling.md`.
