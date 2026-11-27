import { describe, expect, it } from 'vitest';
import { FACES, SPEAKERS } from '@byzantine-council/shared/city';
import { DELIVERY, TALK, VOICES, speaksOn, syllable } from '../src/city/delivery.js';

describe('how a story line is delivered', () => {
  it('gives every face a delivery and every speaker a voice', () => {
    for (const face of FACES) expect(DELIVERY[face].tempo).toBeGreaterThan(0);
    for (const who of SPEAKERS) expect(VOICES[who].hz).toBeGreaterThan(60);
  });

  it('says anger lower and louder, and surprise higher, than calm', () => {
    const calm = syllable('dani', 'calm', 'a', 0, false);
    const angry = syllable('dani', 'angry', 'a', 0, false);
    const surprised = syllable('dani', 'surprised', 'a', 0, false);
    expect(angry.hz).toBeLessThan(calm.hz);
    expect(angry.level).toBeGreaterThan(calm.level);
    expect(surprised.hz).toBeGreaterThan(calm.hz);
  });

  it('whispers on the breath, and speaks slower when sad', () => {
    expect(syllable('pip', 'whisper', 'a', 0, false).breathy).toBe(true);
    expect(DELIVERY.sad.tempo).toBeGreaterThan(DELIVERY.calm.tempo);
  });

  it('sounds the same letter the same way every time, and rises at the end of a question', () => {
    expect(syllable('mags', 'calm', 'k', 0.2, false)).toEqual(syllable('mags', 'calm', 'k', 0.2, false));
    expect(syllable('mags', 'calm', 'k', 1, true).hz).toBeGreaterThan(syllable('mags', 'calm', 'k', 1, false).hz);
    expect(syllable('mags', 'calm', 'k', 0.2, true).hz).toBe(syllable('mags', 'calm', 'k', 0.2, false).hz);
  });

  it('speaks only on letters, every few of them', () => {
    expect(speaksOn('a', 0)).toBe(true);
    expect(speaksOn('a', TALK.everyLetters + 1)).toBe(false);
    expect(speaksOn(' ', 0)).toBe(false);
    expect(speaksOn('.', 0)).toBe(false);
    expect(speaksOn('की', 0)).toBe(true);
  });

  it('puts the phone and the old tape through their devices', () => {
    expect(syllable('voice', 'calm', 'a', 0, false).through).toBe('phone');
    expect(syllable('founder', 'calm', 'a', 0, false).through).toBe('tape');
    expect(syllable('rook', 'calm', 'a', 0, false).through).toBeUndefined();
  });
});
