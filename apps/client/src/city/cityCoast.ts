import { tileAt, type Vec2 } from '@byzantine-council/shared';
import { CITY_MAP } from '@byzantine-council/shared/city';
import { isShallowsBeach } from './cityBeach.js';

const at = (c: number, r: number): string => tileAt(CITY_MAP, c, r);
export const coastWater = (t: string): boolean => t === '~' || t === '#';

const directions = [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const;
const openGround = new Set(['.', '=', ',', 'd', ':', 'T', 'L']);
const stride = CITY_MAP.width + 1;

interface Quadrant {
  readonly c: number;
  readonly r: number;
  readonly dx: number;
  readonly dy: number;
  readonly tile: string;
}

export interface CoastCorner {
  readonly vertex: Vec2;
  readonly from: Vec2;
  readonly to: Vec2;
  readonly dry: Quadrant;
  readonly water: boolean;
}

function quadrants(x: number, y: number): Quadrant[] {
  return directions.map(([dx, dy]) => {
    const c = x + Math.min(0, dx);
    const r = y + Math.min(0, dy);
    return { c, r, dx, dy, tile: at(c, r) };
  });
}

function turnsAt(x: number, y: number): boolean {
  const wet = quadrants(x, y).filter((q) => coastWater(q.tile)).length;
  return wet === 1 || wet === 3;
}

const corners = new Map<number, CoastCorner>();
for (let y = 1; y < CITY_MAP.height; y++) {
  for (let x = 1; x < CITY_MAP.width; x++) {
    const q = quadrants(x, y);
    const wet = q.filter((q) => coastWater(q.tile));
    const dry = q.filter((q) => !coastWater(q.tile));
    const water = wet.length === 1;
    const alone = water ? wet[0] : dry.length === 1 ? dry[0] : undefined;
    if (alone === undefined) continue;
    const neighbours = water ? dry.filter((d) => d.dx === alone.dx || d.dy === alone.dy) : [alone];
    const material = neighbours.find((d) => d.tile === '=') ?? neighbours.find((d) => !isShallowsBeach(d.c, d.r));
    if (material === undefined || !openGround.has(material.tile) || isShallowsBeach(material.c, material.r)) continue;
    if (water && neighbours.some((d) => !openGround.has(d.tile))) continue;
    const { dx, dy } = alone;
    // Shorter curves on single-tile steps leave room for the next bend.
    const rx = turnsAt(x + dx, y) ? 0.48 : 0.94;
    const ry = turnsAt(x, y + dy) ? 0.48 : 0.94;
    corners.set(y * stride + x, { vertex: { x, y }, from: { x: x + dx * rx, y }, to: { x, y: y + dy * ry }, dry: material, water });
  }
}

export function coastCorner(x: number, y: number): CoastCorner | undefined {
  if (x <= 0 || y <= 0 || x >= CITY_MAP.width || y >= CITY_MAP.height) return undefined;
  return corners.get(y * stride + x);
}

/** The straight section between curved corners on a shared land and water edge. */
export function coastEdge(x: number, y: number, vertical: boolean): readonly [Vec2, Vec2] {
  const nx = x + (vertical ? 0 : 1);
  const ny = y + (vertical ? 1 : 0);
  const a = coastCorner(x, y);
  const b = coastCorner(nx, ny);
  if (vertical) {
    return [{ x, y: Math.max(y, a?.to.y ?? y) }, { x, y: Math.min(ny, b?.to.y ?? ny) }];
  }
  return [{ x: Math.max(x, a?.from.x ?? x), y }, { x: Math.min(nx, b?.from.x ?? nx), y }];
}

/** Samples the same quadratic used by the town painter for the ferry's polygon mesh. */
export function coastCurve({ from, vertex, to }: CoastCorner): Vec2[] {
  return Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    const u = 1 - t;
    return {
      x: u * u * from.x + 2 * t * u * vertex.x + t * t * to.x,
      y: u * u * from.y + 2 * t * u * vertex.y + t * t * to.y,
    };
  });
}

export function coastTileOutline(c: number, r: number): Vec2[] {
  return [[c, r], [c + 1, r], [c + 1, r + 1], [c, r + 1]].flatMap(([x = c, y = r], i) => {
    const corner = coastCorner(x, y);
    if (corner === undefined || corner.water || corner.dry.c !== c || corner.dry.r !== r) return [{ x, y }];
    const curve = coastCurve(corner);
    return i % 2 === 0 ? curve.reverse() : curve;
  });
}
