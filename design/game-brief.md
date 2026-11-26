# Game Brief: Byzantine Council

## In your words
"I want to develop a game like farming simulation games for bitcoin/ecash related what can I build,"
Then: "no need of farming"; isometric 2.5D; idea "#1 Byzantine Council".
"you know my vision, right I want game like GTA VI, Minecraft open world game where user can do anything"
"we can add fighting, crime / we should think about how realistic as it is / we need to think about storyline also, we can use story around all the real world cases happen like someone kidnapped and stole bitcoin, girlfriend thrown bitcoin hardware wallet similar to that"
"okay keep teen rating"
"character can only see as much as real human can see or you have seen in GTA game like that"

**Pitch:** An isometric harbour city you explore with friends, where a federated mint of play-money ecash stays honest only if you catch the hidden Byzantine guardians, told through a noir story built on real Bitcoin cases. *(inferred (strong))*

**Genre:** Social deduction plus a co-op open-world story. *(inferred (strong))*

**Controls:** WASD or arrow keys to move (virtual joystick on phones), E to work a spot, Space to read on, number keys to choose a line.

**Question:** Does keeping a federation honest feel like play, not a lesson, for a crew of friends? *(inferred (strong))*

**Hooks:** Hidden Byzantine guardians and threshold signing (`f < n/3`); story acts "ripped from the ledger" of real Bitcoin events, retold with invented people. *(inferred (strong))*

**Intent:** needs N players — the council match is 5–9 (you said: social deduction, co-op federation play); story acts take a crew of 1–4.

## Look and references
- Look: low-poly, flat-shaded isometric city in golden-hour light; night acts go dark with torch cones; every figure drawn in code, never emoji. *(inferred (strong))*
- References: GTA VI (open city, free roam, line of sight), Minecraft (an open world where you can do anything).
- View: 2.5D · Camera: fixed isometric angle with zoom; buildings fade when they hide the player.

## First minute
A guest opens the menu, picks the first story tile, and stands on a Low Tide street at night. A phone call sets up the act, the first choice is timed, and the player walks to the first marker under the city's real line of sight; the first catch by a torch shows the rules.

## Challenge
Stealth and timing from the first act (torches, chases, a tide clock, escorts), deduction in the council match, and later acts that remember earlier choices. Losing a catch costs a walk back, never progress.

## Core loop
- Play a council match or a story act with friends.
- Earn play sats, ranks and seals; spend them on cosmetics.
- Unlock the next act or case, and learn the real concept behind it.

## Goal & fail state
Council: honest guardians fill the Consensus bar or rotate out every Byzantine; Byzantines win by getting a forged proposal signed or reaching a third of the guardians. Story: finish the act; a session feels complete at the end card and its lesson.

## Features
- [x] Council match: roles, threshold signing, council votes, partitions and sabotage, 5–9 players
- [x] Port Concord: nine districts, human line of sight, traffic, cars, street fights in rough districts, the Mint vault
- [x] "The Cold Key" season one (four acts and the signing ceremony) and season two (four acts), co-op crews of four
- [x] Casebook: six side cases
- [x] Progression: ranks, Seal Book, quests, Academy drills, cosmetics bought with play sats
- [x] Codex site, PWA and deploy config
- [ ] Season three: privacy (act one, The Dust, in progress)

## Your systems
- open world · in the slice
- fighting · in the slice
- crime · in the slice
- storyline from real cases · in the slice
- human line of sight · in the slice
- farming · later

## Keep
-

## Avoid
- farming ("no need of farming")
- anything past a teen rating: no blood, no realistic guns, nobody seriously hurt ("okay keep teen rating")
- real money: play sats only *(inferred (strong))*

## Out of scope
- real sats, custody or withdrawals
- farming
- localization, Discord Activities and web portals (later)

## Build order
1. Season three act one, The Dust: tailing a courier unseen.
2. The rest of season three (privacy: blind signatures and beyond).
3. Real players in the city hub before more vehicles or building.
4. The mass-audience pass: localization, streamer mode, portals.

---
**Kill condition:** if crews skip the story scenes instead of reading them. *(guessed)*

**Who it's for / what they feel:** friends in a browser who want to feel clever together, and leave understanding how a federation stays safe. *(inferred (strong))*

**Games you love / don't:** Love GTA VI (open city, free roam), Minecraft (do anything).

Details: [docs/world.md](../docs/world.md) (the city and every act), [docs/progression.md](../docs/progression.md), [CHANGELOG.md](../CHANGELOG.md).
