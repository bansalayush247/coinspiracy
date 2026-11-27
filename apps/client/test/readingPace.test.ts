import { describe, expect, it } from 'vitest';
import { READING, TEXT_SPEEDS, charDelayMs, graphemes, holdMs, isTextSpeed, nextSpeed } from '../src/city/readingPace.js';

describe('the story reading pace', () => {
  it('types a steady letter rate at each speed, nothing at instant', () => {
    expect(charDelayMs('a', 'b', 'normal')).toBeCloseTo(1000 / READING.charsPerSecond.normal);
    expect(charDelayMs('a', 'b', 'slow')).toBeGreaterThan(charDelayMs('a', 'b', 'normal'));
    expect(charDelayMs('a', 'b', 'fast')).toBeLessThan(charDelayMs('a', 'b', 'normal'));
    expect(charDelayMs('.', ' ', 'instant')).toBe(0);
  });

  it('breathes longer at a full stop than a comma, and not inside a number or a word', () => {
    const comma = charDelayMs(',', ' ', 'normal');
    const stop = charDelayMs('.', ' ', 'normal');
    const ellipsis = charDelayMs('…', undefined, 'normal');
    expect(stop).toBeGreaterThan(comma);
    expect(ellipsis).toBeGreaterThan(stop);
    expect(charDelayMs('.', '5', 'normal')).toBe(charDelayMs('a', 'b', 'normal'));
    expect(charDelayMs('!', undefined, 'normal')).toBe(stop);
  });

  it('holds a longer line longer in auto mode, and longest at slow speed', () => {
    expect(holdMs('A much longer line than the other one.', 'normal')).toBeGreaterThan(holdMs('Short.', 'normal'));
    expect(holdMs('Short.', 'slow')).toBeGreaterThan(holdMs('Short.', 'normal'));
  });

  it('splits a line into whole letters, marks and all', () => {
    expect(graphemes('की')).toEqual(['की']);
    expect(graphemes('ƙa')).toEqual(['ƙ', 'a']);
  });

  it('steps through the speeds and back round', () => {
    expect(TEXT_SPEEDS.map(nextSpeed)).toEqual(['normal', 'fast', 'instant', 'slow']);
    expect(isTextSpeed('fast')).toBe(true);
    expect(isTextSpeed('warp')).toBe(false);
  });
});
