// Builds island maps out of rectangular islets (or peaks) joined by bridges, with a gap tile between them.
import type { RoomId } from './constants.js';
import type { CitadelMap } from './map.js';

// Inclusive tile bounds.
export interface Box {
  readonly c0: number;
  readonly r0: number;
  readonly c1: number;
  readonly r1: number;
}

export interface IsletSpec {
  readonly width: number;
  readonly height: number;
  // What lies between islets: '~' water on the reef, '^' a chasm in the mountains. Both block.
  readonly gap: string;
  readonly islets: Readonly<Record<RoomId, Box>>;
  readonly bridges: readonly Box[];
  // Buildings, stations and props, placed after the ground.
  readonly decorate: (fill: (b: Box, t: string) => void, set: (c: number, r: number, t: string) => void) => void;
}

// A void rim, the gap everywhere else, islets of open ground, then bridges and decorations on top.
export function buildIsletMap(spec: IsletSpec): CitadelMap {
  const { width, height } = spec;
  const grid: string[][] = Array.from({ length: height }, (_, r) =>
    Array.from({ length: width }, (_, c) => (r === 0 || c === 0 || r === height - 1 || c === width - 1 ? '#' : spec.gap)),
  );
  const fill = (b: Box, t: string): void => {
    for (let r = b.r0; r <= b.r1; r++) {
      for (let c = b.c0; c <= b.c1; c++) {
        const row = grid[r];
        if (row !== undefined && r > 0 && c > 0 && r < height - 1 && c < width - 1) row[c] = t;
      }
    }
  };
  const set = (c: number, r: number, t: string): void => {
    fill({ c0: c, r0: r, c1: c, r1: r }, t);
  };
  for (const islet of Object.values(spec.islets)) fill(islet, '.');
  for (const bridge of spec.bridges) fill(bridge, '=');
  spec.decorate(fill, set);
  return Object.freeze({ width, height, rows: Object.freeze(grid.map((row) => row.join(''))) });
}

// The same map with some bridge tiles taken down (turned into the gap tile).
export function withCuts(map: CitadelMap, cuts: readonly Box[], gap: string): CitadelMap {
  const rows = map.rows.map((row, r) =>
    Array.from(row, (t, c) => (t === '=' && cuts.some((b) => c >= b.c0 && c <= b.c1 && r >= b.r0 && r <= b.r1) ? gap : t)).join(''),
  );
  return Object.freeze({ width: map.width, height: map.height, rows: Object.freeze(rows) });
}

// Grows a layout drawn on a small grid: boxes keep touching their neighbours, so bridges still meet islets.
export function scaleBox(b: Box, s: number): Box {
  return Object.freeze({ c0: Math.round(b.c0 * s), r0: Math.round(b.r0 * s), c1: Math.round((b.c1 + 1) * s) - 1, r1: Math.round((b.r1 + 1) * s) - 1 });
}

// The tile under the centre of a small-grid tile once the layout has grown.
export function scaleTile(c: number, r: number, s: number): readonly [number, number] {
  return [Math.floor((c + 0.5) * s), Math.floor((r + 0.5) * s)];
}

export function scaleRect(rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }, s: number): { x: number; y: number; w: number; h: number } {
  const x = Math.round(rect.x * s);
  const y = Math.round(rect.y * s);
  return { x, y, w: Math.round((rect.x + rect.w) * s) - x, h: Math.round((rect.y + rect.h) * s) - y };
}

// A named building footprint, for the client to draw the right landmark on it.
export interface IslandBuilding {
  readonly kind: string;
  readonly box: Box;
}
