// The Mint vault: coins carried to the Mint Hall door go into the guardian's wallet, where no punch can reach them.
// Deposits are capped per UTC day, because loose coins on the street are new money.
import type { Vec2 } from '../map.js';
import { CITY_BUILDINGS } from './map.js';

export const VAULT_DAILY_LIMIT = 300;
export const VAULT_REACH = 2.5;

const hall = CITY_BUILDINGS.find((b) => b.kind === 'mintHall');
if (hall === undefined) throw new Error('Port Concord has no Mint Hall');
export const MINT_HALL = hall;

// The middle of the hall's front (south) face, one step out on the street.
export const VAULT_DOOR: Vec2 = Object.freeze({ x: (hall.box.c0 + hall.box.c1 + 1) / 2, y: hall.box.r1 + 1.5 });

// Close enough to the hall's walls, measured to the nearest point of its footprint.
export function atVault(pos: Vec2): boolean {
  const { c0, r0, c1, r1 } = MINT_HALL.box;
  const dx = Math.max(c0 - pos.x, 0, pos.x - (c1 + 1));
  const dy = Math.max(r0 - pos.y, 0, pos.y - (r1 + 1));
  return Math.hypot(dx, dy) <= VAULT_REACH;
}

// How much of a pocket today's allowance still takes.
export function depositable(pocket: number, depositedToday: number): number {
  return Math.max(0, Math.min(pocket, VAULT_DAILY_LIMIT - depositedToday));
}
