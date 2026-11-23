# Changelog

Nothing here has been committed yet; this records what the working tree contains.

## 23 November 2026

### Milestone 6: site, installable app, deploy
- The client is an installable app: a hand-written service worker with a versioned offline shell, an update banner
  that never reloads mid-match, per-path cache headers and `worker-src 'self'` (`npm run offline`).
- The Astro site in `apps/site`: landing page, nine sourced Codex lessons, share cards, sitemap, strict CSP, and
  dist and browser checks (`npm run verify -w @byzantine-council/site`).
- Production config in `deploy/` (nginx, hardened systemd unit, env template, daily database backups) and
  `docs/deploy.md`, with tests that keep the headers in sync with the code.

### Milestone 7: bots, scaling, seasons
- Practice bots the host adds from the lobby. They play every rule: tasks, signing on evidence, votes, quick chat,
  councils, relays, and for Byzantines forging and sabotage.
- Redis-backed presence, room listing and per-network limits (local by default); a load test with results.
- Seasonal events (halvings, Genesis Day, Pizza Day and more) on the menu banner, as event islands on the map, and
  as bunting and confetti on the plaza.

### Milestone 8: islands and Beach Town
- Beach Town: a shared hub with seven stalls and shopkeepers, paid with the notes in your wallet (change reissued),
  a wardrobe with a live portrait, courier jobs with server-checked walks, a daily cap and a seal chain, emotes,
  townsfolk, a sailboat, and light that follows the visitor's clock.
- Your own beach hut (the home plot) beside the Coconut Stand: a thatched hut on stilts with a pennant for each item
  you own. Its porch opens the wardrobe and rereads the Chronicle. The browser test walks there along a real path.
- Lightning Reef: two new Academy levels. Every island on the map can now be opened.

### Milestone 9 (started): reaching more players
- First-time tips, achievement cards, share cards, streamer mode, a graphics quality setting that defaults to Low on
  small devices, and phone layout fixes.

### Look, sound and story
- A painted world: textured stone, planks, grass and water, soft shadows, ambient occlusion and craggy cliffs.
- Physics-based effects for every action (tasks, wax seals, freezes, partitions, councils, fireworks, footsteps),
  wind-swayed trees, flocking birds, rain with splashes, thunder delayed by the speed of sound, rainbows, meteors,
  and day light that turns to dusk through a match. Each phenomenon explains itself once with a short note.
- Procedural music per place and act, plus synthesized sound effects (Karplus-Strong strings, FM bells).
- The Chronicle of Concordia: an original illustrated story in eight parts that opens with the islands.
- Guardians wear the hats, eyewear and robe trims they own; worn looks sync into matches and Beach Town.

### Security review fixes
- A finished match no longer resets the Beach Town courier daily cap (it could be farmed with solo bot matches).
  A regression test covers it.
- One network can seat at most one room's worth of bots (8) across its lobbies, so nobody can take the whole pool.
- A courier payment that fails in the store now says so and gives the parcel back for a retry. An already-spent
  job key is reported as paid, never retried. Look refreshes in town are paced to once every 10 seconds.

### Fixes
- On phones, the joystick layer no longer covers Beach Town's buttons, and dialogs sit above in-world HUDs.
  `npm run beach:phone` now runs the Beach Town visit on a 390 px touch screen.
- Academy Codex links now use the site's real slugs.
- A cookie package conflict that broke the Astro build is resolved.
