# Progression: why players come back

Design for the `progression` lane, 2026-11-22. It binds that lane. The numbers are first-pass constants kept in one file, so a balance change is a one-line edit.

## Goals

1. Every match ends with visible progress, and the next reward is always in view ("120 XP to Rank 6: Note Keeper robe").
2. A player on their own can start right away. A match needs 5 people, so the Academy gives solo levels with stars.
3. Rewards teach. Most seals and quests are about the stations, signing and the council, and each one links to a Codex page.
4. Fair and healthy:
   - no real money and no paid randomness;
   - nothing that gives an edge in a match;
   - no streak penalties, and nothing is lost for good if you miss it;
   - hidden roles stay hidden.

## Loops

| Time scale | What pulls players back | System |
|---|---|---|
| One match | XP lines, rank bar, seals and quests on the result screen | Rewards panel |
| One session | Up to 3 quests held at once, plus a first-match-of-the-day bonus | Quests |
| Two weeks | A free 10-tier road that resets every Bitcoin difficulty epoch (2,016 blocks) | Epoch Road |
| Long term | Guardian Rank 1–50 with a reward at every rank, then stars. 58 seals in a tree. Cosmetics. | Rank Road, Seal Book |
| First visit, solo | 5 Academy levels, each scored out of 3 stars | Academy |

## Guardian Rank

- XP never goes down.
- XP to the next rank: `xpToNext(r) = min(100 + 25·(r − 1), 600)` for r = 1…49. Rank 50 needs 24,150 XP in total.
- After rank 50 a player earns one star per 1,000 XP. Stars are for display only and cap at 999.
- Pacing targets:

  | Rank | Reached after about |
  |---|---|
  | 2 | the first match |
  | 5 | 4 matches |
  | 10 | 14 matches |
  | 20 | 50 matches |
  | 50 | 190 matches, roughly 40 hours |

- Rank titles: 1 Apprentice, 5 Note Keeper, 10 Signer, 15 Keyholder, 20 Guardian, 30 Council Elder, 40 Archon, 50 Genesis Guardian.
- Rank Road: every rank-up pays 100 play sats. Some ranks also unlock a frame or a cosmetic:

| Rank | Unlock |
|---|---|
| 2 | Copper frame |
| 5 | Note Keeper robe `outfit:keeper` |
| 10 | Silver frame, Signer cap `hat:signer` |
| 15 | Keyholder shades `shades:keyholder` |
| 20 | Gold frame, Guardian board `board:guardian` |
| 30 | Sapphire frame, Elder robe `outfit:elder` |
| 40 | Aurora frame, Archon hat `hat:archon` |
| 50 | Genesis frame, Genesis board `board:genesis` |

The new cosmetics are colourways of existing shapes, so they need no new art code. The integration pass adds them to the economy catalogue as reward items.

## Match XP

The server computes XP when the match ends, from its own match record (`MatchFacts` and `PlayerFacts` below). It never awards XP during a match, because a reward popup could reveal a role.

**Eligibility.** A player earns XP only if all three hold. Otherwise they get 0 XP and no counter changes, and the panel shows the reason.
- They are seated at the end (rejoining after a disconnect counts).
- They were not removed for being AFK.
- They were active: walked at least 10 tiles or took at least 1 action.

| Line | XP | Max per match |
|---|---|---|
| Finished the match | 40 | 1 |
| Your side won (same for both sides) | 60 | 1 |
| Task completed (honest, or a Byzantine cover task) | 8 | 4 |
| Honest: signed a legitimate withdrawal | 5 | 3 |
| Honest: refused a forged withdrawal | 15 | 3 |
| Honest: voted for a Byzantine in a council | 15 | 3 |
| Helped repair a partition | 10 | 2 |
| Byzantine: an honest signature landed on a forged withdrawal you backed | 5 | 3 |
| Byzantine: an honest guardian was rotated out | 15 | 2 |
| Byzantine: your partition ran out the timer | 10 | 2 |
| First finished match of the UTC day (match at least 2 minutes long) | 50 | 1 |

**Match sats.** A match also pays play sats equal to half its match XP after every cap below, so the same caps hold for sats.

These rules apply in this order:

1. **Duration factor.** Multiply the subtotal of every line except the daily bonus by `clamp(durationMs, 75 000, 300 000) / 300 000`. Use integer math and floor the result. A match of 5 minutes or more counts in full; one of 75 seconds or less counts a quarter.
2. **Per-match cap.** At most 300 XP, before the daily bonus.
3. **Daily soft cap.** Match XP beyond 1,500 in one UTC day counts at 25%.
4. **Practice matches** (any bot in the match):
   - XP counts at 50%, with at most 300 practice XP a day;
   - only the task counters move;
   - quests don't progress.
5. **Role parity.** Expected XP for a typical honest match and a typical Byzantine match must stay within 15% of each other. A simulation test enforces this.

## Counters

Each profile keeps lifetime counters. They are non-negative safe integers, and one match adds only a bounded amount:

| Group | Counters |
|---|---|
| Matches | `matchesFinished`, `bigMatches` (7+ guardians), `fullMatches` (9 guardians), `privateMatches` (invite rooms) |
| Wins | `wins`, `honestWins`, `byzantineWins`, `consensusWins`, `rotationWins`, `haltWins`, `forgeWins` |
| Stations | `tasksDeposit`, `tasksLedger`, `tasksRoute`, `tasksWatchtower` |
| Signing, council and partitions | `legitSigned`, `forgedRefused`, `byzantineVotes`, `partitionsRepaired`, `misdirections` |
| Chain and calendar | `epochsPlayed`, `eventGenesisDay`, `eventPizzaDay`, `eventWhitepaperDay`, `eventHalving` |
| Academy | `academyClears`, `academyStars` |

## Seals: the achievement tree

The Seal Book works like an advancement tree: five tabs, each one a tree.
- A seal is earned as soon as its criterion holds, whether or not its parent is earned. The parent only decides whether the seal is visible.
- A hidden seal shows as "?" until someone earns it.
- Seals have three frames:

  | Frame | Reward |
  |---|---|
  | normal | 25 XP |
  | goal | 75 XP |
  | legend | 200 XP plus a title |

- A chain such as `deposit1 → deposit2 → deposit3` is three nodes; each node is the parent of the next.

**The Citadel**

| Seal | Parent | Criterion | Frame | Extra reward |
|---|---|---|---|---|
| `firstShift` | none | `matchesFinished ≥ 1` | goal | Genesis Robe (economy reward `firstMatch`) |
| `allStations` | firstShift | each station counter ≥ 1 | normal | |
| `deposit1` / `2` / `3` | firstShift | `tasksDeposit` ≥ 5 / 25 / 100 | normal / goal / legend | title Blind Signer |
| `ledger1` / `2` / `3` | firstShift | `tasksLedger` ≥ 5 / 25 / 100 | normal / goal / legend | title Double-Spend Detective |
| `route1` / `2` / `3` | firstShift | `tasksRoute` ≥ 5 / 25 / 100 | normal / goal / legend | title Pathfinder |
| `watch1` / `2` / `3` | firstShift | `tasksWatchtower` ≥ 5 / 25 / 100 | normal / goal / legend | title Watchkeeper |
| `veteran` | firstShift | `matchesFinished ≥ 10` | goal | Lightning Board (economy reward `veteran`) |
| `regular` | veteran | `matchesFinished ≥ 50` | goal | |
| `oldGuard` | regular | `matchesFinished ≥ 250` | legend | title Old Guard |

**The Council**

| Seal | Parent | Criterion | Frame | Extra reward |
|---|---|---|---|---|
| `firstSignature` | none | `legitSigned ≥ 1` | normal | |
| `threshold1` / `2` / `3` | firstSignature | `forgedRefused` ≥ 1 / 10 / 50 | normal / goal / legend | title Threshold Keeper |
| `keenEye1` / `2` / `3` | firstSignature | `byzantineVotes` ≥ 1 / 10 / 50 | normal / goal / legend | title Keen Eye |
| `mender1` / `2` / `3` | firstSignature | `partitionsRepaired` ≥ 1 / 10 / 50 | normal / goal / legend | title Bridge Builder |
| `honestWin` | firstSignature | `honestWins ≥ 1` | goal | Threshold Crown (economy reward `honestWin`) |
| `consensus1` / `2` / `3` | honestWin | `consensusWins` ≥ 1 / 10 / 50 | normal / goal / legend | title Consensus Builder |
| `sweep1` / `2` | honestWin | `rotationWins` ≥ 1 / 10 | normal / goal | |

**Byzantine Arts**

| Seal | Parent | Criterion | Frame | Extra reward |
|---|---|---|---|---|
| `undercover` | none | `byzantineWins ≥ 1` | goal | Partition Shades (economy reward `byzantineWin`) |
| `tongue1` / `2` / `3` | undercover | `forgeWins` ≥ 1 / 5 / 25 | normal / goal / legend | title Silver Tongue |
| `general1` / `2` / `3` | undercover | `haltWins` ≥ 1 / 5 / 25 | normal / goal / legend | title Byzantine General |
| `misdirect1` / `2` | undercover | `misdirections` ≥ 1 / 10 | normal / goal | |

**Chain & Seasons**

| Seal | Parent | Criterion | Frame | Extra reward |
|---|---|---|---|---|
| `epoch1` / `2` / `3` | none | `epochsPlayed` ≥ 1 / 3 / 12 | normal / goal / legend | title Timechain Regular |
| `genesisDay` (hidden) | epoch1 | `eventGenesisDay ≥ 1` (3 January) | goal | |
| `pizzaDay` (hidden) | epoch1 | `eventPizzaDay ≥ 1` (22 May) | goal | |
| `whitepaperDay` (hidden) | epoch1 | `eventWhitepaperDay ≥ 1` (31 October) | goal | |
| `halving` (hidden) | epoch1 | `eventHalving ≥ 1` | legend | title Halving Witness |
| `fullHouse` | epoch1 | `fullMatches ≥ 1` | normal | |
| `friends1` / `2` | epoch1 | `privateMatches` ≥ 1 / 10 | normal / goal | |

**Academy**

| Seal | Parent | Criterion | Frame | Extra reward |
|---|---|---|---|---|
| `academy1` | none | `academyClears ≥ 1` | normal | |
| `graduate` | academy1 | `academyClears ≥ 5` | goal | Scholar hood `hat:scholar` (new reward item) |
| `topOfClass` | graduate | `academyStars ≥ 15` | legend | title Scholar |

**Announcements.** When a match ends, each seal earned in it is announced in that room only, for example "Alice earned Threshold Keeper". Roles are public at that point. A player can turn their own announcements off.

### Beach Town tab (added 23 Nov 2026)

A sixth tab, **Beach Town**, holds the courier chain: First Parcel (1 delivery), Regular Runner (10) and Harbour
Runner (50, with the *Harbour Runner* title). It reads the append-only counter `courierDeliveries`, which a paid
delivery increments through `applyCourierDelivery()`; the seals pay their usual XP, so deliveries can rank a player
up. Unpaid deliveries (daily limit reached, no profile) count for nothing.

The Academy grew to seven levels (6 Reef Currents, 7 Gateway Rush). Stored star arrays saved with fewer levels are
padded with zeros when loaded, so adding levels never breaks a profile. *Graduate* now reads "Clear five Academy
levels" and *Top of the Class* "Earn 15 Academy stars"; their ids and targets are unchanged.

## Quests

- A player holds at most 3 quests. They never expire.
- A new profile starts with 3 starter quests: `academy1`, `tasks5`, `finish2`.
- After that, each UTC day offers one new quest if fewer than 3 are held.
- One free reroll per UTC day.
- Quests progress only from eligible non-practice matches, and from the Academy for the Academy quests.

Quest design rules:
- No quest rewards disruptive play: nothing like "call meetings", "vote someone out" or "get rotated out".
- No quest requires being dealt a particular role. A role-dependent quest like `refuse1` can still be done as the other side later, because quests never expire.

| Quest | Goal | Target | From rank | XP | Sats |
|---|---|---|---|---|---|
| `finish2` | Finish matches | 2 | 1 | 60 | 100 |
| `tasks5` | Complete tasks (any station) | 5 | 1 | 60 | 100 |
| `deposit3`, `ledger3`, `route3`, `watch3` | Complete tasks at one station | 3 | 1 | 60 | 120 |
| `win1` | Win a match | 1 | 1 | 80 | 150 |
| `big1` | Finish a match with 7+ guardians | 1 | 1 | 60 | 100 |
| `friends1` | Finish a match in an invite room | 1 | 1 | 80 | 150 |
| `academy1` | Clear an Academy level for the first time | 1 | 1 | 60 | 100 |
| `stars3` | Earn Academy stars | 3 | 1 | 60 | 100 |
| `sign2` | Sign legitimate withdrawals | 2 | 2 | 60 | 100 |
| `refuse1` | Refuse a forged withdrawal | 1 | 2 | 80 | 150 |
| `allFour` | Complete all four stations in one match | 1 | 2 | 100 | 200 |
| `vote1` | Vote for a Byzantine guardian in a council | 1 | 3 | 80 | 150 |
| `mend1` | Help repair a partition | 1 | 3 | 80 | 150 |

## Epoch Road

- `epoch = floor(blockHeight / 2016)`, using the server's chain tip, live or estimated. The stored epoch index never goes backwards, so a reorg or a jump between live and estimated height can't move it back.
- Epoch XP is all XP earned while the epoch is current: matches, seals, quests and the Academy. It resets to 0 the first time XP is awarded in a new epoch.
- Ten tiers. Tier k needs 200·k epoch XP, so 2,000 in total, or about 13 matches in two weeks.

| Tier | Reward |
|---|---|
| 1 | 100 sats |
| 2 | Epoch frame (or 150 sats if already owned) |
| 3 | 150 sats |
| 4 | 150 sats |
| 5 | 200 sats |
| 6 | 200 sats |
| 7 | 250 sats |
| 8 | 250 sats |
| 9 | 300 sats |
| 10 | Epoch hat |

The epoch hat is one of six colourways: `hat:epoch-amber`, `-teal`, `-violet`, `-coral`, `-lime`, `-frost`, picked by `epoch mod 6`. An epoch's hat returns in the Hats & Shades shop after that epoch ends, so missing an epoch never locks anyone out for good.

## Academy

Solo levels the server runs: it generates the challenges and checks the answers. Each level opens with a short concept card and ends with a recap that has a "Read more" link to the Codex.

| # | Level | Drills | Par | Teaches |
|---|---|---|---|---|
| 1 | Deposit Gate | 2 deposit | 45 s | Blind signatures, power-of-two notes |
| 2 | Ledger Archive | 2 ledger | 50 s | Double-spends, invalid signatures |
| 3 | Gateway Dock | 2 route | 40 s | Lightning routing, channel liquidity |
| 4 | Watchtower | 2 watchtower | 35 s | Block height, the median of reports, faulty nodes |
| 5 | Night Shift | One of each, shuffled | 120 s | Putting it together |

- **Stars.**

  | Stars | Condition |
  |---|---|
  | 1 | Cleared |
  | 2 | At most 1 mistake |
  | 3 | No mistakes and time ≤ par |

  Time is measured on the server, from the first drill sent to the last correct answer.
- **Unlocks.** Level n+1 unlocks when level n is cleared, and the server enforces this for players with a profile. A player without a profile can play every level, but nothing is saved.
- **Rewards.** First clear: 50 XP and 100 sats. First 3-star clear: 50 XP. Replays give no XP, but a replay can raise the best star count.
- **Later levels.** 6 Signing Ceremony, 7 Council, 8 Full Federation (with bots) arrive when M4 and the bots are integrated. Level ids are append-only.
- **Anti-cheat**, the same as tasks:
  - CSPRNG challenges generated on the server;
  - answers checked on the server;
  - each kind's minimum solve time;
  - 1,500 ms lockout after a wrong answer;
  - drills expire after 120 s;
  - a level times out after 10 minutes;
  - one level at a time;
  - message rate limits.

## Rule tiers (added 26 Nov 2026)

A council match has a lot of rules. A new guardian meets them a few at a time, in the order the islands teach them.
Tasks and councils are in every tier, so both sides can always win. The table is data:
`packages/shared/src/tuning/tiers.json`, checked by `TierTableSchema` (`packages/shared/src/tiers.ts`) and frozen at load.

| Tier | A player has it once | Tasks and councils | Signing ceremonies (withdrawals, sign or refuse, audits, liveness) | Forged withdrawals | Network cuts | Disconnects |
|---|---|---|---|---|---|---|
| Apprentice | always | yes | no | no | no | no |
| Journeyman | Signing Isle is open (Rank 2 or 3 Academy stars) | yes | yes | yes | no | no |
| Full council | Watchtower Peaks is open (Rank 6 or 9 stars) | yes | yes | yes | yes | yes |

- **Quick match** plays the lowest tier anyone seated has (a person, with a known profile). Bots and players without
  a profile do not count; with nobody known (profiles off) it plays the Full council, as before. Apprentice lasts one
  match and Journeyman about five, so a newcomer slows a mixed room only briefly.
- **Private lobbies** follow the same rule until the host picks a tier; the pick stays for the room. A story signing
  ceremony never plays below Journeyman, and its host cannot pick Apprentice.
- The tier is settled in the lobby and fixed when the match starts. The server enforces it: no withdrawal is filed
  without ceremonies, and signing, refusing, auditing, forging, cutting and disconnecting outside the tier are refused
  with `offTier` before anything else looks at them. Sabotage readiness is never sent in a tier without sabotage.
- **Win conditions per tier.** Apprentice ends on consensus, all Byzantines rotated out, a halt, or the last block.
  Journeyman adds a passed forgery and lost liveness. Full adds outages from cuts. `packages/shared/test/tiers.test.ts`
  plays every reason in every tier for 5–9 guardians with the shared rules, and checks that no other reason can occur.
- **Guardrail.** "Ranks never change match rules" is about advantage: a tier applies to everyone in the room alike,
  gives nobody an edge, and never reveals a role. Rank only decides which rules a newcomer has met.
- **Later.** Matchmaking could group quick-match players by tier; XP lines for ceremonies and sabotage simply do not
  occur in lower tiers, which the role-parity simulation should cover next.

## Screens

- **Rewards panel**, inside the result card after roles are revealed:
  - XP lines animate in, and the rank bar fills, possibly through several rank-ups;
  - unlocks show with "Wear it" when they're cosmetics;
  - seals earned, quest progress and Epoch Road progress;
  - a "next unlock" teaser;
  - the ineligibility reason when there is one;
  - with reduced motion, values appear at once.
- **Progress page**, with tabs Rank Road · Seals · Quests · Epoch Road · Academy:
  - the Seal Book is a tree on desktop and a collapsible list on phones;
  - every locked item says what you'll get and how to get it.
- **Lobby and hub.** Rosters show a rank badge, the chosen frame and the chosen title. In-match nameplates show the name only.
- **Toasts.** "Seal earned" and "Rank up" appear after the match, through an `aria-live` region.

## Contracts (`@byzantine-council/shared/progression`)

The module is pure and deterministic:
- randomness comes in as the `RandomSource` from `roles.ts`;
- time comes in as UTC milliseconds;
- inputs are never mutated;
- data is deeply frozen;
- all maths uses integers within safe-integer bounds.

Inputs from the server:
- `MatchFacts` (once per match):
  - `matchId`, `startedAtMs`, `endedAtMs`;
  - `players` (5–9) and `humans`;
  - `privateRoom`, `winner`, `reason`, `blockHeight`;
  - `events`: a subset of `halving`, `genesisDay`, `pizzaDay`, `whitepaperDay`, mapped at integration from `@byzantine-council/shared/seasons`.
- `PlayerFacts` (per player):
  - `role`, `finished`, `afkKicked`, `movedTiles`;
  - `tasks` per station;
  - `legitSigned`, `forgedRefused`, `forgedSigned`, `forgedSignaturesGathered`, `byzantineVotes`, `misdirections`;
  - `partitionsRepaired`, `partitionsRunOut`, `rotatedOut`.

State:
- `Progress` (stored per profile, versioned `v: 1`):
  - `xp`, `counters`, `seals`, `quests`;
  - `offerDay` and `rerollDay`;
  - `epoch {index, xp, tier}`;
  - `day {index, matchXp, practiceXp, firstBonus}`;
  - `lastEpochPlayed`;
  - `academy {level → {stars}}`;
  - `selectedTitle`, `selectedFrame`.
- `ProgressSchema` validates stored progress on every load.

Transitions:
- Each transition returns `{ progress, award }`, where `award` lists the XP lines, sats, items (economy reward ids), titles, frames, seals, rank-ups, quest changes and the epoch tier change.
- The transitions are `applyMatch`, `applyAcademyResult`, `offerDailyQuest`, `rerollQuest`, `selectTitle` and `selectFrame`.

Views and wire schemas, all bounded and strict:
- `toProgressView(progress)`;
- `MatchRewardsSchema` (the server's targeted `matchRewards` message);
- `ProgressViewSchema` (`GET /api/progress`);
- the Academy message payloads.

Stored ids are pinned by golden lists and never renamed: seals, quests, titles, frames, counters, levels.

## Persistence (integration, in the profiles database)

- One `progress` JSONB column on the profile row, validated by `ProgressSchema` on load and on save, and kept under 8 KB.
- Each award runs in the same transaction as the match's sats credit:
  - the row is locked with `SELECT … FOR UPDATE`;
  - the idempotency key is `match:<matchId>` (or `academy:<runId>`), so a retry or crash never pays twice.
- Dates are stored at day granularity.
- A profile's progress is deleted with the profile under the profiles retention policy.
- Aggregate stats only, such as the rank distribution per day, with no per-player history.

## Guardrails

- Play money only. No loot boxes, no paid tracks, no ads in rewards.
- Ranks, seals and titles never change match rules, roles or votes.
- Nothing is computed or shown before the match ends. No progress UI during a match.
- No streaks, no expiring quests, and no lost rewards for missing a day. Epoch items return to the shop.
- No global leaderboards: nicknames are chosen by players and could identify them, and the audience includes young players. Progress stays private to its owner unless they choose to show a title or frame.
- Copy is family-friendly and in plain words, and the names are original.

## Threat model

| Threat | Mitigation |
|---|---|
| Client claims rewards it didn't earn | The server computes all rewards from its own record; the client only displays them |
| Double award (retry, reconnect, crash) | Idempotency key per match and profile, in one transaction with a row lock |
| AFK or idle farming | Active gate; players removed for AFK and players who left get 0 |
| Fast or colluding matches | Duration factor, per-match cap, daily soft cap, equal win XP for both sides |
| Bot-practice farming | 50% XP, 300 XP a day, only task counters move, no quests |
| Academy farming | First-clear and first-3-star rewards only, once per level |
| Role leaks through rewards | Awards only after the end; no in-match XP, toasts or progress UI |
| Profile data leaks | Private by default; title and frame shown only by choice; no leaderboards; logs carry no ids |
| Malformed or hostile payloads | Strict, bounded zod schemas in both directions |
| Academy room abuse | Per-network room caps (integration), rate limits, expiry, bounded state, a 10-minute level limit |
| Clock or epoch tricks | Server clock and server chain tip only; the epoch index never goes backwards |

## Integration checklist (after the parallel lanes)

- **core**
  - `Match` exposes `PlayerFacts` and `MatchFacts`.
  - When the match ends, `CitadelRoom` runs one transaction: sats, then progress. It then sends `matchRewards` to each client and announces seals to the room.
  - Lobby `PlayerState` gets public `rank`, `frame` and `title` fields, set from the profile in the lobby only.
- **profiles**
  - The `progress` column and its migration.
  - Store methods.
  - `GET /api/progress`, plus `POST /api/progress/title`, `/frame` and `/quests/reroll`.
  - The Academy store.
- **economy**: reward ids and items for the Rank Road, the seals, the Epoch Road and the Scholar hood. Colourways only.
- **client**
  - Mount the rewards panel in the result card.
  - A Progress entry in the menu and lobby.
  - An Academy entry on the main menu ("Play solo").
  - Roster badges.
- **server**: `app.ts` defines the `academy` room with per-network caps.
- **seasons**: map event ids to progression's event ids.
- **hub**: show rank, title and frame on nameplates; add epoch hats to the shop after their epoch.
