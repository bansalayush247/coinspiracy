import { describe, expect, it } from 'vitest';
import { canStand } from '../src/pathfinding.js';
import { tileAt } from '../src/map.js';
import { SHIP_ROUTES } from '../src/city/traffic.js';
import { CityJoinSchema } from '../src/city/protocol.js';
import { BeachJoinSchema } from '../src/hub/protocol.js';
import { FERRY_ISLANDS, FERRY_TUNING, FerryTuningSchema, atFerryStop, beachUnlock, ferryArrival, ferryDestination, ferryMap, ferryOpenTo, ferryTuningProblems } from '../src/city/ferry.js';
import raw from '../src/city/tuning/ferry.json' with { type: 'json' };

describe('ferry tuning', () => {
  it('passes its schema and every map check', () => {
    expect(FerryTuningSchema.safeParse(raw).success).toBe(true);
    expect(ferryTuningProblems(FERRY_TUNING)).toEqual([]);
  });

  it('takes about eight seconds and can be skipped after a second', () => {
    expect(FERRY_TUNING.tripMs).toBe(8000);
    expect(FERRY_TUNING.skipAfterMs).toBe(1000);
    expect(FERRY_TUNING.reducedMs).toBeLessThan(FERRY_TUNING.tripMs);
  });

  it('puts both stops and both arrivals on walkable dock at the water', () => {
    for (const island of FERRY_ISLANDS) {
      const stop = FERRY_TUNING.stops[island];
      const map = ferryMap(island);
      expect(canStand(map, stop.at)).toBe(true);
      expect(canStand(map, stop.arrive)).toBe(true);
      expect(tileAt(map, Math.floor(stop.at.x), Math.floor(stop.at.y))).toBe('=');
      expect(tileAt(map, Math.floor(stop.ship.x), Math.floor(stop.ship.y))).toBe('~');
    }
  });

  it('moors Port Concord’s ferry on the seafront where the ferry route sails past', () => {
    const route = SHIP_ROUTES.find((r) => r.kind === 'ferry');
    const xs = route?.points.map((p) => p.x) ?? [];
    const ys = route?.points.map((p) => p.y) ?? [];
    const ship = FERRY_TUNING.stops.city.ship;
    expect(ship.x).toBeGreaterThanOrEqual(Math.min(...xs));
    expect(ship.x).toBeLessThanOrEqual(Math.max(...xs));
    expect(Math.min(...ys) - ship.y).toBeGreaterThan(0);
    expect(Math.min(...ys) - ship.y).toBeLessThan(8);
  });

  it('reports a stop on land, a ship ashore and arrivals inside the reach', () => {
    const city = FERRY_TUNING.stops.city;
    const broken = {
      ...FERRY_TUNING,
      stops: {
        ...FERRY_TUNING.stops,
        city: { ...city, at: { x: 75.5, y: 104.5 }, arrive: { x: 75.8, y: 104.5 }, ship: { ...city.ship, x: 61.5, y: 90.5 }, sign: { x: 75.5, y: 104.5 } },
      },
    };
    const problems = ferryTuningProblems(broken);
    expect(problems).toContain('city: nobody can stand at the boarding spot');
    expect(problems).toContain('city: the moored ferry is not all on water');
    expect(problems).toContain('city: arrivals land inside the boarding reach');
    expect(problems).toContain('city: the sign is not on the dock');
  });

  it('refuses out-of-range numbers and unknown fields', () => {
    expect(FerryTuningSchema.safeParse({ ...raw, tripMs: 100 }).success).toBe(false);
    expect(FerryTuningSchema.safeParse({ ...raw, reach: -1 }).success).toBe(false);
    expect(FerryTuningSchema.safeParse({ ...raw, fare: 10 }).success).toBe(false);
  });
});

describe('boarding', () => {
  it('offers the ferry only within reach of the stop', () => {
    for (const island of FERRY_ISLANDS) {
      const at = FERRY_TUNING.stops[island].at;
      expect(atFerryStop(island, at)).toBe(true);
      expect(atFerryStop(island, { x: at.x + FERRY_TUNING.reach * 0.9, y: at.y })).toBe(true);
      expect(atFerryStop(island, { x: at.x + FERRY_TUNING.reach * 1.1, y: at.y })).toBe(false);
      expect(atFerryStop(island, ferryArrival(island))).toBe(false);
      expect(atFerryStop(island, { x: Number.NaN, y: at.y })).toBe(false);
    }
  });

  it('sails each island to the other', () => {
    expect(ferryDestination('city')).toBe('beach');
    expect(ferryDestination('beach')).toBe('city');
  });

  it('keeps Beach Town’s unlock: its rank or its Academy stars', () => {
    const { rank, stars } = beachUnlock();
    expect(rank).toBeGreaterThan(1);
    expect(ferryOpenTo('beach', 1, 0)).toBe(false);
    expect(ferryOpenTo('beach', rank - 1, stars - 1)).toBe(false);
    expect(ferryOpenTo('beach', rank, 0)).toBe(true);
    expect(ferryOpenTo('beach', 1, stars)).toBe(true);
    expect(ferryOpenTo('city', 1, 0)).toBe(true);
  });

  it('accepts only the ferry arrival as a join option', () => {
    for (const schema of [CityJoinSchema, BeachJoinSchema]) {
      expect(schema.safeParse({ nickname: 'Mara' }).success).toBe(true);
      expect(schema.safeParse({ nickname: 'Mara', arrive: 'ferry' }).success).toBe(true);
      expect(schema.safeParse({ nickname: 'Mara', arrive: 'boat' }).success).toBe(false);
      expect(schema.safeParse({ nickname: 'Mara', arrive: 'ferry', x: 1, y: 1 }).success).toBe(false);
    }
  });
});
