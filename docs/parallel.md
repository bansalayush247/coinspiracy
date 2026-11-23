# Parallel milestone work: lanes, ownership and rules

Seven lanes build milestones M3–M8 at the same time in one working tree. A later run adds two more: `progression` and `growth`. The folder is not a git repository, so isolation comes from file ownership: a lane edits only the files it owns. Anything else is wired in by one integration pass after the lanes finish.

## Lanes

| Lane | Milestone | Scope |
|---|---|---|
| `core` | M3 finish + M4 | Finish roles/tasks/consensus, then signing ceremonies, council meetings and voting, chat, Byzantine sabotage |
| `economy` | shared core for M5 + M8 | Cosmetics catalogue and ecash wallet rules in `@byzantine-council/shared/economy` (runs first, then hands over to `profiles` and `hub`) |
| `profiles` | M5 | Anonymous guest identity, Postgres persistence (Drizzle), play-sat rewards, cosmetics shop and wardrobe, stats rollups, retention |
| `site` | M6 | Astro landing page and Codex learn pages, OG cards, sitemap |
| `pwa-deploy` | M6 | Client PWA (manifest, icons, service worker), nginx/systemd deploy config and deploy guide |
| `bots` | M7 | Tile pathfinding and practice bots that play through the real protocol |
| `scaling` | M7 | Redis presence/driver, shared rate limits, load test, seasonal events |
| `hub` | M8 | Beach Town: hub room, map, shops paid in ecash notes, courier jobs, hub client |
| `progression` | motivation | Guardian Rank, the Seal Book (achievement tree), quests, the Epoch Road and the solo Academy, per `docs/progression.md` |
| `growth` | reach | Research and a mass-audience plan in `docs/growth.md` (no code) |

## File ownership

Only the owner edits a file. Everyone may read everything. Never use Write on a file you do not own, and never delete or move another lane's files.

| Owner | Files |
|---|---|
| `core` | `packages/shared/src/**` except `economy/**`, `hub/**`, `progression/**`, `pathfinding.ts`, `seasons.ts`; `packages/shared/test/**` except those modules' tests; `apps/server/src/{CitadelRoom,match,inputQueue,roomCodes,chain,policy}.ts` and new `apps/server/src/match/**`; existing `apps/server/test/*.ts` (incl. `helpers.ts`) and new top-level server tests; `apps/client/src/**` except `profile/**`, `cosmetics/**`, `hub/**`, `pwa/**`, `progression/**`, `academy/**`; `apps/client/test/*.test.ts` (top level); `apps/client/index.html`, `apps/client/src/style.css`; `e2e/smoke.ts`, `e2e/tsconfig.json`; `README.md` |
| `economy` → `profiles` | `packages/shared/src/economy/**`, `packages/shared/test/economy/**` |
| `profiles` | `apps/server/src/{profile,db}/**`, `apps/server/drizzle/**`, `apps/server/drizzle.config.ts`, `apps/server/test/profile/**`; `apps/client/src/{profile,cosmetics}/**`, `apps/client/test/profile/**`, `apps/client/lab/**` |
| `site` | `apps/site/**` (deps are fixed; scripts and config are the lane's), `eslint.config.js` (only ignores/overrides for `apps/site`) |
| `pwa-deploy` | `apps/client/src/pwa/**`, `apps/client/test/pwa/**`, `apps/client/public/{manifest.webmanifest,icons/**}`, `apps/client/vite.config.ts`, `apps/client/csp.ts`, `deploy/**`, `docs/deploy.md` |
| `bots` | `packages/shared/src/pathfinding.ts`, `packages/shared/test/pathfinding.test.ts`, `apps/server/src/bots/**`, `apps/server/test/bots/**` |
| `scaling` | `packages/shared/src/seasons.ts`, `packages/shared/test/seasons.test.ts`, `apps/server/src/scaling/**`, `apps/server/test/scaling/**`, `scripts/loadtest/**` |
| `hub` | `packages/shared/src/hub/**`, `packages/shared/test/hub/**`, `apps/server/src/hub/**`, `apps/server/test/hub/**`, `apps/client/src/hub/**`, `apps/client/test/hub/**`, `apps/client/hub.html`, `apps/client/vite.hub.config.ts`, `e2e/hub-smoke.ts` |
| `progression` | `packages/shared/src/progression/**`, `packages/shared/test/progression/**`, `apps/server/src/academy/**`, `apps/server/test/academy/**`, `apps/client/src/{progression,academy}/**`, `apps/client/test/{progression,academy}/**`, `apps/client/lab-progression/**`, `apps/client/lab-academy/**`, `docs/lanes/academy.md`. The spec `docs/progression.md` is the orchestrator's; the lane only appends to its "Decisions" section. |
| `growth` | `docs/growth.md` |
| every lane | its own `docs/lanes/<lane>.md` and `.scratch/<lane>/` |

Frozen until integration (nobody edits): `apps/server/src/{app,index,config,httpGate,clientIp,logger,rateLimit}.ts`, every `package.json` except `apps/site/package.json` scripts, `package-lock.json`, existing `tsconfig*.json` files, `apps/*/vitest.config.ts`, `packages/shared/src/index.ts` is `core`'s (other lanes export through their own subpath: `@byzantine-council/shared/economy`, `/hub`, `/pathfinding`, `/seasons`, `/progression`).

When a lane needs a change in a file it does not own, it does not make it. It records the exact change under "Integration" in its `docs/lanes/<lane>.md` and in its final report, and shapes its own code so the change is a small wiring step (an exported `install…`/`register…`/`create…` function).

## Ports

Never bind 2567, 5180 or 5199 (dev servers and the user's port). Stop everything you start.

| Lane | Ports |
|---|---|
| `core` | server tests 3861–3869 and 3880–3889; smoke 3871–3874 |
| `profiles` | 3890–3899 |
| `bots` | 3900–3909 |
| `hub` | 3910–3919 tests, 3920–3921 hub e2e |
| `site` | 3930–3939 |
| `pwa-deploy` | 3940–3949 |
| `scaling` | 3950–3959 |
| `progression` | 3960–3969 |

## Commands

- Typecheck: `npx tsc -p packages/shared/tsconfig.json --noEmit`, `npx tsc -p apps/server/tsconfig.json --noEmit`, `npx tsc -p apps/client/tsconfig.app.json --noEmit`, `npx tsc -p apps/client/tsconfig.node.json --noEmit`, `npx tsc -p e2e/tsconfig.json --noEmit`. Other lanes' half-written files can show errors: fix only yours.
- Tests: `npx vitest run --root packages/shared <paths>`, `npx vitest run --root apps/server <paths>`, `npx vitest run --root apps/client <paths>`. Run your own tests, not the whole repo. Under parallel load a timing test can flake: rerun once before calling it real.
- Lint: `npx eslint <your paths>`.
- Smoke (core only): `npm run smoke`.
- Dependencies are installed and fixed. Do not run `npm install`/`uninstall`/`update`. Record anything missing under "Dependencies needed".

## Conventions every lane follows

- TypeScript strict, ESLint strictTypeChecked, Vitest, zod 4 at every trust boundary, ESM with `.js` import suffixes, the `source` export condition.
- One-line code comments only; rationale goes in the lane doc.
- Production-grade and security-first: server-authoritative; every untrusted input validated; bounded memory, rates and sizes; fail closed; least privilege; no secrets in code; secrets from env.
- Hidden information never leaves the server except through StateView tags (one bit per secret, never default-tag view fields) or a targeted `client.send`. Never log or send `state.toJSON()`.
- Logs never contain IP addresses, nicknames or tokens.
- Privacy: no personal data; no end user is ever identifiable; stored data has retention and rollups.
- Client: strict CSP (no inline script or style, no eval), text only through `textContent`, DOM built with `el()`/`h()` from `apps/client/src/ui/dom.ts`.
- Family-friendly and non-violent; original design; hub districts and shops use original names, never real businesses; play money only.
- Headless Brave for browser checks: `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser` via `playwright-core`.
- Never `git init`, commit or push.
