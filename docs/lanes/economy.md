# Lane: economy

This is the shared economy core for M5 (profiles) and M8 (the Beach Town hub). It holds:

- the catalogue of cosmetics and food, priced in play sats
- wardrobe looks
- the ecash wallet rules

Everything is pure, browser-safe TypeScript plus zod, so the server and the client run the same
rules. The module has no I/O, no timers, no global mutable state and no logging.

Status: done. The API below is stable, so the `profiles` and `hub` lanes can build on it now.

Consumers import `@byzantine-council/shared/economy`. That subpath export already exists in
`packages/shared/package.json`. The root `@byzantine-council/shared` index belongs to `core`
and does not re-export this module.

## Scope and files

| File | What it holds |
|---|---|
| `packages/shared/src/economy/index.ts` | Re-exports `catalog.ts` and `wallet.ts` |
| `packages/shared/src/economy/catalog.ts` | Slots, shops, rewards, the item catalogue, lookups, zod schemas, `Look`, `DEFAULT_LOOK`, wardrobe and purchase checks |
| `packages/shared/src/economy/wallet.ts` | A wallet of power-of-two notes: build, validate, pay with chosen notes, suggest notes, credit, reissue, plus wire schemas |
| `packages/shared/test/economy/catalog.test.ts` | Catalogue data, golden ids, lookups, schemas, looks, ownership, purchases, hostile inputs |
| `packages/shared/test/economy/wallet.test.ts` | Wallet rules, every typed error, abuse inputs, seeded property tests with independent oracles |

The module reads these `core` files and never edits them: `packages/shared/src/{constants,notes,result}.ts`
(`MAX_NOTE_AMOUNT`, `MAX_NOTE_BITS`, `isDenomination`, `toDenominations`, `ok`, `err`, `Result`).

The item data comes from the approved Beach Town concept (`.scratch/concepts/beach-town.html`):
its OUTFITS, HAIR_COLORS, BOARDS and CATALOG sections, read as data only. Two concept items that
were booleans got real values, so later styles fit the same slot: `beard:trim` and
`shades:classic`. The four reward cosmetics are new and original.

## API

### Catalogue (`catalog.ts`)

| Export | Meaning |
|---|---|
| `COSMETIC_SLOTS` | `outfit` (robes), `hair`, `dye` (hair colour), `beard` (grooming), `hat`, `shades` (eyewear), `board` (surfboards) |
| `REQUIRED_SLOTS` / `OPTIONAL_SLOTS` | `outfit`, `hair` and `dye` always hold an item. `beard`, `hat`, `shades` and `board` may be `null` |
| `ITEM_CATEGORIES` | The seven slots plus `food` (consumable, never owned) |
| `CATEGORY_LABELS` | Section titles for shops and the wardrobe: Robes, Haircuts, Hair colour, Grooming, Hats, Eyewear, Boards, Menu |
| `SHOP_IDS`, `SHOPS`, `getShop(id)` | `tailor`, `barber`, `hats`, `surf`, `cafe`, `pupusa-stand`, `coconut-stand`, each with `name`, `sells` (one line) and `color` (sign colour) |
| `REWARD_IDS`, `REWARDS`, `rewardItem(reward)`, `VETERAN_MATCHES` | Match rewards. Each unlocks exactly one cosmetic. `REWARDS[i].hint` says how to earn it |
| `CATALOG` | Every item, deeply frozen, in shop order |
| `ITEM_IDS`, `COSMETIC_IDS`, `FOOD_IDS` | Frozen id lists |
| `getItem(id)` | `CatalogItem \| undefined` for any `unknown`. It uses a Map lookup, so prototype keys find nothing |
| `isItemId`, `isCosmeticId`, `isFoodId`, `isOwnable`, `isConsumable` | Type guards over `unknown`. `isOwnable` is true for cosmetics only |
| `categoryOf(id)`, `slotOf(id)`, `priceOf(id)`, `shopOf(id)` | Return `null` for unknown ids, or when the answer does not apply: `slotOf` of food, `priceOf` or `shopOf` of a reward item |
| `itemsInShop(shop)`, `itemsInCategory(category)` | Frozen lists in catalogue order |
| `DEFAULT_LOOK`, `DEFAULT_OWNED` | The starting look (Ocean Blue robe, hood up, natural dark hair) and the free items that every profile owns implicitly |
| `wear(look, id)`, `takeOff(look, slot)`, `lookItems(look)` | Pure wardrobe edits that return a new frozen look. `wear` and `takeOff` throw `RangeError` on anything the types forbid |
| `ownsItem(owned, id)` | True when the item is owned explicitly or is a free default. Never true for food or unknown ids |
| `checkLook(input, owned)` | `Result<Look, 'invalidLook' \| 'notOwned'>`, for a look that comes from a client or from storage |
| `checkPurchase(id, shop, owned)` | `Result<{ item, price }, 'unknownItem' \| 'notForSale' \| 'wrongShop' \| 'alreadyOwned'>`. An ok `price` is always at least 1 |
| `colorNumber(hex)` | Converts `'#5FA8FF'` to `0x5FA8FF` for Phaser |

Schemas:

- `CosmeticSlotSchema`, `OptionalSlotSchema`, `ItemCategorySchema`, `ShopIdSchema` and `RewardIdSchema`
- `ItemIdSchema`, `CosmeticIdSchema` and `FoodIdSchema`, each a `z.enum` of the known ids
- `LookSchema`: a strict object with exactly one key per slot. Each key is an enum of that slot's ids, and only the optional slots are nullable
- `OwnedCosmeticsSchema`: unique cosmetic ids, capped at the catalogue size

Types: `CosmeticSlot`, `RequiredSlot`, `OptionalSlot`, `ItemCategory`, `ShopId`, `RewardId`,
`ItemId`, `CosmeticId`, `FoodId`, `CosmeticIdIn<Slot>`, `CatalogItem`, `ItemSource`,
`RenderHints`, `ShopInfo`, `RewardInfo`, `Look`, `LookError`, `PurchaseError`, `PurchaseQuote`.
The ids are literal union types, so a typo such as `'outfit:bleu'` fails to compile.

An item has the shape `{ id, category, value, name, source, hints }`:

- `id` is the stable string `"<category>:<value>"`, for example `outfit:coral` or `food:coffee`.
  Profiles store these ids, so an id is never renamed or reused; new ids are only ever added. A
  test pins the full list in order.
- `source` is either `{ kind: 'shop', shop, price }` or `{ kind: 'reward', reward }`. Reward items
  are never for sale.
- `hints.swatch` is one `#RRGGBB` colour for shop and wardrobe buttons: the first palette colour,
  or a neutral `#FFF1DE` for items without colours of their own. `hints.colors` is the slot palette:

| Slot | `colors` |
|---|---|
| outfit | lit side, shaded side, hood or trim highlight |
| dye | the hair colour. Hair styles and beards are drawn in the worn dye colour |
| hat | main colour, then trim (the straw hat adds crown and band colours) |
| shades | lens, glint (Partition Shades: left lens, right lens) |
| board | deck, rim (Lightning Board: deck, bolt) |
| hair, beard, food | none |

Render rule from the concept: while `hair:hood` is worn, the hood hides the hair colour and the
beard. The concept's wardrobe switches to `hair:short` when a player who owns it puts on a dye or
a beard. That choice belongs to the client wardrobe, not to these rules, so any combination of
owned items is a valid `Look`.

### Catalogue contents

Prices follow the concept. Default items cost 0, and everyone owns them.

| Shop | Items (sats) |
|---|---|
| Tailor | Ocean Blue 0, Coral Reef 400, Palm Green 400, Sunset 350, Dusk Violet 500, Dune 300, Golden Hour 350, Hibiscus 450 |
| Barber | Hood up 0, Short crop 150, Buzz cut 100, Curls 250, Long waves 250, Braids 300, Surf mohawk 350, Beard trim 180, Natural dark 0, Chestnut 120, Sun-bleached 150, Coral dye 200, Ocean dye 200 |
| Hats & Shades | Straw hat 280, Surf cap 200, Bucket hat 240, Sunglasses 320 |
| Surf Shop | Lime board 900, Sunset board 950, Ocean board 900, Night wetsuit 600 |
| Lightning Café | Coffee 30 |
| Pupusa Stand | Pupusa 60 |
| Coconut Stand | Coconut 40 |

The match rewards are original and Bitcoin-flavoured, and they are never sold:

| Reward id | How it is earned (`hint`) | Item |
|---|---|---|
| `firstMatch` | Finish your first Council match | Genesis Robe (`outfit:genesis`), black with a gold trim, named after the genesis block |
| `honestWin` | Win a match as an honest guardian | Threshold Crown (`hat:threshold`), named after the signing threshold |
| `byzantineWin` | Win a match as a Byzantine guardian | Partition Shades (`shades:partition`), one violet and one teal lens, a split view |
| `veteran` | Finish `VETERAN_MATCHES` (10) Council matches | Lightning Board (`board:lightning`) |

### Wallet (`wallet.ts`)

A wallet is a list of ecash note amounts. Each note is a power of two from 1 to
`MAX_NOTE_AMOUNT` (2^20). A wallet holds at most `MAX_WALLET_NOTES` (64) notes and at most
`MAX_WALLET_BALANCE` (10,000,000) sats. Every wallet these functions return is a fresh array,
largest note first. Inputs may come in any order.

| Function | Returns |
|---|---|
| `validateWallet(input: unknown)` | `Result<Wallet, 'invalidWallet'>`, a sorted copy |
| `walletFromAmount(amount)` | `Result<Wallet, 'invalidAmount'>`, the fewest notes for 0 to `MAX_WALLET_BALANCE`: whole 2^20 notes, then `toDenominations` of the rest |
| `balanceOf(wallet)` | The sum. It throws `RangeError` on an invalid wallet, so validate untrusted data first |
| `payWithNotes(wallet, selected, price)` | `Result<Payment, PayError>`, where `Payment = { wallet, spent, change, reissued }` |
| `suggestNotes(wallet, price)` | `Result<Wallet, 'invalidWallet' \| 'invalidAmount' \| 'insufficientFunds'>` |
| `credit(wallet, amount)` | `Result<Credit, 'invalidWallet' \| 'invalidAmount' \| 'walletFull'>`, where `Credit = { wallet, received, reissued }` |
| `reissue(wallet)` | `Result<Wallet, 'invalidWallet'>`, the fewest notes for the same balance |

`PayError` is `'invalidWallet' | 'invalidAmount' | 'insufficientFunds' | 'invalidSelection' |
'notInWallet' | 'underpaid' | 'overpaid'`. The checks run in that order. `WalletError` is the
union of all the wallet errors.

Schemas:

- `NoteSchema`: one denomination.
- `WalletSchema`: at most 64 notes, within the balance cap.
- `NoteSelectionSchema`: 1 to 64 notes. Use it for a client's chosen notes.
- `PaymentSchema` and `CreditSchema`: strict wire shapes for a result sent to its owner. A client
  validates them before rendering.

Payment rules:

1. The wallet must be valid, and the price must be a safe integer from 1 to `MAX_WALLET_BALANCE`.
   Free items never go through a payment.
2. The wallet must hold at least the price (`insufficientFunds`).
3. The selection must have 1 to 64 denominations (`invalidSelection`). It must also be a
   sub-multiset of the wallet, counted per denomination (`notInWallet`).
4. The selection must cover the price (`underpaid`).
5. The selection must be minimal: no selected note can be dropped while still covering the price
   (`overpaid`). Checking the smallest note is enough: `sum - min(selected) < price`.
6. Change is `toDenominations(sum - price)`. Minimality keeps the change below the smallest
   selected note, so it is always below 2^20, a valid split of at most 20 notes.
7. The new wallet is the old one minus the selection plus the change. If that would exceed 64
   notes, the wallet is reissued as the fewest notes for its balance, and `reissued` is `true`.

`suggestNotes` picks, in this order:

1. Exact notes, when some subset sums to the price. Greedy largest-first is exact whenever any
   subset is, because each power of two divides every larger one.
2. Otherwise, the smallest single note that covers the price.
3. Otherwise, notes largest-first until the price is covered.

Every suggestion passes `payWithNotes`.

## Invariants (all tested)

- Value is conserved exactly:
  - A payment lowers the balance by exactly the price, and `sum(spent) - sum(change) = price`.
  - A credit raises the balance by exactly the amount.
  - A reissue keeps the balance.
- No function mutates its inputs. Each untrusted list is read once, element by element, into a
  private copy. Catalogue data is deeply frozen.
- Every returned wallet passes `validateWallet`. The fewest-notes form of any allowed balance has
  at most 28 notes, which is under half of `MAX_WALLET_NOTES`. A test derives this bound.
- A suggestion is always a valid, minimal payment. It is exact whenever an exact subset exists;
  a dynamic-programming oracle checks this on random small wallets.
- Item ids are unique, `category:value` shaped, and pinned by a golden list. Only defaults are
  free, and the defaults are exactly `DEFAULT_LOOK`. Every reward unlocks exactly one cosmetic,
  and reward items are not for sale. Food costs at least 1 sat and is sold only at food stands.

## How profiles and hub use it

### Profiles (M5)

- **Storage.** Store the wallet as a list of note amounts: at most 64 integers, each at most 2^20,
  so `integer[]` fits. Also store the owned cosmetic ids (`OwnedCosmeticsSchema`; the defaults
  stay implicit) and the current look.
- **Loading.** On every load, run `validateWallet`, `OwnedCosmeticsSchema` and
  `checkLook(look, owned)`. If any of them fails, stop and log only the profile id.
- **New profile.** Use `walletFromAmount(START_BALANCE)`, where profiles picks the amount, with
  owned `[]` and look `DEFAULT_LOOK`.
- **Play-sat rewards.** Pay them with `credit(wallet, amount)`. On `walletFull`, skip the payout;
  never clamp it. Grant reward cosmetics with `rewardItem(reward)`, using the `REWARDS` hints for
  the conditions.
- **Wardrobe messages.**
  - `{ item: CosmeticIdSchema }`: check `ownsItem`, then call `wear`.
  - `{ slot: OptionalSlotSchema }`: call `takeOff`.
  - A whole look: call `checkLook(input, owned)`.
- **Atomic updates.** Apply wallet changes to a freshly read wallet inside one transaction, with
  a row lock or a version column. Never reuse a wallet cached across an `await`, so two rooms
  cannot spend the same notes.

### Hub (M8)

- **Buying.** The buy message is `{ item: ItemIdSchema, notes: NoteSelectionSchema }`.
  1. The server takes the shop from the player's server-side position.
  2. It runs `checkPurchase(item, shop, owned)`.
  3. It runs `payWithNotes(wallet, notes, quote.price)`.
  4. It saves the wallet, plus the item unless the item is food, in one transaction.
  5. It sends the `Payment` to that player only.
  Food is consumed on the spot and never added to owned.
- **Choosing notes.** The client preselects `suggestNotes(wallet, price)` and lets the player
  change the selection. The server never trusts a client's price or wallet, only its note selection.
- **Income and reissue.** Courier pay and other income go through `credit`. The Beach Mint's
  reissue button calls `reissue`.
- **Shop data.** `SHOPS` gives names, "sells" lines and sign colours. Map positions, keeper lines
  and the Beach Mint building belong to the hub.
- **zod configuration.** zod 4.6 decides whether to JIT-compile an object schema when the schema
  is constructed. This module builds `LookSchema`, `PaymentSchema` and `CreditSchema` at import
  time. Any new browser entry, such as the hub's, must import the client's
  `zod-jitless.js` before anything that imports shared schemas, as `apps/client/src/main.ts`
  already does. Otherwise a strict CSP reports zod's `new Function` probe.

## Threat model

| Threat | Mitigation |
|---|---|
| Forged or malformed note selection from a client | `NoteSelectionSchema` at the message boundary, then `payWithNotes` checks again: a real array of 1 to 64 entries, each a denomination. Only safe integers pass; NaN, fractions, -0, strings, boxed numbers and holes are rejected |
| Spending notes the player does not hold | A per-denomination multiset check against the server-held wallet (`notInWallet`) |
| Minting value through rounding or overflow | Integers only. The 10M balance cap keeps every sum far below 2^53, and change stays below 2^20. Seeded property tests check conservation on about 10,000 random cases, including a reissue path |
| Overpaying by accident | The minimality rule (`overpaid`) |
| Getting items for free | Price-0 items are defaults that everyone already owns (`alreadyOwned`). Reward items return `notForSale`. An item sells only at its own shop (`wrongShop`). A free consumable would be refused as `notForSale` |
| Prototype or key tricks (`__proto__`, `constructor`) in ids or looks | `Map` lookups, `z.enum` ids, and strict objects that reject unknown keys, including a JSON `__proto__` member |
| Exotic arrays (proxies, changing lengths, getters) | `length` and each element are read once into a private copy before any check |
| Memory or CPU abuse | Every list is capped at 64 notes before any per-note work. Payment work is linear in 21 denomination buckets, and the catalogue has a fixed size |
| Corrupt stored wallet, owned list or look | All three are validated on load. A failure is a typed error (fail closed), never coerced |
| Wallet privacy | A wallet is private to its owner. Send it only with a targeted `client.send`, never in shared room state or logs |
| Double spend across rooms | Profiles applies each payment to a freshly read wallet inside one transaction (see above) |

Everything is play money; no real sats move. The module holds no personal data.

## Scalability

The functions are pure and allocate little, and a payment is O(64). Catalogue lookups are O(1)
through maps built once at import. Any number of rooms and processes can share the module.

## Test plan

- **Catalogue**:
  - golden id list
  - id shape and uniqueness
  - concept prices, with only the defaults free
  - one item per reward
  - shop and category partitions
  - `#RRGGBB` colours and per-slot palette sizes
  - deep freezing
  - lookups with 21 hostile strings and 13 non-strings
  - every schema with valid and invalid values
  - the exact `LookSchema` key set
  - looks: wear, take off, ownership
  - purchases: each error, and the ok path for every sold item
- **Wallet**:
  - fixed examples for each function and each typed error
  - abuse inputs: non-arrays, array-likes, typed arrays, holes, NaN, Infinity, fractions, -0,
    2^21, strings, bigints, boxed numbers, 65 notes, over the cap, a sparse 2^32 - 1 array, and
    proxies that change length or values between reads
  - frozen inputs are never mutated
  - seeded property tests:
    - conservation, minimality, the 64-note cap and reissue
    - random selections classified by an oracle written from the rule as stated
    - an exact-subset oracle for suggestions
    - credits against the cap
- **Mutation check**: 33 single-point mutations of the rules were run against the tests on a
  scratch copy (see Verification).

## Integration

The module works as it is. No file outside this lane needs to change.

| File | Change | Why |
|---|---|---|
| (none required) | | The `./economy` subpath export is already in `packages/shared/package.json` |
| `README.md` (core, optional) | Add a Layout row: `packages/shared/src/economy` — cosmetics catalogue, wardrobe looks and ecash wallet rules (`@byzantine-council/shared/economy`) | Makes the module easy to find |
| Hub lane's own client entry (`apps/client/hub.html` and its script, owned by `hub`) | Import the client's `zod-jitless.js` first, before anything that imports shared schemas | zod builds object schemas at import time (see Hub above) |

## Verification

Run from the repo root on 2026-11-22.

| Command | Result |
|---|---|
| `npx tsc -p packages/shared/tsconfig.json --noEmit` | exit 0 |
| `npx eslint packages/shared/src/economy packages/shared/test/economy` | exit 0, no findings |
| `npx vitest run --root packages/shared test/economy` | 2 files, 294 tests passed (run twice, deterministic seeds) |
| `npx tsc -p packages/shared/tsconfig.build.json --outDir .scratch/economy/build` | exit 0. Declarations emit for all three economy files (the build went to scratch and was deleted) |
| `npx tsc -p .scratch/economy/tsconfig.node.json` and `.scratch/economy/tsconfig.bundler.json` | exit 0. A scratch consumer imports `@byzantine-council/shared/economy` under the server (NodeNext) and client (Bundler) resolution, both with the `source` condition |
| `npx tsx --conditions=source .scratch/economy/consumer.ts` | Buys Coral Reef with a 512 note: change `[64, 32, 16]`, then a credit of 400 and the look update |
| `.scratch/economy/mutate.sh`, `mutate2.sh`, `mutate3.sh`, `mutate4.sh` (scratch copies only, never the live module) | 34 runs over 33 distinct mutations. 31 runs were killed; one of them was a malformed mutant, so its kill means nothing. 3 runs survived. One survivor found a real gap: an extra optional `LookSchema` key. A new key-set test fixed it, and that mutant was killed on re-run. The other 2 survivors are equivalent mutants: the food guard in `checkPurchase` (`ownsItem` already excludes food) and `sum > price` in the largest-first branch, which only runs when no subset is exact, so the sum never equals the price |
