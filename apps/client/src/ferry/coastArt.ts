// The islands as the ferry sees them from the water: each one drawn from its own map, tiles, buildings and palms, as
// a small model a crossing can shrink behind it or grow ahead of it.
import Phaser from 'phaser';
import { tileAt, type CitadelMap, type Vec2 } from '@byzantine-council/shared';
import { CITY_BUILDINGS, CITY_MAP, FERRY_TUNING, type FerryIsland } from '@byzantine-council/shared/city';
import { colorNumber, getShop } from '@byzantine-council/shared/economy';
import { BEACH_LANDMARKS, BEACH_MAP, HOME_HUT, SHOP_BOOTHS } from '@byzantine-council/shared/hub';
import { P, drawBeachLandmark, drawHut, drawPalm, fan, prism } from '../beach/beachArt.js';
import { buildingFront, cityFerrySand, cityGroundColor, drawBuilding } from '../city/cityArt.js';
import { CITY_SAND, SHALLOWS_BEACHES, citySandAt, isShallowsBeach } from '../city/cityBeach.js';
import { coastCurve, coastEdge, coastTileCorners, coastTileOutline } from '../city/cityCoast.js';
import { seafrontBank, seafrontBetween, seafrontColumn, seafrontSandWidth } from '../city/citySeafront.js';
import { ART_SCALE, TILE_H, worldToScreen } from '../game/iso.js';
import { shade } from '../game/palette.js';

type G = Phaser.GameObjects.Graphics;

interface Window {
  readonly map: CitadelMap;
  readonly c0: number;
  readonly r0: number;
  readonly c1: number;
  readonly r1: number;
  readonly anchor: Vec2;
}

const BEACH_GROUND: Readonly<Record<string, number>> = {
  '.': 0xf1d9a6, ',': 0xaac47d, d: 0xdcc6ac, '=': 0xb8845a, T: 0xf1d9a6, H: 0xf1d9a6, R: 0xf1d9a6, U: 0xf1d9a6, L: 0xf1d9a6,
};
const CLIFF = 14;

function windowFor(island: FerryIsland): Window {
  const { ship } = FERRY_TUNING.stops[island];
  if (island === 'beach') return { map: BEACH_MAP, c0: 0, r0: 0, c1: BEACH_MAP.width - 1, r1: BEACH_MAP.height - 1, anchor: ship };
  // The waterfront and the neighbourhoods behind it. Preserve the real shoreline at both ends of the trip.
  return { map: CITY_MAP, c0: 0, r0: Math.floor(ship.y) - 35, c1: CITY_MAP.width - 1, r1: CITY_MAP.height - 1, anchor: ship };
}

const land = (t: string): boolean => t !== '~' && t !== '#' && t !== '';
const projection = ({ x, y }: Vec2): Phaser.Math.Vector2 => {
  const p = P(x, y);
  return new Phaser.Math.Vector2(p.x, p.y);
};

function coastFace(g: G, a: Vec2, b: Vec2, depth: number, color: number): void {
  fan(g, color, [P(a.x, a.y), P(b.x, b.y), P(b.x, b.y, -depth), P(a.x, a.y, -depth)]);
}

function curvedCoastFace(g: G, curve: readonly Vec2[], depth: number, color: number): void {
  for (const [i, a] of curve.entries()) {
    const b = curve[i + 1];
    if (b !== undefined) coastFace(g, a, b, depth, color);
  }
}

function drawShoreWater(g: G, c0: number, c1: number): void {
  for (const { edge, bridge } of seafrontBetween(c0, c1)) {
    if (bridge) continue;
    for (const [i, a] of edge.entries()) {
      const b = edge[i + 1];
      if (b === undefined) continue;
      const wa = seafrontSandWidth(a.x);
      const wb = seafrontSandWidth(b.x);
      fan(g, 0x9bccba, [P(a.x, a.y), P(b.x, b.y), P(b.x, b.y + wb), P(a.x, a.y + wa)], 0.15);
      fan(g, 0xc6d3a7, [P(a.x, a.y), P(b.x, b.y), P(b.x, b.y + wb * 0.48), P(a.x, a.y + wa * 0.48)], 0.21);
    }
  }
}

/** Draws an island's coast into a new container whose origin is the point nearest the ferry. */
export function buildCoast(scene: Phaser.Scene, island: FerryIsland): Phaser.GameObjects.Container {
  const win = windowFor(island);
  const origin = worldToScreen(win.anchor.x, win.anchor.y);
  const root = scene.add.container(0, 0);
  const ground = scene.add.graphics().setPosition(-origin.x, -origin.y);
  root.add(ground);
  const at = (c: number, r: number): string => tileAt(win.map, c, r);
  const city = island === 'city';
  if (city) {
    for (const beach of SHALLOWS_BEACHES) {
      const points = beach.shore.map(projection);
      ground.fillStyle(CITY_SAND, 1).fillPoints(points, true);
      ground.lineStyle(1.8 * ART_SCALE, 0xffeed2, 0.75).strokePoints(points, true);
    }
  }
  for (let r = win.r0; r <= win.r1; r++) {
    for (let c = win.c0; c <= win.c1; c++) {
      const t = (city ? seafrontBank(c, r) : undefined) ?? at(c, r);
      if (city && (isShallowsBeach(c, r) || seafrontColumn(c)?.deck === r)) continue;
      if (!land(t)) {
        if (city) for (const corner of coastTileCorners(c, r)) {
          const { dry } = corner;
          const sand = citySandAt(dry.c, dry.r, dry.tile);
          const color = cityGroundColor(dry.tile, dry.c, dry.r);
          const curve = coastCurve(corner);
          fan(ground, color, [projection(corner.vertex), ...curve.map(projection)]);
          if (corner.from.x > corner.vertex.x || corner.to.y > corner.vertex.y) {
            curvedCoastFace(ground, curve, dry.tile === '=' || sand ? CLIFF / 3 : CLIFF, shade(color, 0.4));
          }
        }
        continue;
      }
      const sand = city && citySandAt(c, r, t);
      const color = city ? cityGroundColor(t, c, r) : (BEACH_GROUND[t] ?? 0xd9ccb4);
      const outline = city ? coastTileOutline(c, r).map(projection) : [P(c, r), P(c + 1, r), P(c + 1, r + 1), P(c, r + 1)];
      fan(ground, color, outline);
      const depth = t === '=' || sand ? CLIFF / 3 : CLIFF;
      if (!land(at(c, r + 1))) {
        const [a, b] = city ? coastEdge(c, r + 1, false) : [{ x: c, y: r + 1 }, { x: c + 1, y: r + 1 }];
        coastFace(ground, a, b, depth, shade(color, 0.35));
      }
      if (!land(at(c + 1, r))) {
        const [a, b] = city ? coastEdge(c + 1, r, true) : [{ x: c + 1, y: r }, { x: c + 1, y: r + 1 }];
        coastFace(ground, a, b, depth, shade(color, 0.5));
      }
      if (city) for (const corner of coastTileCorners(c, r)) {
        if (corner.vertex.x === c + 1 || corner.vertex.y === r + 1) {
          curvedCoastFace(ground, coastCurve(corner), depth, shade(color, 0.4));
        }
      }
    }
  }
  if (city) {
    drawShoreWater(ground, win.c0, win.c1);
    root.add(cityFerrySand(scene, origin));
  }
  const props: { depth: number; draw: (g: G) => void; at?: Vec2 }[] = [];
  if (island === 'city') {
    for (const b of CITY_BUILDINGS) {
      if (b.box.c1 < win.c0 || b.box.c0 > win.c1 || b.box.r1 < win.r0 || b.box.r0 > win.r1) continue;
      props.push({ depth: buildingFront(b.box), draw: (g) => { drawBuilding(g, b); } });
    }
    for (let r = win.r0; r <= win.r1; r++) {
      for (let c = win.c0; c <= win.c1; c++) {
        if (at(c, r) === 'T') props.push({ depth: c + r + 1, draw: (g) => { tree(g, c, r); } });
      }
    }
  } else {
    for (const site of BEACH_LANDMARKS) {
      props.push({ depth: site.col + site.row + site.width + site.depth, draw: (g) => { drawBeachLandmark(g, site); } });
    }
    for (const [id, booth] of Object.entries(SHOP_BOOTHS)) {
      const color = colorNumber(getShop(id)?.color ?? '#ffd27a');
      props.push({ depth: booth.col + booth.row + 4, draw: (g) => { booth2x2(g, booth.col, booth.row, color); } });
    }
    props.push({ depth: HOME_HUT.col + HOME_HUT.row + 4, draw: (g) => { drawHut(g, HOME_HUT.col, HOME_HUT.row); } });
    for (let r = win.r0; r <= win.r1; r++) {
      for (let c = win.c0; c <= win.c1; c++) {
        const t = at(c, r);
        if (t === 'T') props.push({ depth: c + r + 1, at: { x: c + 0.5, y: r + 0.5 }, draw: (g) => { drawPalm(g, c * 31 + r); } });
        else if (t === 'R') props.push({ depth: c + r + 1, draw: (g) => { prism(g, c + 0.2, r + 0.25, c + 0.8, r + 0.8, 0, 16, 0x8a8478); } });
      }
    }
  }
  props.sort((a, b) => a.depth - b.depth);
  for (const p of props) {
    const g = scene.add.graphics();
    if (p.at === undefined) g.setPosition(-origin.x, -origin.y);
    else {
      const s = worldToScreen(p.at.x, p.at.y);
      g.setPosition(s.x - origin.x, s.y - origin.y);
    }
    p.draw(g);
    root.add(g);
  }
  return root;
}

// A Beach Town stall: a striped awning over a wooden booth.
function booth2x2(g: G, c: number, r: number, color: number): void {
  prism(g, c + 0.1, r + 0.1, c + 1.9, r + 1.9, 0, 56, 0xd9a86a);
  prism(g, c, r, c + 2, r + 2, 56, 10, color);
  fan(g, 0xfff6e6, [P(c, r + 2, 56), P(c + 1, r + 2, 56), P(c + 1, r + 2, 48), P(c, r + 2, 48)]);
}

// A round street tree seen from out at sea.
function tree(g: G, c: number, r: number): void {
  const foot = P(c + 0.5, r + 0.5);
  g.fillStyle(0x5a3e2e, 1);
  g.fillRect(foot.x - 3 * ART_SCALE, foot.y - 30 * ART_SCALE, 6 * ART_SCALE, 30 * ART_SCALE);
  g.fillStyle(0x4f8a4e, 1);
  g.fillEllipse(foot.x, foot.y - 46 * ART_SCALE, TILE_H * 1.1, TILE_H * 1.2);
  g.fillStyle(0x6fae5a, 1);
  g.fillEllipse(foot.x - 8 * ART_SCALE, foot.y - 52 * ART_SCALE, TILE_H * 0.6, TILE_H * 0.6);
}
