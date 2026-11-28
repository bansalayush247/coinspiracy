import type Phaser from 'phaser';
import { shopTradeOf, type CityBuilding, type ShopTrade } from '@byzantine-council/shared/city';
import { P, fan, prism } from '../beach/beachArt.js';
import { lit, mix, shade } from '../game/palette.js';

type Graphics = Phaser.GameObjects.Graphics;

interface Footprint {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

type Face = (along: number, height: number) => ReturnType<typeof P>;

const STEEL = 0x334452;
const GLASS = 0x78adb3;
const STONE = 0xf1e3cd;
const TIMBER = 0xa76d51;
const SHOP_TRIM: Readonly<Record<ShopTrade, number>> = {
  tailor: 0x814459,
  barber: 0x46608a,
  hats: 0x4e7659,
  surf: 0x458a91,
  cafe: 0xaa654c,
};

function plane(g: Graphics, face: Face, a: number, b: number, sill: number, head: number, color: number): void {
  fan(g, color, [face(a, sill), face(b, sill), face(b, head), face(a, head)]);
}

function front(rect: Footprint): Face {
  return (u, z) => P(u, rect.y1 + 0.009, z);
}

function side(rect: Footprint): Face {
  return (u, z) => P(rect.x1 + 0.009, u, z);
}

// Projected glazing with dark frames, individually shaded bays and a shared reflection across them.
function glazing(g: Graphics, face: Face, a: number, b: number, sill: number, head: number, tint: number, panes: number): void {
  if (b - a < 0.22 || head - sill < 9) return;
  const width = (b - a) / panes;
  plane(g, face, a, b, sill, head, STEEL);
  for (let i = 0; i < panes; i++) {
    const left = a + i * width + 0.025;
    const right = a + (i + 1) * width - 0.025;
    const color = mix(tint, 0xffe7ba, (i % 3) * 0.045);
    plane(g, face, left, right, sill + 2, head - 2, color);
    fan(g, 0xf3f6df, [face(left, head - 10), face(right, head - 6), face(right, head - 3), face(left, head - 7)], 0.35);
    plane(g, face, left, right, sill + 2, sill + 5, shade(color, 0.24));
  }
}

function body(g: Graphics, rect: Footprint, z: number, height: number, color: number, top?: number): void {
  prism(g, rect.x0, rect.y0, rect.x1, rect.y1, z, height, color, top);
}

function roofSlab(g: Graphics, rect: Footprint, z: number, color: number): void {
  body(g, { x0: rect.x0 - 0.07, y0: rect.y0 - 0.07, x1: rect.x1 + 0.07, y1: rect.y1 + 0.07 }, z, 5, shade(color, 0.16), lit(color, 0.18));
}

function roofGarden(g: Graphics, rect: Footprint, z: number): void {
  const { x0, y0, x1 } = rect;
  const garden = { x0: x0 + 0.26, x1: x1 - 0.26, y0: y0 + 0.25, y1: y0 + 0.68 };
  body(g, garden, z, 5, 0xbea685, 0x7e9b6a);
  for (let x = garden.x0 + 0.16; x < garden.x1 - 0.1; x += 0.34) {
    body(g, { x0: x - 0.12, x1: x + 0.12, y0: garden.y0 + 0.07, y1: garden.y1 - 0.07 }, z + 5, 6, 0x5d875d, 0x91ab67);
  }
}

/** A shop with display glazing, a slim canopy and either a planted or a capped roof. */
export function drawStorefront(g: Graphics, b: CityBuilding, rect: Footprint, wall: number, roof: number): void {
  const { x0, x1, y0, y1 } = rect;
  const accent = SHOP_TRIM[shopTradeOf(b.seed)];
  const mid = (x0 + x1) / 2;
  body(g, rect, 0, b.height, mix(wall, STONE, 0.23));
  const face = front(rect);
  const flank = side(rect);
  plane(g, face, x0 + 0.12, x1 - 0.12, 4, 52, shade(accent, 0.44));
  glazing(g, face, x0 + 0.18, mid - 0.57, 8, 46, mix(accent, 0xeec895, 0.72), 2);
  glazing(g, face, mid + 0.57, x1 - 0.18, 8, 46, mix(accent, 0xeec895, 0.72), 2);
  glazing(g, flank, y0 + 0.18, y1 - 0.18, 9, 46, mix(accent, 0xbdc4ae, 0.68), 3);
  glazing(g, flank, y0 + 0.24, y1 - 0.24, 58, b.height - 13, shade(GLASS, 0.15), 3);
  if (b.height >= 101) glazing(g, face, x0 + 0.22, x1 - 0.22, 82, b.height - 9, GLASS, 4);
  body(g, { x0: x0 - 0.015, x1: x1 + 0.015, y0: y1 - 0.19, y1: y1 + 0.31 }, 52, 6, shade(accent, 0.22), lit(accent, 0.24));
  plane(g, face, x0 + 0.12, x1 - 0.12, 58, Math.min(82, b.height - 1), accent);
  roofSlab(g, rect, b.height, mix(roof, STONE, 0.55));
  if (b.seed % 3 === 0) roofGarden(g, rect, b.height + 5);
}

/** A timber-and-plaster home with offset upper floors and an open roof terrace. */
export function drawResidence(g: Graphics, b: CityBuilding, rect: Footprint, wall: number, roof: number): void {
  const { x0, x1, y0, y1 } = rect;
  const mid = (x0 + x1) / 2;
  const firstFloor = b.kind === 'mansion' ? 50 : 46;
  const leftWing = b.seed % 2 === 0;
  const upper = { x0: x0 + (leftWing ? 0.07 : 0.70), x1: x1 - (leftWing ? 0.67 : 0.07), y0: y0 + 0.09, y1: y1 - 0.58 };
  const frame = mix(roof, 0xd9c6a6, 0.40);
  body(g, rect, 0, firstFloor, mix(wall, STONE, 0.37));
  plane(g, front(rect), mid - 0.51, mid + 0.51, 0, firstFloor, mix(TIMBER, wall, 0.22));
  glazing(g, front(rect), x0 + 0.23, mid - 0.58, 11, firstFloor - 9, 0xbda78b, 2);
  glazing(g, front(rect), mid + 0.58, x1 - 0.23, 11, firstFloor - 9, 0xa5bdaf, 2);
  glazing(g, side(rect), y0 + 0.22, y1 - 0.22, 10, firstFloor - 9, shade(GLASS, 0.17), 3);
  roofSlab(g, rect, firstFloor, STONE);
  body(g, upper, firstFloor + 5, b.height - firstFloor - 5, mix(wall, frame, 0.22));
  glazing(g, front(upper), upper.x0 + 0.15, upper.x1 - 0.15, firstFloor + 9, b.height - 6, GLASS, 3);
  glazing(g, side(upper), upper.y0 + 0.18, upper.y1 - 0.18, firstFloor + 9, b.height - 6, shade(GLASS, 0.12), 2);
  body(g, { x0: x0 + 0.12, x1: x1 - 0.12, y0: y1 - 0.16, y1: y1 - 0.05 }, firstFloor + 5, 6, frame);
  roofSlab(g, upper, b.height, frame);
  if (b.kind === 'mansion') roofGarden(g, upper, b.height + 5);
}

/** Recessed glass offices and towers with a setback at the roof. */
export function drawOffice(g: Graphics, b: CityBuilding, rect: Footprint, wall: number, roof: number): void {
  const { x0, x1, y0, y1 } = rect;
  const mid = (x0 + x1) / 2;
  const frame = mix(wall, STEEL, 0.52);
  const tint = mix(GLASS, roof, 0.34);
  const cap = b.height - 26;
  const turret = { x0: x0 + 0.42, y0: y0 + 0.36, x1: x1 - 0.5, y1: y1 - 0.60 };
  body(g, rect, 0, cap, frame);
  glazing(g, front(rect), x0 + 0.17, mid - 0.60, 7, 44, 0xaabdb9, 3);
  glazing(g, front(rect), mid + 0.60, x1 - 0.17, 7, 44, 0xaabdb9, 3);
  glazing(g, side(rect), y0 + 0.18, y1 - 0.18, 7, 44, shade(tint, 0.14), 5);
  for (let z = 69; z < cap - 11; z += 28) {
    const head = Math.min(z + 24, cap - 3);
    glazing(g, front(rect), x0 + 0.17, x1 - 0.17, z, head, tint, 6);
    glazing(g, side(rect), y0 + 0.17, y1 - 0.17, z, head, shade(tint, 0.15), 5);
  }
  roofSlab(g, rect, cap, mix(roof, wall, 0.29));
  body(g, turret, cap + 5, b.height - cap - 5, frame);
  glazing(g, front(turret), turret.x0 + 0.12, turret.x1 - 0.12, cap + 7, b.height - 3, tint, 4);
  roofSlab(g, turret, b.height, roof);
}

/** The hospital's white wings, long ward windows and covered entrance. */
export function drawHospital(g: Graphics, b: CityBuilding, rect: Footprint): void {
  const { x0, x1, y0, y1 } = rect;
  const mid = (x0 + x1) / 2;
  const ward = { x0: x0 + 0.48, y0: y0 + 0.36, x1: x1 - 0.48, y1: y1 - 0.8 };
  body(g, rect, 0, 82, 0xe8eae1);
  glazing(g, front(rect), x0 + 0.32, mid - 0.94, 8, 51, 0xa4c7c6, 4);
  glazing(g, front(rect), mid + 0.94, x1 - 0.32, 8, 51, 0xa4c7c6, 4);
  glazing(g, side(rect), y0 + 0.36, y1 - 0.36, 12, 54, 0x8fb4b4, 8);
  body(g, { x0: mid - 2.2, x1: mid + 2.2, y0: y1 - 0.24, y1: y1 + 0.42 }, 50, 5, 0x527d88, 0xb5d8d7);
  roofSlab(g, rect, 82, 0xc9d3cf);
  body(g, ward, 87, b.height - 87, 0xf4eee0);
  for (let z = 100; z < b.height - 19; z += 32) {
    glazing(g, front(ward), ward.x0 + 0.35, ward.x1 - 0.35, z, z + 17, 0x96bcc0, 8);
    glazing(g, side(ward), ward.y0 + 0.35, ward.y1 - 0.35, z, z + 17, 0x80a9b0, 8);
  }
  plane(g, front(ward), mid - 0.30, mid + 0.30, 158, 172, 0xe9e8db);
  plane(g, front(ward), mid - 0.28, mid + 0.28, 163, 167, 0xc4484c);
  plane(g, front(ward), mid - 0.09, mid + 0.09, 158, 172, 0xc4484c);
  roofSlab(g, ward, b.height, 0x7c939a);
}
