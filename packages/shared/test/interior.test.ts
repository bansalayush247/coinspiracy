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
  flatPick,
  interiorTuningProblems,
  isIndoors,
  layoutFor,
  roomMap,
  roomSpawn,
  stepIndoors,
  toLocal,
  toWorld,
  walkedOut,
} from '../src/city/index.js';

describe('walk-in buildings', () => {
  it('opens shops, the Mint Hall, the hospital and houses, each with a door on open street', () => {
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

  it('picks the same layout for the same building and the same flat owner', () => {
    expect(layoutFor('shop', 7)).toBe(layoutFor('shop', 7));
    expect(flatPick('profile-abc')).toBe(flatPick('profile-abc'));
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
