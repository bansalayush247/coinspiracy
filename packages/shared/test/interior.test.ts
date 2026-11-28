import { describe, expect, it } from 'vitest';
import { canStand } from '../src/pathfinding.js';
import {
  BUILDING_DOORS,
  CITY_MAP,
  INTERIOR_TUNING,
  ROOM_KINDS,
  atExit,
  doorAt,
  doorBySeed,
  doorColumn,
  generateLayout,
  layoutProblems,
  SHOP_TRADES,
  shopTradeOf,
  interiorTuningProblems,
  isIndoors,
  layoutFor,
  roomMap,
  roomSpawn,
  spotAt,
  stepIndoors,
  toLocal,
  toWorld,
  walkedOut,
} from '../src/city/index.js';

describe('walk-in buildings', () => {
  it('opens every kind of room, each building with a door on open street', () => {
    const kinds = new Set(BUILDING_DOORS.map((d) => d.room));
    expect([...kinds].sort()).toEqual([...ROOM_KINDS].sort());
    for (const d of BUILDING_DOORS) {
      expect(canStand(CITY_MAP, d.at)).toBe(true);
      expect(doorAt(d.at)?.building.seed).toBe(d.building.seed);
      expect(doorBySeed(d.building.seed)).toBe(d);
    }
  });

  it('finds no door away from every door', () => {
    expect(doorAt({ x: 0.5, y: 0.5 })).toBeNull();
  });

  it('loads a tuning file with no problems, and catches a blocked way in', () => {
    expect(interiorTuningProblems(INTERIOR_TUNING)).toEqual([]);
    const [shop] = INTERIOR_TUNING.layouts.shop;
    if (shop === undefined) throw new Error('no shop');
    const spawn = roomSpawn(shop);
    const blocked = { ...INTERIOR_TUNING, layouts: { ...INTERIOR_TUNING.layouts, shop: [{ ...shop, furniture: [...shop.furniture, { piece: 'table' as const, c: Math.floor(spawn.x), r: Math.floor(spawn.y), w: 1, d: 1 }] }] } };
    expect(interiorTuningProblems(blocked).some((p) => p.includes('way in is blocked'))).toBe(true);
  });

  it('keeps every spot far enough from the door that pressing use there still walks out', () => {
    const [shop] = INTERIOR_TUNING.layouts.shop;
    if (shop === undefined) throw new Error('no shop');
    const byDoor = { ...shop, spots: [{ kind: 'counter' as const, c: Math.floor(shop.w / 2), r: shop.d - 3 }] };
    expect(layoutProblems('shop', byDoor).some((p) => p.includes('in the way of the door'))).toBe(true);
  });

  it('makes the same room for the same building, and a different one for every building in the city', () => {
    expect(layoutFor('shop', 7)).toBe(layoutFor('shop', 7));
    expect(generateLayout('flat', 99)).toEqual(generateLayout('flat', 99));
    expect(new Set(BUILDING_DOORS.map((d) => JSON.stringify(layoutFor(d.room, d.building.seed)))).size).toBe(BUILDING_DOORS.length);
  });

  it('makes City Hall, the chapel, the arcade, the fish hall, offices, the temple and the mandirs with something to do in each', () => {
    const wants: Readonly<Record<'cityHall' | 'chapel' | 'arcade' | 'fishMarket' | 'office' | 'temple' | 'mandir', readonly string[]>> = {
      cityHall: ['board', 'books'],
      chapel: ['candles'],
      arcade: ['arcade'],
      fishMarket: ['counter'],
      office: ['board', 'books'],
      temple: ['bell', 'cushion'],
      mandir: ['diya', 'bell'],
    };
    for (const [room, kinds] of Object.entries(wants) as [keyof typeof wants, readonly string[]][]) {
      const handMade = new Set(INTERIOR_TUNING.layouts[room]);
      for (let seed = 1; seed < 200; seed++) {
        const layout = generateLayout(room, seed * 53);
        expect(handMade.has(layout)).toBe(false);
        expect(layoutProblems(room, layout)).toEqual([]);
        for (const kind of kinds) expect(layout.spots.some((s) => s.kind === kind)).toBe(true);
      }
    }
  });

  it('makes shops and flats that pass every layout check, with a counter in every shop and a bed, bookcase, kitchen, wardrobe and TV in every home', () => {
    const handMade = new Set([...INTERIOR_TUNING.layouts.shop, ...INTERIOR_TUNING.layouts.flat]);
    for (let seed = 1; seed < 400; seed++) {
      for (const room of ['shop', 'flat'] as const) {
        const layout = generateLayout(room, seed * 37);
        expect(handMade.has(layout)).toBe(false);
        expect(layoutProblems(room, layout)).toEqual([]);
        const kinds = new Set(layout.spots.map((s) => s.kind));
        expect([...kinds].sort()).toEqual(room === 'shop' ? ['counter'] : ['bed', 'books', 'kitchen', 'tv', 'wardrobe']);
      }
    }
  });

  it('finds the nearest spot in reach, and none out of reach', () => {
    const layout = generateLayout('flat', 4242);
    for (const spot of layout.spots) {
      expect(spotAt(toWorld({ x: spot.c + 0.5, y: spot.r + 0.5 }), layout)).toBe(spot);
    }
    const far = toWorld({ x: doorColumn(layout) + 0.5, y: layout.d - 1.5 });
    const nearest = Math.min(...layout.spots.map((s) => Math.hypot(s.c + 0.5 - (doorColumn(layout) + 0.5), s.r + 0.5 - (layout.d - 1.5))));
    expect(spotAt(far, layout) === null).toBe(nearest > INTERIOR_TUNING.door.counterReach);
  });

  it('gives every shop a trade from the Beach Town shops, the same each time', () => {
    for (const d of BUILDING_DOORS.filter((door) => door.room === 'shop')) {
      expect(SHOP_TRADES).toContain(shopTradeOf(d.building.seed));
      expect(shopTradeOf(d.building.seed)).toBe(shopTradeOf(d.building.seed));
    }
  });

  it('keeps a walker inside the room, out through the doorway only', () => {
    for (const kind of ROOM_KINDS) {
      for (const layout of INTERIOR_TUNING.layouts[kind]) {
        const map = roomMap(layout);
        let pos = toWorld(roomSpawn(layout));
        const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];
        for (let i = 0; i < 400; i++) pos = stepIndoors(pos, dirs[i % dirs.length] ?? { x: 0, y: 0 }, 0.05, map);
        const local = toLocal(pos);
        expect(isIndoors(pos)).toBe(true);
        expect(local.x).toBeGreaterThan(0.6);
        expect(local.x).toBeLessThan(layout.w - 0.6);
        expect(local.y).toBeGreaterThan(0.6);
      }
    }
  });

  it('lets a guardian at the inner door leave, and counts a step through the doorway as walking out', () => {
    const [layout] = INTERIOR_TUNING.layouts.flat;
    if (layout === undefined) throw new Error('no flat');
    const door = doorColumn(layout) + 0.5;
    expect(atExit(toWorld(roomSpawn(layout)), layout)).toBe(false);
    expect(atExit(toWorld({ x: door, y: layout.d - 1.4 }), layout)).toBe(true);
    expect(walkedOut(toWorld({ x: door, y: layout.d - 1.4 }), layout)).toBe(false);
    let pos = toWorld({ x: door, y: layout.d - 1.4 });
    for (let i = 0; i < 20; i++) pos = stepIndoors(pos, { x: 0, y: 1 }, 0.05, roomMap(layout));
    expect(walkedOut(pos, layout)).toBe(true);
  });
});
