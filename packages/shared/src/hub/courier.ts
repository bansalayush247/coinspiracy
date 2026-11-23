// Courier jobs: carry a parcel from one shop to another for play sats. The server checks the
// route was walked (no faster than a guardian can move) and caps deliveries per day.
import { SHOP_IDS, type ShopId } from '../economy/catalog.js';
import { PLAYER_SPEED } from '../movement.js';
import type { RandomSource } from '../roles.js';
import { shopCounter } from './map.js';

export const COURIER_DAILY_LIMIT = 12;
export const COURIER_MIN_REWARD = 10;
export const COURIER_MAX_REWARD = 60;
// Fraction of the straight-line walking time a delivery must take at least; paths are never shorter.
const PACE_SLACK = 0.8;

export function shopDistance(from: ShopId, to: ShopId): number {
  const a = shopCounter(from);
  const b = shopCounter(to);
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function courierReward(from: ShopId, to: ShopId): number {
  return Math.max(COURIER_MIN_REWARD, Math.min(COURIER_MAX_REWARD, Math.round(8 + shopDistance(from, to) * 2)));
}

// Least time a real walk between the two counters can take, in ms.
export function minDeliveryMs(from: ShopId, to: ShopId): number {
  return Math.floor((shopDistance(from, to) / PLAYER_SPEED) * 1000 * PACE_SLACK);
}

export function pickDestination(from: ShopId, rng: RandomSource): ShopId {
  const others = SHOP_IDS.filter((s) => s !== from);
  return others[rng.int(others.length)] ?? others[0] ?? from;
}
