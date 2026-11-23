import { describe, expect, it } from 'vitest';
import { SeasonReplySchema, seasonReply } from '../src/seasons.js';

const ORDINARY = Date.UTC(2026, 6, 15, 12);

describe('season banner', () => {
  it('features the halving right after a halving block', () => {
    const reply = SeasonReplySchema.parse(seasonReply(840_010, true, ORDINARY));
    expect(reply.featured?.id).toBe('halving');
    expect(reply.featured?.headline).toContain('3.125');
  });

  it('features an anniversary for its whole UTC day', () => {
    expect(seasonReply(900_000, false, Date.UTC(2027, 0, 3, 23, 59)).featured?.id).toBe('genesisDay');
    expect(seasonReply(900_000, false, Date.UTC(2027, 4, 22, 0, 0)).featured?.id).toBe('pizzaDay');
  });

  it('features nothing on an ordinary day mid-epoch', () => {
    expect(seasonReply(900_500, true, ORDINARY)).toEqual({ height: 900_500, live: true, featured: null });
  });
});
