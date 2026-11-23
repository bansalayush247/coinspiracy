// Draws the Mint Citadel from the shared map in the golden-hour low-poly style.
// Heights are in concept-art pixels (64 px tiles) and scaled by ART_SCALE.
import Phaser from 'phaser';
import { CITADEL_MAP, SPAWN_POINTS, TASK_KINDS, TASK_STATIONS, roomAt, tileAt, type RoomId, type TaskKind } from '@byzantine-council/shared';
import { ART_SCALE, TILE_H, TILE_W } from './iso.js';
import { COLORS, lit, mix, shade } from './palette.js';

type G = Phaser.GameObjects.Graphics;
interface Pt {
  readonly x: number;
  readonly y: number;
}

// World point (tiles) plus height (concept px) to world pixels.
function P(x: number, y: number, z = 0): Pt {
  return { x: (x - y) * (TILE_W / 2), y: (x + y) * (TILE_H / 2) - z * ART_SCALE };
}

// Convex polygons as triangle fans: Graphics re-tessellates paths every frame, triangles are cheap.
function fan(g: G, color: number, pts: readonly Pt[], alpha = 1): void {
  const [a] = pts;
  if (a === undefined) return;
  g.fillStyle(color, alpha);
  for (let i = 1; i < pts.length - 1; i++) {
    const b = pts[i];
    const c = pts[i + 1];
    if (b !== undefined && c !== undefined) g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
  }
}

// Box with only its camera-facing sides: +y on the left of the screen, +x on the right.
function prism(
  g: G,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z0: number,
  h: number,
  col: number,
  opts: { left?: boolean; right?: boolean; top?: number } = {},
): void {
  const z1 = z0 + h;
  if (opts.left !== false) fan(g, lit(col, 0.05), [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)]);
  if (opts.right !== false) fan(g, shade(col), [P(x1, y1, z0), P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1)]);
  fan(g, opts.top ?? lit(col, 0.3), [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)]);
}

export function pyramid(g: G, cx: number, cy: number, half: number, z0: number, h: number, col: number): void {
  const b = P(cx + half, cy - half, z0);
  const c = P(cx + half, cy + half, z0);
  const d = P(cx - half, cy + half, z0);
  const top = P(cx, cy, z0 + h);
  fan(g, lit(col, 0.12), [d, c, top]);
  fan(g, shade(col, 0.3), [c, b, top]);
}

function glow(g: G, at: Pt, radius: number): void {
  for (const [r, a] of [
    [1, 0.08],
    [0.7, 0.1],
    [0.45, 0.14],
  ] as const) {
    g.fillStyle(0xffd68c, a);
    g.fillCircle(at.x, at.y, radius * r * ART_SCALE);
  }
}

const BUILDINGS: Partial<Record<RoomId, { wall: number; roof: number; height: number }>> = {
  vault: { wall: 0xf2cfa0, roof: 0x8c6bc8, height: 120 },
  ledgerArchive: { wall: 0xf4d8b4, roof: 0x3e9c8c, height: 96 },
  watchtower: { wall: 0xf0c49c, roof: 0xe26e52, height: 168 },
};

function buildingAt(c: number, r: number) {
  const room = roomAt({ x: c + 0.5, y: r + 0.5 });
  return (room === null ? undefined : BUILDINGS[room]) ?? { wall: 0xf2cfa0, roof: 0x8c6bc8, height: 120 };
}

const map = CITADEL_MAP;
const at = (c: number, r: number): string => tileAt(map, c, r);

function groundColor(t: string, c: number, r: number): number {
  if (t === '~') return COLORS.water;
  if (t === '=') return COLORS.bridge;
  if (t === 'T') return COLORS.grass;
  const room = roomAt({ x: c + 0.5, y: r + 0.5 });
  if (room === 'plaza') return COLORS.plaza;
  if (room === 'signingHall') return COLORS.hall;
  return COLORS.floor;
}

// Static ground: floor, water, cliffs, the council seal and spawn seats. Drawn once.
export function drawGround(g: G): void {
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      const t = at(c, r);
      if (t === '#') continue;
      const z = t === '~' ? -7 : 0;
      const base = groundColor(t, c, r);
      const checker = t === '~' ? 0 : (c + r) % 2 === 0 ? 0.045 : 0;
      const top = mix(base, 0xffffff, checker);
      // Each tile is two flat facets, lighter toward the sun.
      fan(g, lit(top, 0.06), [P(c, r, z), P(c + 1, r, z), P(c, r + 1, z)]);
      fan(g, top, [P(c + 1, r, z), P(c + 1, r + 1, z), P(c, r + 1, z)]);
      if (t === '=') {
        g.lineStyle(ART_SCALE, COLORS.bridgeLine, 1);
        for (let k = 1; k < 4; k++) {
          const a = P(c + k / 4, r, 0);
          const b = P(c + k / 4, r + 1, 0);
          g.lineBetween(a.x, a.y, b.x, b.y);
        }
      }
      // Cliffs below open edges; the dock hangs over the sky with a thin edge.
      const depth = t === '=' && c >= 27 ? 10 : 46;
      if (at(c, r + 1) === '#') fan(g, COLORS.cliffLeft, [P(c, r + 1), P(c + 1, r + 1), P(c + 1, r + 1, -depth), P(c, r + 1, -depth)]);
      if (at(c + 1, r) === '#') fan(g, COLORS.cliffRight, [P(c + 1, r + 1), P(c + 1, r), P(c + 1, r, -depth), P(c + 1, r + 1, -depth)]);
    }
  }
  // Banks on the channel's visible inner edges.
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      if (at(c, r) !== '~') continue;
      if (at(c - 1, r) !== '~') fan(g, COLORS.bank, [P(c, r), P(c, r + 1), P(c, r + 1, -7), P(c, r, -7)]);
      if (at(c, r - 1) !== '~' && at(c, r - 1) !== '=') fan(g, mix(COLORS.bank, 0xffffff, 0.2), [P(c, r), P(c + 1, r), P(c + 1, r, -7), P(c, r, -7)]);
    }
  }
  // Council seal: rings centred on the plaza, then one diamond per seat.
  const seal = P(15, 15);
  for (const [radius, color, alpha, width] of [
    [3.0, COLORS.seal, 0.6, 3],
    [2.2, COLORS.seal, 0.35, 2],
    [1.1, COLORS.seal, 0.7, 4],
  ] as const) {
    g.lineStyle(width * ART_SCALE, color, alpha);
    g.strokeEllipse(seal.x, seal.y, radius * TILE_W * Math.SQRT2, radius * TILE_H * Math.SQRT2, 48);
  }
  for (const s of SPAWN_POINTS) {
    const p = P(s.x, s.y);
    fan(g, COLORS.seal, [
      { x: p.x, y: p.y - 6 * ART_SCALE },
      { x: p.x + 10 * ART_SCALE, y: p.y },
      { x: p.x, y: p.y + 6 * ART_SCALE },
      { x: p.x - 10 * ART_SCALE, y: p.y },
    ], 0.8);
  }
}

// Soft highlights on the water, faded in and out by a tween for a little life.
export function drawWaterShine(g: G): void {
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      if (at(c, r) !== '~' || (c + r) % 2 !== 0) continue;
      fan(g, COLORS.waterLight, [P(c + 0.25, r + 0.2, -7), P(c + 0.75, r + 0.2, -7), P(c + 0.5, r + 0.45, -7)], 0.7);
    }
  }
}

// A framed, lit window on a wall face: frame, warm glass with a sky reflection, mullion and sill.
function windowOn(g: G, side: 'left' | 'right', c: number, r: number, h: number, warm: number): void {
  const q = (u: number, z: number): Pt => (side === 'left' ? P(c + u, r + 1, z) : P(c + 1, r + 1 - u, z));
  const z0 = h * 0.38;
  const z1 = h * 0.7;
  fan(g, 0x6b4a5a, [q(0.26, z0 - 3), q(0.74, z0 - 3), q(0.74, z1 + 3), q(0.26, z1 + 3)]);
  fan(g, warm, [q(0.3, z0), q(0.7, z0), q(0.7, z1), q(0.3, z1)]);
  // Upper pane reflects the evening sky.
  fan(g, 0xffe9c4, [q(0.3, z1 - (z1 - z0) * 0.3), q(0.7, z1 - (z1 - z0) * 0.3), q(0.7, z1), q(0.3, z1)], 0.55);
  g.lineStyle(1.2 * ART_SCALE, 0x6b4a5a, 1);
  const m0 = q(0.5, z0);
  const m1 = q(0.5, z1);
  g.lineBetween(m0.x, m0.y, m1.x, m1.y);
  fan(g, 0xf8e6c8, [q(0.22, z0 - 6), q(0.78, z0 - 6), q(0.78, z0 - 3), q(0.22, z0 - 3)]);
}

// Stone courses on a wall face, darker toward the foot.
function coursesOn(g: G, side: 'left' | 'right', c: number, r: number, h: number, wall: number): void {
  const q = (u: number, z: number): Pt => (side === 'left' ? P(c + u, r + 1, z) : P(c + 1, r + 1 - u, z));
  const line = side === 'left' ? shade(wall, 0.18) : shade(wall, 0.5);
  g.lineStyle(0.8 * ART_SCALE, line, 0.55);
  for (let z = 14; z < h - 4; z += 14) {
    const a = q(0, z);
    const b = q(1, z);
    g.lineBetween(a.x, a.y, b.x, b.y);
    // Staggered vertical joints.
    const u = (Math.floor(z / 14) + c + r) % 2 === 0 ? 0.33 : 0.66;
    const j0 = q(u, z);
    const j1 = q(u, Math.min(h, z + 14));
    g.lineBetween(j0.x, j0.y, j1.x, j1.y);
  }
  // A heavier plinth at the base.
  fan(g, shade(wall, side === 'left' ? 0.28 : 0.55), [q(0, 0), q(1, 0), q(1, 10), q(0, 10)]);
}

function drawBuildingTile(g: G, c: number, r: number): void {
  const b = buildingAt(c, r);
  const h = b.height;
  const openLeft = at(c, r + 1) !== 'B';
  const openRight = at(c + 1, r) !== 'B';
  prism(g, c, r, c + 1, r + 1, 0, h, b.wall, { left: openLeft, right: openRight, top: b.roof });
  if (openLeft) coursesOn(g, 'left', c, r, h, b.wall);
  if (openRight) coursesOn(g, 'right', c, r, h, b.wall);
  if (openLeft && c % 2 === 0) windowOn(g, 'left', c, r, h, COLORS.window);
  if (openRight && r % 2 === 1) windowOn(g, 'right', c, r, h, COLORS.windowSide);
  // Roof tiles: rows of slightly darker lines across the flat tops.
  g.lineStyle(0.8 * ART_SCALE, shade(b.roof, 0.25), 0.5);
  for (const k of [0.25, 0.5, 0.75]) {
    const a = P(c, r + k, h);
    const d = P(c + 1, r + k, h);
    g.lineBetween(a.x, a.y, d.x, d.y);
  }
  // Parapet lip catching the sun on open edges.
  if (openLeft) fan(g, lit(b.wall, 0.5), [P(c, r + 1, h), P(c + 1, r + 1, h), P(c + 1, r + 1, h + 4), P(c, r + 1, h + 4)]);
}

function stationAt(c: number, r: number): TaskKind | undefined {
  return TASK_KINDS.find((kind) => TASK_STATIONS[kind].col === c && TASK_STATIONS[kind].row === r);
}

// Accent colour of each station's glowing part; markers above stations use it too.
export const STATION_ACCENT: Readonly<Record<TaskKind, number>> = {
  deposit: 0xffc860,
  ledger: 0x5fd3b0,
  route: 0xffe36a,
  watchtower: 0xff8f6a,
};

// Height in concept px of each station's top, for markers floating above it.
export const STATION_HEIGHT: Readonly<Record<TaskKind, number>> = { deposit: 70, ledger: 58, route: 96, watchtower: 74 };

function drawStation(g: G, kind: TaskKind, c: number, r: number): void {
  const accent = STATION_ACCENT[kind];
  // Shared stone plinth.
  prism(g, c + 0.1, r + 0.1, c + 0.9, r + 0.9, 0, 12, 0xe2c49a, { top: 0xf4e0c0 });
  switch (kind) {
    case 'deposit': {
      // Mint press: a violet block with a gold coin slot and a coin waiting on top.
      prism(g, c + 0.24, r + 0.24, c + 0.76, r + 0.76, 12, 46, 0x8c6bc8);
      fan(g, shade(accent, 0.2), [P(c + 0.36, r + 0.76, 36), P(c + 0.64, r + 0.76, 36), P(c + 0.64, r + 0.76, 42), P(c + 0.36, r + 0.76, 42)]);
      const coin = P(c + 0.5, r + 0.5, 62);
      g.fillStyle(shade(accent, 0.25), 1);
      g.fillEllipse(coin.x, coin.y + 2 * ART_SCALE, 26 * ART_SCALE, 12 * ART_SCALE);
      g.fillStyle(accent, 1);
      g.fillEllipse(coin.x, coin.y, 26 * ART_SCALE, 12 * ART_SCALE);
      break;
    }
    case 'ledger': {
      // Lectern with an open ledger book.
      prism(g, c + 0.4, r + 0.4, c + 0.6, r + 0.6, 12, 34, 0x7a4e3e);
      prism(g, c + 0.22, r + 0.28, c + 0.78, r + 0.72, 46, 6, 0x5a3a30, { top: 0x6b4638 });
      fan(g, 0xfff4dc, [P(c + 0.26, r + 0.32, 52), P(c + 0.5, r + 0.32, 55), P(c + 0.5, r + 0.68, 55), P(c + 0.26, r + 0.68, 52)]);
      fan(g, 0xf1e2c2, [P(c + 0.5, r + 0.32, 55), P(c + 0.74, r + 0.32, 52), P(c + 0.74, r + 0.68, 52), P(c + 0.5, r + 0.68, 55)]);
      g.lineStyle(ART_SCALE, accent, 1);
      for (const k of [0.42, 0.5, 0.58]) {
        const a = P(c + 0.3, r + k, 53);
        const b = P(c + 0.46, r + k, 54.5);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
      break;
    }
    case 'route': {
      // Lightning beacon: a slim mast with a glowing crystal.
      prism(g, c + 0.44, r + 0.44, c + 0.56, r + 0.56, 12, 62, 0x5a4466);
      glow(g, P(c + 0.5, r + 0.5, 84), 34);
      pyramid(g, c + 0.5, r + 0.5, 0.16, 74, 22, accent);
      const tip = P(c + 0.5, r + 0.5, 74);
      fan(g, shade(accent, 0.15), [
        { x: tip.x - 9 * ART_SCALE, y: tip.y },
        { x: tip.x + 9 * ART_SCALE, y: tip.y },
        { x: tip.x, y: tip.y + 12 * ART_SCALE },
      ]);
      break;
    }
    case 'watchtower': {
      // Telescope on a tripod, pointed at the sky.
      g.lineStyle(3 * ART_SCALE, 0x5a4466, 1);
      const top = P(c + 0.5, r + 0.5, 52);
      for (const [dx, dy] of [[-0.25, 0.15], [0.2, 0.22], [0.05, -0.25]] as const) {
        const foot = P(c + 0.5 + dx, r + 0.5 + dy, 12);
        g.lineBetween(foot.x, foot.y, top.x, top.y);
      }
      const back = P(c + 0.35, r + 0.62, 48);
      const front = P(c + 0.68, r + 0.3, 76);
      g.lineStyle(9 * ART_SCALE, 0xd9b27a, 1);
      g.lineBetween(back.x, back.y, front.x, front.y);
      g.fillStyle(accent, 1);
      g.fillCircle(front.x, front.y, 6 * ART_SCALE);
      break;
    }
  }
}

function drawProp(g: G, t: string, c: number, r: number): void {
  switch (t) {
    case 'S': {
      const kind = stationAt(c, r);
      if (kind !== undefined) drawStation(g, kind, c, r);
      break;
    }
    case 'B':
      drawBuildingTile(g, c, r);
      break;
    case 'P':
      prism(g, c + 0.3, r + 0.3, c + 0.7, r + 0.7, 0, 78, 0xf6e2c4);
      prism(g, c + 0.2, r + 0.2, c + 0.8, r + 0.8, 78, 8, COLORS.gold);
      break;
    case 'K':
      prism(g, c + 0.05, r + 0.05, c + 0.95, r + 0.95, 0, 16, 0xb8784e, { top: 0xd69a68 });
      break;
    case 'L': {
      prism(g, c + 0.45, r + 0.45, c + 0.55, r + 0.55, 0, 54, 0x5a4466);
      const orb = P(c + 0.5, r + 0.5, 60);
      glow(g, orb, 40);
      fan(g, 0xffe7a8, [
        { x: orb.x, y: orb.y - 9 * ART_SCALE },
        { x: orb.x + 7 * ART_SCALE, y: orb.y },
        { x: orb.x, y: orb.y + 9 * ART_SCALE },
        { x: orb.x - 7 * ART_SCALE, y: orb.y },
      ]);
      break;
    }
    case 'C':
      prism(g, c + 0.1, r + 0.15, c + 0.55, r + 0.6, 0, 20, 0xc08a58);
      prism(g, c + 0.45, r + 0.45, c + 0.9, r + 0.9, 0, 20, 0xb07a4c);
      prism(g, c + 0.2, r + 0.25, c + 0.5, r + 0.55, 20, 16, 0xcf9a66);
      break;
    case 'G':
      prism(g, c + 0.3, r + 0.3, c + 0.7, r + 0.7, 0, 70, 0xe9c79e);
      pyramid(g, c + 0.5, r + 0.5, 0.26, 70, 18, 0xffc860);
      break;
    default:
      break;
  }
}

function drawVaultDome(g: G): void {
  const centre = P(5.5, 5.5, 120);
  const rim = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    return { x: centre.x + Math.cos(a) * 70 * ART_SCALE, y: centre.y + Math.sin(a) * 35 * ART_SCALE };
  });
  const peak = { x: centre.x, y: centre.y - 46 * ART_SCALE };
  fan(g, 0xb696f0, rim);
  // Facets back to front; ones facing the low western sun are lit, the rest fall into shade.
  const facets = rim.map((a, i) => ({ a, b: rim[(i + 1) % 8] ?? a }));
  facets.sort((p, q) => p.a.y + p.b.y - (q.a.y + q.b.y));
  for (const { a, b } of facets) {
    const midX = (a.x + b.x) / 2 - centre.x;
    const front = (a.y + b.y) / 2 > centre.y;
    const color = midX < 0 ? lit(0xa983ff, front ? 0.3 : 0.15) : shade(0xa983ff, front ? 0.18 : 0.32);
    fan(g, color, [a, b, peak]);
  }
  fan(g, 0xffc860, [
    { x: peak.x, y: peak.y - 12 * ART_SCALE },
    { x: peak.x + 8 * ART_SCALE, y: peak.y },
    { x: peak.x, y: peak.y + 6 * ART_SCALE },
    { x: peak.x - 8 * ART_SCALE, y: peak.y },
  ]);
}

function drawArchiveRoof(g: G): void {
  const z = 96;
  const rise = 38;
  const roof = 0x3e9c8c;
  const c0 = P(13, 1, z);
  const c1 = P(22, 1, z);
  const c2 = P(22, 7, z);
  const c3 = P(13, 7, z);
  const r0 = P(13.6, 4, z + rise);
  const r1 = P(21.4, 4, z + rise);
  fan(g, shade(roof, 0.2), [c0, c1, r1, r0]);
  fan(g, shade(roof, 0.42), [c1, c2, r1]);
  fan(g, lit(roof, 0.2), [c3, c2, r1, r0]);
  fan(g, lit(roof, 0.05), [c0, c3, r0]);
  // Tile rows down the sunlit slope.
  g.lineStyle(1 * ART_SCALE, shade(roof, 0.3), 0.55);
  for (let k = 1; k < 9; k++) {
    const t = k / 9;
    const a = P(13 + 0.6 * t, 7 - 3 * t, z + rise * t);
    const b = P(22 - 0.6 * t, 7 - 3 * t, z + rise * t);
    g.lineBetween(a.x, a.y, b.x, b.y);
  }
  g.lineStyle(1.5 * ART_SCALE, lit(roof, 0.45), 0.9);
  g.lineBetween(r0.x, r0.y, r1.x, r1.y);
}

function drawWatchtowerSpire(g: G): void {
  const s = 168;
  const roof = 0xe26e52;
  const t0 = P(24, 1, s);
  const t1 = P(27, 1, s);
  const t2 = P(27, 5, s);
  const t3 = P(24, 5, s);
  const tip = P(25.5, 3, s + 90);
  fan(g, shade(roof, 0.15), [t0, t1, tip]);
  fan(g, shade(roof, 0.4), [t1, t2, tip]);
  fan(g, lit(roof, 0.2), [t3, t2, tip]);
  fan(g, lit(roof, 0.05), [t0, t3, tip]);
  glow(g, P(25.5, 3, s + 98), 30);
}

function drawGateArch(g: G): void {
  prism(g, 2.3, 26.35, 5.7, 26.65, 70, 12, 0xffc860);
}

// A broadleaf tree drawn around its foot at (0, 0): tapered trunk, then canopy clusters back to front.
function drawTree(g: G, seed: number): void {
  const s = ART_SCALE;
  const rand = (k: number): number => {
    const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  g.fillStyle(0x6e4636, 1);
  g.fillTriangle(-5 * s, 0, 5 * s, 0, 2 * s, -40 * s);
  g.fillTriangle(-5 * s, 0, 2 * s, -40 * s, -2 * s, -40 * s);
  g.fillStyle(0x8a5a44, 1);
  g.fillTriangle(-5 * s, 0, -2 * s, -40 * s, -1 * s, 0);
  // A branch fork.
  g.lineStyle(2.5 * s, 0x6e4636, 1);
  g.lineBetween(0, -30 * s, 9 * s, -44 * s);
  g.lineBetween(0, -34 * s, -8 * s, -46 * s);
  const blobs: [number, number, number][] = [];
  for (let i = 0; i < 9; i++) {
    const a = rand(i) * Math.PI * 2;
    const d = rand(i + 20) * 18;
    blobs.push([Math.cos(a) * d * s, (-58 + Math.sin(a) * d * 0.7) * s, (12 + rand(i + 40) * 9) * s]);
  }
  // Shaded underside, mid foliage, then sunlit tops on the west (left) side.
  for (const [x, y, rr] of blobs) {
    g.fillStyle(0x4f7a3e, 1);
    g.fillCircle(x + 2 * s, y + 4 * s, rr);
  }
  for (const [x, y, rr] of blobs) {
    g.fillStyle(0x6f9e48, 1);
    g.fillCircle(x, y, rr * 0.88);
  }
  for (const [x, y, rr] of blobs) {
    g.fillStyle(0x9cc45e, 1);
    g.fillCircle(x - rr * 0.28, y - rr * 0.3, rr * 0.5);
  }
  for (let i = 0; i < 14; i++) {
    g.fillStyle(rand(i + 60) > 0.5 ? 0xc8e07c : 0x86b250, 0.9);
    g.fillCircle((rand(i + 80) - 0.6) * 30 * s, (-70 + rand(i + 90) * 26) * s, 1.8 * s);
  }
  // Warm rim of golden-hour light on the sun side.
  g.lineStyle(1.5 * s, 0xffe3a0, 0.5);
  g.beginPath();
  g.arc(-4 * s, -60 * s, 24 * s, Math.PI * 0.75, Math.PI * 1.35);
  g.strokePath();
}

export interface Swaying {
  readonly g: Phaser.GameObjects.Graphics;
  readonly phase: number;
  // Taller things sway more.
  readonly amount: number;
}

// Every prop gets its own Graphics so avatars can be drawn between them in painter's order.
// Returns the trees, which the scene sways in the wind.
export function createProps(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer): Swaying[] {
  const swaying: Swaying[] = [];
  const add = (depthSum: number, draw: (g: G) => void): void => {
    const g = new Phaser.GameObjects.Graphics(scene);
    draw(g);
    g.setDepth(depthSum * (TILE_H / 2));
    layer.add(g);
  };
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      const t = at(c, r);
      if (t === '#' || t === '.' || t === '=' || t === '~') continue;
      if (t === 'T') {
        const foot = P(c + 0.5, r + 0.5);
        const g = new Phaser.GameObjects.Graphics(scene);
        drawTree(g, c * 31 + r);
        g.setPosition(foot.x, foot.y).setScale(1.35).setDepth((c + r + 1) * (TILE_H / 2));
        layer.add(g);
        swaying.push({ g, phase: (c * 1.7 + r * 0.9) % (Math.PI * 2), amount: 1 });
        continue;
      }
      add(c + r + 1, (g) => {
        drawProp(g, t, c, r);
      });
    }
  }
  // Crowns sort just after the last tile of their building (front corner sum).
  add(18.5, drawVaultDome);
  add(28.5, drawArchiveRoof);
  add(31.5, drawWatchtowerSpire);
  add(32.5, drawGateArch);
  return swaying;
}

// Screen points of every lit window, so the evening can make them glow.
export function windowLights(): Pt[] {
  const out: Pt[] = [];
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      if (at(c, r) !== 'B') continue;
      const h = buildingAt(c, r).height;
      if (at(c, r + 1) !== 'B' && c % 2 === 0) out.push(P(c + 0.5, r + 1, h * 0.54));
      if (at(c + 1, r) !== 'B' && r % 2 === 1) out.push(P(c + 1, r + 0.5, h * 0.54));
    }
  }
  return out;
}

// Wind in the world: a slow breeze with gusts that roll across the island from the west.
export function windAt(timeMs: number, x: number): number {
  const t = timeMs / 1000;
  const breeze = 0.55 + 0.25 * Math.sin(t / 7.3);
  const gust = Math.max(0, Math.sin(t / 3.1 - x / 900)) ** 6 * 0.9;
  return breeze + gust;
}

// Area names painted on the floor in front of each building.
export const AREA_LABELS: readonly { readonly text: string; readonly x: number; readonly y: number }[] = [
  { text: 'VAULT', x: 5.5, y: 9.6 },
  { text: 'LEDGER ARCHIVE', x: 16.2, y: 8.1 },
  { text: 'WATCHTOWER', x: 25.2, y: 6.3 },
  { text: 'PLAZA', x: 12.4, y: 11.2 },
  { text: 'SIGNING HALL', x: 5.2, y: 16.6 },
  { text: 'DEPOSIT GATE', x: 4.6, y: 25.4 },
  { text: 'GATEWAY DOCK', x: 26.4, y: 18.2 },
];

export function labelPoint(x: number, y: number): Pt {
  return P(x, y);
}

export const GROUND_DEPTH = 0;
export const WATER_DEPTH = 1;
export const AREA_LABEL_DEPTH = 2;
export const ENTITY_DEPTH = 10;
export const NAME_DEPTH = 20;
