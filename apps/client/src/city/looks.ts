// How every story character looks: robe colours and a costume that says who they are at a glance. Guardians keep
// the plain hood, which is the game's own look; townsfolk dress as their jobs.
import type { NpcKind } from '@byzantine-council/shared/city';
import { EVERYDAY_COSTUMES, type Costume } from '../game/costumes.js';
import type { Wear } from '../game/guardianArt.js';
import { seatColors, type GuardianColors } from '../game/palette.js';

/** A story character's name tag, robe colours, worn cosmetics and costume. */
export interface Look {
  readonly name: string;
  readonly colors: GuardianColors;
  readonly wear: Wear;
  readonly costume: Costume;
}

/** The kinds drawn as robed figures (not animals or floating letters). */
export type FigureKind = Exclude<NpcKind, 'duncan' | 'gull' | 'letter'>;

const PLAIN: Wear = { hat: '', shades: '', outfit: '' };
const INK = 0x1a1020;
const GOLD = 0xf2c14e;
const SILVER = 0xd9d4e6;

function look(name: string, lit: number, shadow: number, highlight: number, costume: Costume = {}): Look {
  return { name, colors: { lit, shadow, highlight }, wear: PLAIN, costume };
}

/** Every robed story character's look, by NPC kind. */
export const LOOKS: Readonly<Record<FigureKind, Look>> = {
  dani: look('Dani', 0x4fb3a9, 0x2b6b66, 0xa6e3dc, { head: ['beanie', 0x2f4858], eyes: ['glasses', SILVER] }),
  mags: look('Mags', 0xd98c3f, 0x8a5426, 0xf2c491, { head: ['headset', 0x3a3a44], neck: ['scarf', 0x6e8b3d] }),
  guard: { name: 'Ivor', colors: seatColors(7), wear: PLAIN, costume: { head: ['captain', 0x2c3440] } },
  ivy: look('Ivy', 0xb79cf0, 0x6a568f, 0xe2d6ff, { eyes: ['glasses', GOLD], neck: ['scarf', 0xf2c14e] }),
  guardian: look('Guardian', 0xe8c25a, 0x8f7330, 0xfff0b8),
  lookout: look('Lookout', 0x4a5566, 0x262c36, 0x8792a3, { head: ['beanie', 0x6b2f2f] }),
  teo: look('Teo', 0xff8a3c, 0x9c4d1c, 0xffc799, { head: ['cap', 0x2b4c7e], prop: ['phone', 0x9fd8ff] }),
  brannigan: look('Brannigan', 0xc7b28a, 0x7a6a4f, 0xeee1c2, { head: ['fedora', 0x5a4632], neck: ['tie', 0x7a2e2e] }),
  nonce: look('Nonce', 0x5fd3b0, 0x2f7a63, 0xb7f2df, { head: ['headset', 0x2a2a33], eyes: ['glasses', SILVER] }),
  choir: look('Choir runner', 0x3a3550, 0x1c1a28, 0x77729a, { eyes: ['mask', 0x0f0d16] }),
  sharpe: look('Dr Sharpe', 0x9fb4c7, 0x56677a, 0xd8e4ef, { eyes: ['glasses', SILVER], neck: ['bowtie', 0x8c2f39], prop: ['book', 0x6b3e26] }),
  okafor: look('Mrs Okafor', 0xe57aa8, 0x8c4566, 0xf7c4da, { head: ['headscarf', 0xf2a541], eyes: ['glasses', 0xe0b080] }),
  pip: look('Pip', 0x6fc4e8, 0x37728c, 0xc4ebfa, { head: ['cap', 0xe2553f], prop: ['phone', 0xbff0e2] }),
  juno: look('Juno', 0xa6d65c, 0x5d7f2e, 0xdaf2b4, { head: ['bun', 0x4a2c20], neck: ['tie', 0x2b4c7e] }),
  crane: look('Mr Crane', 0x8b8fa8, 0x4c4f63, 0xc9cbe0, { head: ['flatcap', 0x55585f], neck: ['tie', 0x3c5a3a] }),
  stall: look('Stallholder', 0xd9b36a, 0x86683a, 0xf4dfb1, { head: ['flatcap', 0x6b4f2f], neck: ['apron', 0xf4f1ea], prop: ['basket', 0xc89b5a] }),
  mc: look('MC Mempool', 0xf2c230, 0x9a7612, 0xfff0a0, { eyes: ['shades', INK], neck: ['chain', GOLD], prop: ['mic', 0x3a3a44] }),
  penrose: look('Ms Penrose', 0x4a4a5c, 0x26262f, 0x8e8ea6, { head: ['wideHat', 0x1f1f28], neck: ['pearls', 0xf4f1ff] }),
  keeper: look('Mrs Bellweather', 0x6e7d5a, 0x3b4430, 0xb4c19e, { head: ['bun', 0xd8d4cc], eyes: ['glasses', SILVER], neck: ['scarf', 0x8c2f39] }),
  kit: look('Kit', 0x7f9be0, 0x435899, 0xc6d3f5, { head: ['beanie', 0xf2c14e], neck: ['scarf', 0x3b4a7a] }),
  marco: look('Marco', 0xf2f2ee, 0x9a9a92, 0xffffff, { head: ['chef', 0xffffff], neck: ['apron', 0xe2553f] }),
  benny: look('Benny', 0x5c8a6e, 0x2f4a3a, 0xa8d1b8, { head: ['flatcap', 0x4a3a2a], prop: ['satchel', 0x8a5a2b] }),
  rex: look('Rex Bigsby', 0xe0503c, 0x8a2c20, 0xf6a99c, { eyes: ['shades', INK], neck: ['bowtie', GOLD], prop: ['megaphone', 0xf4f1ea] }),
  nell: look('Nell', 0xe8b33c, 0x8f6a1e, 0xf8de9a, { head: ['rainHat', 0xf2d13a], eyes: ['glasses', SILVER] }),
  silas: look('Silas', 0x2f5f8a, 0x173450, 0x86b2d8, { head: ['captain', 0xf4f1ea], neck: ['tie', 0x1f2533] }),
  ozzy: look('Ozzy', 0x58c96a, 0x2c7a3a, 0xb4efbe, { head: ['headset', 0x2a2a33], prop: ['phone', 0xff7ad9] }),
  dee: look('Dee', 0xd96b4f, 0x86392a, 0xf4b9a8, { head: ['headscarf', 0x2b6b66], neck: ['apron', 0xf4f1ea] }),
  fennick: look('Mr Fennick', 0x8c8f94, 0x4a4c50, 0xc8cbd0, { head: ['bowler', 0x26262c], neck: ['tie', 0x4a2c20], prop: ['satchel', 0x6b4a2b] }),
  glass: look('Perpetua Glass', 0xf3f5f8, 0xa9b2bf, 0xffffff, { head: ['bun', 0xf6efe0], eyes: ['shades', 0xdfe9f5], neck: ['pearls', 0xffffff] }),
  lumley: look('Lumley', 0xe6dcc4, 0x968a6c, 0xfff6e0, { head: ['beret', 0x2b2b33], prop: ['camera', 0x2a2a30] }),
  shopper: { name: '', colors: seatColors(0), wear: PLAIN, costume: {} },
  varnish: look('Mr Varnish', 0x3e4a63, 0x1f2533, 0x8b99b8, { head: ['topHat', 0x16161c], eyes: ['monocle', GOLD], neck: ['tie', 0xb8344a], prop: ['briefcase', 0x5a3a24] }),
};

/** A shopper in The Clock's crowd: each one coloured and dressed differently, by their place in the crowd. */
export function shopperLook(index: number): Look {
  const i = Math.max(0, Math.floor(index));
  return { name: '', colors: seatColors(i + 1), wear: PLAIN, costume: EVERYDAY_COSTUMES[i % EVERYDAY_COSTUMES.length] ?? {} };
}
