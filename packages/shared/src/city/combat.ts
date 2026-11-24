// Street fights in Port Concord, Teen-rated: cartoon punches and knockouts, no blood. Fights only happen
// in the rough districts, and a knockout only costs the coins you carry, never what is in a vault.
import { isWalkableTile, type Vec2 } from '../map.js';
import { CITY_HEIGHT, CITY_MAP, CITY_WIDTH, districtAt, type DistrictId } from './map.js';

export const MAX_HEALTH = 100;
export const PUNCH_DAMAGE = 25;
export const PUNCH_RANGE = 1.5;
export const PUNCH_COOLDOWN_MS = 450;
export const KNOCKOUT_MS = 3_000;
// After waking up, and on joining, nobody can hit you for a while.
export const SHIELD_MS = 8_000;
export const REGEN_DELAY_MS = 6_000;
export const REGEN_PER_SECOND = 10;

export const MAX_POCKET = 2_000;
export const PICKUP_RANGE = 0.9;
export const DROP_LIFETIME_MS = 90_000;
export const MAX_DROPS = 80;
// Loose coins turn up on rough streets only: the money is where the risk is.
export const LOOSE_COINS_LIVE = 30;
export const LOOSE_COINS_EVERY_MS = 4_000;
export const LOOSE_COIN_MIN = 5;
export const LOOSE_COIN_MAX = 25;

export const ROUGH_DISTRICTS: readonly DistrictId[] = Object.freeze(['lowtide', 'docks', 'gullmoor', 'shallows']);

export function isRough(pos: Vec2): boolean {
  const d = districtAt(pos);
  return d !== null && ROUGH_DISTRICTS.includes(d.id);
}

// Tile centres where loose coins can turn up.
export const ROUGH_STREETS: readonly Vec2[] = Object.freeze(
  Array.from({ length: CITY_WIDTH * CITY_HEIGHT }, (_, i) => ({ x: (i % CITY_WIDTH) + 0.5, y: Math.floor(i / CITY_WIDTH) + 0.5 })).filter((p) => isWalkableTile(CITY_MAP, Math.floor(p.x), Math.floor(p.y)) && isRough(p)),
);

export interface Fighter extends Vec2 {
  readonly health: number;
  readonly knockedOutUntil: number;
  readonly shieldUntil: number;
}

export const isDown = (f: Fighter, nowMs: number): boolean => f.knockedOutUntil > nowMs;
export const isShielded = (f: Fighter, nowMs: number): boolean => f.shieldUntil > nowMs;

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

// Both fighters must stand on rough streets, be awake, and the target must not be shielded.
export function canHit(attacker: Fighter, target: Fighter, nowMs: number): boolean {
  if (isDown(attacker, nowMs) || isDown(target, nowMs) || isShielded(target, nowMs)) return false;
  if (!isRough(attacker) || !isRough(target)) return false;
  return distance(attacker, target) <= PUNCH_RANGE;
}

// The server picks the target, so a client can never aim at someone out of reach.
export function pickTarget<K>(attacker: Fighter, others: Iterable<readonly [K, Fighter]>, nowMs: number): K | null {
  let best: K | null = null;
  let bestDistance = Infinity;
  for (const [id, other] of others) {
    if (!canHit(attacker, other, nowMs)) continue;
    const d = distance(attacker, other);
    if (d < bestDistance) {
      best = id;
      bestDistance = d;
    }
  }
  return best;
}

export function afterPunch(health: number): { readonly health: number; readonly knockedOut: boolean } {
  const next = Math.max(0, health - PUNCH_DAMAGE);
  return { health: next, knockedOut: next === 0 };
}

// Health comes back on its own once nobody has hit you for a while.
export function regenerate(health: number, lastHitMs: number, nowMs: number, seconds: number): number {
  if (health >= MAX_HEALTH || nowMs - lastHitMs < REGEN_DELAY_MS) return health;
  return Math.min(MAX_HEALTH, health + REGEN_PER_SECOND * seconds);
}

export const canPickUp = (who: Vec2, drop: Vec2): boolean => distance(who, drop) <= PICKUP_RANGE;

// How much of a pile fits in a pocket; the rest stays on the ground.
export function takeFromPile(pocket: number, pile: number): { readonly pocket: number; readonly left: number } {
  const room = Math.max(0, MAX_POCKET - pocket);
  const taken = Math.min(room, pile);
  return { pocket: pocket + taken, left: pile - taken };
}
