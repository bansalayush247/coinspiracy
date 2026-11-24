// Lightning Reef: a lagoon of sandy islets joined by plank bridges. The ground reuses the beach
// painter with reef water; the props are the reef's own: a pearl vault, a lighthouse, a signing
// pavilion, coral, and light pulses that run along the bridges like payments through channels.
import Phaser from 'phaser';
import { REEF, REEF_BRIDGES, REEF_BUILDINGS, REEF_ISLETS, TASK_KINDS, tileAt, type Arena, type Box, type TaskKind } from '@byzantine-council/shared';
import { P, drawBoat, drawHut, drawPalm, drawTorch, fan, paintBeach, prism, type ShoreStyle } from '../beach/beachArt.js';
import { rng } from './groundPaint.js';
import { islandPaths } from './islandPaths.js';
import { ART_SCALE, TILE_H } from './iso.js';
import { drawStation, type Swaying } from './mapArt.js';
import { lit, mix, shade } from './palette.js';

type G = Phaser.GameObjects.Graphics;

const REEF_GROUND = 'reef-ground';

// Distance from a point to the nearest land tile's edge, capped at 4: continuous, so depth shades smoothly.
function shoreDistance(x: number, y: number): number {
  let best = 4;
  const c0 = Math.floor(x);
  const r0 = Math.floor(y);
  for (let r = r0 - 4; r <= r0 + 4; r++) {
    for (let c = c0 - 4; c <= c0 + 4; c++) {
      const t = tileAt(REEF.map, c, r);
      if (t === '~' || t === '#') continue;
      const dx = Math.max(c - x, 0, x - (c + 1));
      const dy = Math.max(r - y, 0, y - (r + 1));
      best = Math.min(best, Math.hypot(dx, dy));
    }
  }
  return best;
}

// The lagoon is shallow turquoise along every islet and deep blue in the open channels.
const REEF_STYLE: ShoreStyle = {
  deep: (x, y) => (shoreDistance(x, y) - 0.3) / 2.6,
  smooth: true,
  heights: { B: 150, T: 130, L: 60, S: 70, K: 60, R: 30, C: 30, U: 70, N: 50 },
  key: REEF_GROUND,
};

export function paintReef(scene: Phaser.Scene): { key: string; x: number; y: number; scale: number } {
  return paintBeach(scene, REEF.map, REEF_STYLE);
}

// Everything flat on the reef, on the ground layer: coral, shell paths, the square's mosaic, beach litter.
export function drawReefGround(g: G): void {
  drawCoralBeds(g);
  drawShellPaths(g);
  drawMosaic(g);
  drawBeachBits(g);
}

// Coral heads under the shallow water.
function drawCoralBeds(g: G): void {
  const colors = [0xff8a9a, 0xffa45c, 0xc98bff, 0xffd27a, 0x7fd8c0];
  for (let r = 1; r < REEF.map.height - 1; r++) {
    for (let c = 1; c < REEF.map.width - 1; c++) {
      if (tileAt(REEF.map, c, r) !== '~') continue;
      const d = shoreDistance(c + 0.5, r + 0.5);
      const rand = rng(c * 613 + r * 389);
      // Coral grows in the shallows only, in occasional clumps.
      if (d > 1.2 || rand() > 0.22) continue;
      const col = colors[Math.floor(rand() * colors.length)] ?? 0xff8a9a;
      const cx = c + 0.25 + rand() * 0.5;
      const cy = r + 0.25 + rand() * 0.5;
      for (let i = 0; i < 4; i++) {
        const at = P(cx + (rand() - 0.5) * 0.35, cy + (rand() - 0.5) * 0.35);
        // Seen through water: soft, a little blue, and faint.
        g.fillStyle(mix(col, 0x3fa7b5, 0.45), 0.3);
        g.fillEllipse(at.x, at.y, (14 + rand() * 10) * ART_SCALE, (7 + rand() * 4) * ART_SCALE);
      }
    }
  }
}

// Footprint width in tiles and the scale factor against the 2-tile size the shapes were drawn for.
const sizeOf = (b: Box): { w: number; d: number; k: number } => {
  const w = b.c1 + 1 - b.c0;
  const d = b.r1 + 1 - b.r0;
  return { w, d, k: Math.min(w, d) / 2 };
};

// The Pearl Vault: a white stone drum under a nacre dome, crowned with a pearl, with columns at the door.
function drawPearlVault(g: G, b: Box): void {
  const { k } = sizeOf(b);
  const [c0, r0, c1, r1] = [b.c0, b.r0, b.c1 + 1, b.r1 + 1];
  prism(g, c0 + 0.1, r0 + 0.1, c1 - 0.1, r1 - 0.1, 0, 12, 0xd9c8b0, 0xeadcc6);
  prism(g, c0 + 0.45, r0 + 0.45, c1 - 0.45, r1 - 0.45, 12, 52 * k, 0xf4ece0);
  // Pilasters and a frieze of pearls on the two faces you see.
  for (let i = 1; i < 6; i++) {
    const x = c0 + 0.45 + ((c1 - c0 - 0.9) * i) / 6;
    prism(g, x - 0.06, r1 - 0.5, x + 0.06, r1 - 0.38, 12, 52 * k, 0xfff8ee);
    const y = r0 + 0.45 + ((r1 - r0 - 0.9) * i) / 6;
    prism(g, c1 - 0.5, y - 0.06, c1 - 0.38, y + 0.06, 12, 52 * k, 0xfff8ee);
  }
  const mid = (c0 + c1) / 2;
  fan(g, 0x5a4466, [P(mid - 0.35, r1 - 0.44, 12), P(mid + 0.35, r1 - 0.44, 12), P(mid + 0.35, r1 - 0.44, 44 * k), P(mid, r1 - 0.44, 54 * k), P(mid - 0.35, r1 - 0.44, 44 * k)]);
  // Steps up to the door.
  prism(g, mid - 0.5, r1 - 0.4, mid + 0.5, r1 - 0.1, 0, 8, 0xe6d8c4);
  const cx = mid;
  const cy = (r0 + r1) / 2;
  const top = 12 + 52 * k;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const rad = Math.cos((t * Math.PI) / 2) * 0.62 * (c1 - c0 - 0.9);
    const at = P(cx, cy, top + 10 + 44 * k * Math.sin((t * Math.PI) / 2));
    g.fillStyle(mix(0xd9cfe8, 0xffffff, t * 0.75), 1);
    g.fillEllipse(at.x, at.y, rad * 64 * ART_SCALE * 1.4, rad * 32 * ART_SCALE * 1.4);
  }
  const crown = P(cx, cy, top + 12 + 44 * k);
  g.fillStyle(0xfff6fb, 1);
  g.fillCircle(crown.x, crown.y - 8 * ART_SCALE, 11 * ART_SCALE);
  g.fillStyle(0xffffff, 0.9);
  g.fillCircle(crown.x - 4 * ART_SCALE, crown.y - 12 * ART_SCALE, 3.5 * ART_SCALE);
}

// A red-and-white lighthouse on a rock base, with a gallery, a lamp room and a keeper's door.
function drawLighthouse(g: G, b: Box): void {
  const { w, k } = sizeOf(b);
  const cx = b.c0 + w / 2;
  const cy = b.r0 + (b.r1 + 1 - b.r0) / 2;
  prism(g, b.c0 + 0.08, b.r0 + 0.08, b.c1 + 0.92, b.r1 + 0.92, 0, 16, 0xa8988a, 0xc6b8a8);
  const bands = 7;
  const band = 24 * k;
  for (let i = 0; i < bands; i++) {
    const half = (0.74 - i * 0.06) * k;
    prism(g, cx - half, cy - half, cx + half, cy + half, 16 + i * band, band, i % 2 === 0 ? 0xf4ece0 : 0xe0525a);
  }
  fan(g, 0x4a3a52, [P(cx - 0.18, cy + 0.74 * k + 0.01, 16), P(cx + 0.18, cy + 0.74 * k + 0.01, 16), P(cx + 0.18, cy + 0.74 * k + 0.01, 16 + 40 * k), P(cx - 0.18, cy + 0.74 * k + 0.01, 16 + 40 * k)]);
  const z = 16 + bands * band;
  prism(g, cx - 0.6 * k, cy - 0.6 * k, cx + 0.6 * k, cy + 0.6 * k, z, 6, 0x4a3a52, 0x6a5a72);
  prism(g, cx - 0.32 * k, cy - 0.32 * k, cx + 0.32 * k, cy + 0.32 * k, z + 6, 28 * k, 0xffe9a8, 0xfff4d0);
  const lamp = P(cx, cy, z + 20 * k);
  g.fillStyle(0xfff1c9, 0.35);
  g.fillCircle(lamp.x, lamp.y, 34 * ART_SCALE * k);
  const peak = P(cx, cy, z + 64 * k);
  fan(g, 0x9a3a44, [P(cx - 0.42 * k, cy + 0.42 * k, z + 34 * k), P(cx + 0.42 * k, cy + 0.42 * k, z + 34 * k), peak]);
  fan(g, 0x7a2a34, [P(cx + 0.42 * k, cy + 0.42 * k, z + 34 * k), P(cx + 0.42 * k, cy - 0.42 * k, z + 34 * k), peak]);
}

// The open signing pavilion: a round table under a teal sail on four posts, with benches.
function drawPavilion(g: G, b: Box): void {
  const { w, d } = sizeOf(b);
  const [c, r] = [b.c0, b.r0];
  const h = 70 + 12 * w;
  prism(g, c + 0.05, r + 0.05, c + w - 0.05, r + d - 0.05, 0, 6, 0xc9a27a, 0xe0bf94);
  for (const [x, y] of [[0.1, 0.1], [w - 0.1, 0.1], [w - 0.1, d - 0.1], [0.1, d - 0.1]] as const) prism(g, c + x - 0.07, r + y - 0.07, c + x + 0.07, r + y + 0.07, 6, h, 0x7a4e3e);
  // Benches on two sides, then the table.
  prism(g, c + 0.4, r + 0.35, c + w - 0.4, r + 0.6, 6, 18, 0x9a6a3e, 0xb8844e);
  prism(g, c + 0.4, r + d - 0.6, c + w - 0.4, r + d - 0.35, 6, 18, 0x9a6a3e, 0xb8844e);
  prism(g, c + 0.8, r + 0.9, c + w - 0.8, r + d - 0.9, 6, 30, 0xb8784e, 0xd69a68);
  const scroll = P(c + w / 2, r + d / 2, 38);
  g.fillStyle(0xfff4dc, 1);
  g.fillEllipse(scroll.x, scroll.y, 34 * ART_SCALE, 11 * ART_SCALE);
  g.fillStyle(0xe0525a, 1);
  g.fillCircle(scroll.x + 7 * ART_SCALE, scroll.y, 4.5 * ART_SCALE);
  const sail = 0x3fa7b5;
  const apex = P(c + w / 2, r + d / 2, h + 26);
  fan(g, shade(sail, 0.1), [P(c, r, h + 4), P(c + w, r, h + 4), apex]);
  fan(g, shade(sail, 0.2), [P(c + w, r, h + 4), P(c + w, r + d, h), apex]);
  fan(g, lit(sail, 0.15), [P(c, r, h + 4), P(c, r + d, h), apex]);
  fan(g, lit(sail, 0.05), [P(c, r + d, h), P(c + w, r + d, h), apex]);
  // Scalloped hem along the front edge.
  for (let i = 0; i < w * 3; i++) {
    const a = P(c + (i + 0.5) / 3, r + d, h);
    g.fillStyle(i % 2 === 0 ? 0xf4ece0 : lit(sail, 0.1), 1);
    g.fillTriangle(a.x - 10 * ART_SCALE, a.y - 3 * ART_SCALE, a.x + 10 * ART_SCALE, a.y + 2 * ART_SCALE, a.x, a.y + 12 * ART_SCALE);
  }
}

// A market stall with a striped awning and baskets of fruit and fish.
function drawStall(g: G, b: Box): void {
  const { w, d } = sizeOf(b);
  const [c, r] = [b.c0, b.r0];
  for (const [x, y] of [[0.1, 0.1], [w - 0.1, 0.1], [w - 0.1, d - 0.1], [0.1, d - 0.1]] as const) prism(g, c + x - 0.05, r + y - 0.05, c + x + 0.05, r + y + 0.05, 0, 78, 0x7a4e3e);
  prism(g, c + 0.15, r + 0.2, c + w - 0.15, r + d - 0.15, 0, 30, 0xb8784e, 0xd69a68);
  const goods = [0xffa45c, 0xffd27a, 0xe0525a, 0x7fd8c0, 0x9ad06a];
  for (let i = 0; i < w * 3; i++) {
    const at = P(c + 0.35 + (i * (w - 0.7)) / (w * 3 - 1), r + d / 2, 32);
    g.fillStyle(0x8a5a3a, 1);
    g.fillEllipse(at.x, at.y, 16 * ART_SCALE, 8 * ART_SCALE);
    g.fillStyle(goods[i % goods.length] ?? 0xffd27a, 1);
    g.fillCircle(at.x - 3 * ART_SCALE, at.y - 3 * ART_SCALE, 3.5 * ART_SCALE);
    g.fillCircle(at.x + 3 * ART_SCALE, at.y - 4 * ART_SCALE, 3.5 * ART_SCALE);
  }
  // Awning stripes along the length, sloping down to the front.
  const stripes = w * 4;
  for (let i = 0; i < stripes; i++) {
    const x0 = c + (i * w) / stripes;
    const x1 = c + ((i + 1) * w) / stripes;
    fan(g, i % 2 === 0 ? 0xf4ece0 : 0xe0525a, [P(x0, r - 0.05, 92), P(x1, r - 0.05, 92), P(x1, r + d + 0.15, 74), P(x0, r + d + 0.15, 74)]);
  }
}

// A beach parasol over a towel.
function drawParasol(g: G, c: number, r: number, seed: number): void {
  const rand = rng(seed);
  const colors = [[0xe0525a, 0xf4ece0], [0x3fa7b5, 0xfff4dc], [0xffa45c, 0xfff4dc]][Math.floor(rand() * 3)] ?? [0xe0525a, 0xf4ece0];
  const towel = [P(c + 0.15, r + 0.45), P(c + 0.85, r + 0.45), P(c + 0.85, r + 0.95), P(c + 0.15, r + 0.95)];
  fan(g, colors[0] ?? 0xe0525a, towel, 0.85);
  const foot = P(c + 0.5, r + 0.5);
  g.lineStyle(2.5 * ART_SCALE, 0x7a4e3e, 1);
  g.lineBetween(foot.x, foot.y, foot.x, foot.y - 70 * ART_SCALE);
  const top = { x: foot.x, y: foot.y - 82 * ART_SCALE };
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const rim = (a: number): { x: number; y: number } => ({ x: foot.x + Math.cos(a) * 34 * ART_SCALE, y: foot.y - 64 * ART_SCALE + Math.sin(a) * 15 * ART_SCALE });
    const p0 = rim(a0);
    const p1 = rim(a1);
    g.fillStyle(i % 2 === 0 ? (colors[0] ?? 0xe0525a) : (colors[1] ?? 0xf4ece0), 1);
    g.fillTriangle(top.x, top.y, p0.x, p0.y, p1.x, p1.y);
  }
}

// Fishing nets drying on a rack of two poles, with cork floats.
function drawNetRack(g: G, c: number, r: number): void {
  const a = P(c + 0.15, r + 0.5);
  const b = P(c + 0.85, r + 0.5);
  const lift = 56 * ART_SCALE;
  g.lineStyle(3 * ART_SCALE, 0x7a4e3e, 1);
  g.lineBetween(a.x, a.y, a.x, a.y - lift);
  g.lineBetween(b.x, b.y, b.x, b.y - lift);
  g.lineBetween(a.x, a.y - lift, b.x, b.y - lift);
  g.lineStyle(1 * ART_SCALE, 0x5a6a6a, 0.8);
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y - lift + (b.y - a.y) * t;
    g.lineBetween(x, y, x + 4 * ART_SCALE, y + 36 * ART_SCALE);
  }
  for (let j = 1; j <= 4; j++) {
    const off = j * 9 * ART_SCALE;
    g.lineBetween(a.x + off * 0.1, a.y - lift + off, b.x + off * 0.1, b.y - lift + off);
  }
  g.fillStyle(0xffa45c, 1);
  for (let i = 0; i < 4; i++) {
    const t = (i + 0.5) / 4;
    g.fillCircle(a.x + (b.x - a.x) * t + 4 * ART_SCALE, a.y - lift + (b.y - a.y) * t + 38 * ART_SCALE, 3 * ART_SCALE);
  }
}

// Branching coral on a rock.
function drawCoralRock(g: G, c: number, r: number): void {
  fan(g, 0x9a8a92, [P(c + 0.1, r + 0.8), P(c + 0.9, r + 0.8), P(c + 0.75, r + 0.3, 20), P(c + 0.3, r + 0.4, 16)]);
  fan(g, 0x7a6a78, [P(c + 0.9, r + 0.8), P(c + 0.85, r + 0.2), P(c + 0.75, r + 0.3, 20)]);
  const base = P(c + 0.5, r + 0.5, 18);
  g.lineStyle(3 * ART_SCALE, 0xff8a9a, 1);
  for (const [dx, dy] of [[-8, -20], [0, -26], [9, -18], [-14, -12], [14, -10]] as const) {
    g.lineBetween(base.x, base.y, base.x + dx * ART_SCALE, base.y + dy * ART_SCALE);
    g.fillStyle(0xffb0bc, 1);
    g.fillCircle(base.x + dx * ART_SCALE, base.y + dy * ART_SCALE, 2.5 * ART_SCALE);
  }
}

function drawCrates(g: G, c: number, r: number): void {
  prism(g, c + 0.12, r + 0.12, c + 0.88, r + 0.88, 0, 26, 0xb8784e, 0xd69a68);
  prism(g, c + 0.3, r + 0.3, c + 0.7, r + 0.7, 26, 18, 0xa86a40, 0xc98a5a);
}

function stationAt(c: number, r: number): TaskKind | undefined {
  return TASK_KINDS.find((k) => REEF.stations[k].col === c && REEF.stations[k].row === r);
}

// Every standing thing on the reef, each its own Graphics so guardians sort between them.
export function createReefProps(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer): Swaying[] {
  const swaying: Swaying[] = [];
  const add = (depthSum: number, draw: (g: G) => void): void => {
    const g = new Phaser.GameObjects.Graphics(scene);
    draw(g);
    g.setDepth(depthSum * (TILE_H / 2));
    layer.add(g);
  };
  for (const b of REEF_BUILDINGS) {
    const { w } = sizeOf(b.box);
    add(b.box.c1 + b.box.r1 + 1, (g) => {
      if (b.kind === 'pearlVault') drawPearlVault(g, b.box);
      else if (b.kind === 'lighthouse') drawLighthouse(g, b.box);
      else if (b.kind === 'pavilion') drawPavilion(g, b.box);
      else if (b.kind === 'stall') drawStall(g, b.box);
      else drawHut(g, b.box.c0, b.box.r0, w);
    });
  }
  for (let r = 0; r < REEF.map.height; r++) {
    for (let c = 0; c < REEF.map.width; c++) {
      const t = tileAt(REEF.map, c, r);
      if (t === 'T') {
        const foot = P(c + 0.5, r + 0.5);
        const g = new Phaser.GameObjects.Graphics(scene);
        drawPalm(g, c * 13 + r * 7);
        g.setPosition(foot.x, foot.y).setDepth((c + r + 1) * (TILE_H / 2));
        layer.add(g);
        swaying.push({ g, phase: (c * 0.7 + r) % 6.28, amount: 1.6 });
      } else if (t === 'L') {
        add(c + r + 1, (g) => {
          drawTorch(g, c, r);
        });
      } else if (t === 'R') {
        add(c + r + 1, (g) => {
          drawCoralRock(g, c, r);
        });
      } else if (t === 'C') {
        add(c + r + 1, (g) => {
          drawCrates(g, c, r);
        });
      } else if (t === 'U') {
        add(c + r + 1, (g) => {
          drawParasol(g, c, r, c * 7 + r * 13);
        });
      } else if (t === 'N') {
        add(c + r + 1, (g) => {
          drawNetRack(g, c, r);
        });
      } else if (t === 'S') {
        const kind = stationAt(c, r);
        if (kind !== undefined) {
          add(c + r + 1, (g) => {
            drawStation(g, kind, c, r);
          });
        }
      }
    }
  }
  return swaying;
}

// Islet names painted on the sand, from the arena's own place names.
export function reefLabels(arena: Arena = REEF): { text: string; x: number; y: number }[] {
  return Object.entries(REEF_ISLETS).map(([room, b]) => ({
    text: (arena.roomNames[room as keyof typeof arena.roomNames]).replace(/^the /, '').toUpperCase(),
    x: (b.c0 + b.c1 + 1) / 2,
    y: b.r1 + 0.6,
  }));
}

// Light pulses running along the bridges (the reef's payment channels), and a moored boat that bobs.
export class ReefLife {
  readonly #pulses: Phaser.GameObjects.Graphics;
  readonly #boat: Phaser.GameObjects.Graphics;
  readonly #lanes: { ax: number; ay: number; bx: number; by: number; offset: number; speed: number }[];
  readonly #boatAt = P(36.8, 39.4);

  constructor(scene: Phaser.Scene, depth: number) {
    this.#pulses = scene.add.graphics().setDepth(depth).setBlendMode(Phaser.BlendModes.ADD);
    this.#boat = scene.add.graphics().setDepth(depth - 0.5);
    drawBoat(this.#boat, 0xffd27a);
    this.#boat.setPosition(this.#boatAt.x, this.#boatAt.y);
    // Each bridge carries a lane down its long axis, slightly offset so the two directions don't overlap.
    this.#lanes = REEF_BRIDGES.flatMap((b, i) => {
      const horizontal = b.c1 - b.c0 >= b.r1 - b.r0;
      const midR = (b.r0 + b.r1 + 1) / 2;
      const midC = (b.c0 + b.c1 + 1) / 2;
      const a = horizontal ? { x: b.c0 - 0.3, y: midR } : { x: midC, y: b.r0 - 0.3 };
      const z = horizontal ? { x: b.c1 + 1.3, y: midR } : { x: midC, y: b.r1 + 1.3 };
      return [
        { ax: a.x, ay: a.y - 0.25, bx: z.x, by: z.y - 0.25, offset: i * 0.37, speed: 0.35 + (i % 3) * 0.08 },
        { ax: z.x + 0.25, ay: z.y, bx: a.x + 0.25, by: a.y, offset: i * 0.61, speed: 0.3 + (i % 2) * 0.1 },
      ];
    });
  }

  update(time: number, reducedMotion: boolean): void {
    const t = time / 1000;
    this.#boat.y = this.#boatAt.y + (reducedMotion ? 0 : Math.sin(t * 1.3) * 2 * ART_SCALE);
    this.#boat.rotation = reducedMotion ? 0 : Math.sin(t * 0.9) * 0.03;
    const g = this.#pulses;
    g.clear();
    if (reducedMotion) return;
    for (const lane of this.#lanes) {
      const k = (t * lane.speed + lane.offset) % 1;
      const at = P(lane.ax + (lane.bx - lane.ax) * k, lane.ay + (lane.by - lane.ay) * k, 4);
      // A bright head with a soft halo, fading in and out at the ends of the bridge.
      const fade = Math.sin(k * Math.PI);
      g.fillStyle(0xffd27a, 0.25 * fade);
      g.fillCircle(at.x, at.y, 9 * ART_SCALE);
      g.fillStyle(0xfff6d0, 0.85 * fade);
      g.fillCircle(at.x, at.y, 3 * ART_SCALE);
    }
  }
}

const REEF_PATHS = islandPaths(REEF.map, REEF_ISLETS, REEF_BRIDGES, { plaza: REEF.seal });

// Crushed-shell paths: paler than the sand, with flecks of shell.
function drawShellPaths(g: G): void {
  for (const key of REEF_PATHS) {
    const [c = 0, r = 0] = key.split(',').map(Number);
    const rand = rng(c * 211 + r * 97);
    fan(g, 0xfff4e2, [P(c, r), P(c + 1, r), P(c + 1, r + 1), P(c, r + 1)], 0.42);
    for (let i = 0; i < 7; i++) {
      const at = P(c + rand(), r + rand());
      g.fillStyle(rand() > 0.5 ? 0xffffff : 0xf2c9c0, 0.7);
      g.fillEllipse(at.x, at.y, 4 * ART_SCALE, 2 * ART_SCALE);
    }
  }
}

// A shell mosaic compass under the council seal on Lagoon Square.
function drawMosaic(g: G): void {
  const { x, y } = REEF.seal;
  for (const [radius, color, alpha] of [[3.1, 0x3fa7b5, 0.35], [2.7, 0xfff4e2, 0.7], [1.2, 0xffd27a, 0.55], [0.8, 0xfff4e2, 0.8]] as const) {
    const pts = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2;
      return P(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
    });
    fan(g, color, pts, alpha);
  }
  // Eight points of the compass.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const len = i % 2 === 0 ? 2.5 : 1.7;
    const side = a + Math.PI / 2;
    fan(g, i % 2 === 0 ? 0xe0525a : 0x3fa7b5, [P(x + Math.cos(side) * 0.22, y + Math.sin(side) * 0.22), P(x + Math.cos(a) * len, y + Math.sin(a) * len), P(x - Math.cos(side) * 0.22, y - Math.sin(side) * 0.22)], 0.75);
  }
}

// Shells, starfish and footprints on the open sand.
function drawBeachBits(g: G): void {
  for (let r = 1; r < REEF.map.height - 1; r++) {
    for (let c = 1; c < REEF.map.width - 1; c++) {
      if (tileAt(REEF.map, c, r) !== '.' || REEF_PATHS.has(`${String(c)},${String(r)}`)) continue;
      const rand = rng(c * 389 + r * 613);
      const roll = rand();
      const at = P(c + 0.2 + rand() * 0.6, r + 0.2 + rand() * 0.6);
      if (roll < 0.05) {
        // A starfish.
        g.fillStyle(rand() > 0.5 ? 0xff8a5c : 0xe0525a, 0.95);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
          g.fillTriangle(at.x - 2 * ART_SCALE, at.y, at.x + 2 * ART_SCALE, at.y, at.x + Math.cos(a) * 9 * ART_SCALE, at.y + Math.sin(a) * 5 * ART_SCALE);
        }
      } else if (roll < 0.14) {
        // A scallop shell.
        g.fillStyle(rand() > 0.5 ? 0xfff0e8 : 0xf6c8c0, 1);
        g.fillTriangle(at.x - 5 * ART_SCALE, at.y - 3 * ART_SCALE, at.x + 5 * ART_SCALE, at.y - 3 * ART_SCALE, at.x, at.y + 3 * ART_SCALE);
        g.fillCircle(at.x, at.y - 3 * ART_SCALE, 5 * ART_SCALE);
      } else if (roll < 0.2) {
        // Tufts of dune grass.
        g.lineStyle(1.5 * ART_SCALE, 0x8aa34e, 0.9);
        for (let i = -2; i <= 2; i++) g.lineBetween(at.x + i * 2 * ART_SCALE, at.y, at.x + i * 4 * ART_SCALE, at.y - (10 + rand() * 6) * ART_SCALE);
      }
    }
  }
}
