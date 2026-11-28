// A guardian's look as the art draws it, from a synced player or from a profile's saved look.
import { colorNumber, getItem, type Look } from '@byzantine-council/shared/economy';
import type { Wear } from './guardianArt.js';
import { seatColors, type GuardianColors } from './palette.js';

/** The synced player fields a look is shown with. */
export interface WornFields {
  readonly hat: string;
  readonly shades: string;
  readonly outfit: string;
  readonly hair: string;
  readonly dye: string;
  readonly beard: string;
  readonly board: string;
}

const KEYS = ['hat', 'shades', 'outfit', 'hair', 'dye', 'beard', 'board'] as const;

/** What a synced player wears. */
export const wearOf = (p: WornFields): Wear => ({ hat: p.hat, shades: p.shades, outfit: p.outfit, hair: p.hair, dye: p.dye, beard: p.beard, board: p.board });

/** What a profile's look wears; empty slots become ''. */
export const lookWear = (look: Look): Wear => ({
  hat: look.hat ?? '',
  shades: look.shades ?? '',
  outfit: look.outfit,
  hair: look.hair,
  dye: look.dye,
  beard: look.beard ?? '',
  board: look.board ?? '',
});

/** Whether two looks draw the same, counting a missing slot as empty. */
export const sameWear = (a: Wear, b: Wear): boolean => KEYS.every((k) => (a[k] ?? '') === (b[k] ?? ''));

/** The robe a guardian wears out in the city and Beach Town: a bought outfit's own colours, else the seat's, so free robes keep players apart. */
export function robeColors(seat: number, wear: Wear): GuardianColors {
  const item = wear.outfit === '' ? undefined : getItem(wear.outfit);
  const bought = item?.category === 'outfit' && item.source.kind === 'shop' && item.source.price > 0;
  const [lit, shadow, highlight] = bought ? item.hints.colors : [];
  if (lit === undefined || shadow === undefined || highlight === undefined) return seatColors(seat);
  return { lit: colorNumber(lit), shadow: colorNumber(shadow), highlight: colorNumber(highlight) };
}
