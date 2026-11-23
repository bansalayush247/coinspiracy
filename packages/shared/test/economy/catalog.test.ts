import { describe, expect, it } from 'vitest';
import {
  CATALOG,
  CATEGORY_LABELS,
  COSMETIC_IDS,
  COSMETIC_SLOTS,
  CosmeticIdSchema,
  CosmeticSlotSchema,
  DEFAULT_LOOK,
  DEFAULT_OWNED,
  FOOD_IDS,
  FoodIdSchema,
  ITEM_CATEGORIES,
  ITEM_IDS,
  ItemCategorySchema,
  ItemIdSchema,
  LookSchema,
  OPTIONAL_SLOTS,
  OptionalSlotSchema,
  OwnedCosmeticsSchema,
  REQUIRED_SLOTS,
  REWARDS,
  REWARD_IDS,
  RewardIdSchema,
  SHOPS,
  SHOP_IDS,
  ShopIdSchema,
  VETERAN_MATCHES,
  categoryOf,
  checkLook,
  checkPurchase,
  colorNumber,
  getItem,
  getShop,
  isConsumable,
  isCosmeticId,
  isFoodId,
  isItemId,
  isOwnable,
  itemsInCategory,
  itemsInShop,
  lookItems,
  ownsItem,
  priceOf,
  rewardItem,
  shopOf,
  slotOf,
  takeOff,
  wear,
  type CatalogItem,
  type CosmeticId,
  type Look,
  type OptionalSlot,
  type RewardId,
} from '../../src/economy/index.js';

// Profiles store these ids, so renaming or reusing one is a breaking change: extend, never edit.
const GOLDEN_IDS = [
  'outfit:blue',
  'outfit:coral',
  'outfit:palm',
  'outfit:orange',
  'outfit:violet',
  'outfit:sand',
  'outfit:yellow',
  'outfit:pink',
  'hair:hood',
  'hair:short',
  'hair:buzz',
  'hair:curls',
  'hair:long',
  'hair:braids',
  'hair:mohawk',
  'beard:trim',
  'dye:dark',
  'dye:chestnut',
  'dye:bleached',
  'dye:coral',
  'dye:ocean',
  'hat:straw',
  'hat:cap',
  'hat:bucket',
  'shades:classic',
  'board:lime',
  'board:sunset',
  'board:ocean',
  'outfit:night',
  'food:coffee',
  'food:pupusa',
  'food:coconut',
  'outfit:genesis',
  'hat:threshold',
  'shades:partition',
  'board:lightning',
  'outfit:keeper',
  'hat:signer',
  'shades:keyholder',
  'board:guardian',
  'outfit:elder',
  'hat:archon',
  'board:genesis',
  'hat:scholar',
  'hat:epoch-amber',
  'hat:epoch-teal',
  'hat:epoch-violet',
  'hat:epoch-coral',
  'hat:epoch-lime',
  'hat:epoch-frost',
] as const;

// Prices from the approved Beach Town concept.
const CONCEPT_PRICES: readonly (readonly [string, number])[] = [
  ['outfit:blue', 0],
  ['outfit:coral', 400],
  ['outfit:palm', 400],
  ['outfit:orange', 350],
  ['outfit:violet', 500],
  ['outfit:sand', 300],
  ['outfit:yellow', 350],
  ['outfit:pink', 450],
  ['hair:hood', 0],
  ['hair:short', 150],
  ['hair:buzz', 100],
  ['hair:curls', 250],
  ['hair:long', 250],
  ['hair:braids', 300],
  ['hair:mohawk', 350],
  ['beard:trim', 180],
  ['dye:dark', 0],
  ['dye:chestnut', 120],
  ['dye:bleached', 150],
  ['dye:coral', 200],
  ['dye:ocean', 200],
  ['hat:straw', 280],
  ['hat:cap', 200],
  ['hat:bucket', 240],
  ['shades:classic', 320],
  ['board:lime', 900],
  ['board:sunset', 950],
  ['board:ocean', 900],
  ['outfit:night', 600],
  ['food:coffee', 30],
  ['food:pupusa', 60],
  ['food:coconut', 40],
];

const FOOD_SHOPS = ['cafe', 'pupusa-stand', 'coconut-stand'];
const COLOR = /^#[0-9A-F]{6}$/;

// Strings that must never resolve to an item.
const HOSTILE_IDS: readonly string[] = [
  '',
  '__proto__',
  'constructor',
  'toString',
  'hasOwnProperty',
  'outfit',
  'outfit:',
  ':blue',
  'blue',
  'OUTFIT:BLUE',
  'Outfit:blue',
  ' outfit:blue',
  'outfit:blue ',
  'outfit:blue\u0000',
  'outfit:blue:blue',
  'outfit::blue',
  'outfit:gray',
  'food:beer',
  'shades:true',
  'beard:true',
  'x'.repeat(10_000),
];

const NON_STRINGS: readonly unknown[] = [
  undefined,
  null,
  0,
  1,
  Number.NaN,
  true,
  4n,
  Symbol('outfit:blue'),
  {},
  [],
  ['outfit:blue'],
  { toString: () => 'outfit:blue' },
  new String('outfit:blue'),
];

const NOTHING_OWNED: ReadonlySet<string> = new Set<string>();

function item(id: string): CatalogItem {
  const found = getItem(id);
  if (found === undefined) throw new Error(`missing item ${id}`);
  return found;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

// A look as a plain record, for building invalid variants.
function lookRecord(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { ...DEFAULT_LOOK, ...overrides };
}

function without(record: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

describe('catalogue ids', () => {
  it('pins every item id, since profiles store them', () => {
    expect([...ITEM_IDS]).toStrictEqual([...GOLDEN_IDS]);
    expect(CATALOG.map((i) => i.id)).toStrictEqual([...GOLDEN_IDS]);
  });

  it('shapes every id as category:value and keeps them unique', () => {
    expect(new Set(ITEM_IDS).size).toBe(ITEM_IDS.length);
    for (const entry of CATALOG) {
      expect(entry.id).toMatch(/^[a-z]+:[a-z][a-z0-9-]*$/);
      expect(entry.id.length).toBeLessThanOrEqual(32);
      expect(entry.id).toBe(`${entry.category}:${entry.value}`);
      expect(ITEM_CATEGORIES).toContain(entry.category);
    }
  });

  it('splits ids into cosmetics and food with nothing left over', () => {
    expect(sorted([...COSMETIC_IDS, ...FOOD_IDS])).toStrictEqual(sorted(ITEM_IDS));
    expect(FOOD_IDS.every((id) => id.startsWith('food:'))).toBe(true);
    expect(COSMETIC_IDS.some((id) => id.startsWith('food:'))).toBe(false);
    expect([...FOOD_IDS]).toStrictEqual(['food:coffee', 'food:pupusa', 'food:coconut']);
  });
});

describe('slots and categories', () => {
  it('lists the seven cosmetic slots and food', () => {
    expect([...COSMETIC_SLOTS]).toStrictEqual(['outfit', 'hair', 'dye', 'beard', 'hat', 'shades', 'board']);
    expect([...ITEM_CATEGORIES]).toStrictEqual([...COSMETIC_SLOTS, 'food']);
  });

  it('splits slots into required and optional', () => {
    expect([...REQUIRED_SLOTS]).toStrictEqual(['outfit', 'hair', 'dye']);
    expect([...OPTIONAL_SLOTS]).toStrictEqual(['beard', 'hat', 'shades', 'board']);
    expect(sorted([...REQUIRED_SLOTS, ...OPTIONAL_SLOTS])).toStrictEqual(sorted(COSMETIC_SLOTS));
  });

  it('labels every category and has items in each', () => {
    for (const category of ITEM_CATEGORIES) {
      expect(CATEGORY_LABELS[category].length).toBeGreaterThan(0);
      expect(itemsInCategory(category).length).toBeGreaterThan(0);
    }
    expect(CATEGORY_LABELS.outfit).toBe('Robes');
    expect(CATEGORY_LABELS.shades).toBe('Eyewear');
  });

  it('partitions the catalogue by category in catalogue order', () => {
    const all = ITEM_CATEGORIES.flatMap((category) => itemsInCategory(category).map((i) => i.id));
    expect(sorted(all)).toStrictEqual(sorted(ITEM_IDS));
    for (const category of ITEM_CATEGORIES) {
      const ids = itemsInCategory(category).map((i) => i.id);
      expect(ids).toStrictEqual(ITEM_IDS.filter((id) => id.startsWith(`${category}:`)));
    }
  });
});

describe('prices and sources', () => {
  it('matches the concept prices for every shop item', () => {
    for (const [id, price] of CONCEPT_PRICES) expect(priceOf(id), id).toBe(price);
    const sold = CATALOG.filter((i) => i.source.kind === 'shop').map((i) => i.id);
    expect(sorted(sold)).toStrictEqual(sorted(CONCEPT_PRICES.map(([id]) => id)));
  });

  it('keeps every price a small whole number of sats', () => {
    for (const entry of CATALOG) {
      if (entry.source.kind !== 'shop') continue;
      expect(Number.isSafeInteger(entry.source.price)).toBe(true);
      expect(entry.source.price).toBeGreaterThanOrEqual(0);
      expect(entry.source.price).toBeLessThanOrEqual(5_000);
    }
  });

  it('makes only the defaults free, and the defaults are exactly the starting look', () => {
    const free = CATALOG.filter((i) => i.source.kind === 'shop' && i.source.price === 0).map((i) => i.id);
    expect(sorted(free)).toStrictEqual(sorted(DEFAULT_OWNED));
    expect(sorted(DEFAULT_OWNED)).toStrictEqual(sorted(lookItems(DEFAULT_LOOK)));
    expect(sorted(DEFAULT_OWNED)).toStrictEqual(['dye:dark', 'hair:hood', 'outfit:blue']);
  });

  it('charges at least one sat for food and sells it only at food stands', () => {
    for (const id of FOOD_IDS) {
      expect(priceOf(id)).toBeGreaterThanOrEqual(1);
      expect(FOOD_SHOPS).toContain(shopOf(id));
    }
    for (const shop of FOOD_SHOPS) {
      for (const entry of itemsInShop(ShopIdSchema.parse(shop))) expect(entry.category).toBe('food');
    }
  });

  it('gives each reward exactly one cosmetic that is never sold', () => {
    const rewarded = CATALOG.filter((i) => i.source.kind === 'reward');
    expect(rewarded.map((i) => (i.source.kind === 'reward' ? i.source.reward : null))).toStrictEqual([...REWARD_IDS]);
    for (const entry of rewarded) {
      expect(isCosmeticId(entry.id)).toBe(true);
      expect(priceOf(entry.id)).toBeNull();
      expect(shopOf(entry.id)).toBeNull();
    }
    expect(REWARD_IDS.map((reward) => rewardItem(reward))).toStrictEqual([
      'outfit:genesis',
      'hat:threshold',
      'shades:partition',
      'board:lightning',
      'outfit:keeper',
      'hat:signer',
      'shades:keyholder',
      'board:guardian',
      'outfit:elder',
      'hat:archon',
      'board:genesis',
      'hat:scholar',
      'hat:epoch-amber',
      'hat:epoch-teal',
      'hat:epoch-violet',
      'hat:epoch-coral',
      'hat:epoch-lime',
      'hat:epoch-frost',
    ]);
  });

  it('throws for a reward that does not exist', () => {
    expect(() => rewardItem('jackpot' as RewardId)).toThrow(RangeError);
    expect(() => rewardItem('__proto__' as RewardId)).toThrow(RangeError);
  });

  it('describes every reward, and the veteran one names its match count', () => {
    expect(REWARDS.map((r) => r.id)).toStrictEqual([...REWARD_IDS]);
    for (const reward of REWARDS) expect(reward.hint.length).toBeGreaterThan(0);
    expect(REWARDS.find((r) => r.id === 'veteran')?.hint).toContain(String(VETERAN_MATCHES));
  });
});

describe('shops', () => {
  it('lists the seven shops in order with names and sign colours', () => {
    expect(SHOPS.map((s) => s.id)).toStrictEqual([...SHOP_IDS]);
    expect([...SHOP_IDS]).toStrictEqual(['tailor', 'barber', 'hats', 'surf', 'cafe', 'pupusa-stand', 'coconut-stand']);
    expect(new Set(SHOPS.map((s) => s.name)).size).toBe(SHOPS.length);
    for (const shop of SHOPS) {
      expect(shop.name.length).toBeGreaterThan(0);
      expect(shop.sells.length).toBeGreaterThan(0);
      expect(shop.color).toMatch(COLOR);
      expect(getShop(shop.id)).toBe(shop);
    }
  });

  it('has every shop sell something, and shop lists partition what is sold', () => {
    const all = SHOP_IDS.flatMap((shop) => itemsInShop(shop).map((i) => i.id));
    const sold = CATALOG.filter((i) => i.source.kind === 'shop').map((i) => i.id);
    expect(sorted(all)).toStrictEqual(sorted(sold));
    for (const shop of SHOP_IDS) {
      expect(itemsInShop(shop).length).toBeGreaterThan(0);
      for (const entry of itemsInShop(shop)) expect(shopOf(entry.id)).toBe(shop);
    }
  });

  it('finds no shop for hostile or unknown ids', () => {
    for (const id of [...HOSTILE_IDS, 'mint', 'Tailor']) expect(getShop(id)).toBeUndefined();
    for (const value of NON_STRINGS) expect(getShop(value)).toBeUndefined();
    expect(itemsInShop('mint' as never)).toStrictEqual([]);
  });
});

describe('names and render hints', () => {
  it('gives every item a short, unique, trimmed name', () => {
    expect(new Set(CATALOG.map((i) => i.name)).size).toBe(CATALOG.length);
    for (const entry of CATALOG) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.name.length).toBeLessThanOrEqual(24);
      expect(entry.name.trim()).toBe(entry.name);
    }
  });

  it('uses #RRGGBB colours everywhere', () => {
    for (const entry of CATALOG) {
      expect(entry.hints.swatch, entry.id).toMatch(COLOR);
      for (const color of entry.hints.colors) expect(color, entry.id).toMatch(COLOR);
    }
  });

  it('gives each slot the palette its renderer expects', () => {
    const expected: Readonly<Record<string, (n: number) => boolean>> = {
      outfit: (n) => n === 3,
      dye: (n) => n === 1,
      hat: (n) => n >= 2,
      shades: (n) => n === 2,
      board: (n) => n === 2,
      hair: (n) => n === 0,
      beard: (n) => n === 0,
      food: (n) => n === 0,
    };
    for (const entry of CATALOG) {
      const check = expected[entry.category];
      expect(check?.(entry.hints.colors.length), entry.id).toBe(true);
    }
  });

  it('uses the first palette colour as the swatch when the item has colours', () => {
    for (const entry of CATALOG) {
      const first = entry.hints.colors[0];
      if (first !== undefined) expect(entry.hints.swatch).toBe(first);
    }
  });

  it('converts colours for canvas renderers', () => {
    expect(colorNumber('#5FA8FF')).toBe(0x5fa8ff);
    expect(colorNumber('#000000')).toBe(0);
    expect(colorNumber('#ffffff')).toBe(0xffffff);
    for (const bad of ['', '5FA8FF', '#5FA8F', '#5FA8FFF', '#GGGGGG', 'red', '#5FA8FF\n', ' #5FA8FF', '0x5FA8FF']) {
      expect(() => colorNumber(bad), bad).toThrow(RangeError);
    }
  });
});

describe('frozen data', () => {
  it('freezes the catalogue deeply', () => {
    expect(Object.isFrozen(CATALOG)).toBe(true);
    for (const entry of CATALOG) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.source)).toBe(true);
      expect(Object.isFrozen(entry.hints)).toBe(true);
      expect(Object.isFrozen(entry.hints.colors)).toBe(true);
    }
  });

  it('freezes every exported list and record', () => {
    const frozen: readonly unknown[] = [
      ITEM_IDS,
      COSMETIC_IDS,
      FOOD_IDS,
      COSMETIC_SLOTS,
      REQUIRED_SLOTS,
      OPTIONAL_SLOTS,
      ITEM_CATEGORIES,
      SHOP_IDS,
      REWARD_IDS,
      CATEGORY_LABELS,
      SHOPS,
      ...SHOPS,
      REWARDS,
      ...REWARDS,
      DEFAULT_LOOK,
      DEFAULT_OWNED,
      itemsInShop('tailor'),
      itemsInCategory('hat'),
    ];
    for (const value of frozen) expect(Object.isFrozen(value)).toBe(true);
  });

  it('refuses writes to shared data', () => {
    const entry = item('outfit:coral');
    expect(() => {
      Object.assign(entry.source, { price: 0 });
    }).toThrow(TypeError);
    expect(() => {
      Object.assign(DEFAULT_LOOK, { hat: 'hat:cap' });
    }).toThrow(TypeError);
    expect(() => {
      (ITEM_IDS as string[]).push('outfit:free');
    }).toThrow(TypeError);
    expect(priceOf('outfit:coral')).toBe(400);
  });
});

describe('lookups', () => {
  it('finds every item by id', () => {
    for (const id of ITEM_IDS) {
      expect(getItem(id)?.id).toBe(id);
      expect(isItemId(id)).toBe(true);
      expect(categoryOf(id)).toBe(id.slice(0, id.indexOf(':')));
    }
  });

  it.each(HOSTILE_IDS.map((id) => ({ label: JSON.stringify(id.slice(0, 24)), id })))(
    'finds nothing for the string $label',
    ({ id }) => {
      expect(getItem(id)).toBeUndefined();
      expect(isItemId(id)).toBe(false);
      expect(isCosmeticId(id)).toBe(false);
      expect(isFoodId(id)).toBe(false);
      expect(isOwnable(id)).toBe(false);
      expect(isConsumable(id)).toBe(false);
      expect(categoryOf(id)).toBeNull();
      expect(slotOf(id)).toBeNull();
      expect(priceOf(id)).toBeNull();
      expect(shopOf(id)).toBeNull();
    },
  );

  it('finds nothing for values that are not strings', () => {
    for (const value of NON_STRINGS) {
      expect(getItem(value)).toBeUndefined();
      expect(isItemId(value)).toBe(false);
      expect(isOwnable(value)).toBe(false);
      expect(slotOf(value)).toBeNull();
      expect(priceOf(value)).toBeNull();
    }
  });

  it('tells cosmetics from food', () => {
    for (const id of COSMETIC_IDS) {
      expect(isCosmeticId(id)).toBe(true);
      expect(isOwnable(id)).toBe(true);
      expect(isFoodId(id)).toBe(false);
      expect(isConsumable(id)).toBe(false);
      expect(slotOf(id)).toBe(categoryOf(id));
    }
    for (const id of FOOD_IDS) {
      expect(isCosmeticId(id)).toBe(false);
      expect(isOwnable(id)).toBe(false);
      expect(isFoodId(id)).toBe(true);
      expect(isConsumable(id)).toBe(true);
      expect(slotOf(id)).toBeNull();
      expect(categoryOf(id)).toBe('food');
    }
  });

  it('reports shop and price for sold items', () => {
    expect(shopOf('outfit:night')).toBe('surf');
    expect(priceOf('outfit:night')).toBe(600);
    expect(shopOf('shades:classic')).toBe('hats');
    expect(shopOf('food:pupusa')).toBe('pupusa-stand');
    expect(item('beard:trim').value).toBe('trim');
  });
});

describe('schemas', () => {
  it('accepts exactly the cosmetic ids as CosmeticIdSchema', () => {
    for (const id of COSMETIC_IDS) expect(CosmeticIdSchema.safeParse(id).success).toBe(true);
    for (const id of [...FOOD_IDS, ...HOSTILE_IDS]) expect(CosmeticIdSchema.safeParse(id).success).toBe(false);
    for (const value of NON_STRINGS) expect(CosmeticIdSchema.safeParse(value).success).toBe(false);
  });

  it('accepts exactly the item and food ids', () => {
    for (const id of ITEM_IDS) expect(ItemIdSchema.safeParse(id).success).toBe(true);
    for (const id of FOOD_IDS) expect(FoodIdSchema.safeParse(id).success).toBe(true);
    for (const id of COSMETIC_IDS) expect(FoodIdSchema.safeParse(id).success).toBe(false);
    for (const id of HOSTILE_IDS) expect(ItemIdSchema.safeParse(id).success).toBe(false);
    for (const value of NON_STRINGS) expect(ItemIdSchema.safeParse(value).success).toBe(false);
  });

  it('accepts only known slots, categories, shops and rewards', () => {
    for (const slot of COSMETIC_SLOTS) expect(CosmeticSlotSchema.safeParse(slot).success).toBe(true);
    for (const slot of OPTIONAL_SLOTS) expect(OptionalSlotSchema.safeParse(slot).success).toBe(true);
    for (const slot of REQUIRED_SLOTS) expect(OptionalSlotSchema.safeParse(slot).success).toBe(false);
    for (const category of ITEM_CATEGORIES) expect(ItemCategorySchema.safeParse(category).success).toBe(true);
    for (const shop of SHOP_IDS) expect(ShopIdSchema.safeParse(shop).success).toBe(true);
    for (const reward of REWARD_IDS) expect(RewardIdSchema.safeParse(reward).success).toBe(true);
    for (const bad of ['', 'food', 'Outfit', '__proto__', 'mint', 'jackpot', ' hat']) {
      expect(CosmeticSlotSchema.safeParse(bad).success).toBe(false);
      expect(ShopIdSchema.safeParse(bad).success).toBe(false);
      expect(RewardIdSchema.safeParse(bad).success).toBe(false);
    }
    expect(ItemCategorySchema.safeParse('food').success).toBe(true);
  });

  it('accepts owned lists of unique cosmetics up to the catalogue size', () => {
    expect(OwnedCosmeticsSchema.safeParse([]).success).toBe(true);
    expect(OwnedCosmeticsSchema.safeParse([...COSMETIC_IDS]).success).toBe(true);
    expect(OwnedCosmeticsSchema.safeParse(['hat:cap', 'hat:cap']).success).toBe(false);
    expect(OwnedCosmeticsSchema.safeParse(['food:coffee']).success).toBe(false);
    expect(OwnedCosmeticsSchema.safeParse(['outfit:gray']).success).toBe(false);
    expect(OwnedCosmeticsSchema.safeParse([...COSMETIC_IDS, 'hat:cap']).success).toBe(false);
    expect(OwnedCosmeticsSchema.safeParse('hat:cap').success).toBe(false);
    expect(OwnedCosmeticsSchema.safeParse(null).success).toBe(false);
  });
});

describe('looks', () => {
  it('starts everyone in the Ocean Blue robe with the hood up', () => {
    expect(DEFAULT_LOOK).toStrictEqual({
      outfit: 'outfit:blue',
      hair: 'hair:hood',
      dye: 'dye:dark',
      beard: null,
      hat: null,
      shades: null,
      board: null,
    });
    expect(LookSchema.safeParse(DEFAULT_LOOK).success).toBe(true);
  });

  it('has exactly one key per slot, with only the optional slots nullable', () => {
    expect(Object.keys(LookSchema.shape)).toStrictEqual([...COSMETIC_SLOTS]);
    for (const slot of COSMETIC_SLOTS) {
      const nullable = LookSchema.shape[slot].safeParse(null).success;
      expect(nullable, slot).toBe((OPTIONAL_SLOTS as readonly string[]).includes(slot));
    }
  });

  it('accepts any combination of cosmetics in their own slots', () => {
    const fancy: Look = {
      outfit: 'outfit:genesis',
      hair: 'hair:mohawk',
      dye: 'dye:coral',
      beard: 'beard:trim',
      hat: 'hat:threshold',
      shades: 'shades:partition',
      board: 'board:lightning',
    };
    expect(LookSchema.parse(fancy)).toStrictEqual(fancy);
    expect(lookItems(fancy)).toStrictEqual([
      'outfit:genesis',
      'hair:mohawk',
      'dye:coral',
      'beard:trim',
      'hat:threshold',
      'shades:partition',
      'board:lightning',
    ]);
  });

  const INVALID_LOOKS: readonly { label: string; value: unknown }[] = [
    { label: 'null', value: null },
    { label: 'a string', value: 'outfit:blue' },
    { label: 'an array', value: [...lookItems(DEFAULT_LOOK)] },
    { label: 'an empty object', value: {} },
    { label: 'a missing outfit', value: without(lookRecord(), 'outfit') },
    { label: 'a missing optional slot', value: without(lookRecord(), 'hat') },
    { label: 'a null required slot', value: lookRecord({ hair: null }) },
    { label: 'an item in the wrong slot', value: lookRecord({ outfit: 'hat:cap' }) },
    { label: 'a hat in the board slot', value: lookRecord({ board: 'hat:straw' }) },
    { label: 'food as a hat', value: lookRecord({ hat: 'food:coffee' }) },
    { label: 'an unknown item', value: lookRecord({ outfit: 'outfit:gray' }) },
    { label: 'a boolean beard', value: lookRecord({ beard: true }) },
    { label: 'an extra slot', value: lookRecord({ cape: null }) },
    { label: 'a bare value instead of an id', value: lookRecord({ outfit: 'blue' }) },
    { label: 'a JSON __proto__ member', value: JSON.parse('{"__proto__":{"hat":"hat:cap"},"outfit":"outfit:blue","hair":"hair:hood","dye":"dye:dark","beard":null,"hat":null,"shades":null,"board":null}') as unknown },
  ];

  it.each(INVALID_LOOKS)('rejects $label', ({ value }) => {
    expect(LookSchema.safeParse(value).success).toBe(false);
    expect(checkLook(value, new Set(COSMETIC_IDS))).toStrictEqual({ ok: false, error: 'invalidLook' });
  });

  it('wears every cosmetic in its own slot and leaves the rest alone', () => {
    for (const id of COSMETIC_IDS) {
      const next = wear(DEFAULT_LOOK, id);
      const slot = slotOf(id);
      expect(next[slot]).toBe(id);
      for (const other of COSMETIC_SLOTS) if (other !== slot) expect(next[other]).toBe(DEFAULT_LOOK[other]);
      expect(Object.isFrozen(next)).toBe(true);
    }
    expect(DEFAULT_LOOK.hat).toBeNull();
  });

  it('replaces what was in the slot', () => {
    const capped = wear(DEFAULT_LOOK, 'hat:cap');
    expect(wear(capped, 'hat:straw').hat).toBe('hat:straw');
    expect(wear(capped, 'outfit:night').outfit).toBe('outfit:night');
  });

  it('refuses to wear food or unknown ids', () => {
    for (const bad of ['food:coffee', 'outfit:gray', '__proto__', '', 'hat']) {
      expect(() => wear(DEFAULT_LOOK, bad as CosmeticId), bad).toThrow(RangeError);
    }
  });

  it('takes off optional items and keeps required ones', () => {
    let look = DEFAULT_LOOK;
    for (const id of ['beard:trim', 'hat:bucket', 'shades:classic', 'board:ocean'] as const) look = wear(look, id);
    for (const slot of OPTIONAL_SLOTS) {
      const next = takeOff(look, slot);
      expect(next[slot]).toBeNull();
      expect(next.outfit).toBe(look.outfit);
    }
    expect(takeOff(DEFAULT_LOOK, 'hat')).toStrictEqual(DEFAULT_LOOK);
    for (const slot of REQUIRED_SLOTS) {
      expect(() => takeOff(look, slot as unknown as OptionalSlot), slot).toThrow(RangeError);
    }
  });
});

describe('ownership', () => {
  it('owns the defaults without storing them', () => {
    for (const id of DEFAULT_OWNED) expect(ownsItem(NOTHING_OWNED, id)).toBe(true);
    expect(ownsItem(NOTHING_OWNED, 'hat:cap')).toBe(false);
    expect(ownsItem(new Set(['hat:cap']), 'hat:cap')).toBe(true);
  });

  it('never owns food or unknown ids, whatever the stored set says', () => {
    const junk = new Set(['food:coffee', 'outfit:gray', '__proto__']);
    expect(ownsItem(junk, 'food:coffee')).toBe(false);
    expect(ownsItem(junk, 'outfit:gray')).toBe(false);
    expect(ownsItem(junk, '__proto__')).toBe(false);
    expect(ownsItem(junk, null)).toBe(false);
  });

  it('accepts the default look with nothing owned', () => {
    expect(checkLook(DEFAULT_LOOK, NOTHING_OWNED)).toStrictEqual({ ok: true, value: DEFAULT_LOOK });
  });

  it('refuses a look with an item the profile does not own', () => {
    const look = lookRecord({ hat: 'hat:cap' });
    expect(checkLook(look, NOTHING_OWNED)).toStrictEqual({ ok: false, error: 'notOwned' });
    expect(checkLook(look, new Set(['hat:straw']))).toStrictEqual({ ok: false, error: 'notOwned' });
    const result = checkLook(look, new Set(['hat:cap']));
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
  });

  it('needs reward items to be earned before they can be worn', () => {
    const look = lookRecord({ outfit: 'outfit:genesis' });
    expect(checkLook(look, NOTHING_OWNED)).toStrictEqual({ ok: false, error: 'notOwned' });
    expect(checkLook(look, new Set([rewardItem('firstMatch')])).ok).toBe(true);
  });
});

describe('checkPurchase', () => {
  it('quotes every sold item that is not owned yet', () => {
    for (const entry of CATALOG) {
      if (entry.source.kind !== 'shop' || entry.source.price === 0) continue;
      const result = checkPurchase(entry.id, entry.source.shop, NOTHING_OWNED);
      expect(result, entry.id).toStrictEqual({ ok: true, value: { item: entry, price: entry.source.price } });
      if (result.ok) expect(result.value.price).toBeGreaterThanOrEqual(1);
    }
  });

  it('refuses unknown and hostile ids', () => {
    for (const id of [...HOSTILE_IDS, ...NON_STRINGS]) {
      expect(checkPurchase(id, 'tailor', NOTHING_OWNED)).toStrictEqual({ ok: false, error: 'unknownItem' });
    }
  });

  it('never sells reward items', () => {
    for (const reward of REWARD_IDS) {
      for (const shop of SHOP_IDS) {
        expect(checkPurchase(rewardItem(reward), shop, NOTHING_OWNED)).toStrictEqual({ ok: false, error: 'notForSale' });
      }
    }
  });

  it('sells an item only at its own shop', () => {
    expect(checkPurchase('outfit:coral', 'barber', NOTHING_OWNED)).toStrictEqual({ ok: false, error: 'wrongShop' });
    expect(checkPurchase('outfit:night', 'tailor', NOTHING_OWNED)).toStrictEqual({ ok: false, error: 'wrongShop' });
    expect(checkPurchase('food:coffee', 'coconut-stand', NOTHING_OWNED)).toStrictEqual({ ok: false, error: 'wrongShop' });
    expect(checkPurchase('outfit:night', 'surf', NOTHING_OWNED).ok).toBe(true);
  });

  it('refuses cosmetics the profile already owns, including the free defaults', () => {
    for (const id of DEFAULT_OWNED) {
      const shop = shopOf(id);
      expect(shop).not.toBeNull();
      if (shop !== null) expect(checkPurchase(id, shop, NOTHING_OWNED)).toStrictEqual({ ok: false, error: 'alreadyOwned' });
    }
    expect(checkPurchase('hat:cap', 'hats', new Set(['hat:cap']))).toStrictEqual({ ok: false, error: 'alreadyOwned' });
  });

  it('sells food again and again', () => {
    const owned = new Set<string>(FOOD_IDS);
    for (const id of FOOD_IDS) {
      const shop = shopOf(id);
      if (shop !== null) expect(checkPurchase(id, shop, owned).ok).toBe(true);
    }
  });
});
