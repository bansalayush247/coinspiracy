import { describe, expect, it } from 'vitest';
import { FACES, STORY_ACTS, STORY_PACING, faceOf, patienceMs, readMs, type ScriptNode } from '../src/city/index.js';

describe('the face a story line is said with', () => {
  it('uses the face a line names over anything else', () => {
    expect(faceOf({ who: 'dani', text: 'Wait, what?', paren: 'whispering', face: 'angry' })).toBe('angry');
  });

  it('reads the stage direction, a held-back smile before a smile', () => {
    expect(faceOf({ who: 'dani', text: 'Fine.', paren: 'whispering' })).toBe('whisper');
    expect(faceOf({ who: 'ivy', text: 'Fine.', paren: 'very nearly smiling' })).toBe('smug');
    expect(faceOf({ who: 'ivy', text: 'Fine.', paren: 'delighted' })).toBe('happy');
    expect(faceOf({ who: 'teo', text: 'Fine.', paren: 'scrolling, going pale' })).toBe('worried');
    expect(faceOf({ who: 'mags', text: 'Fine.', paren: 'cold' })).toBe('angry');
    expect(faceOf({ who: 'sol', text: 'Fine.', paren: 'remembering' })).toBe('sad');
    expect(faceOf({ who: 'kit', text: 'Fine.', paren: 'surprised' })).toBe('surprised');
  });

  it('reads the line itself when there is no stage direction', () => {
    expect(faceOf({ who: 'dani', text: '…' })).toBe('worried');
    expect(faceOf({ who: 'dani', text: 'Wait. That’s the tip.' })).toBe('surprised');
    expect(faceOf({ who: 'dani', text: 'I’m sorry, Rook.' })).toBe('sad');
  });

  it('falls back to the speaker’s resting face', () => {
    expect(faceOf({ who: 'pell', text: 'Forty thousand by Friday.' })).toBe('smug');
    expect(faceOf({ who: 'dani', text: 'Forty thousand by Friday.' })).toBe('calm');
  });

  it('gives every line in every act a face the portraits can draw', () => {
    for (const act of Object.values(STORY_ACTS)) {
      for (const node of Object.values(act.script)) for (const line of node.lines) expect(FACES).toContain(faceOf(line));
    }
  });
});

describe('how long the crew waits for its slowest reader', () => {
  const long: ScriptNode = { lines: Array.from({ length: 40 }, () => ({ who: 'dani' as const, text: 'A long line that takes a while to read through properly.' })), next: 'x' };
  const short: ScriptNode = { lines: [{ who: 'dani', text: 'Hi.' }], next: 'x' };

  it('waits well past a comfortable reading pace', () => {
    expect(patienceMs(short, new Set())).toBe(readMs(short, new Set()) * STORY_PACING.patienceFactor + STORY_PACING.patienceExtraMs);
    expect(patienceMs(short, new Set())).toBeGreaterThan(readMs(short, new Set()));
  });

  it('never waits longer than the cap', () => {
    expect(patienceMs(long, new Set())).toBe(STORY_PACING.maxPatienceMs);
  });
});
