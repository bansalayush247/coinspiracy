// Rooms made up from a building's seed, so no two shops or flats look alike: a size, finishes and furniture picked by
// the recipes in tuning/interiors.json, placed along the walls and around the floor, and checked like a hand-made
// layout (a clear way in, every floor tile reachable). The server and every client make the same room from the seed.
import { INTERIOR_TUNING, doorColumn, layoutProblems, shopTradeOf, type Furniture, type Piece, type RoomKind, type RoomLayout, type RoomSpot, type SpotKind } from './interior.js';

type Rand = () => number;

// Mulberry32: small, fast and the same on every engine.
function seeded(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rand: Rand, lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
const choose = <T>(rand: Rand, list: readonly T[]): T => {
  const item = list[Math.floor(rand() * list.length)];
  if (item === undefined) throw new Error('nothing to choose from');
  return item;
};
function shuffled<T>(rand: Rand, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const TALL: ReadonlySet<Piece> = new Set(['shelf', 'bookcase', 'wardrobe', 'kitchen', 'mirror', 'rack', 'boardRack', 'tv']);

// A room being furnished: which tiles are taken, by furniture or kept clear on purpose.
class Plan {
  readonly #taken = new Set<string>();
  readonly furniture: Furniture[] = [];
  readonly spots: RoomSpot[] = [];

  constructor(
    readonly w: number,
    readonly d: number,
    readonly rand: Rand,
  ) {
    const door = doorColumn({ w } as RoomLayout);
    for (const [c, r] of [[door, d - 2], [door, d - 3], [door - 1, d - 2], [door + 1, d - 2]] as const) this.keepClear(c, r);
  }

  keepClear(c: number, r: number): void {
    this.#taken.add(`${String(c)},${String(r)}`);
  }

  fits(c: number, r: number, w: number, d: number): boolean {
    if (c < 1 || r < 1 || c + w > this.w - 1 || r + d > this.d - 1) return false;
    for (let y = r; y < r + d; y++) for (let x = c; x < c + w; x++) if (this.#taken.has(`${String(x)},${String(y)}`)) return false;
    return true;
  }

  put(piece: Piece, c: number, r: number, w: number, d: number): boolean {
    if (!this.fits(c, r, w, d)) return false;
    for (let y = r; y < r + d; y++) for (let x = c; x < c + w; x++) this.keepClear(x, y);
    this.furniture.push({ piece, c, r, w, d });
    return true;
  }

  rug(c: number, r: number, w: number, d: number): void {
    if (c >= 1 && r >= 1 && c + w <= this.w - 1 && r + d <= this.d - 1) this.furniture.push({ piece: 'rug', c, r, w, d });
  }

  // Against the back, west or east wall, long side along it; tall pieces keep off the east wall, where only their backs
  // would show. With a spot, the tile in front of the piece is kept clear for using it.
  alongWall(piece: Piece, long: number, spot?: SpotKind): boolean {
    const spots: [number, number, number, number][] = [];
    for (let c = 1; c + long <= this.w - 1; c++) spots.push([c, 1, long, 1]);
    for (let r = 1; r + long <= this.d - 1; r++) {
      spots.push([1, r, 1, long]);
      if (!TALL.has(piece)) spots.push([this.w - 2, r, 1, long]);
    }
    return shuffled(this.rand, spots).some(([c, r, w, d]) => {
      if (spot === undefined) return this.put(piece, c, r, w, d);
      const [fc, fr] = r === 1 && d === 1 ? [c, 2] : c === 1 ? [2, r] : [c - 1, r];
      if (!this.fits(fc, fr, 1, 1) || !this.put(piece, c, r, w, d)) return false;
      this.keepClear(fc, fr);
      this.spots.push({ kind: spot, c: fc, r: fr });
      return true;
    });
  }

  // Out on the floor, a step away from the walls where the room allows.
  onFloor(piece: Piece, w: number, d: number): boolean {
    const spots: [number, number][] = [];
    for (let r = 2; r + d <= this.d - 2; r++) for (let c = 2; c + w <= this.w - 2; c++) spots.push([c, r]);
    return shuffled(this.rand, spots).some(([c, r]) => this.put(piece, c, r, w, d));
  }

  // A corner first, then anywhere along a wall.
  inCorner(piece: Piece): boolean {
    const corners: [number, number][] = [[1, 1], [this.w - 2, 1], [1, this.d - 2], [this.w - 2, this.d - 2]];
    if (shuffled(this.rand, corners).some(([c, r]) => this.put(piece, c, r, 1, 1))) return true;
    return this.alongWall(piece, 1);
  }
}

// One piece the recipe asks for, placed its own way; false if the room has no place left for it.
function place(plan: Plan, piece: Piece): boolean {
  const { rand } = plan;
  switch (piece) {
    case 'wardrobe':
      return plan.alongWall(piece, 2, 'wardrobe');
    case 'rack':
    case 'boardRack':
    case 'bench':
      return plan.alongWall(piece, 2);
    case 'shelf':
      return plan.alongWall(piece, between(rand, 2, 3));
    case 'kitchen':
      return plan.alongWall(piece, Math.min(between(rand, 3, 4), plan.w - 3), 'kitchen');
    case 'bookcase':
      return plan.alongWall(piece, 1, 'books');
    case 'mirror':
      return plan.alongWall(piece, 1);
    case 'displayCase':
      return plan.onFloor(piece, between(rand, 2, 3), 1) || plan.alongWall(piece, 2);
    case 'hatStand':
      return plan.onFloor(piece, 1, 1) || plan.inCorner(piece);
    case 'plant':
    case 'lamp':
      return plan.inCorner(piece);
    case 'barberChair':
      return shuffled(rand, Array.from({ length: plan.w - 2 }, (_, i) => i + 1)).some((c) => {
        if (!plan.fits(c, 1, 1, 3)) return false;
        plan.put('mirror', c, 1, 1, 1);
        plan.put('barberChair', c, 2, 1, 1);
        plan.keepClear(c, 3);
        return true;
      });
    case 'table': {
      if (!plan.onFloor('table', 1, 1)) return false;
      const table = plan.furniture[plan.furniture.length - 1];
      if (table === undefined) return false;
      const sides = shuffled(rand, [-1, 1]);
      let chairs = 0;
      for (const side of sides) if (chairs < between(rand, 1, 2) && plan.put('chair', table.c + side, table.r, 1, 1)) chairs++;
      return chairs > 0;
    }
    case 'bed': {
      const c = choose(rand, [1, plan.w - 3]);
      if (!plan.fits(c, 1, 2, 3)) return false;
      plan.put('bed', c, 1, 2, 2);
      plan.spots.push({ kind: 'bed', c, r: 3 });
      plan.keepClear(c, 3);
      return true;
    }
    case 'tv': {
      const rows = shuffled(rand, Array.from({ length: plan.d - 3 }, (_, i) => i + 1));
      for (const r of rows) {
        if (plan.fits(1, r, 1, 2) && plan.fits(plan.w - 2, r, 1, 2) && plan.fits(2, r, 1, 1)) {
          plan.put('tv', 1, r, 1, 2);
          plan.put('sofa', plan.w - 2, r, 1, 2);
          plan.keepClear(2, r);
          plan.spots.push({ kind: 'tv', c: 2, r });
          return true;
        }
      }
      return plan.alongWall('tv', 2, 'tv') && plan.alongWall('sofa', 2);
    }
    default:
      return plan.alongWall(piece, 1);
  }
}

function shop(seed: number, rand: Rand): RoomLayout | null {
  const recipe = INTERIOR_TUNING.recipes.shop;
  const trade = recipe.trades[shopTradeOf(seed)];
  const w = between(rand, recipe.w[0], recipe.w[1]);
  const d = between(rand, recipe.d[0], recipe.d[1]);
  const plan = new Plan(w, d, rand);
  const long = Math.min(between(rand, 2, 3), w - 4);
  const r = d >= 8 ? between(rand, 2, 3) : 2;
  const c = between(rand, 1, w - 1 - long);
  if (!plan.put('counter', c, r, long, 1)) return null;
  const spot = { kind: 'counter' as const, c: c + Math.floor(long / 2), r: r + 1 };
  plan.keepClear(spot.c, spot.r);
  plan.spots.push(spot);
  plan.rug(c, r + 1, long, 1);
  for (const want of trade.pieces) {
    const n = between(rand, want.min, want.max);
    for (let i = 0; i < n; i++) if (!place(plan, want.piece) && i < want.min) return null;
  }
  return { w, d, floor: choose(rand, trade.floors), wall: choose(rand, trade.walls), furniture: plan.furniture, spots: plan.spots };
}

function flat(rand: Rand): RoomLayout | null {
  const recipe = INTERIOR_TUNING.recipes.flat;
  const w = between(rand, recipe.w[0], recipe.w[1]);
  const d = between(rand, recipe.d[0], recipe.d[1]);
  const plan = new Plan(w, d, rand);
  for (const want of recipe.pieces) {
    const n = between(rand, want.min, want.max);
    for (let i = 0; i < n; i++) if (!place(plan, want.piece) && i < want.min) return null;
  }
  const table = plan.furniture.find((f) => f.piece === 'table');
  if (table !== undefined) plan.rug(table.c - 1, table.r - 1, 3, 3);
  return { w, d, floor: choose(rand, recipe.floors), wall: choose(rand, recipe.walls), furniture: plan.furniture, spots: plan.spots };
}

const ATTEMPTS = 80;

/** A shop or flat furnished from this seed, the same every time; a hand-made layout if none comes out right. */
export function generateLayout(room: 'shop' | 'flat', seed: number): RoomLayout {
  const rand = seeded(seed ^ (room === 'shop' ? 0x5eed5 : 0xf1a7));
  for (let i = 0; i < ATTEMPTS; i++) {
    const layout = room === 'shop' ? shop(seed, rand) : flat(rand);
    if (layout !== null && layoutProblems(room, layout).length === 0) return Object.freeze(layout);
  }
  return handMade(room, seed);
}

function handMade(room: RoomKind, seed: number): RoomLayout {
  const list = INTERIOR_TUNING.layouts[room];
  const layout = list[Math.abs(Math.trunc(seed)) % list.length];
  if (layout === undefined) throw new Error(`no ${room} layouts`);
  return layout;
}

const MADE = new Map<string, RoomLayout>();
const MADE_CAP = 512;

/** The room inside the building with this seed: made up for a shop or a flat, hand-made for the Mint Hall and hospital. */
export function layoutFor(room: RoomKind, seed: number): RoomLayout {
  if (room !== 'shop' && room !== 'flat') return handMade(room, seed);
  const key = `${room}:${String(seed)}`;
  let layout = MADE.get(key);
  if (layout === undefined) {
    if (MADE.size >= MADE_CAP) MADE.clear();
    layout = generateLayout(room, seed);
    MADE.set(key, layout);
  }
  return layout;
}
