import type { RandomSource } from '@byzantine-council/shared';
import { pickOne } from './random.js';

// Original, friendly names; the prefix keeps a bot recognisable wherever a name shows.
export const BOT_NAME_PREFIX = 'Bot ';
export const BOT_NAMES: readonly string[] = Object.freeze([
  'Acorn',
  'Basil',
  'Biscuit',
  'Bramble',
  'Clover',
  'Dewdrop',
  'Fennel',
  'Hazel',
  'Juniper',
  'Kestrel',
  'Lumen',
  'Maple',
  'Marble',
  'Mosaic',
  'Nutmeg',
  'Pebble',
  'Puffin',
  'Quill',
  'Saffron',
  'Thistle',
  'Tumble',
  'Willow',
  'Wren',
  'Zephyr',
]);

export function botNickname(name: string): string {
  return `${BOT_NAME_PREFIX}${name}`;
}

// A nickname no bot in this room has yet; the room still makes every name unique.
export function pickBotNickname(taken: ReadonlySet<string>, rng: RandomSource): string {
  const free = BOT_NAMES.map(botNickname).filter((n) => !taken.has(n));
  return pickOne(rng, free) ?? pickOne(rng, BOT_NAMES.map(botNickname)) ?? botNickname('Pebble');
}
