// Every building in Port Concord has its own name: shops after their keepers, homes by street address, offices after
// the firms inside. Names come from each building's seed and the word lists in tuning/names.json, so every client and
// the server agree, and no two buildings share one.
import { z } from 'zod';
import { shopTradeOf } from './interior.js';
import { BUILDING_KINDS, CITY_BUILDINGS, type CityBuilding } from './map.js';
import raw from './tuning/names.json' with { type: 'json' };

const Words = z.array(z.string().min(1).max(40)).min(1);
const NamesSchema = z.strictObject({
  surnames: Words.min(2),
  adjectives: Words,
  streets: Words,
  patterns: z.record(z.string(), z.array(z.string().min(1).max(60)).min(1)),
});

const NAMES = NamesSchema.parse(raw);

for (const kind of BUILDING_KINDS) {
  const key = kind === 'shop' ? 'shop:tailor' : kind;
  if (NAMES.patterns[key] === undefined) throw new Error(`names.json has no pattern for ${key}`);
}

// Mulberry32, as the rooms use: small, fast and the same on every engine.
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rand: () => number, list: readonly string[]): string => list[Math.floor(rand() * list.length)] ?? list[0] ?? '';

function candidate(b: CityBuilding, rand: () => number): string {
  const local = `${b.kind}:${b.district}`;
  const key = b.kind === 'shop' ? `shop:${shopTradeOf(b.seed)}` : NAMES.patterns[local] !== undefined ? local : b.kind;
  const surname = pick(rand, NAMES.surnames);
  let surname2 = pick(rand, NAMES.surnames);
  if (surname2 === surname) surname2 = NAMES.surnames.find((s) => s !== surname) ?? surname2;
  return pick(rand, NAMES.patterns[key] ?? [b.kind])
    .replace('{surname2}', surname2)
    .replace('{surname}', surname)
    .replace('{adj}', pick(rand, NAMES.adjectives))
    .replace('{street}', pick(rand, NAMES.streets))
    .replace('{n}', String(1 + Math.floor(rand() * 98)));
}

// Each building in map order takes its seed's first name not already taken; a numbered one if every try is.
const BY_SEED: ReadonlyMap<number, string> = (() => {
  const taken = new Set<string>();
  const names = new Map<number, string>();
  for (const b of CITY_BUILDINGS) {
    const rand = seeded(b.seed ^ 0x4a3e5);
    let name = candidate(b, rand);
    for (let i = 0; i < 60 && taken.has(name); i++) name = candidate(b, rand);
    for (let n = 2; taken.has(name); n++) name = `${candidate(b, rand)} ${String(n)}`;
    taken.add(name);
    names.set(b.seed, name);
  }
  return names;
})();

/** The name of the building with this seed, the same everywhere; '' if no building has it. */
export const buildingName = (seed: number): string => BY_SEED.get(seed) ?? '';
