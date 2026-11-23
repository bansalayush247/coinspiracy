import { describe, expect, it } from 'vitest';
import { byzantineCount, isHalted, maxFaulty, threshold } from '@byzantine-council/shared';
import { agreedHeight, faultyTolerated, halted, matchRows, powerOfTwoNotes, signingThreshold, wrongEjectionsSurvived } from '../src/lib/federation.js';

describe('the Codex arithmetic matches the game', () => {
  it('uses the same fault and threshold formulas', () => {
    for (let n = 1; n <= 40; n++) {
      expect(faultyTolerated(n)).toBe(maxFaulty(n));
      expect(signingThreshold(n)).toBe(threshold(n));
    }
  });

  it('uses the game’s role counts and halt rule', () => {
    for (const row of matchRows(5, 9)) expect(row.tolerated).toBe(byzantineCount(row.guardians));
    for (let members = 1; members <= 9; members++) for (let b = 0; b <= members; b++) expect(halted(b, members)).toBe(isHalted(b, members));
  });

  it('counts the wrong rotations a match survives', () => {
    expect([5, 6, 7, 8, 9].map(wrongEjectionsSurvived)).toEqual([1, 2, 0, 1, 2]);
  });

  it('splits amounts into power-of-two notes', () => {
    expect(powerOfTwoNotes(45)).toEqual([32, 8, 4, 1]);
    expect(powerOfTwoNotes(0)).toEqual([]);
    expect(powerOfTwoNotes(1000).reduce((a, b) => a + b, 0)).toBe(1000);
    expect(() => powerOfTwoNotes(-1)).toThrow();
  });

  it('agrees on the median height', () => {
    expect(agreedHeight([5, 1, 9, 3, 7, 0, 999])).toBe(5);
    expect(() => agreedHeight([])).toThrow();
  });
});
