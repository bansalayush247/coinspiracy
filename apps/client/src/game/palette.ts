import { PLAYER_COLORS } from '@byzantine-council/shared';

// Golden-hour palette from the concept art, as 0xRRGGBB for Phaser.
export const COLORS = {
  floor: 0xf0d7b0,
  plaza: 0xfae8c8,
  hall: 0xf3ddb8,
  grass: 0xb5cc6e,
  bridge: 0xc89462,
  bridgeLine: 0x9c6b45,
  water: 0x4fa7cf,
  waterLight: 0x7cc8da,
  cliffLeft: 0xc98f6c,
  cliffRight: 0x8e5e6e,
  bank: 0xb98a6a,
  seal: 0xffc860,
  sealInner: 0xa983ff,
  gold: 0xffd27a,
  rim: 0xffe3b0,
  face: 0x2a2238,
  eye: 0xfff1c9,
  amulet: 0xffc860,
  shadow: 0x6e4e86,
  window: 0xffd27a,
  windowSide: 0xe8a85a,
  sun: 0xffe9be,
} as const;

export function mix(a: number, b: number, t: number): number {
  const ch = (c: number, shift: number): number => (c >> shift) & 0xff;
  const lerp = (shift: number): number => Math.round(ch(a, shift) + (ch(b, shift) - ch(a, shift)) * t);
  return (lerp(16) << 16) | (lerp(8) << 8) | lerp(0);
}

// Sunlit faces lean warm; shaded faces lean toward the dusk violet.
export const lit = (c: number, t = 0.18): number => mix(c, COLORS.sun, t);
export const shade = (c: number, t = 0.38): number => mix(c, COLORS.shadow, t);

export interface GuardianColors {
  readonly lit: number;
  readonly shadow: number;
  readonly highlight: number;
}

export function seatColors(seat: number): GuardianColors {
  const base = PLAYER_COLORS[seat % PLAYER_COLORS.length] ?? 0xa7b3c6;
  return { lit: base, shadow: shade(base, 0.42), highlight: mix(base, 0xffffff, 0.38) };
}

export function cssColor(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}
