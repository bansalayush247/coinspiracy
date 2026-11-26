import { describe, expect, it } from 'vitest';
import { MAX_BLOCK_HEIGHT } from '../src/minigames.js';
import {
  HALVING_CELEBRATION_BLOCKS,
  HALVING_COUNTDOWN_BLOCKS,
  HALVING_INTERVAL,
  LAST_HALVING_EPOCH,
  MAX_SEASON_HEIGHT,
  MAX_SEASON_TIME_MS,
  RETARGET_CELEBRATION_BLOCKS,
  RETARGET_INTERVAL,
  SEASONAL_DECORATIONS,
  SEASONAL_EVENTS,
  SEASONAL_EVENT_IDS,
  SEASONAL_HAT_IDS,
  SeasonalEventIdSchema,
  chainCalendar,
  formatBitcoin,
  groupDigits,
  headline,
  seasonAt,
  subsidyForEpoch,
  utcDay,
  type ActiveSeasonalEvent,
  type SeasonalEventId,
} from '../src/seasons.js';

// An ordinary day with no anniversary.
const PLAIN_DAY = Date.UTC(2026, 10, 22, 12);
// An ordinary height: no halving window, no countdown, no retarget window.
const PLAIN_HEIGHT = 925_104;

const ids = (height: number, nowMs = PLAIN_DAY): SeasonalEventId[] => seasonAt(height, nowMs).active.map((e) => e.id);

function find<I extends SeasonalEventId>(height: number, nowMs: number, id: I): Extract<ActiveSeasonalEvent, { id: I }> {
  const event = seasonAt(height, nowMs).active.find((e): e is Extract<ActiveSeasonalEvent, { id: I }> => e.id === id);
  if (event === undefined) throw new Error(`${id} is not active`);
  return event;
}

// Small seeded PRNG so the sweep is the same on every run.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('chainCalendar', () => {
  it('starts at the genesis block', () => {
    expect(chainCalendar(0)).toStrictEqual({
      height: 0,
      epoch: 0,
      subsidySats: 5_000_000_000,
      nextHalvingHeight: 210_000,
      blocksToHalving: 210_000,
      retargetPeriod: 0,
      nextRetargetHeight: 2_016,
      blocksToRetarget: 2_016,
    });
  });

  it('counts down to the 2024 halving and rolls over on the halving block', () => {
    expect(chainCalendar(839_999)).toStrictEqual({
      height: 839_999,
      epoch: 3,
      subsidySats: 625_000_000,
      nextHalvingHeight: 840_000,
      blocksToHalving: 1,
      retargetPeriod: 416,
      nextRetargetHeight: 840_672,
      blocksToRetarget: 673,
    });
    expect(chainCalendar(840_000)).toMatchObject({ epoch: 4, subsidySats: 312_500_000, nextHalvingHeight: 1_050_000, blocksToHalving: 210_000, blocksToRetarget: 672 });
  });

  it('handles the top of the allowed range', () => {
    expect(chainCalendar(MAX_SEASON_HEIGHT)).toMatchObject({ epoch: 476, subsidySats: 0 });
    expect(MAX_SEASON_HEIGHT).toBe(MAX_BLOCK_HEIGHT);
  });

  it.each([-1, 1.5, Number.NaN, Infinity, -Infinity, MAX_SEASON_HEIGHT + 1, 2 ** 53])('rejects height %s', (height) => {
    expect(() => chainCalendar(height)).toThrow(RangeError);
    expect(() => seasonAt(height, PLAIN_DAY)).toThrow(RangeError);
  });
});

describe('subsidyForEpoch', () => {
  it('halves 50 bitcoin like a right shift and reaches zero at the 33rd halving', () => {
    expect([0, 1, 2, 3, 4, 5].map(subsidyForEpoch)).toStrictEqual([5_000_000_000, 2_500_000_000, 1_250_000_000, 625_000_000, 312_500_000, 156_250_000]);
    expect(subsidyForEpoch(32)).toBe(1);
    expect(subsidyForEpoch(LAST_HALVING_EPOCH)).toBe(0);
    expect(subsidyForEpoch(476)).toBe(0);
  });

  it.each([-1, 0.5, Number.NaN])('rejects epoch %s', (epoch) => {
    expect(() => subsidyForEpoch(epoch)).toThrow(RangeError);
  });
});

describe('halving events', () => {
  it('opens the countdown exactly 4,032 blocks before the halving', () => {
    expect(HALVING_COUNTDOWN_BLOCKS).toBe(4_032);
    expect(ids(840_000 - 4_033)).not.toContain('halvingCountdown');
    const first = find(840_000 - 4_032, PLAIN_DAY, 'halvingCountdown');
    expect(first).toMatchObject({ halvingHeight: 840_000, blocksLeft: 4_032, endsAtHeight: 840_000 });
    expect(find(839_999, PLAIN_DAY, 'halvingCountdown').blocksLeft).toBe(1);
  });

  it('celebrates from the halving block for 1,008 blocks', () => {
    expect(HALVING_CELEBRATION_BLOCKS).toBe(1_008);
    expect(ids(839_999)).not.toContain('halving');
    expect(find(840_000, PLAIN_DAY, 'halving')).toMatchObject({ halvingHeight: 840_000, epoch: 4, subsidySats: 312_500_000, endsAtHeight: 841_008 });
    expect(ids(840_000)).not.toContain('halvingCountdown');
    expect(find(841_007, PLAIN_DAY, 'halving').halvingHeight).toBe(840_000);
    expect(ids(841_008)).not.toContain('halving');
  });

  it('never celebrates the genesis era as a halving', () => {
    expect(ids(0)).toStrictEqual([]);
    expect(ids(1_007)).toStrictEqual([]);
  });

  it('celebrates the final halving to zero and nothing after it', () => {
    const last = LAST_HALVING_EPOCH * HALVING_INTERVAL;
    expect(last).toBe(6_930_000);
    expect(find(last - 1, PLAIN_DAY, 'halvingCountdown').blocksLeft).toBe(1);
    const final = find(last, PLAIN_DAY, 'halving');
    expect(final.subsidySats).toBe(0);
    expect(headline(final)).toBe('The last halving! From now on blocks pay only fees.');
    expect(ids(last + HALVING_INTERVAL - 1)).not.toContain('halvingCountdown');
    expect(ids(last + HALVING_INTERVAL)).not.toContain('halving');
  });
});

describe('difficulty retarget events', () => {
  it('runs for 144 blocks from each multiple of 2,016, but not from the genesis block', () => {
    expect(RETARGET_CELEBRATION_BLOCKS).toBe(144);
    expect(ids(2_015)).toStrictEqual([]);
    expect(find(2_016, PLAIN_DAY, 'retarget')).toMatchObject({ retargetHeight: 2_016, period: 1, endsAtHeight: 2_160 });
    expect(find(2_159, PLAIN_DAY, 'retarget').retargetHeight).toBe(2_016);
    expect(ids(2_160)).toStrictEqual([]);
  });

  it('marks the retarget after the 2024 halving exactly', () => {
    expect(ids(840_671)).not.toContain('retarget');
    expect(find(840_672, PLAIN_DAY, 'retarget')).toMatchObject({ retargetHeight: 840_672, period: 417, endsAtHeight: 840_816 });
    expect(ids(840_815)).toContain('retarget');
    expect(ids(840_816)).not.toContain('retarget');
  });
});

describe('anniversaries', () => {
  it('runs Genesis Day for exactly the UTC day of 3 January', () => {
    expect(ids(PLAIN_HEIGHT, Date.UTC(2027, 0, 2, 23, 59, 59, 999))).toStrictEqual([]);
    const genesis = find(PLAIN_HEIGHT, Date.UTC(2027, 0, 3), 'genesisDay');
    expect(genesis).toMatchObject({ years: 18, endsAtMs: Date.UTC(2027, 0, 4) });
    expect(ids(PLAIN_HEIGHT, Date.UTC(2027, 0, 3, 23, 59, 59, 999))).toStrictEqual(['genesisDay']);
    expect(ids(PLAIN_HEIGHT, Date.UTC(2027, 0, 4))).toStrictEqual([]);
  });

  it('runs Whitepaper Day on 31 October and ends at the start of November', () => {
    expect(find(PLAIN_HEIGHT, Date.UTC(2026, 9, 31, 8), 'whitepaperDay')).toMatchObject({ years: 18, endsAtMs: Date.UTC(2026, 10, 1) });
    expect(ids(PLAIN_HEIGHT, Date.UTC(2026, 9, 30, 23, 59, 59, 999))).toStrictEqual([]);
    expect(ids(PLAIN_HEIGHT, Date.UTC(2026, 10, 1))).toStrictEqual([]);
  });

  it('runs Pizza Day on 22 May', () => {
    expect(find(PLAIN_HEIGHT, Date.UTC(2026, 4, 22, 18), 'pizzaDay')).toMatchObject({ years: 16, endsAtMs: Date.UTC(2026, 4, 23) });
    expect(ids(PLAIN_HEIGHT, Date.UTC(2026, 4, 21, 23, 59, 59, 999))).toStrictEqual([]);
  });

  it('starts each anniversary one year after the original day', () => {
    expect(ids(0, Date.UTC(2009, 0, 3))).toStrictEqual([]);
    expect(find(0, Date.UTC(2010, 0, 3), 'genesisDay').years).toBe(1);
    expect(ids(0, Date.UTC(2008, 9, 31))).toStrictEqual([]);
    expect(find(0, Date.UTC(2009, 9, 31), 'whitepaperDay').years).toBe(1);
    expect(ids(0, Date.UTC(2010, 4, 22))).toStrictEqual([]);
    expect(find(0, Date.UTC(2011, 4, 22), 'pizzaDay').years).toBe(1);
  });

  it('has nothing on other days, including a leap day', () => {
    expect(ids(PLAIN_HEIGHT, Date.UTC(2028, 1, 29))).toStrictEqual([]);
    expect(ids(PLAIN_HEIGHT)).toStrictEqual([]);
  });

  it('reads the calendar day in UTC', () => {
    expect(utcDay(Date.UTC(2026, 11, 31, 23, 59, 59, 999))).toStrictEqual({ year: 2026, month: 12, day: 31 });
    expect(utcDay(0)).toStrictEqual({ year: 1970, month: 1, day: 1 });
    expect(utcDay(MAX_SEASON_TIME_MS)).toStrictEqual({ year: 275_760, month: 9, day: 13 });
  });

  it.each([-1, 0.5, Number.NaN, Infinity, MAX_SEASON_TIME_MS + 1])('rejects time %s', (nowMs) => {
    expect(() => seasonAt(PLAIN_HEIGHT, nowMs)).toThrow(RangeError);
    expect(() => utcDay(nowMs)).toThrow(RangeError);
  });
});

describe('overlaps and priority', () => {
  it('features the halving over a retarget on the block that is both', () => {
    expect(1_260_000 % HALVING_INTERVAL).toBe(0);
    expect(1_260_000 % RETARGET_INTERVAL).toBe(0);
    const season = seasonAt(1_260_000, PLAIN_DAY);
    expect(season.active.map((e) => e.id)).toStrictEqual(['halving', 'retarget']);
    expect(season.featured?.id).toBe('halving');
  });

  it('orders an anniversary over a countdown over a retarget', () => {
    const season = seasonAt(1_046_304, Date.UTC(2028, 0, 3, 9));
    expect(season.active.map((e) => e.id)).toStrictEqual(['genesisDay', 'halvingCountdown', 'retarget']);
    expect(season.featured?.id).toBe('genesisDay');
    expect(find(1_046_304, Date.UTC(2028, 0, 3, 9), 'halvingCountdown').blocksLeft).toBe(3_696);
  });

  it('puts a halving ahead of Pizza Day', () => {
    expect(ids(840_000, Date.UTC(2026, 4, 22))).toStrictEqual(['halving', 'pizzaDay']);
  });

  it('reports no featured event on a plain day', () => {
    expect(seasonAt(PLAIN_HEIGHT, PLAIN_DAY).featured).toBeNull();
  });

  it('agrees with an independent oracle on every height near the boundaries and on random heights', () => {
    const exists = (from: number, to: number, test: (k: number) => boolean): boolean => {
      for (let k = from; k <= to; k++) if (test(k)) return true;
      return false;
    };
    const expected = (h: number): SeasonalEventId[] => {
      const out: SeasonalEventId[] = [];
      if (exists(1, LAST_HALVING_EPOCH, (k) => h >= k * 210_000 && h < k * 210_000 + 1_008)) out.push('halving');
      if (exists(1, LAST_HALVING_EPOCH, (k) => h >= k * 210_000 - 4_032 && h < k * 210_000)) out.push('halvingCountdown');
      const p = Math.floor(h / 2_016);
      if (p >= 1 && h - p * 2_016 < 144) out.push('retarget');
      return out;
    };
    const heights = new Set<number>();
    for (const edge of [0, 2_016, 210_000, 840_000, 840_672, 1_050_000, 1_260_000, 6_930_000, 7_140_000]) {
      for (let d = -4_100; d <= 1_100; d++) if (edge + d >= 0) heights.add(edge + d);
    }
    const random = mulberry32(20_260_522);
    for (let i = 0; i < 5_000; i++) heights.add(Math.floor(random() * (MAX_SEASON_HEIGHT + 1)));
    for (const h of heights) expect(ids(h)).toStrictEqual(expected(h));
  });
});

describe('copy and formatting', () => {
  it('writes one short headline per event', () => {
    expect(headline(find(840_000, PLAIN_DAY, 'halving'))).toBe('Halving! The block reward is now 3.125 bitcoin.');
    expect(headline(find(210_000, PLAIN_DAY, 'halving'))).toBe('Halving! The block reward is now 25 bitcoin.');
    expect(headline(find(1_260_000, PLAIN_DAY, 'halving'))).toBe('Halving! The block reward is now 0.78125 bitcoin.');
    expect(headline(find(839_999, PLAIN_DAY, 'halvingCountdown'))).toBe('Halving in 1 block.');
    expect(headline(find(835_968, PLAIN_DAY, 'halvingCountdown'))).toBe('Halving in 4,032 blocks.');
    expect(headline(find(840_672, PLAIN_DAY, 'retarget'))).toBe('Difficulty retarget at block 840,672.');
    expect(headline(find(PLAIN_HEIGHT, Date.UTC(2027, 0, 3), 'genesisDay'))).toBe('Bitcoin turns 18 today.');
    expect(headline(find(PLAIN_HEIGHT, Date.UTC(2026, 9, 31), 'whitepaperDay'))).toBe('The Bitcoin whitepaper turns 18 today.');
    expect(headline(find(PLAIN_HEIGHT, Date.UTC(2026, 4, 22), 'pizzaDay'))).toBe('Pizza Day: 16 years since two pizzas cost 10,000 bitcoin.');
    expect(headline(find(PLAIN_HEIGHT, Date.UTC(2011, 4, 22), 'pizzaDay'))).toBe('Pizza Day: 1 year since two pizzas cost 10,000 bitcoin.');
  });

  it('formats bitcoin amounts and digit groups without the host locale', () => {
    expect([5_000_000_000, 312_500_000, 78_125_000, 1, 0, 123_456_789].map(formatBitcoin)).toStrictEqual([
      '50',
      '3.125',
      '0.78125',
      '0.00000001',
      '0',
      '1.23456789',
    ]);
    expect(formatBitcoin(2_100_000_000_000_000)).toBe('21,000,000');
    expect([0, 999, 1_000, 1_234_567, -1_234].map(groupDigits)).toStrictEqual(['0', '999', '1,000', '1,234,567', '-1,234']);
    for (const bad of [-1, 1.5, Number.NaN]) expect(() => formatBitcoin(bad)).toThrow(RangeError);
    expect(() => groupDigits(0.5)).toThrow(RangeError);
  });

  it('keeps every event themed, original and family-friendly', () => {
    expect(Object.keys(SEASONAL_EVENTS).sort()).toStrictEqual([...SEASONAL_EVENT_IDS].sort());
    const hats = new Set<string>();
    for (const id of SEASONAL_EVENT_IDS) {
      const info = SEASONAL_EVENTS[id];
      expect(info.id).toBe(id);
      expect(info.title.length).toBeGreaterThan(0);
      expect(info.title.length).toBeLessThanOrEqual(32);
      expect(info.blurb.length).toBeLessThanOrEqual(120);
      expect(info.theme.decorations.length).toBeGreaterThan(0);
      for (const d of info.theme.decorations) expect(SEASONAL_DECORATIONS).toContain(d);
      expect(info.theme.hat).toMatch(/^hat:[a-z][a-z0-9-]*$/);
      hats.add(info.theme.hat);
      for (const color of info.theme.colors) expect(color).toMatch(/^#[0-9A-F]{6}$/);
      expect(`${info.title} ${info.blurb}`).not.toMatch(/\b(kill|blood|gun|weapon|dead|die|war|bomb|gamble|casino|beer|wine)\b/i);
    }
    expect([...hats].sort()).toStrictEqual([...SEASONAL_HAT_IDS].sort());
  });

  it('validates synced event ids with a strict schema', () => {
    for (const id of SEASONAL_EVENT_IDS) expect(SeasonalEventIdSchema.safeParse(id).success).toBe(true);
    for (const bad of ['Halving', '__proto__', 'constructor', '', 7, null]) expect(SeasonalEventIdSchema.safeParse(bad).success).toBe(false);
  });
});

describe('purity', () => {
  it('returns the same frozen answer for the same inputs', () => {
    const a = seasonAt(1_046_304, Date.UTC(2028, 0, 3, 9));
    const b = seasonAt(1_046_304, Date.UTC(2028, 0, 3, 9));
    expect(a).toStrictEqual(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.active)).toBe(true);
    expect(Object.isFrozen(a.calendar)).toBe(true);
    for (const e of a.active) expect(Object.isFrozen(e)).toBe(true);
    expect(Object.isFrozen(SEASONAL_EVENTS)).toBe(true);
    expect(Object.isFrozen(SEASONAL_EVENTS.halving.theme.decorations)).toBe(true);
    expect(Object.isFrozen(SEASONAL_EVENTS.halving.theme.colors)).toBe(true);
  });
});
