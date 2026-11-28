import { tileAt, type Vec2 } from '@byzantine-council/shared';
import { CITY_MAP, FERRY_TUNING } from '@byzantine-council/shared/city';

const START = 40;
const END = CITY_MAP.width - 4;
const ferry = FERRY_TUNING.stops.city.at;
const FERRY_X = ferry.x;
export const FERRY_LANDING = { left: ferry.x - 2.05, top: ferry.y - 1.38, width: 3.68, height: 1.92 };
const outerRows = Array.from({ length: END - START }, (_, i) => CITY_MAP.rows.findLastIndex((row) => row[i + START] === '='));
const outerRow = (c: number): number => outerRows[Math.max(0, Math.min(outerRows.length - 1, c - START))] ?? 100;
const smooth = (t: number): number => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

function shoreline(x: number): number {
  let weighted = 0;
  let total = 0;
  for (let c = Math.floor(x) - 4; c <= Math.floor(x) + 4; c++) {
    const distance = Math.abs(x - c - 0.5);
    if (distance >= 4) continue;
    const w = 0.5 + 0.5 * Math.cos(distance * Math.PI / 4);
    weighted += (outerRow(c) + 1) * w;
    total += w;
  }
  const endDistance = Math.min(x - START, END - x);
  const bank = outerRow(Math.floor(x)) + 1;
  const edge = bank + (weighted / total - bank) * smooth(endDistance / 1.6);
  // A straight berth gives the ferry a clear landing at the centre of the promenade.
  const berth = outerRow(Math.floor(FERRY_X)) + 1;
  const distance = Math.abs(x - FERRY_X);
  const blend = smooth((distance - 0.65) / 2.5);
  return berth + (edge - berth) * blend;
}

export function seafrontSandWidth(x: number): number {
  const pocket = (center: number, extent: number): number => Math.exp(-(((x - center) / extent) ** 2));
  const sand = 1.25 * Math.max(pocket(52, 7.5), 0.78 * pocket(87, 6.5), 0.88 * pocket(109, 9));
  return sand * smooth((Math.abs(x - FERRY_X) - 2) / 4) * smooth(Math.min(x - START, END - x) / 3);
}

interface SeafrontColumn {
  readonly c: number;
  readonly deck: number;
  readonly edge: readonly Vec2[];
  readonly inner: readonly Vec2[];
  readonly bridge: boolean;
}

const columns: readonly SeafrontColumn[] = outerRows.map((deck, i) => {
  const c = START + i;
  const edge = Array.from({ length: 5 }, (_, j) => ({ x: c + j / 4, y: shoreline(c + j / 4) }));
  const bridge = tileAt(CITY_MAP, c, deck - 2) === '~';
  return { c, deck, edge, inner: edge.map(({ x, y }) => ({ x, y: y - 2 })), bridge };
});

export function seafrontColumn(c: number): SeafrontColumn | undefined {
  return columns[c - START];
}

export function isSeafrontDeck(c: number, r: number): boolean {
  const deck = seafrontColumn(c)?.deck;
  return deck !== undefined && (r === deck || r === deck - 1);
}

/** What would be behind the original landward planks, where the curved deck exposes the ground. */
export function seafrontBank(c: number, r: number): string | undefined {
  const col = seafrontColumn(c);
  return col !== undefined && r === col.deck - 1 ? tileAt(CITY_MAP, c, r - 1) : undefined;
}

export function inlandSandAt(c: number, r: number, tile: string): boolean {
  if (tile !== '.' && tile !== ',' && tile !== 'T') return false;
  const col = seafrontColumn(c);
  return col !== undefined && r >= col.deck - 6 && r < col.deck;
}

function shoreHeight(col: SeafrontColumn, x: number): number {
  const sample = (x - col.c) * 4;
  const i = Math.floor(sample);
  const a = col.edge[i]?.y ?? col.deck + 1;
  const b = col.edge[i + 1]?.y ?? a;
  return a + (b - a) * (sample - i);
}

export function inlandSandOpacity(x: number, y: number): number {
  const col = seafrontColumn(Math.floor(x));
  if (col === undefined) return 0;
  const inner = shoreHeight(col, x) - 2;
  const width = 2.05 + 0.62 * Math.cos(x * 0.22) + 0.24 * Math.sin(x * 0.69);
  const along = smooth(Math.min(x - START, END - x) / 1.8);
  return 0.99 * Math.max(along * smooth((y - inner + width) / 1.12), smooth((y - inner + 0.32) / 0.24));
}

export function wetSandAt(x: number, y: number): number {
  const col = seafrontColumn(Math.floor(x));
  if (col === undefined) return 0;
  const distance = shoreHeight(col, x) - y;
  const width = 0.65 + 0.12 * Math.sin(x * 0.49) + 0.08 * Math.sin(x * 1.13);
  return 0.9 * smooth(1 - distance / width);
}

export function seafrontBetween(first: number, last: number): readonly SeafrontColumn[] {
  return columns.slice(Math.max(0, first - START), Math.max(0, last + 1 - START));
}
