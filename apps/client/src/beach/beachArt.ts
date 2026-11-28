// Beach Town art: painted sand, a turquoise lagoon with foam, the boardwalk, striped shop booths,
// palms that sway in the sea breeze, umbrellas and rocks.
import Phaser from 'phaser';
import { tileAt, type CitadelMap } from '@byzantine-council/shared';
import { SHOPS, colorNumber, getItem, isBeachShop, type BeachShopId } from '@byzantine-council/shared/economy';
import { BEACH_LANDMARKS, BEACH_MAP, HOME_HUT, SHOP_BOOTHS } from '@byzantine-council/shared/hub';
import { hex, jitter, paintCliffs, paintPlanks, rng, softPatch, type Ctx } from '../game/groundPaint.js';
import { ART_SCALE, TILE_H, TILE_W, mapScreenBounds } from '../game/iso.js';
import { lit, mix, seatColors, shade } from '../game/palette.js';
import { quality } from '../game/quality.js';
import { drawGuardian } from '../game/guardianArt.js';
import type { Swaying } from '../game/mapArt.js';

export const BEACH_GROUND = 'beach-ground';
const PAD_TOP = 40;
const PAD_BOTTOM = 260;
const SAND = 0xf2d9a6;
const WET = 0xd6b27c;
export const BEACH_SEA = 0x2f86b5;

type G = Phaser.GameObjects.Graphics;
interface Pt {
  readonly x: number;
  readonly y: number;
}
export function P(x: number, y: number, z = 0): Pt {
  return { x: (x - y) * (TILE_W / 2), y: (x + y) * (TILE_H / 2) - z * ART_SCALE };
}
export function fan(g: G, color: number, pts: readonly Pt[], alpha = 1): void {
  const [a] = pts;
  if (a === undefined) return;
  g.fillStyle(color, alpha);
  for (let i = 1; i < pts.length - 1; i++) {
    const b = pts[i];
    const c = pts[i + 1];
    if (b !== undefined && c !== undefined) g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
  }
}
export function prism(g: G, x0: number, y0: number, x1: number, y1: number, z0: number, h: number, col: number, top?: number): void {
  const z1 = z0 + h;
  fan(g, lit(col, 0.05), [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)]);
  fan(g, shade(col), [P(x1, y1, z0), P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1)]);
  fan(g, top ?? lit(col, 0.3), [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)]);
}

// How the painter shades a map: water depth per tile (0 shallow, 1 deep) and shadow-casting heights.
export interface ShoreStyle {
  readonly deep: (c: number, r: number) => number;
  // Sample depth on a 4 x 4 grid inside each water tile (deep takes fractional positions), so it shades smoothly.
  readonly smooth?: boolean;
  readonly heights: Readonly<Record<string, number>>;
  readonly key: string;
}

export function paintBeach(scene: Phaser.Scene, map: CitadelMap = BEACH_MAP, style: ShoreStyle = BEACH_STYLE): { key: string; x: number; y: number; scale: number } {
  const margin = style === BEACH_STYLE ? 5 : 0;
  const bounds = mapScreenBounds(map.width + margin * 2, map.height + margin * 2);
  const y = -PAD_TOP - margin * TILE_H;
  const w = bounds.width;
  const h = bounds.height + PAD_TOP + PAD_BOTTOM;
  const scale = Math.min(quality.current === 'low' ? 0.5 : 1, 4096 / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2d canvas');
  const ox = -bounds.x;
  const at = (c: number, r: number): string => tileAt(map, c, r);
  ctx.setTransform(scale, 0, 0, scale, ox * scale, -y * scale);
  if (margin === 0) paintCliffs(ctx, map, at);
  ctx.setTransform((TILE_W / 2) * scale, (TILE_H / 2) * scale, (-TILE_W / 2) * scale, (TILE_H / 2) * scale, ox * scale, -y * scale);
  if (margin > 0) paintShallows(ctx, map, margin);
  paintSandAndSea(ctx, map, style === BEACH_STYLE ? beachTile : at, style.deep, style.smooth === true, margin);
  paintBeachShadows(ctx, map, at, style.heights);
  if (scene.textures.exists(style.key)) scene.textures.remove(style.key);
  scene.textures.addCanvas(style.key, canvas);
  return { key: style.key, x: bounds.x, y, scale };
}

function nearWater(at: (c: number, r: number) => string, c: number, r: number): number {
  let best = 9;
  for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) if (at(c + dc, r + dr) === '~') best = Math.min(best, Math.hypot(dc, dr));
  return best;
}

function paintSandAndSea(ctx: Ctx, map: CitadelMap, at: (c: number, r: number) => string, deep: (c: number, r: number) => number, smooth: boolean, margin: number): void {
  for (let r = -margin; r < map.height + margin; r++) {
    for (let c = -margin; c < map.width + margin; c++) {
      const t = at(c, r);
      if (t === '#') continue;
      const rand = rng(c * 811 + r * 977);
      if (t === '~') {
        // Shallow turquoise over the sand near the shore, deep blue further out.
        const clamp = (v: number): number => Math.min(1, Math.max(0, v));
        if (margin === 0 && smooth) {
          for (let j = 0; j < 4; j++) {
            for (let i = 0; i < 4; i++) {
              ctx.fillStyle = hex(mix(0x7fdad2, 0x2f86b5, clamp(deep(c + (i + 0.5) / 4, r + (j + 0.5) / 4))));
              ctx.fillRect(c + i / 4 - 0.01, r + j / 4 - 0.01, 0.27, 0.27);
            }
          }
        } else if (margin === 0) {
          const d = clamp(deep(c, r));
          const g = ctx.createLinearGradient(c, r, c, r + 1);
          g.addColorStop(0, hex(mix(0x7fdad2, BEACH_SEA, d)));
          g.addColorStop(1, hex(mix(0x7fdad2, BEACH_SEA, Math.min(1, d + 0.16))));
          ctx.fillStyle = g;
          ctx.fillRect(c - 0.01, r - 0.01, 1.02, 1.02);
        }
        const rippleAlpha = margin > 0 ? 0.30 * (1 - clamp(deep(c, r))) : 0.35;
        if (rippleAlpha === 0) continue;
        ctx.strokeStyle = `rgba(235,255,255,${rippleAlpha})`;
        ctx.lineWidth = 0.02;
        for (let i = 0; i < 3; i++) {
          const y = r + rand();
          ctx.beginPath();
          ctx.moveTo(c + rand() * 0.4, y);
          ctx.quadraticCurveTo(c + 0.5, y - 0.05, c + 0.6 + rand() * 0.4, y);
          ctx.stroke();
        }
        continue;
      }
      // Sand darkens where waves keep it wet.
      const wet = nearWater(at, c, r) <= 1.01;
      const base = t === ',' ? 0xaac47d : t === 'd' ? 0xdcc6ac : wet ? WET : SAND;
      ctx.fillStyle = hex(jitter(base, rand, 0.03));
      ctx.fillRect(c - 0.01, r - 0.01, 1.02, 1.02);
      if (t === '=') {
        paintPlanks(ctx, c, r, rand, at(c, r + 1) === '~' || at(c, r - 1) === '~');
        continue;
      }
      if (t === 'd') {
        ctx.strokeStyle = 'rgba(125,91,76,0.24)';
        ctx.lineWidth = 0.018;
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) ctx.strokeRect(c + i / 3, r + j / 3, 1 / 3, 1 / 3);
        }
        continue;
      }
      // Grains, wind ripples and the odd shell.
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = rand() > 0.5 ? 'rgba(255,250,235,0.35)' : 'rgba(160,120,70,0.18)';
        ctx.fillRect(c + rand(), r + rand(), 0.014, 0.014);
      }
      ctx.strokeStyle = 'rgba(170,130,80,0.18)';
      ctx.lineWidth = 0.02;
      for (let i = 0; i < 2; i++) {
        const y = r + 0.2 + rand() * 0.6;
        ctx.beginPath();
        ctx.moveTo(c + 0.05, y);
        ctx.bezierCurveTo(c + 0.3, y - 0.08, c + 0.6, y + 0.08, c + 0.95, y);
        ctx.stroke();
      }
      if (rand() < 0.12) {
        ctx.fillStyle = ['#ffd6e0', '#fff1de', '#ffe0b8'][Math.floor(rand() * 3)] ?? '#fff';
        ctx.beginPath();
        ctx.ellipse(c + rand(), r + rand(), 0.05, 0.035, rand() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // Grass and flowers around the palms along the back of the town.
  for (let r = 0; r < map.height; r++) for (let c = 0; c < map.width; c++) if (at(c, r) === 'T') softPatch(ctx, c + 0.5, r + 0.5, 1.3, 0x9fbe5c, 0.5);
  // Foam where the waves reach the sand.
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 0.05;
  for (let c = 0; c < map.width; c++) {
    for (let r = 0; r < map.height; r++) {
      if (at(c, r) !== '~') continue;
      const shore = (x: number, y: number): boolean => !['~', '=', '#'].includes(at(x, y));
      for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        if (!shore(c + dc, r + dr) || (margin === 0 && dr !== -1)) continue;
        ctx.save();
        ctx.translate(c + 0.5, r + 0.5);
        ctx.rotate(Math.atan2(dc, -dr));
        ctx.beginPath();
        ctx.moveTo(-0.5, -0.4);
        ctx.bezierCurveTo(-0.2, -0.28, 0.1, -0.52, 0.5, -0.4);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}

function beachTile(c: number, r: number): string {
  const t = tileAt(BEACH_MAP, c, r);
  return t === '#' ? '~' : t;
}

function beachDepth(c: number, r: number): number {
  let distance = 4;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const t = beachTile(c + dx, r + dy);
    if (t !== '~' && t !== '=') distance = Math.min(distance, Math.hypot(dx, dy));
  }
  return (distance - 1) / 3;
}

// One translucent sample per tile. Interpolating them lets the shallows blend into the open ocean.
function paintShallows(ctx: Ctx, map: CitadelMap, margin: number): void {
  const canvas = document.createElement('canvas');
  canvas.width = map.width + margin * 2;
  canvas.height = map.height + margin * 2;
  const layer = canvas.getContext('2d');
  if (layer === null) throw new Error('no 2d canvas');
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const depth = Math.max(0, beachDepth(x - margin, y - margin));
      const alpha = 1 - depth * depth * (3 - 2 * depth);
      layer.fillStyle = `rgba(127,218,210,${0.9 * alpha})`;
      layer.fillRect(x, y, 1, 1);
    }
  }
  ctx.drawImage(canvas, -margin, -margin, canvas.width, canvas.height);
}

const BEACH_STYLE: ShoreStyle = { deep: beachDepth, heights: { H: 96, T: 130, U: 70, R: 26 }, key: BEACH_GROUND };

function paintBeachShadows(ctx: Ctx, map: CitadelMap, at: (c: number, r: number) => string, heights: Readonly<Record<string, number>>): void {
  ctx.save();
  ctx.fillStyle = 'rgba(70,45,90,0.16)';
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      const t = at(c, r);
      const h = heights[t];
      if (h === undefined) continue;
      const len = (h / 64) * 0.7;
      ctx.beginPath();
      if (t === 'T' || t === 'U') ctx.ellipse(c + 0.5 + len * 0.8, r + 0.6, t === 'T' ? 0.9 : 0.6, 0.6, 0, 0, Math.PI * 2);
      else ctx.rect(c, r, 1 + len, 1);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Booths, palms, umbrellas and rocks, each its own Graphics so guardians sort between them.
const KEEPER_HATS = ['hat:straw', '', 'hat:bucket', 'hat:cap', '', 'hat:straw', ''];

export interface BeachProps {
  readonly swaying: Swaying[];
  // Shopkeepers, so the scene can let them shift their weight now and then.
  readonly keepers: Phaser.GameObjects.Graphics[];
  // The pennants on the player's own hut, redrawn as their collection grows.
  readonly hutDecor: Phaser.GameObjects.Graphics;
}

export function createBeachProps(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, labels: Phaser.GameObjects.Layer, map: CitadelMap = BEACH_MAP): BeachProps {
  const swaying: Swaying[] = [];
  const keepers: Phaser.GameObjects.Graphics[] = [];
  const add = (depthSum: number, draw: (g: G) => void): void => {
    const g = new Phaser.GameObjects.Graphics(scene);
    draw(g);
    g.setDepth(depthSum * (TILE_H / 2));
    layer.add(g);
  };
  SHOPS.flatMap((shop) => (isBeachShop(shop.id) ? [{ ...shop, id: shop.id }] : [])).forEach((shop, i) => {
    const b = SHOP_BOOTHS[shop.id];
    const color = colorNumber(shop.color);
    add(b.col + b.row + 2, (g) => {
      drawBoothBack(g, b.col, b.row, color);
    });
    // The shopkeeper stands between the back wall and the counter.
    const keeper = new Phaser.GameObjects.Graphics(scene);
    const foot = P(b.col + 1, b.row + 1.05);
    drawGuardian(keeper, seatColors(i + 3), i % 2 === 0 ? 1 : -1, { hat: KEEPER_HATS[i % KEEPER_HATS.length] ?? '', shades: '', outfit: '' });
    keeper.setPosition(foot.x, foot.y).setDepth((b.col + b.row + 3) * (TILE_H / 2));
    layer.add(keeper);
    keepers.push(keeper);
    add(b.col + b.row + 4, (g) => {
      drawBoothFront(g, b.col, b.row, color, shop.id);
    });
    const sign = P(b.col + 1, b.row + 2, 112);
    labels.add(
      scene.add
        .text(sign.x, sign.y, shop.name, { fontFamily: 'Georgia, serif', fontSize: '22px', fontStyle: '700', color: '#fff6e6', stroke: '#5a3a30', strokeThickness: 5 })
        .setOrigin(0.5, 1),
    );
  });
  // The player's own beach hut, with a sign and a line of pennants for what they own.
  const { col: hc, row: hr } = HOME_HUT;
  add(hc + hr + 3, (g) => {
    drawHut(g, hc, hr);
  });
  const hutDecor = new Phaser.GameObjects.Graphics(scene).setDepth((hc + hr + 4) * (TILE_H / 2));
  layer.add(hutDecor);
  const hutSign = P(hc + 1, hr + 2, 128);
  labels.add(
    scene.add
      .text(hutSign.x, hutSign.y, 'Your hut', { fontFamily: 'Georgia, serif', fontSize: '22px', fontStyle: '700', color: '#fff6e6', stroke: '#5a3a30', strokeThickness: 5 })
      .setOrigin(0.5, 1),
  );
  for (const site of BEACH_LANDMARKS) {
    add(site.col + site.row + site.width + site.depth, (g) => { drawBeachLandmark(g, site); });
    const sign = P(site.col + site.width / 2, site.row + site.depth, site.id === 'tideglass' ? 174 : 102);
    labels.add(scene.add.text(sign.x, sign.y, LANDMARK_NAMES[site.id], {
      fontFamily: 'Georgia, serif', fontSize: '22px', fontStyle: '700', color: '#fff6e6', stroke: '#344e4a', strokeThickness: 5,
    }).setOrigin(0.5, 1));
  }
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      const t = tileAt(map, c, r);
      if (t === 'T') {
        const foot = P(c + 0.5, r + 0.5);
        const g = new Phaser.GameObjects.Graphics(scene);
        drawPalm(g, c * 13 + r * 7);
        g.setPosition(foot.x, foot.y).setDepth((c + r + 1) * (TILE_H / 2));
        layer.add(g);
        swaying.push({ g, phase: (c * 0.7 + r) % 6.28, amount: 1.6 });
      } else if (t === 'U') {
        add(c + r + 1, (g) => {
          drawUmbrella(g, c, r, (c + r) % 2 === 0 ? 0xff7f6a : 0x3fa7b5);
        });
      } else if (t === 'L') {
        add(c + r + 1, (g) => {
          drawTorch(g, c, r);
        });
      } else if (t === 'R') {
        add(c + r + 1, (g) => {
          fan(g, 0x9a8a92, [P(c + 0.1, r + 0.8), P(c + 0.9, r + 0.8), P(c + 0.75, r + 0.3, 24), P(c + 0.3, r + 0.4, 20)]);
          fan(g, 0x7a6a78, [P(c + 0.9, r + 0.8), P(c + 0.85, r + 0.2), P(c + 0.75, r + 0.3, 24)]);
          fan(g, 0xb8aab0, [P(c + 0.3, r + 0.4, 20), P(c + 0.75, r + 0.3, 24), P(c + 0.5, r + 0.5, 26)]);
        });
      }
    }
  }
  return { swaying, keepers, hutDecor };
}

type BeachLandmark = (typeof BEACH_LANDMARKS)[number];
const LANDMARK_NAMES: Record<BeachLandmark['id'], string> = {
  gardens: 'Palm Gardens', promenade: 'East Promenade', tideglass: 'Tideglass Point',
};

export function drawBeachLandmark(g: G, { id, col: c, row: r, width }: BeachLandmark): void {
  const timber = 0xa77756;
  const cream = 0xf4dfbd;
  prism(g, c, r, c + width, r + 2, 0, 9, timber, 0xe2ba89);
  if (id === 'tideglass') {
    prism(g, c + 0.92, r + 0.28, c + 2.08, r + 1.55, 9, 107, cream);
    prism(g, c + 0.89, r + 0.25, c + 2.11, r + 1.58, 51, 18, 0x468f8b);
    prism(g, c + 0.67, r + 0.06, c + 2.33, r + 1.78, 111, 8, 0x418b84, cream);
    prism(g, c + 1.04, r + 0.41, c + 1.96, r + 1.4, 119, 30, 0x65aa9a, 0xffe093);
    const lamp = P(c + 1.46, r + 1.4, 135);
    g.fillStyle(0xffe7a4, 1).fillCircle(lamp.x, lamp.y, 7 * ART_SCALE);
    prism(g, c + 0.85, r + 0.23, c + 2.15, r + 1.58, 149, 7, 0x29675e);
    const top = P(c + 1.5, r + 0.9, 173);
    fan(g, 0x498c80, [P(c + 0.85, r + 1.58, 156), P(c + 2.15, r + 1.58, 156), top]);
    fan(g, 0x29675e, [P(c + 2.15, r + 1.58, 156), P(c + 2.15, r + 0.23, 156), top]);
    return;
  }
  const color = id === 'gardens' ? 0x43877c : 0xc77857;
  const fronts = id === 'gardens' ? [0.18, width - 0.28] : [0.18, 0.95, width - 0.28];
  for (const x of fronts) {
    for (const y of [0.13, 1.73]) prism(g, c + x, r + y, c + x + 0.12, r + y + 0.12, 9, 73, cream);
  }
  prism(g, c + 0.33, r + 0.18, c + width - 0.33, r + 0.58, 9, 18, timber, cream);
  prism(g, c - 0.1, r - 0.08, c + width + 0.1, r + 2.02, 81, 8, color);
  if (id === 'gardens') {
    for (let i = 0; i < 7; i++) {
      const x = c + 0.12 + i * 0.45;
      prism(g, x, r - 0.18, x + 0.12, r + 2.12, 89, 5, 0x609f85);
    }
  } else {
    prism(g, c + 0.16, r + 0.16, c + 1.84, r + 1.85, 89, 8, color, cream);
  }
}

// A bamboo hut on stilts with a thatched hip roof and an open door facing the porch.
// size is the footprint in tiles (2 for a home hut); everything scales with it.
export function drawHut(g: G, c: number, r: number, size = 2): void {
  const k = size / 2;
  const bamboo = 0xd9a86a;
  // Stilts, then the deck.
  for (const [x, y] of [[0.2, 0.2], [1.8, 0.2], [0.2, 1.8], [1.8, 1.8]] as const) prism(g, c + x * k - 0.05, r + y * k - 0.05, c + x * k + 0.05, r + y * k + 0.05, 0, 14 * k, 0x7a4e3e);
  prism(g, c + 0.05 * k, r + 0.05 * k, c + 1.95 * k, r + 1.95 * k, 14 * k, 6 * k, 0xb8784e, 0xd69a68);
  // Walls, with bamboo seams on the two visible faces.
  prism(g, c + 0.25 * k, r + 0.25 * k, c + 1.75 * k, r + 1.6 * k, 20 * k, 62 * k, bamboo);
  g.lineStyle(1 * ART_SCALE, shade(bamboo, 0.3), 0.7);
  for (let i = 1; i < 8; i++) {
    const a = P(c + 0.25 * k + (i * 1.5 * k) / 8, r + 1.6 * k, 20 * k);
    const b = P(c + 0.25 * k + (i * 1.5 * k) / 8, r + 1.6 * k, 82 * k);
    g.lineBetween(a.x, a.y, b.x, b.y);
    const e = P(c + 1.75 * k, r + 0.25 * k + (i * 1.35 * k) / 8, 20 * k);
    const f = P(c + 1.75 * k, r + 0.25 * k + (i * 1.35 * k) / 8, 82 * k);
    g.lineBetween(e.x, e.y, f.x, f.y);
  }
  // The doorway and a window that glows warm.
  fan(g, 0x4a2e2a, [P(c + 0.8 * k, r + 1.61 * k, 20 * k), P(c + 1.2 * k, r + 1.61 * k, 20 * k), P(c + 1.2 * k, r + 1.61 * k, 64 * k), P(c + 0.8 * k, r + 1.61 * k, 64 * k)]);
  fan(g, 0xffd27a, [P(c + 1.76 * k, r + 0.6 * k, 44 * k), P(c + 1.76 * k, r + 1.1 * k, 44 * k), P(c + 1.76 * k, r + 1.1 * k, 66 * k), P(c + 1.76 * k, r + 0.6 * k, 66 * k)]);
  // Thatch: four faces to the apex, back ones first, with straw streaks.
  const apex = P(c + 1 * k, r + 0.92 * k, 132 * k);
  const e00 = P(c + 0.05 * k, r + 0.05 * k, 80 * k);
  const e10 = P(c + 1.95 * k, r + 0.05 * k, 80 * k);
  const e11 = P(c + 1.95 * k, r + 1.85 * k, 80 * k);
  const e01 = P(c + 0.05 * k, r + 1.85 * k, 80 * k);
  const straw = 0xc9a25a;
  fan(g, shade(straw, 0.25), [e00, e10, apex]);
  fan(g, shade(straw, 0.15), [e01, e00, apex]);
  fan(g, lit(straw, 0.12), [e01, e11, apex]);
  fan(g, shade(straw, 0.05), [e11, e10, apex]);
  g.lineStyle(1 * ART_SCALE, shade(straw, 0.4), 0.5);
  for (let i = 1; i < 10; i++) {
    const t = i / 10;
    g.lineBetween(e01.x + (e11.x - e01.x) * t, e01.y + (e11.y - e01.y) * t, apex.x, apex.y);
  }
}

// One pennant per item in the player's collection (up to twelve) on a line across the porch.
export function drawHutDecor(g: G, owned: readonly string[]): void {
  g.clear();
  const { col: c, row: r } = HOME_HUT;
  const items = owned.map((id) => getItem(id)).filter((i) => i !== undefined && i.category !== 'food').slice(0, 12);
  const a = P(c + 0.1, r + 1.95, 74);
  const b = P(c + 1.95, r + 1.95, 74);
  g.lineStyle(1 * ART_SCALE, 0x5a3a30, 0.9);
  g.lineBetween(a.x, a.y, b.x, b.y);
  items.forEach((item, i) => {
    const t = (i + 0.5) / items.length;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    g.fillStyle(colorNumber(item?.hints.swatch ?? '#FFD27A'), 1);
    g.fillTriangle(x - 4 * ART_SCALE, y, x + 4 * ART_SCALE, y, x, y + 10 * ART_SCALE);
  });
}

// A tiki torch: a bamboo pole with a woven cup and a flame.
export function drawTorch(g: G, c: number, r: number): void {
  const foot = P(c + 0.5, r + 0.5);
  const top = P(c + 0.5, r + 0.5, 60);
  g.lineStyle(3 * ART_SCALE, 0x9a6a3e, 1);
  g.lineBetween(foot.x, foot.y, top.x, top.y);
  g.lineStyle(1 * ART_SCALE, 0x6e4636, 1);
  for (const z of [14, 30, 46]) {
    const a = P(c + 0.5, r + 0.5, z);
    g.lineBetween(a.x - 3 * ART_SCALE, a.y, a.x + 3 * ART_SCALE, a.y);
  }
  g.fillStyle(0x7a4e3e, 1);
  g.fillTriangle(top.x - 6 * ART_SCALE, top.y, top.x + 6 * ART_SCALE, top.y, top.x, top.y + 8 * ART_SCALE);
  g.fillStyle(0xffa24a, 1);
  g.fillTriangle(top.x - 4 * ART_SCALE, top.y, top.x + 4 * ART_SCALE, top.y, top.x, top.y - 14 * ART_SCALE);
  g.fillStyle(0xffe08a, 1);
  g.fillTriangle(top.x - 2 * ART_SCALE, top.y, top.x + 2 * ART_SCALE, top.y, top.x, top.y - 8 * ART_SCALE);
}

// A small sailboat drawn around its waterline at (0, 0).
export function drawBoat(g: G, sail: number): void {
  const s = ART_SCALE;
  g.fillStyle(0x7a4e3e, 1);
  g.fillTriangle(-22 * s, -6 * s, 22 * s, -6 * s, 14 * s, 4 * s);
  g.fillTriangle(-22 * s, -6 * s, 14 * s, 4 * s, -14 * s, 4 * s);
  g.fillStyle(0xa8744a, 1);
  g.fillRect(-20 * s, -9 * s, 40 * s, 3 * s);
  g.lineStyle(2 * s, 0x5a3a30, 1);
  g.lineBetween(0, -8 * s, 0, -62 * s);
  g.fillStyle(sail, 1);
  g.fillTriangle(2 * s, -60 * s, 2 * s, -12 * s, 26 * s, -14 * s);
  g.fillStyle(0xfff6e6, 1);
  g.fillTriangle(-2 * s, -54 * s, -2 * s, -12 * s, -18 * s, -13 * s);
  // Its reflection, broken by the ripples.
  g.fillStyle(0x7a4e3e, 0.18);
  g.fillRect(-14 * s, 6 * s, 28 * s, 3 * s);
  g.fillRect(-10 * s, 11 * s, 20 * s, 2 * s);
}

// A wooden market stall: the floor and back wall behind the keeper...
function drawBoothBack(g: G, c: number, r: number, color: number): void {
  prism(g, c + 0.1, r + 0.1, c + 1.9, r + 1.9, 0, 10, 0xd9b48a, 0xe8c9a0);
  prism(g, c + 0.15, r + 0.15, c + 1.85, r + 0.35, 10, 70, mix(color, 0xffffff, 0.55));
}

// ...then the counter, posts, wares and a striped awning in the shop's colour in front.
function drawBoothFront(g: G, c: number, r: number, color: number, shop: BeachShopId): void {
  const wood = 0xb8784e;
  prism(g, c + 0.2, r + 1.45, c + 1.8, r + 1.85, 10, 30, wood, 0xd69a68);
  for (const [x, y] of [[0.15, 1.8], [1.8, 1.8], [1.8, 0.2]] as const) prism(g, c + x - 0.04, r + y - 0.04, c + x + 0.04, r + y + 0.04, 10, 88, 0x7a4e3e);
  // Wares on the counter.
  const ware = (u: number, col: number): void => {
    prism(g, c + u, r + 1.55, c + u + 0.22, r + 1.75, 40, 10, col);
  };
  if (shop === 'cafe' || shop === 'pupusa-stand' || shop === 'coconut-stand') {
    ware(0.4, shop === 'coconut-stand' ? 0x6e4636 : 0xfff1de);
    ware(1.2, shop === 'cafe' ? 0x6e4636 : 0xffd27a);
  } else {
    ware(0.35, color);
    ware(0.8, mix(color, 0xffffff, 0.4));
    ware(1.3, mix(color, 0x000000, 0.25));
  }
  // Striped awning sloping down toward the front.
  const stripes = 8;
  for (let i = 0; i < stripes; i++) {
    const x0 = c + 0.05 + (i * 1.9) / stripes;
    const x1 = c + 0.05 + ((i + 1) * 1.9) / stripes;
    const col = i % 2 === 0 ? color : 0xfff6e6;
    fan(g, col, [P(x0, r + 0.1, 100), P(x1, r + 0.1, 100), P(x1, r + 2.05, 84), P(x0, r + 2.05, 84)]);
    // Scalloped edge.
    fan(g, shade(col, 0.15), [P(x0, r + 2.05, 84), P(x1, r + 2.05, 84), P((x0 + x1) / 2, r + 2.05, 76)]);
  }
}

export function drawPalm(g: G, seed: number): void {
  const s = ART_SCALE;
  const rand = (k: number): number => {
    const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const lean = (rand(1) - 0.3) * 18;
  // Ringed trunk, curving as it rises.
  const segs = 9;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const x0 = lean * t0 * t0 * s;
    const x1 = lean * t1 * t1 * s;
    const y0 = -110 * t0 * s;
    const y1 = -110 * t1 * s;
    const w0 = (6 - 2.5 * t0) * s;
    const w1 = (6 - 2.5 * t1) * s;
    g.fillStyle(i % 2 === 0 ? 0x8a5e44 : 0x7a4e3e, 1);
    g.fillTriangle(x0 - w0, y0, x0 + w0, y0, x1 + w1, y1);
    g.fillTriangle(x0 - w0, y0, x1 + w1, y1, x1 - w1, y1);
  }
  const top = { x: lean * s, y: -110 * s };
  // Fronds: long curved leaves fanning out and drooping.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rand(i) * 0.3;
    const len = (46 + rand(i + 10) * 16) * s;
    const tipX = top.x + Math.cos(a) * len;
    const tipY = top.y + Math.sin(a) * len * 0.45 + 22 * s;
    const midX = top.x + Math.cos(a) * len * 0.5;
    const midY = top.y + Math.sin(a) * len * 0.22 - 10 * s;
    const nx = -Math.sin(a) * 7 * s;
    const ny = Math.cos(a) * 3 * s;
    const dark = Math.sin(a) > 0;
    g.fillStyle(dark ? 0x4f8a3e : 0x6fae48, 1);
    g.fillTriangle(top.x, top.y, midX + nx, midY + ny, tipX, tipY);
    g.fillStyle(dark ? 0x5f9a46 : 0x8cc45a, 1);
    g.fillTriangle(top.x, top.y, midX - nx, midY - ny, tipX, tipY);
  }
  // Coconuts.
  for (const [dx, dy] of [[-4, 4], [3, 5], [0, 8]] as const) {
    g.fillStyle(0x6e4636, 1);
    g.fillCircle(top.x + dx * s, top.y + dy * s, 3.6 * s);
  }
}

function drawUmbrella(g: G, c: number, r: number, color: number): void {
  // Towel under the shade.
  fan(g, mix(color, 0xffffff, 0.5), [P(c + 0.2, r + 0.4), P(c + 0.9, r + 0.4), P(c + 0.9, r + 0.75), P(c + 0.2, r + 0.75)]);
  const top = P(c + 0.5, r + 0.5, 70);
  const foot = P(c + 0.5, r + 0.5, 0);
  g.lineStyle(2 * ART_SCALE, 0xf6e6d0, 1);
  g.lineBetween(foot.x, foot.y, top.x, top.y);
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const rim = (a: number): Pt => P(c + 0.5 + Math.cos(a) * 0.75, r + 0.5 + Math.sin(a) * 0.75, 52);
    fan(g, i % 2 === 0 ? color : 0xfff6e6, [top, rim(a0), rim(a1)]);
  }
}
