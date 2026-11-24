import { describe, expect, it } from 'vitest';
import { MUSIC_CHOICES, isMusicChoice, musicMood } from '../src/audio/engine.js';

describe('music selection', () => {
  it('accepts only the choices shown to players', () => {
    for (const choice of MUSIC_CHOICES) expect(isMusicChoice(choice)).toBe(true);
    for (const value of ['off', 'silent', 'unknown', 1, null]) expect(isMusicChoice(value)).toBe(false);
  });

  it('keeps scene-aware music in adaptive mode', () => {
    expect(musicMood('proposals', 'dynamic')).toBe('proposals');
    expect(musicMood('beach', 'dynamic')).toBe('beach');
  });

  it('pins a selected theme but still respects silent scenes', () => {
    expect(musicMood('proposals', 'council')).toBe('council');
    expect(musicMood('silent', 'council')).toBe('silent');
  });
});
