# Lane `site` (M6 part 1): public website and Codex

Status: done (23 Nov 2026). The Integration and Verification sections at the end are the hand-off.

## Scope

A static Astro 7 site in `apps/site`:

1. **Landing page** (`/`): what the game is, how a match plays, the four stations with screenshots, how to win,
   the Codex, a real FAQ, and Play buttons that go to `PUBLIC_PLAY_URL`.
2. **Codex index** (`/codex/`) and nine learn pages (`/codex/<slug>/`), each tied to a game mechanic and citing
   primary sources:

   | Slug | Topic | Game mechanic |
   |---|---|---|
   | `byzantine-fault-tolerance` | Byzantine fault tolerance and the generals problem | Hidden Byzantine guardians, the council |
   | `one-third-rule` | Why f < n/3 and the signing threshold | Role counts, `t = n - f`, the halt rule |
   | `federations-and-guardians` | Federations and Fedimint guardians | You play a guardian of the Mint Citadel |
   | `ecash-blind-signatures` | Ecash and blind signatures | Deposit Gate: split, blind, sign, unblind |
   | `power-of-two-notes` | Power-of-two notes | Deposit Gate note buttons 64…1 |
   | `double-spending` | Double-spending and the spent-note ledger | Ledger Archive: bad seal, spent serial |
   | `lightning-gateways` | Lightning gateways and route liquidity | Gateway Dock: route with enough liquidity |
   | `block-height-consensus` | How a federation agrees on the block height | Watchtower: median of seven reports; live HUD height |
   | `circular-economies` | Circular Bitcoin economies (El Zonte's Bitcoin Beach) | Beach Town hub (play-sat shops and jobs) |

3. **SEO**: unique titles and descriptions, canonical URLs from `SITE_URL`, Open Graph and Twitter cards, JSON-LD
   (`WebSite`, `VideoGame`, `Article` with `citation`, `BreadcrumbList`, `CollectionPage`, `FAQPage` only where the
   page shows that FAQ), `@astrojs/sitemap` with per-page `lastmod`, `robots.txt`, a `404` page, one `h1` per page.
4. **OG cards**: `scripts/render-og.ts` renders branded 1200×630 PNGs with headless Brave into `public/og/`. The PNGs
   are committed, so `astro build` never needs a browser.
5. **Screenshots**: `scripts/render-screens.ts` turns the e2e PNGs into resized WebP files in `public/screens/` (Brave's
   canvas encoder; no extra dependency).
6. **Security headers** for static hosting in `public/_headers`, a matching `<meta>` CSP in production HTML, no
   third-party requests of any kind, system fonts, and an off-by-default analytics placeholder.

Out of scope: the game client and its headers (core, pwa-deploy), nginx (pwa-deploy), the recap screen's links (core).

## Files (all under `apps/site`, owned by this lane)

| File | What it is |
|---|---|
| `package.json` | Scripts only: `dev` (3930), `build`, `preview` (3931), `typecheck` (`astro check`), `test`, `og`, `screens`, `check:dist`, `check:browser`, `verify` |
| `astro.config.ts` | Static output, `trailingSlash: 'always'`, `build.inlineStylesheets: 'never'`, sitemap with `lastmod`, the `siteConfig()` integration, ports |
| `tsconfig.json` | Extends `astro/tsconfigs/strictest` |
| `src/config/env.ts` | zod parsing of `SITE_URL`, `PUBLIC_PLAY_URL`, `PUBLIC_ANALYTICS_SRC` (pure, unit-tested) |
| `src/config/integration.ts` | `siteConfig()`: sets `site`, requires `SITE_URL` for builds, validates the public variables before anything renders |
| `src/lib/*.ts` | Site constants, SEO helpers, JSON-LD builders and safe serializer, the CSP, federation tables |
| `src/data/pages.ts` | The page registry: titles, descriptions, dates, sources, FAQs, related pages, game ties |
| `src/data/screens.ts` | Screenshot catalogue: file names, sizes, alt text |
| `src/components/*.astro`, `src/layouts/*.astro`, `src/pages/**` | The site |
| `src/styles/site.css` | Golden-hour palette and glass panels from `apps/client/src/style.css`, long-form typography |
| `public/_headers`, `public/favicon.svg`, `public/apple-touch-icon.png`, `public/og/*.png`, `public/screens/*.webp` | Static files |
| `scripts/render-og.ts`, `scripts/render-screens.ts` | Asset renderers (headless Brave) |
| `scripts/check-dist.ts` | Link, SEO and CSP checks over `dist/` (optional `--external` to fetch outbound links) |
| `scripts/serve-dist.ts`, `scripts/browser-check.ts` | Serve `dist/` with the real `_headers` and screenshot pages in Brave, failing on console errors, CSP violations or failed requests |
| `test/*.test.ts` | Vitest unit tests |
| `eslint.config.js` (root) | Only an ignore for `apps/site/.astro/**` |

## Configuration

| Variable | Default | Rules |
|---|---|---|
| `SITE_URL` | `http://127.0.0.1:3930` in dev, preview and sync. **Required for `astro build`.** | Origin only (no path, query, fragment or credentials). `https:`; `http:` only for loopback hosts. |
| `PUBLIC_PLAY_URL` | dev: `http://127.0.0.1:5180/`; build: `https://play.<SITE_URL host without www.>/`, matching the README's `play.example.com` layout | `https:` URL, `http:` only for loopback, or a same-origin path starting with one `/`. No credentials, no `javascript:`/`data:`, no `//host`, no backslashes or whitespace, at most 512 characters. |
| `PUBLIC_ANALYTICS_SRC` | unset (off) | Only a same-origin path to a `.js` file. When set, one deferred `<script>` loads it. |

Every value is parsed once in `siteConfig()` at startup; an invalid value stops `dev`, `build` and `check` with the
variable name and the rule it broke (the value itself is not echoed).

## Contracts and integration seams

- **Stable URLs** (for the recap screen's "Learn more" cards and anywhere else): `<SITE_URL>/codex/<slug>/` for the
  slugs above, `<SITE_URL>/codex/` and `<SITE_URL>/`. Suggested mapping for core's recap:
  - win reasons: `forgedProposalPassed` and `federationHalted` → `one-third-rule`; `allByzantineRotatedOut` →
    `byzantine-fault-tolerance`; `consensusReached` → `federations-and-guardians`;
  - tasks: `deposit` → `ecash-blind-signatures` (and `power-of-two-notes`), `ledger` → `double-spending`,
    `route` → `lightning-gateways`, `watchtower` → `block-height-consensus`.
- **Headers**: `public/_headers` is the policy for static hosts that read it (Netlify, Cloudflare Pages). nginx does not
  read it, so the deploy config must send the same headers (see Integration).
- **Build output**: `apps/site/dist/` is plain static files: `index.html`, `codex/**/index.html`, `404.html`,
  `robots.txt`, `sitemap-index.xml`, `sitemap-0.xml`, `_headers`, `_astro/*` (hashed CSS), `og/`, `screens/`.

## Design

- Palette and glass from the game (`--glass`, `--edge`, `--gold`, `--cta`, `--honest`, `--byz`, the sky gradient),
  dark plum page background, system UI font. Body text 17–18 px, line height ≈1.7, measure ≈68 characters.
- Mobile first; works at 390 px with no horizontal scrolling. Header collapses to logo, Codex and Play.
- Accessibility: skip link, landmarks, one `h1`, ordered headings, visible focus rings, underlined body links,
  `aria-current` in nav, tables with captions and header cells, alt text on every screenshot, reduced motion respected,
  contrast ≥ 4.5:1 for all text.
- No client JavaScript. Diagrams are HTML lists, tables and inline SVG with presentation attributes only.

## Threat model and mitigations

| Threat | Mitigation |
|---|---|
| XSS through content or config | All text goes through Astro's escaping; the only raw HTML is JSON-LD, serialized with `<`, `>`, `&`, U+2028 and U+2029 escaped; no user input exists at runtime |
| Script or style injection if a file is tampered with or a dependency adds inline code | CSP `default-src 'none'`, `script-src 'self'`, `style-src 'self'`, no `unsafe-inline`/`unsafe-eval`; `build.inlineStylesheets: 'never'`; `check-dist` fails the build check on any inline script (other than JSON-LD), `<style>`, `style=` or `on*=` attribute |
| Clickjacking | `frame-ancestors 'none'` and `X-Frame-Options: DENY` |
| A malicious or mistyped `PUBLIC_PLAY_URL` (`javascript:`, `//evil`, credentials) | zod allowlist of `https:` URLs, loopback `http:` and single-slash paths; the build stops on anything else |
| Wrong canonical URLs in production | `SITE_URL` is required for builds and must be a bare origin; `check-dist` asserts every canonical, `og:url`, sitemap and robots URL starts with it |
| Third-party tracking or supply-chain scripts | No third-party requests at all (fonts, scripts, images); CSP blocks them; analytics is off by default and can only be a same-origin script |
| Leaking visitors' browsing to linked sites | `Referrer-Policy: no-referrer` header and `<meta name="referrer">` |
| MIME sniffing | `X-Content-Type-Options: nosniff` |
| Path traversal in scripts | Output file names come from a slug allowlist (`^[a-z0-9-]+$`); `serve-dist.ts` resolves inside `dist/` only and binds loopback |
| Inaccurate teaching content | Every claim is sourced on the page; numbers come from primary sources or are derived from stated formulas; the federation tables are cross-checked against the game's own rule functions in a test |
| Personal data | None collected: no cookies, no forms, no accounts, no analytics by default; screenshots use test names only |

## Scalability

Static files only: any CDN or nginx serves them. Hashed CSS under `/_astro/` is cached for a year (`immutable`); HTML
revalidates. Pages ship no JavaScript, one small stylesheet and lazy-loaded WebP screenshots with explicit sizes. New
Codex pages are one registry entry, one `.astro` file and one `npm run og`.

## Test plan

- `test/env.test.ts`: every variable's defaults and abuse cases (`javascript:`, `data:`, `//host`, backslashes,
  credentials, paths with `..`, overlong values, whitespace, non-loopback `http:`, paths and queries in `SITE_URL`).
- `test/jsonld.test.ts`: escaping of `</script>` and line separators; builder output shapes.
- `test/pages.test.ts`: unique titles (≤ 60) and descriptions (70–160), slug format, `https:` sources, unique source
  ids, related pages exist, every entry has a page file and a 1200×630 OG PNG, every FAQ is non-empty.
- `test/rules.test.ts`: the Codex tables equal `maxFaulty`, `threshold` and `isHalted` from `packages/shared`.
- `test/headers.test.ts`: `_headers` parses, has every required header, its CSP has no `unsafe-*` and matches the
  meta CSP plus `frame-ancestors`.
- `test/checks.test.ts` (happy-dom): the `check-dist` rules on small HTML fixtures (inline script, style attribute,
  handler attribute, broken fragment, missing canonical).
- `test/og.test.ts`: card HTML escapes titles; output names reject traversal.
- `scripts/check-dist.ts` after `astro build`; `scripts/browser-check.ts` with Brave at 1366 px and 390 px.

## Integration

- `astro.config.ts` turns off `compressHTML` (it dropped the space between a line break and an inline element) and
  aliases `cookie` to Astro's own 2.x copy, because the copy hoisted to the repo root is express's CommonJS 0.7.
- Scripts set `ASTRO_TELEMETRY_DISABLED=1`, so builds never send usage data.
- `scripts/serve-dist.ts` from the plan became part of `scripts/browser-check.ts`, which serves `dist/` with the
  `_headers` rules (HSTS and `upgrade-insecure-requests` removed because it serves plain http on loopback).
- nginx must send the `public/_headers` policy itself; `deploy/` does that (M6c).
- The recap screen's "Learn more" links can use the slug mapping above.

## Verification

Run on 23 Nov 2026 with `SITE_URL=https://byzantinecouncil.example`:

- `npm run typecheck -w @byzantine-council/site`: 0 errors, 0 warnings (45 files).
- `npm test -w @byzantine-council/site`: 52 tests in 6 files.
- `npm run build`: 12 pages, sitemap, robots.txt; no inline script other than JSON-LD, no `<style>`, no `style=`.
- `npm run check:dist`: every page passes the CSP, SEO, link, fragment and sitemap checks.
- `npm run check:browser`: every page at 1366 px and 390 px in headless Brave, with no console errors, CSP violations,
  failed requests or sideways scrolling.
