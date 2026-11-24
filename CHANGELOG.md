# Changelog

Nothing here has been committed yet; this records what the working tree contains.

## 24 November 2026

### Bigger, richer island maps
- Lightning Reef and Watchtower Peaks are grown 1.5× (48 × 42 tiles), about the Citadel's walkable size, with the
  same rooms, bridges, relays and partition rules.
- Reef: a pilastered Pearl Vault, a taller lighthouse, a canopied signing pavilion, fishers' huts, market stalls,
  parasols, drying nets, shell paths between bridges, a compass mosaic on Lagoon Square, shells and starfish.
- Peaks: alpine chalets and a herders' cabin replace the beach huts; a buttressed Ice Vault, a crenellated tower,
  cairns, woodpiles, pine stands, flagstone paths and a paved council ring on Summit Square.
- Lobby: one row of Academy, Explore and Wardrobe tiles; sound, music, graphics and streamer mode tuck behind a
  Settings button. `npm run dev:islands` serves a local copy with every island open on ports 5181 and 2568.

## 23 November 2026

### Explorer preview
- Add `?explore=all` to the client URL to open every finished island, its card and Chronicle chapters, and the Beach
  Town visit button for visual review. Preview mode does not alter rank, stars, rewards or server-side progression.
- Move the archipelago out of the crowded main menu into a full-size Map view. Its menu button and progress bar show
  how many islands remain, while the larger layout keeps island labels and the selected island card easy to scan.
- Finished islands now have an Explore action. Mint Island, Signing Isle, Council Isle, Watchtower Peaks and Lightning
  Reef open as local walkable visual previews with distinct landmarks; Beach Town keeps its full multiplayer scene.
- Each walkable island now has a local objective: prepare an ecash batch, reach a signing threshold, cast a council
  ballot, repair both relays, or open a Lightning route. Glowing markers, `E` interaction and HUD progress make the
  environments playable without changing rank, rewards or server state.

### Every island finished
- **Watchtower Peaks** has its own match map: floating mountain tops, rope bridges, pines and drifting mist. A partition
  takes down the bridges between the west and east ranges (server movement, client prediction and bot paths all follow),
  and each range holds one relay. `npm run peaks` plays it in a browser and watches a bot cut the network.
- **Academy levels for Signing Isle, Council Isle and Watchtower Peaks** (8 to 13), with four new drills: thresholds,
  the one-third rule, council evidence and network splits. Levels now open with their island. `npm run academy` reads
  each drill off the screen and answers it.
- **Seal Book tabs per island**: Signing Isle, Council Isle and Watchtower Peaks (existing seals regrouped; ids unchanged),
  with new chains and rewards: the Signet Robe, Verdict Shades and Alpine Robe, and the titles Pillar of the Mint and
  Peak Warden.
- **Codex**: new pages on threshold signatures and network partitions; the circular-economies page no longer calls Beach
  Town a later update.
- Fixed: Byzantine practice bots never sabotaged, because the readiness message that arrives as a match starts was wiped
  when the bot noticed the start.
- The lobby map picker lists all three maps; bots on the Peaks pick the relay on their own side of the cut.

### Lightning Reef
- A second match map: seven sandy islets in a lagoon, joined by plank bridges, with the Pearl Vault, a lighthouse, a
  signing pavilion, coral and a moored boat. Light pulses run along the bridges like payments through channels. The
  same rules apply everywhere through a shared arena definition (map, rooms, stations, spawns, relays, council seal).
- Hard gateway routes on the reef: the working route has 5 sats to spare at most, and the decoys fall just short.
- Private lobbies have a map picker. The reef is offered once anyone in the room has opened it (checked server-side
  from their profile); quick match stays on the Citadel. Bots follow the lobby to the reef and play there.
- Reef place names in quick chat, prompts and task panels; a Lightning Reef Seal Book tab with six seals, two titles,
  the Pearl Diver Goggles and the Reef Board; the Codex lesson on Lightning gateways explains the tighter channels.
- Tests: arena geometry for every map, server arena rules and a reef match, bots on the reef, and `npm run reef`
  (a browser walks the bridges to the Gateway Harbour).

### Smoother music
- Players can choose Adaptive music or pin any of the game themes from the new persistent Music selector; choosing Off
  silences music without muting effects.
- The music is composed bar by bar in `apps/client/src/audio/composer.ts`. Chords change by voice leading. The melody is
  a gliding legato voice in two-bar phrases that move by step and end on a chord tone. Arpeggios roll under it, played
  on electric-piano keys (a soft guitar at the beach).
- Softer instruments: swelling triangle pads, a round bass, a soft pulse instead of kicks and hi-hats, and a separate
  long, darker reverb for music. Mood changes crossfade over a few seconds.
- Fixed: the plucked-string feedback loop could ring up to infinity, because low-pass Q is in dB in Web Audio. That
  turned all sound to silence until a reload, and it affected the plucked sound effects too.
- Tests for scale, voice leading and phrasing in every mood. All ten moods and all twenty effects were recorded in
  headless Brave: no clipping, no clicks, no NaN.

: site, installable app, deploy
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
