// Cosmetics and food priced in play sats, wardrobe looks and purchase checks; item ids are stable storage keys.
import { z } from 'zod';
import { err, ok, type Result } from '../result.js';

export const COSMETIC_SLOTS = Object.freeze(['outfit', 'hair', 'dye', 'beard', 'hat', 'shades', 'board'] as const);
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

// Slots that always hold an item; the others can be empty.
export const REQUIRED_SLOTS = Object.freeze(['outfit', 'hair', 'dye'] as const satisfies readonly CosmeticSlot[]);
export const OPTIONAL_SLOTS = Object.freeze(['beard', 'hat', 'shades', 'board'] as const satisfies readonly CosmeticSlot[]);
export type RequiredSlot = (typeof REQUIRED_SLOTS)[number];
export type OptionalSlot = (typeof OPTIONAL_SLOTS)[number];

// Food is a consumable category, never a slot.
export const ITEM_CATEGORIES = Object.freeze([...COSMETIC_SLOTS, 'food'] as const);
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const CATEGORY_LABELS: Readonly<Record<ItemCategory, string>> = Object.freeze({
  outfit: 'Robes',
  hair: 'Haircuts',
  dye: 'Hair colour',
  beard: 'Grooming',
  hat: 'Hats',
  shades: 'Eyewear',
  board: 'Boards',
  food: 'Menu',
});

export const SHOP_IDS = Object.freeze(['tailor', 'barber', 'hats', 'surf', 'cafe', 'pupusa-stand', 'coconut-stand'] as const);
export type ShopId = (typeof SHOP_IDS)[number];

export interface ShopInfo {
  readonly id: ShopId;
  readonly name: string;
  readonly sells: string;
  // Sign colour, '#RRGGBB'.
  readonly color: string;
}

export const REWARD_IDS = Object.freeze([
  'firstMatch',
  'honestWin',
  'byzantineWin',
  'veteran',
  // Progression rewards (docs/progression.md): Rank Road, the Academy and the Epoch Road.
  'rank5',
  'rank10',
  'rank15',
  'rank20',
  'rank30',
  'rank40',
  'rank50',
  'graduate',
  'epochAmber',
  'epochTeal',
  'epochViolet',
  'epochCoral',
  'epochLime',
  'epochFrost',
] as const);
export type RewardId = (typeof REWARD_IDS)[number];

// Finished matches that earn the veteran reward.
export const VETERAN_MATCHES = 10;

export interface RewardInfo {
  readonly id: RewardId;
  readonly hint: string;
}

// A shop item at a fixed price, or a match reward that is never sold.
export type ItemSource =
  | { readonly kind: 'shop'; readonly shop: ShopId; readonly price: number }
  | { readonly kind: 'reward'; readonly reward: RewardId };

export interface RenderHints {
  // One '#RRGGBB' colour for shop and wardrobe buttons.
  readonly swatch: string;
  // Slot palette, documented per slot in docs/lanes/economy.md.
  readonly colors: readonly string[];
}

interface SpecBase {
  readonly id: `${ItemCategory}:${string}`;
  readonly name: string;
  readonly colors?: readonly string[];
  readonly swatch?: string;
}
type ItemSpec = SpecBase & ({ readonly shop: ShopId; readonly price: number } | { readonly reward: RewardId });

// Swatch for items drawn in the worn hair colour or without colours of their own.
const NEUTRAL_SWATCH = '#FFF1DE';

const ITEM_SPECS = [
  // Tailor robes: lit side, shaded side, highlight.
  { id: 'outfit:blue', name: 'Ocean Blue', shop: 'tailor', price: 0, colors: ['#5FA8FF', '#3567B8', '#9CCBFF'] },
  { id: 'outfit:coral', name: 'Coral Reef', shop: 'tailor', price: 400, colors: ['#FF7F6A', '#B84E4A', '#FFB0A0'] },
  { id: 'outfit:palm', name: 'Palm Green', shop: 'tailor', price: 400, colors: ['#6FBF73', '#3F8A4E', '#A8DDA0'] },
  { id: 'outfit:orange', name: 'Sunset', shop: 'tailor', price: 350, colors: ['#FFA45C', '#B8623A', '#FFC896'] },
  { id: 'outfit:violet', name: 'Dusk Violet', shop: 'tailor', price: 500, colors: ['#A983FF', '#6A4BB8', '#C9B0FF'] },
  { id: 'outfit:sand', name: 'Dune', shop: 'tailor', price: 300, colors: ['#E8C98E', '#A8875A', '#F5E2B8'] },
  { id: 'outfit:yellow', name: 'Golden Hour', shop: 'tailor', price: 350, colors: ['#FFD45C', '#B8903A', '#FFE79A'] },
  { id: 'outfit:pink', name: 'Hibiscus', shop: 'tailor', price: 450, colors: ['#FF86B8', '#B84E7E', '#FFB6D4'] },
  // Barber: hair styles and beards are drawn in the worn dye colour.
  { id: 'hair:hood', name: 'Hood up', shop: 'barber', price: 0 },
  { id: 'hair:short', name: 'Short crop', shop: 'barber', price: 150 },
  { id: 'hair:buzz', name: 'Buzz cut', shop: 'barber', price: 100 },
  { id: 'hair:curls', name: 'Curls', shop: 'barber', price: 250 },
  { id: 'hair:long', name: 'Long waves', shop: 'barber', price: 250 },
  { id: 'hair:braids', name: 'Braids', shop: 'barber', price: 300 },
  { id: 'hair:mohawk', name: 'Surf mohawk', shop: 'barber', price: 350 },
  { id: 'beard:trim', name: 'Beard trim', shop: 'barber', price: 180 },
  { id: 'dye:dark', name: 'Natural dark', shop: 'barber', price: 0, colors: ['#2B2028'] },
  { id: 'dye:chestnut', name: 'Chestnut', shop: 'barber', price: 120, colors: ['#7A4A2E'] },
  { id: 'dye:bleached', name: 'Sun-bleached', shop: 'barber', price: 150, colors: ['#F2D48A'] },
  { id: 'dye:coral', name: 'Coral dye', shop: 'barber', price: 200, colors: ['#FF86B8'] },
  { id: 'dye:ocean', name: 'Ocean dye', shop: 'barber', price: 200, colors: ['#5FA8FF'] },
  // Hats & Shades: hats are main then trim; shades are lens then glint.
  { id: 'hat:straw', name: 'Straw hat', shop: 'hats', price: 280, colors: ['#F2D48A', '#C9A25A', '#F6DFA0', '#E26E52'] },
  { id: 'hat:cap', name: 'Surf cap', shop: 'hats', price: 200, colors: ['#E26E52', '#B84E4A'] },
  { id: 'hat:bucket', name: 'Bucket hat', shop: 'hats', price: 240, colors: ['#3FA7B5', '#2E7F8A'] },
  { id: 'shades:classic', name: 'Sunglasses', shop: 'hats', price: 320, colors: ['#1A1020', '#7FD8FF'] },
  // Surf Shop: boards are deck then rim.
  { id: 'board:lime', name: 'Lime board', shop: 'surf', price: 900, colors: ['#B8E45C', '#FFF1DE'] },
  { id: 'board:sunset', name: 'Sunset board', shop: 'surf', price: 950, colors: ['#FF8A5C', '#FFF1DE'] },
  { id: 'board:ocean', name: 'Ocean board', shop: 'surf', price: 900, colors: ['#4FA7CF', '#FFF1DE'] },
  { id: 'outfit:night', name: 'Night wetsuit', shop: 'surf', price: 600, colors: ['#3E3A5C', '#24203A', '#6C66A0'] },
  // Food is eaten on the spot and never owned.
  { id: 'food:coffee', name: 'Coffee', shop: 'cafe', price: 30, swatch: '#8A5E44' },
  { id: 'food:pupusa', name: 'Pupusa', shop: 'pupusa-stand', price: 60, swatch: '#FFC896' },
  { id: 'food:coconut', name: 'Coconut', shop: 'coconut-stand', price: 40, swatch: '#A8DDA0' },
  // Match rewards, never sold.
  { id: 'outfit:genesis', name: 'Genesis Robe', reward: 'firstMatch', colors: ['#3A3348', '#221D2C', '#FFD27A'] },
  { id: 'hat:threshold', name: 'Threshold Crown', reward: 'honestWin', colors: ['#FFD27A', '#B8903A'] },
  { id: 'shades:partition', name: 'Partition Shades', reward: 'byzantineWin', colors: ['#6A4BB8', '#3FA7B5'] },
  { id: 'board:lightning', name: 'Lightning Board', reward: 'veteran', colors: ['#FFD45C', '#6A4BB8'] },
  // Progression rewards: colourways of existing shapes.
  { id: 'outfit:keeper', name: 'Note Keeper Robe', reward: 'rank5', colors: ['#E9DFC7', '#B9A985', '#7A5C3A'] },
  { id: 'hat:signer', name: 'Signer Cap', reward: 'rank10', colors: ['#5FD3B0', '#2E8A72'] },
  { id: 'shades:keyholder', name: 'Keyholder Shades', reward: 'rank15', colors: ['#FFD27A', '#FFF4DC'] },
  { id: 'board:guardian', name: 'Guardian Board', reward: 'rank20', colors: ['#5FA8FF', '#FFD27A'] },
  { id: 'outfit:elder', name: 'Elder Robe', reward: 'rank30', colors: ['#6A4BB8', '#3E2A78', '#FFD27A'] },
  { id: 'hat:archon', name: 'Archon Hat', reward: 'rank40', colors: ['#FF8A5C', '#FFD27A', '#FFF1DE', '#6A4BB8'] },
  { id: 'board:genesis', name: 'Genesis Board', reward: 'rank50', colors: ['#221D2C', '#FFD27A'] },
  { id: 'hat:scholar', name: 'Scholar Hood', reward: 'graduate', colors: ['#3FA7B5', '#FFD27A'] },
  { id: 'hat:epoch-amber', name: 'Amber Epoch Cap', reward: 'epochAmber', colors: ['#FFB347', '#B8742A'] },
  { id: 'hat:epoch-teal', name: 'Teal Epoch Cap', reward: 'epochTeal', colors: ['#3FC1B5', '#2E7F8A'] },
  { id: 'hat:epoch-violet', name: 'Violet Epoch Cap', reward: 'epochViolet', colors: ['#A983FF', '#6A4BB8'] },
  { id: 'hat:epoch-coral', name: 'Coral Epoch Cap', reward: 'epochCoral', colors: ['#FF7A6B', '#B84E4A'] },
  { id: 'hat:epoch-lime', name: 'Lime Epoch Cap', reward: 'epochLime', colors: ['#B8E45C', '#6E9A2E'] },
  { id: 'hat:epoch-frost', name: 'Frost Epoch Cap', reward: 'epochFrost', colors: ['#BFE8FF', '#6FA8CF'] },
] as const satisfies readonly ItemSpec[];

export type ItemId = (typeof ITEM_SPECS)[number]['id'];
export type FoodId = Extract<ItemId, `food:${string}`>;
export type CosmeticId = Exclude<ItemId, FoodId>;
export type CosmeticIdIn<S extends CosmeticSlot> = Extract<CosmeticId, `${S}:${string}`>;

export interface CatalogItem {
  readonly id: ItemId;
  readonly category: ItemCategory;
  // The part after the colon; renderers pick shapes by it.
  readonly value: string;
  readonly name: string;
  readonly source: ItemSource;
  readonly hints: RenderHints;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function buildItem(spec: ItemSpec & { readonly id: ItemId }): CatalogItem {
  const at = spec.id.indexOf(':');
  const prefix = spec.id.slice(0, at);
  const category = ITEM_CATEGORIES.find((c) => c === prefix);
  if (category === undefined) throw new Error(`item ${spec.id} has no category`);
  const source: ItemSource =
    'shop' in spec ? { kind: 'shop', shop: spec.shop, price: spec.price } : { kind: 'reward', reward: spec.reward };
  const colors = [...(spec.colors ?? [])];
  const swatch = spec.swatch ?? colors[0] ?? NEUTRAL_SWATCH;
  return deepFreeze({ id: spec.id, category, value: spec.id.slice(at + 1), name: spec.name, source, hints: { swatch, colors } });
}

export const SHOPS: readonly ShopInfo[] = deepFreeze([
  { id: 'tailor', name: 'Tailor', sells: 'Guardian robes in eight colours', color: '#A983FF' },
  { id: 'barber', name: 'Barber', sells: 'Haircuts, hair colour and beard trims', color: '#FF86B8' },
  { id: 'hats', name: 'Hats & Shades', sells: 'Straw hats, caps, bucket hats and sunglasses', color: '#5FD3B0' },
  { id: 'surf', name: 'Surf Shop', sells: 'Surfboards and a night wetsuit', color: '#3FA7B5' },
  { id: 'cafe', name: 'Lightning Café', sells: 'Coffee', color: '#7FD8FF' },
  { id: 'pupusa-stand', name: 'Pupusa Stand', sells: 'Pupusas fresh off the griddle', color: '#FF9A6A' },
  { id: 'coconut-stand', name: 'Coconut Stand', sells: 'Ice-cold coconuts', color: '#A8DDA0' },
]);

export const REWARDS: readonly RewardInfo[] = deepFreeze([
  { id: 'firstMatch', hint: 'Finish your first Council match.' },
  { id: 'honestWin', hint: 'Win a match as an honest guardian.' },
  { id: 'byzantineWin', hint: 'Win a match as a Byzantine guardian.' },
  { id: 'veteran', hint: `Finish ${VETERAN_MATCHES} Council matches.` },
  { id: 'rank5', hint: 'Reach Guardian Rank 5.' },
  { id: 'rank10', hint: 'Reach Guardian Rank 10.' },
  { id: 'rank15', hint: 'Reach Guardian Rank 15.' },
  { id: 'rank20', hint: 'Reach Guardian Rank 20.' },
  { id: 'rank30', hint: 'Reach Guardian Rank 30.' },
  { id: 'rank40', hint: 'Reach Guardian Rank 40.' },
  { id: 'rank50', hint: 'Reach Guardian Rank 50.' },
  { id: 'graduate', hint: 'Clear every Academy level.' },
  { id: 'epochAmber', hint: 'Finish the Epoch Road in an amber epoch.' },
  { id: 'epochTeal', hint: 'Finish the Epoch Road in a teal epoch.' },
  { id: 'epochViolet', hint: 'Finish the Epoch Road in a violet epoch.' },
  { id: 'epochCoral', hint: 'Finish the Epoch Road in a coral epoch.' },
  { id: 'epochLime', hint: 'Finish the Epoch Road in a lime epoch.' },
  { id: 'epochFrost', hint: 'Finish the Epoch Road in a frost epoch.' },
]);

export const CATALOG: readonly CatalogItem[] = Object.freeze(ITEM_SPECS.map((spec) => buildItem(spec)));

export const ITEM_IDS: readonly ItemId[] = Object.freeze(ITEM_SPECS.map((spec) => spec.id));
export const COSMETIC_IDS: readonly CosmeticId[] = Object.freeze(
  ITEM_IDS.filter((id): id is CosmeticId => !id.startsWith('food:')),
);
export const FOOD_IDS: readonly FoodId[] = Object.freeze(ITEM_IDS.filter((id): id is FoodId => id.startsWith('food:')));

// Maps, not plain objects, so hostile keys such as '__proto__' find nothing.
const BY_ID: ReadonlyMap<string, CatalogItem> = new Map(CATALOG.map((item) => [item.id, item]));
const SHOP_BY_ID: ReadonlyMap<string, ShopInfo> = new Map(SHOPS.map((shop) => [shop.id, shop]));
const NONE: readonly CatalogItem[] = Object.freeze([]);
const BY_SHOP: ReadonlyMap<string, readonly CatalogItem[]> = new Map(
  SHOP_IDS.map((shop) => [shop, Object.freeze(CATALOG.filter((i) => i.source.kind === 'shop' && i.source.shop === shop))]),
);
const BY_CATEGORY: ReadonlyMap<string, readonly CatalogItem[]> = new Map(
  ITEM_CATEGORIES.map((category) => [category, Object.freeze(CATALOG.filter((i) => i.category === category))]),
);
const REWARD_ITEM: ReadonlyMap<string, CosmeticId> = new Map(
  CATALOG.flatMap((i) => (i.source.kind === 'reward' && isCosmeticId(i.id) ? [[i.source.reward, i.id] as const] : [])),
);

function idsIn<S extends CosmeticSlot>(slot: S): readonly CosmeticIdIn<S>[] {
  return Object.freeze(COSMETIC_IDS.filter((id): id is CosmeticIdIn<S> => id.startsWith(`${slot}:`)));
}

export const CosmeticSlotSchema = z.enum(COSMETIC_SLOTS);
export const OptionalSlotSchema = z.enum(OPTIONAL_SLOTS);
export const ItemCategorySchema = z.enum(ITEM_CATEGORIES);
export const ShopIdSchema = z.enum(SHOP_IDS);
export const RewardIdSchema = z.enum(REWARD_IDS);
export const ItemIdSchema = z.enum(ITEM_IDS);
export const CosmeticIdSchema = z.enum(COSMETIC_IDS);
export const FoodIdSchema = z.enum(FOOD_IDS);

// What a guardian wears: one item per required slot, an item or null for the rest.
export const LookSchema = z.strictObject({
  outfit: z.enum(idsIn('outfit')),
  hair: z.enum(idsIn('hair')),
  dye: z.enum(idsIn('dye')),
  beard: z.enum(idsIn('beard')).nullable(),
  hat: z.enum(idsIn('hat')).nullable(),
  shades: z.enum(idsIn('shades')).nullable(),
  board: z.enum(idsIn('board')).nullable(),
});
export type Look = Readonly<z.infer<typeof LookSchema>>;

// Stored list of cosmetics a profile owns beyond the defaults.
export const OwnedCosmeticsSchema = z
  .array(CosmeticIdSchema)
  .max(COSMETIC_IDS.length)
  .refine((ids) => new Set(ids).size === ids.length, 'duplicate cosmetic');

export const DEFAULT_LOOK: Look = Object.freeze({
  outfit: 'outfit:blue',
  hair: 'hair:hood',
  dye: 'dye:dark',
  beard: null,
  hat: null,
  shades: null,
  board: null,
});

// Free cosmetics that every profile owns from the start.
export const DEFAULT_OWNED: readonly CosmeticId[] = Object.freeze(COSMETIC_IDS.filter((id) => priceOf(id) === 0));
const DEFAULT_OWNED_SET: ReadonlySet<string> = new Set(DEFAULT_OWNED);

export function getItem(id: unknown): CatalogItem | undefined {
  return typeof id === 'string' ? BY_ID.get(id) : undefined;
}

export function getShop(id: unknown): ShopInfo | undefined {
  return typeof id === 'string' ? SHOP_BY_ID.get(id) : undefined;
}

export function isItemId(id: unknown): id is ItemId {
  return getItem(id) !== undefined;
}

export function isFoodId(id: unknown): id is FoodId {
  return getItem(id)?.category === 'food';
}

export function isCosmeticId(id: unknown): id is CosmeticId {
  const category = getItem(id)?.category;
  return category !== undefined && category !== 'food';
}

// Cosmetics go into a wardrobe; food is eaten and never owned.
export function isOwnable(id: unknown): id is CosmeticId {
  return isCosmeticId(id);
}

export function isConsumable(id: unknown): id is FoodId {
  return isFoodId(id);
}

export function categoryOf(id: unknown): ItemCategory | null {
  return getItem(id)?.category ?? null;
}

export function slotOf(id: CosmeticId): CosmeticSlot;
export function slotOf(id: unknown): CosmeticSlot | null;
export function slotOf(id: unknown): CosmeticSlot | null {
  const category = categoryOf(id);
  return category === null || category === 'food' ? null : category;
}

// Shop price in sats, or null for reward items and unknown ids.
export function priceOf(id: unknown): number | null {
  const source = getItem(id)?.source;
  return source?.kind === 'shop' ? source.price : null;
}

export function shopOf(id: unknown): ShopId | null {
  const source = getItem(id)?.source;
  return source?.kind === 'shop' ? source.shop : null;
}

export function itemsInShop(shop: ShopId): readonly CatalogItem[] {
  return BY_SHOP.get(shop) ?? NONE;
}

export function itemsInCategory(category: ItemCategory): readonly CatalogItem[] {
  return BY_CATEGORY.get(category) ?? NONE;
}

export function rewardItem(reward: RewardId): CosmeticId {
  const id = REWARD_ITEM.get(reward);
  if (id === undefined) throw new RangeError(`unknown reward ${reward}`);
  return id;
}

// Owned outright or a free default.
export function ownsItem(owned: ReadonlySet<string>, id: unknown): boolean {
  return isCosmeticId(id) && (DEFAULT_OWNED_SET.has(id) || owned.has(id));
}

export function lookItems(look: Look): CosmeticId[] {
  return COSMETIC_SLOTS.flatMap((slot) => {
    const id = look[slot];
    return id === null ? [] : [id];
  });
}

function relook(candidate: unknown): Look {
  const parsed = LookSchema.safeParse(candidate);
  if (!parsed.success) throw new RangeError('not a valid look');
  return Object.freeze(parsed.data);
}

// Puts an item on in its own slot; throws on anything that is not a known cosmetic.
export function wear(look: Look, id: CosmeticId): Look {
  return relook({ ...look, [slotOf(id)]: id });
}

// Empties an optional slot; required slots always keep an item.
export function takeOff(look: Look, slot: OptionalSlot): Look {
  return relook({ ...look, [slot]: null });
}

export type LookError = 'invalidLook' | 'notOwned';

// Validates a look from a client or storage against what the profile owns.
export function checkLook(input: unknown, owned: ReadonlySet<string>): Result<Look, LookError> {
  const parsed = LookSchema.safeParse(input);
  if (!parsed.success) return err('invalidLook');
  const look = Object.freeze(parsed.data);
  return lookItems(look).every((id) => ownsItem(owned, id)) ? ok(look) : err('notOwned');
}

export type PurchaseError = 'unknownItem' | 'notForSale' | 'wrongShop' | 'alreadyOwned';

export interface PurchaseQuote {
  readonly item: CatalogItem;
  // Always at least 1: free items are defaults that everyone already owns.
  readonly price: number;
}

// Can this item be bought at this shop by someone owning these cosmetics.
export function checkPurchase(id: unknown, shop: ShopId, owned: ReadonlySet<string>): Result<PurchaseQuote, PurchaseError> {
  const item = getItem(id);
  if (item === undefined) return err('unknownItem');
  if (item.source.kind !== 'shop') return err('notForSale');
  if (item.source.shop !== shop) return err('wrongShop');
  if (item.category !== 'food' && ownsItem(owned, item.id)) return err('alreadyOwned');
  // Free cosmetics are owned by default above; a free consumable would be a data bug, so refuse it.
  if (item.source.price < 1) return err('notForSale');
  return ok({ item, price: item.source.price });
}

// '#5FA8FF' to 0x5FA8FF for canvas renderers.
export function colorNumber(hex: string): number {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) throw new RangeError('colour must be #RRGGBB');
  return Number.parseInt(hex.slice(1), 16);
}
