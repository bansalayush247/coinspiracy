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
| Signing Isle | Rank 2 or 3 stars | Signing ceremonies, audits, chapter 2 |
| Council Isle | Rank 4 or 6 stars | Councils and rotation, chapter 3 |
| Watchtower Peaks | Rank 6 or 9 stars | Partitions and freezes, chapter 4 |
| Lightning Reef | Rank 8 or 12 stars | Academy levels 6–7 (Reef Currents, Gateway Rush), chapter 5 |
| Beach Town | Rank 3 or 4 stars | The hub (below); chapter 6 at Rank 10, the epilogue at Rank 12 |
| Event islands | while an event is live | Appear on the map with the event's story; a match during the event earns its hidden seal |

Beach Town opens early on purpose: it is where play sats are spent, so new players find a reason to earn them.

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
