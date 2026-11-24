// Port Concord's traffic: car lanes along every road (they keep left, as the harbour always has), the crossings
// where lights take turns, and the routes ships sail in the harbour and out at sea. Ambient only: no rules hang on it.
import type { Vec2 } from '../map.js';
import { CITY_HEIGHT, CITY_MAP, CITY_WIDTH, ROAD_COLS, ROAD_ROWS } from './map.js';

export interface Lane {
  // 'col' lanes run north and south along a road column; 'row' lanes run east and west.
  readonly axis: 'col' | 'row';
  // The lane's centre line across its axis.
  readonly at: number;
  readonly dir: 1 | -1;
  // Where the lane starts and stops along its axis, in the direction of travel.
  readonly from: number;
  readonly to: number;
  // Stretches along the axis where it crosses another road.
  readonly crossings: readonly (readonly [number, number])[];
}

const ROAD = new Set([':', '=']);
const MIN_RUN = 10;

function lanesFor(axis: 'col' | 'row', starts: readonly number[], others: readonly number[]): Lane[] {
  const out: Lane[] = [];
  const length = axis === 'col' ? CITY_HEIGHT : CITY_WIDTH;
  for (const s0 of starts) {
    for (const [offset, dir] of [[1.5, 1], [0.5, -1]] as const) {
      const at = s0 + (axis === 'col' ? offset : 2 - offset);
      const line = Math.floor(at);
      let run: number | null = null;
      for (let i = 0; i <= length; i++) {
        const t = i < length ? (axis === 'col' ? CITY_MAP.rows[i]?.[line] : CITY_MAP.rows[line]?.[i]) : undefined;
        const road = t !== undefined && ROAD.has(t);
        if (road && run === null) run = i;
        if (!road && run !== null) {
          if (i - run >= MIN_RUN) {
            const lo = run;
            const hi = i;
            const crossings = others.filter((o) => o >= lo && o + 2 <= hi).map((o) => [o, o + 2] as const);
            out.push({ axis, at, dir, from: dir === 1 ? lo : hi, to: dir === 1 ? hi : lo, crossings });
          }
          run = null;
        }
      }
    }
  }
  return out;
}

// Left-hand traffic: heading south a car keeps to the east half of a road column, heading east to the north half.
export const CAR_LANES: readonly Lane[] = Object.freeze([...lanesFor('col', ROAD_COLS, ROAD_ROWS), ...lanesFor('row', ROAD_ROWS, ROAD_COLS)]);

export const lanePoint = (lane: Lane, s: number): Vec2 => (lane.axis === 'col' ? { x: lane.at, y: s } : { x: s, y: lane.at });

// Lights at every crossing take turns: north-south, a clearance, east-west, a clearance.
export const LIGHT_CYCLE_MS = 16_000;
export function greenFor(axis: 'col' | 'row', nowMs: number): boolean {
  const t = nowMs % LIGHT_CYCLE_MS;
  return axis === 'col' ? t < 6_500 : t >= 8_000 && t < 14_500;
}

export const SHIP_KINDS = ['ferry', 'sailboat', 'fishing', 'cargo'] as const;
export type ShipKind = (typeof SHIP_KINDS)[number];

export interface ShipRoute {
  readonly kind: ShipKind;
  readonly speed: number;
  // A closed loop of waypoints over open water.
  readonly points: readonly Vec2[];
}

export const SHIP_ROUTES: readonly ShipRoute[] = Object.freeze([
  { kind: 'cargo', speed: 0.7, points: [{ x: 30, y: 114 }, { x: 122, y: 114 }, { x: 122, y: 121 }, { x: 30, y: 121 }] },
  { kind: 'ferry', speed: 1.3, points: [{ x: 44, y: 106 }, { x: 120, y: 106 }, { x: 120, y: 109 }, { x: 44, y: 109 }] },
  { kind: 'sailboat', speed: 1, points: [{ x: 60, y: 117 }, { x: 100, y: 117 }, { x: 100, y: 124 }, { x: 60, y: 124 }] },
  { kind: 'fishing', speed: 0.8, points: [{ x: 6, y: 53.5 }, { x: 20, y: 53.5 }, { x: 20, y: 55.5 }, { x: 6, y: 55.5 }] },
  { kind: 'fishing', speed: 0.9, points: [{ x: 3.5, y: 4 }, { x: 3.5, y: 38 }, { x: 6.5, y: 38 }, { x: 6.5, y: 4 }] },
  { kind: 'sailboat', speed: 1.1, points: [{ x: 12, y: 2.5 }, { x: 120, y: 2.5 }] },
]);
