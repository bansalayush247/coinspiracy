# Lane `pwa-deploy` (M6 part 2): installable client and production deploy

Status: done (23 Nov 2026): PWA wired into the build and main.ts; deploy files in deploy/, guide in docs/deploy.md.
The Integration and Verification
sections at the end are the hand-off.

## Scope

1. **PWA for `apps/client`**
   - `public/manifest.webmanifest` and icons rendered from `public/favicon.svg` by a script in this lane.
   - A hand-written service worker (`src/pwa/sw.ts`) built to `/sw.js` by a small Vite plugin.
   - `registerServiceWorker()` for `main.ts` (core owns `main.ts`, so the call is an integration step),
     with a safe update flow: a new version waits until the page asks for it.
   - CSP: `worker-src 'self'` and `manifest-src 'self'`; `dist/_headers` gives `/sw.js` `Cache-Control: no-cache`.
2. **Deploy configuration** in `deploy/` plus `docs/deploy.md`: nginx (TLS, ACME, HSTS, the same
   security headers as `dist/_headers`, static roots for the client and the Astro site, the game server
   behind a WebSocket-capable proxy, rate-limit zones, gzip), a hardened systemd unit, an environment
   template, Postgres and Redis notes, backups, log rotation, monitoring via `/healthz` and a release checklist.

Out of scope: `main.ts`, `index.html` and `style.css` (core), the Astro site's own pages and headers
(site), server code and env parsing (core, profiles, scaling).

## Files (all owned by this lane)

| File | What it is |
|---|---|
| `apps/client/public/manifest.webmanifest` | Web app manifest |
| `apps/client/public/icons/*.png` | 192, 512, maskable 512 and a 180 px Apple touch icon, rendered from `favicon.svg` |
| `apps/client/src/pwa/render-icons.ts` | Node script: renders the icons with headless Brave (`npx tsx apps/client/src/pwa/render-icons.ts`) |
| `apps/client/src/pwa/swConfig.ts` | The build-time config the plugin injects into `sw.js`, and its runtime guard |
| `apps/client/src/pwa/cachePolicy.ts` | Pure cache rules: request routing, cache names, response checks, message parsing |
| `apps/client/src/pwa/swRuntime.ts` | `installServiceWorker(scope, config)`: the install, activate, fetch and message handlers |
| `apps/client/src/pwa/sw.ts` | Service worker entry: reads the injected config and installs the handlers |
| `apps/client/src/pwa/shell.ts` | Pure build helpers: the app shell from the bundle graph, the version hash input |
| `apps/client/src/pwa/vitePlugin.ts` | `pwa()` Vite plugin: injects the manifest links, builds `sw.js`, validates the manifest and icons |
| `apps/client/src/pwa/register.ts` | `registerServiceWorker()` and its testable core `startServiceWorker()` |
| `apps/client/src/pwa/updatePrompt.ts`, `pwa.css` | Default "new version ready" banner |
| `apps/client/csp.ts` | Adds `worker-src 'self'`; renders `dist/_headers` with per-path cache rules |
| `apps/client/vite.config.ts` | One small edit at the end: `pwa()` in `plugins`, `_headers` from `renderHeadersFile()` |
| `apps/client/test/pwa/*.test.ts` | Unit, plugin, build and deploy-config tests |
| `apps/client/test/pwa/offline.e2e.ts` | Headless Brave check on a `vite preview` of a production build (ports 3940–3949) |
| `deploy/**` | nginx, systemd, env template, journald, logrotate, backup script |
| `docs/deploy.md` | The deploy guide and release checklist |

## Contracts and integration seams

- `registerServiceWorker(options?)` from `apps/client/src/pwa/register.ts`
  - No-op (resolves `null`) in dev (`import.meta.env.DEV`), in e2e builds (`VITE_E2E=1`), without
    `navigator.serviceWorker` or outside a secure context.
  - Registers `/sw.js` with scope `/` and `updateViaCache: 'none'` after the window `load` event.
  - `options.onUpdate(apply)` is called once per waiting version; `apply()` tells the waiting worker to
    take over and reloads this tab once it does. Without `onUpdate` a small accessible banner offers
    "Reload" and "Later". It never reloads on its own, so a match is never interrupted.
  - Checks for a new version hourly while the page is open.
- `pwa()` from `apps/client/src/pwa/vitePlugin.ts` returns two Vite plugins:
  - `byzantine-council-pwa-html` adds `<link rel="manifest">` and `<link rel="apple-touch-icon">` to
    `index.html` only, so `index.html` (core) needs no edit.
  - `byzantine-council-pwa-sw` (build only, `enforce: 'post'`) validates the manifest and its icons, computes
    the app shell and version, builds `src/pwa/sw.ts` as one self-contained IIFE with a nested Vite build
    and emits it as `sw.js`. A build without `index.html` (for example a separate hub build) gets no
    service worker and a warning.
- `renderHeadersFile(headers)` from `apps/client/csp.ts` renders `dist/_headers`.

## How the service worker works

- **Precache (install).** The versioned app shell: `/` (the HTML), the entry chunk with its static imports,
  their CSS and imported assets (the same graph Vite writes to its build manifest, read from the bundle so
  `.vite/manifest.json` is never published), plus the manifest, the icons and the favicon. Non-hashed files
  are fetched with `cache: 'no-cache'`; every response must be `200`, same-origin (`basic`), not redirected
  and of the expected content type. The HTML must reference the shell's entry scripts, so a deploy that
  lands mid-install fails the install instead of caching a mismatched pair. Nothing is written until every
  file has been fetched. A failed install leaves the old version in charge and retries on the next visit.
- **Waiting.** Install never calls `skipWaiting()`. The new version waits until every tab closes or a page
  posts `{ type: 'skip-waiting' }`.
- **Activate.** Deletes this app's caches (`bc-` prefix) that the new version does not use, never other
  caches, and turns on navigation preload where supported.
- **Fetch routing** (`classifyRequest`):
  - `bypass` (the browser handles it; the worker never calls `respondWith`): any non-GET, any cross-origin
    URL, `Range` requests, the `only-if-cached` quirk, any URL with a query string outside navigations,
    and every path under `/api`, `/matchmake`, `/colyseus`, `/healthz` or the same-origin game server
    path from `VITE_SERVER_URL`. WebSockets never reach a service worker.
  - `navigation` for `/` and `/index.html`: network first (navigation preload when available), falling
    back to the cached shell on a network error or after 4 s. Fresh HTML is never written over the cached
    shell, so the cached HTML always matches the cached scripts.
  - `shell`: exact precached paths, served cache first.
  - `asset`: hashed files under `/assets/`, cache first; misses go to the network and are cached
    (bounded to 64 entries per version) when the response is a cacheable `200`.
- **Update flow.** The browser checks `/sw.js` on navigation and the page checks hourly. A changed build
  changes the version string inside `sw.js`, so the browser installs it; it waits; the page offers a reload.

## Threat model and mitigations

| Threat | Mitigation |
|---|---|
| Cache poisoning: an HTML error page or a redirect cached under a script URL | Only `200`, `basic`, non-redirected responses whose `Content-Type` fits the file extension are cached; nginx serves `/assets/` with `try_files $uri =404` (no SPA fallback) |
| Stale or mixed versions | Versioned cache names; the cached HTML is never overwritten by network HTML; install verifies the HTML references the shell scripts; old caches are deleted only on activate |
| The worker intercepting game traffic (matchmake, room lookups, profiles API, WebSockets) | Allowlist routing: only navigations to the app's own pages, exact precached paths and hashed assets are handled; API prefixes and the configured server path are bypassed explicitly; non-GET, cross-origin and query-string requests are bypassed |
| A tab reloading mid-match | The worker never calls `skipWaiting()` on its own; only an explicit user action reloads, and only the tab that asked |
| Hostile messages to the worker | Only same-origin clients can message a worker; the one accepted message has an exact shape (`{ type: 'skip-waiting' }`), everything else is ignored |
| Script injection through the worker | `sw.js` is a single self-contained file with no `importScripts`; its own CSP (the page headers) applies; the page CSP allows workers only from `'self'` |
| Unbounded storage | The shell is capped at build time (64 files, 12 MiB, build fails above); the runtime cache keeps at most 64 entries per version |
| Long-lived stale worker | `sw.js` is served `Cache-Control: no-cache` and registered with `updateViaCache: 'none'`; hourly update checks |
| Personal data in caches | Only public static files are cached; no cookies, tokens or API responses |
| Proxy spoofing of client IPs | nginx overwrites `X-Real-IP` with `$remote_addr` and clears `X-Forwarded-For`, `X-Client-IP` and `Forwarded`; the server trusts `X-Real-IP` only from `TRUSTED_PROXIES` |
| Abuse at the edge | `limit_req` zones for matchmaking and the API, `limit_conn` on game sockets, small `client_max_body_size`, timeouts, unknown hosts get a rejected TLS handshake |
| Identifiable logs | nginx access logs use formats with no client address, no query string (WebSocket URLs carry reconnection tokens) and a coarse route label instead of the path for proxied requests; the error log stays at `crit` |
| Secrets on disk | The env file is `root:root 0600` (systemd reads it before dropping privileges); nothing secret lives in the repo |
| A compromised game process | Dedicated user, no capabilities, `NoNewPrivileges`, `ProtectSystem=strict`, no writable paths, private `/tmp` and devices, syscall filter, memory and file-descriptor caps |

Decisions:

- The service worker does not bundle zod. Its config is our own build output (validated by the plugin
  at build time and guarded again at runtime, failing closed), and its only message comes from same-origin
  pages that can already run code on the origin. A hand-written exact-shape check keeps `sw.js` small.
- No `clients.claim()`: a first install takes control from the next navigation, so a page never switches
  workers under its feet.
- Network-first for HTML instead of stale-while-revalidate: a returning player always gets the newest page
  when online, and the cached page when not.
- Navigation preload is enabled when supported, so network-first does not wait for the worker to boot.

## Scalability

- Static files are served by nginx with long-lived caching for hashed assets (`immutable`) and
  revalidation for HTML, the manifest and `sw.js`; returning players load the shell from their cache.
- The service worker adds no server load beyond one conditional `sw.js` request per navigation and per hour.
- The game server sits behind one upstream with keepalive; moving to several processes (scaling lane) is an
  `upstream` change plus sticky routing per room, noted in `docs/deploy.md`.

## Test plan

- `test/pwa/cachePolicy.test.ts`: routing for every request class including abuse cases (cross-origin,
  API, matchmake, server path, query strings, `Range`, non-GET, odd URLs), cache naming and cleanup,
  response cacheability (status, type, redirects, content type), message parsing.
- `test/pwa/swRuntime.test.ts`: the real handlers against an in-memory cache and fetch: atomic precache,
  failed installs, the HTML integrity check, cache-first assets, runtime cache bounds, network-first with
  offline and timeout fallbacks, navigation preload, bypassed requests, activate cleanup, skip-waiting.
- `test/pwa/register.test.ts`: no-op in dev, e2e and insecure contexts; registration options; update
  detection for waiting and newly installed workers; one reload only for the tab that asked; hourly checks.
- `test/pwa/updatePrompt.test.ts` (happy-dom): the banner's text, buttons, keyboard access and single instance.
- `test/pwa/plugin.test.ts`: fixture builds through the plugin: `sw.js` is one IIFE with the injected
  config, the shell list, the HTML links, version stability and change, manifest and icon validation, caps.
- `test/pwa/build.test.ts`: the real client build through the real `vite.config.ts`: `sw.js`, the manifest,
  the icons and `_headers` (`/sw.js` no-cache, `worker-src 'self'`).
- `test/pwa/deploy.test.ts`: nginx files are well formed (braces, statements, known directives), every
  location that adds headers repeats the security headers, the nginx CSP equals `csp.ts` for the same-origin
  build, `X-Real-IP` is overwritten and never appended; the systemd unit has the required hardening; the env
  template lists every server variable and parses with the real `loadConfig`.
- `test/pwa/offline.e2e.ts`: headless Brave against `vite preview` of a production build: registers `/sw.js`
  under the real CSP, checks the caches, goes offline (server stopped and context offline) and still shows
  the menu, proves API paths are not intercepted, then walks the update flow (new build waits, skip-waiting
  swaps, old caches deleted), with zero console errors or CSP violations.
