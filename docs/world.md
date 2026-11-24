# The world: an archipelago that opens island by island

Agreed with the user on 2026-11-22. This is the spine of progression: the main menu is a world map of floating islands. You start on one island. The others sit in fog with their outlines visible, so the next goal is always in sight.

## Islands

| # | Island | What it opens | Concept it teaches |
|---|---|---|---|
| 1 | Mint Island (start) | The Citadel map: four tasks, the Consensus bar | Ecash notes, blind signatures |
| 2 | Signing Isle | Signing ceremonies, forged withdrawals | Threshold signatures |
| 3 | Council Isle | Council meetings, voting, rotating a guardian out | The 1/3 rule (BFT) |
| 4 | Lightning Reef | A dock map variant, harder routing | Lightning payments |
| 5 | Watchtower Peaks | Partitions: bridges between areas break and must be repaired | Network partitions |
| 6 | Beach Town | The social hub: shops, home plot, courier jobs | Spending ecash |
| ★ | Event islands | Appear around the halving, Pizza Day, Genesis Day and Whitepaper Day, and return every year | Bitcoin history |

## Every island has the same five parts

1. Three or four solo Academy levels with stars.
2. One new match rule or map.
3. A tab in the Seal Book.
4. Cosmetics themed on the island.
5. A Codex page about the real concept.

## How islands open

- **Two routes, so nobody has to grind.** An island opens when the player earns enough Academy stars on the previous island, or reaches a Guardian Rank. Solo learners take the first route, social players the second.
- **Locks never split friends.** If anyone in a private room has opened an island, the whole room can play it. Inviting a friend to an island you opened is a reason to invite them.
- **New players meet one idea at a time.** Quick-match for low ranks uses only the rules a player has opened: tasks first, then signing, then councils, then partitions. Everyone in a match plays the same rules.
- **No edge in a match.** Islands unlock content, maps and looks, never power. Play money only; nothing is for sale.

## Match pacing: three acts on the block clock

| Act | What happens |
|---|---|
| Calm | Tasks only. Players spread out and learn who is where. |
| Proposals | Withdrawal proposals start to appear. Signing decisions build suspicion. |
| Final blocks | A countdown. A missed signature or a partition can decide the match. |

## What each island has today (23 Nov 2026)

| Island | Opens at | Built |
|---|---|---|
| Mint Island | start | The citadel match, Academy levels 1–5, Chronicle prologue and chapter 1 |
| Signing Isle | Rank 2 or 3 stars | Signing ceremonies, audits, Academy levels 8–9 (Threshold Hall, Audit Desk), a Seal Book tab, the Signet Robe, the threshold-signatures Codex page, chapter 2 |
| Council Isle | Rank 4 or 6 stars | Councils and rotation, Academy levels 10–11 (One-Third Rule, Council Evidence), a Seal Book tab, the Verdict Shades, chapter 3 |
| Watchtower Peaks | Rank 6 or 9 stars | Its own match map (mountain tops on rope bridges; a partition cuts the bridges between the ranges), Academy levels 12–13 (Split Network, Night Watch), a Seal Book tab, the Alpine Robe, the network-partitions Codex page, chapter 4 |
| Lightning Reef | Rank 8 or 12 stars | Its own match map (islets, plank bridges, tight Gateway Harbour routes), Academy levels 6–7 (Reef Currents, Gateway Rush), a Seal Book tab, Pearl Diver Goggles and the Reef Board, chapter 5 |
| Beach Town | Rank 3 or 4 stars | The hub (below); chapter 6 at Rank 10, the epilogue at Rank 12 |
| Event islands | while an event is live | Appear on the map with the event's story; a match during the event earns its hidden seal |

Beach Town opens early on purpose: it is where play sats are spent, so new players find a reason to earn them.

### The island Academy

- Every Academy level belongs to an island and opens with it (by rank or stars); after that, an island's levels open one
  after another. A level once cleared stays open.
- Drills beyond the four stations (`packages/shared/src/drills.ts`): **threshold** (how many signatures n guardians need),
  **quorum** (how many honest guardians can be wrongly rotated out before Byzantines are a third), **council** (rotate out
  the guardian the evidence proves, or skip), and **partition** (which side of a split can still sign). Answers derive
  from the challenge, and the server checks them with the same minimum-time rule as station drills.

### Watchtower Peaks

- **Arena.** Mountain tops over the clouds joined by rope bridges. The west range (Summit Square, the Ice Vault, the
  Signing Lodge, the Deposit Pass) and the east range (the Ledger Crag, the Watchtower Summit, the Gateway Ridge) meet
  only on three bridges.
- **Rule.** While a partition lasts, those three bridges are down: movement on the server, prediction on the client and
  bot paths all use the cut map, and anyone on a bridge steps back to the nearest ledge. Each range holds one relay, so a
  repair needs a guardian on each side.

### Lightning Reef

- **Arena.** A second match map, `packages/shared/src/arena.ts`. It has the same seven rooms and four stations as the
  Citadel, so every rule works unchanged. Its geography is seven sandy islets in a lagoon joined by eight plank bridges:
  Lagoon Square in the middle, the Pearl Vault, the Tide Ledger, the Lighthouse, the Signing Pavilion, the Deposit Pier
  and the Gateway Harbour. The two relays sit at opposite ends of the reef.
- **Harder routing.** Gateway payments on the reef leave thin margins. The working route clears the amount by 5 sats at
  most, and every other route falls short by 8 sats at most.
- **Who can play it.** The host of a private lobby picks the map. Lightning Reef is offered when anyone in the room has
  opened the island, which the server checks from their profile (locks never split friends). If that guest leaves
  before the match starts, the lobby goes back to the Citadel. Quick-match rooms always play the Citadel.
- **Seal Book.** A Lightning Reef tab with two chains: matches finished on the reef (Reef Walker, Tidekeeper, Reef
  Warden) and payments routed at its harbour (Thin Margins, Channel Hopper, Channel Master). They reward the Pearl Diver
  Goggles and the Reef Board.

### Beach Town

- A public hub room (`beach`, up to 16 guardians) on its own map: sand, a lagoon with a pier, seven stalls with
  shopkeepers, palms, umbrellas and a sailboat. Movement is server-checked exactly as in matches.
- **Shops** sell the economy catalogue. A purchase is paid with notes the guardian picks from their wallet; the shared
  wallet rules refuse underpaying and handing over an unneeded note, and the mint reissues change.
- **Wardrobe**: worn hats, eyewear and robe trims show on the guardian in Beach Town and in matches.
- **Courier jobs**: take a parcel at one counter, carry it to another. The server pays only after a walk no faster than
  a guardian can move, once per job (idempotency key), at most 12 paid deliveries a day.
- **Emotes**: six friendly emotes, paced per guardian; no free text.
- **Home plot**: a hut beside the Coconut Stand that every guardian sees as their own, drawn client-side from their
  profile with a pennant per owned item. Its porch opens the wardrobe and the Chronicle. It holds no new server state.

## The Chronicle of Concordia

An original story in eight parts (`apps/client/src/story/chapters.ts`), told as an illustrated book from the island
cards. Each chapter opens with its island and ties its plot to that island's idea: the Old Mint that sank with a
single keeper; the Hollow Seal forging notes; many hands on Signing Isle; the one-third law; storms that split the
network; the Lightning Reef's currents; the town that pays in light; and the Old Mint rising again with many keepers.

## Build order

1. M4 finishes the core rules (signing, councils, partitions, three acts). Islands 2, 3 and 5 depend on these.
2. M5: world map v1, with Mint Island and Signing Isle open and the rest visible but locked. Also progression (`docs/progression.md`) and guest profiles.
3. Later milestones add Beach Town, Lightning Reef, Watchtower Peaks and the event islands.

## Port Concord (open city)

The open-world direction (story bible "The Cold Key") turns the archipelago into one harbour city. Milestone 1 is
the city itself: `packages/shared/src/city/` builds the map deterministically (districts, roads every 16 tiles,
river, harbour, boardwalk, landmarks) and defines interest management; `apps/server/src/city/CityRoom.ts` is one
region room of up to 60 players with server-checked movement and per-player views; `apps/client/src/city/` streams
chunks and draws buildings by district.

The city is rated Teen: cartoon fights, no blood or realistic guns, and real cases retold only as invented events.

Milestone 2 is street fights (`packages/shared/src/city/combat.ts`):
- Fights only work in the rough districts: Low Tide, the Reef Docks, Gullmoor and the Shallows. Everywhere else,
  including the Saltmarket spawn, is safe.
- The client only sends "punch"; the server picks the nearest guardian it can legally hit (in reach, awake, not
  shielded, both on rough streets). Four punches knock someone out for 3 seconds; they wake at home with full health
  and an 8-second shield, which also covers new arrivals. Health comes back after 6 quiet seconds.
- A knockout drops only the coins in the guardian's pocket as a pile anyone can pick up. Leaving within 10 seconds of
  being hit drops it too. Loose coins (5 to 25) turn up on rough streets only, at most 30 at a time.
- The pocket is session cash and only its owner is sent the amount. Vaulted money (the profile wallet) is untouched;
  carrying coins to the Mint vault is milestone 3.

Milestone 3 is the Mint vault (`packages/shared/src/city/vault.ts`):
- A gold ring marks the street at the Mint Hall's front door, in the safe Mint district, and on the minimap. Standing
  within 2.5 tiles of the hall shows "Vault my pocket" (E).
- The server empties the pocket first, then credits the profile wallet in one atomic profile change with a fresh
  idempotency key, so the same coins can never be paid twice. Whatever does not fit goes back in the pocket.
- At most 300 play sats a UTC day go into the vault (the `vault` daily counter), because loose coins are new money.
- Guests without a saved profile keep their coins in the pocket.
- Coins carry the ₿ mark (piles and the pocket HUD), drawn as shapes rather than a font glyph. They stay play sats.

Act one of "The Cold Key", The Dump, is the first story mission (`packages/shared/src/city/dump.ts`, `script.ts`,
`mission.ts`; server `apps/server/src/city/MissionRoom.ts`):
- "The Dump" on the menu opens a private, solo `mission` room on the Port Concord map at night. Mr Pell calls,
  Rook finds Dani at St Brigid's Hospital, talks past Mags at the Gullmoor gatehouse, digs the tip while Ivor patrols
  with a torch and Duncan the dog roams, finds the wallet crushed, and gets the twelve words from Dani on paper.
- Scenes are data: nodes of lines, choices (some on a clock, where silence is an answer), and marks that characters
  remember and later lines depend on. `scriptProblems` checks every link, clock and hand-back in the tests.
- Clues live in the talk: answering Dani calmly or staying silent gives "winter 2013"; paying Mags double says
  which winter heap was already dug; a bluff lets Duncan out at once. Wrong heaps turn up junk (and Rook's guitar).
- The server walks the script, times every clock, checks digs by reach and stillness, catches players in the torch
  cone (heaps block it) or by Duncan, and keeps which heap holds the device to itself. The first finish pays 250 play
  sats once per profile; replays save what the characters remember without paying again.
- Buildings between the camera and your guardian fade, in the open city as well as in the story.

Next: co-op story instances (friends join by code), then act two, The Ransom Call.
