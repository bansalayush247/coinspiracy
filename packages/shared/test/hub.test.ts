import { describe, expect, it } from 'vitest';
import { BEACH_SHOP_IDS } from '../src/economy/catalog.js';
import { canStand, findPathNear } from '../src/pathfinding.js';
import { BEACH_MAP, BEACH_SPAWNS, COURIER_MAX_REWARD, COURIER_MIN_REWARD, courierReward, HOME_RANGE, SHOP_RANGE, atHome, homeDoor, minDeliveryMs, pickDestination, shopAt, shopCounter } from '../src/hub/index.js';
import { cryptoRandom } from '../src/roles.js';

describe('Beach Town map', () => {
  it('lets every spawn reach every shop counter', () => {
    for (const s of BEACH_SPAWNS) expect(canStand(BEACH_MAP, s)).toBe(true);
    for (const shop of BEACH_SHOP_IDS) {
      const path = findPathNear(BEACH_MAP, BEACH_SPAWNS[0] ?? { x: 15, y: 9 }, shopCounter(shop), 1.2);
      expect(path.ok, shop).toBe(true);
    }
  });

  it('puts the hut porch where a guardian can stand, apart from every shop counter', () => {
    const door = homeDoor();
    expect(canStand(BEACH_MAP, door)).toBe(true);
    expect(atHome(door)).toBe(true);
    expect(shopAt(door)).toBeNull();
    for (const shop of BEACH_SHOP_IDS) {
      const c = shopCounter(shop);
      expect(Math.hypot(c.x - door.x, c.y - door.y), shop).toBeGreaterThan(HOME_RANGE + SHOP_RANGE - 1);
    }
    expect(findPathNear(BEACH_MAP, BEACH_SPAWNS[0] ?? { x: 15, y: 9 }, door, 1).ok).toBe(true);
  });
});

describe('courier jobs', () => {
  it('pay more for longer walks, within bounds, and never send a parcel to its own shop', () => {
    for (const a of BEACH_SHOP_IDS) {
      for (const b of BEACH_SHOP_IDS) {
        if (a === b) continue;
        const r = courierReward(a, b);
        expect(r).toBeGreaterThanOrEqual(COURIER_MIN_REWARD);
        expect(r).toBeLessThanOrEqual(COURIER_MAX_REWARD);
        expect(minDeliveryMs(a, b)).toBeGreaterThan(0);
      }
      for (let i = 0; i < 20; i++) expect(pickDestination(a, cryptoRandom)).not.toBe(a);
    }
    expect(courierReward('tailor', 'coconut-stand')).toBeGreaterThan(courierReward('tailor', 'barber'));
  });
});

describe('courier progression', () => {
  it('earns the courier seals as deliveries add up', async () => {
    const { applyCourierDelivery, newProgress } = await import('../src/progression/index.js');
    const t = Date.UTC(2026, 10, 23, 12);
    let p = newProgress(t);
    const first = applyCourierDelivery(p, t, 900_000);
    expect(first.award.seals).toEqual(['courier1']);
    expect(first.progress.counters.courierDeliveries).toBe(1);
    p = first.progress;
    for (let i = 0; i < 8; i++) p = applyCourierDelivery(p, t, 900_000).progress;
    const tenth = applyCourierDelivery(p, t, 900_000);
    expect(tenth.award.seals).toEqual(['courier2']);
    expect(tenth.award.xpAfter).toBeGreaterThan(tenth.award.xpBefore);
  });
});

describe('the courier daily cap', () => {
  it('is not reset by finishing a match', async () => {
    const { applyCourierDelivery, applyMatch, newProgress } = await import('../src/progression/index.js');
    const t = Date.UTC(2026, 10, 23, 12);
    const start = newProgress(t);
    const delivered = applyCourierDelivery({ ...start, day: { ...start.day, courier: 12 } }, t, 900_000).progress;
    const match = { matchId: 'm-cap', startedAtMs: t - 600_000, endedAtMs: t, players: 5, humans: 1, privateRoom: true, winner: 'honest' as const, reason: 'consensusReached' as const, blockHeight: 900_000, events: [] };
    const player = { role: 'honest' as const, finished: true, afkKicked: false, movedTiles: 50, tasks: { deposit: 1, ledger: 1, route: 1, watchtower: 1 }, legitSigned: 1, forgedRefused: 0, forgedSigned: 0, forgedSignaturesGathered: 0, byzantineVotes: 0, misdirections: 0, partitionsRepaired: 0, partitionsRunOut: 0, rotatedOut: false };
    const after = applyMatch(delivered, match, player);
    expect(after.award.eligible).toBe(true);
    expect(after.progress.day.courier).toBe(12);
  });
});
