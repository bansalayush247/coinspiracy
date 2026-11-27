import { describe, expect, it } from 'vitest';
import { Composer, MOODS, STEPS_PER_BAR, seeded, type BarPlan } from '../src/audio/composer.js';

const MOOD_NAMES = Object.keys(MOODS) as (keyof typeof MOODS)[];

function bars(mood: keyof typeof MOODS, count: number, seed = 7): { composer: Composer; plans: BarPlan[] } {
  const composer = new Composer(MOODS[mood], seeded(seed));
  return { composer, plans: Array.from({ length: count }, () => composer.next()) };
}

const inScale = (composer: Composer, midi: number): boolean => composer.spec.scale.includes((((midi - composer.spec.root) % 12) + 12) % 12);

describe('the composer', () => {
  it('replays the same tune from the same seed', () => {
    expect(bars('menu', 8, 3).plans).toEqual(bars('menu', 8, 3).plans);
  });

  it.each(MOOD_NAMES)('keeps every %s note in its scale', (mood) => {
    const { composer, plans } = bars(mood, 32);
    for (const p of plans) {
      for (const m of [...p.pad, ...p.bass.map((e) => e.midi), ...p.arp.map((e) => e.midi), ...p.lead.map((e) => e.midi), ...p.bells.map((e) => e.midi)]) {
        expect(inScale(composer, m), `${mood} ${String(m)}`).toBe(true);
      }
    }
  });

  it.each(MOOD_NAMES)('moves the %s pad voices smoothly between chords', (mood) => {
    const { composer, plans } = bars(mood, 32);
    plans.forEach((p, i) => {
      // Each pad voice sounds a note of this bar's chord, within the pad's range.
      const pcs = composer.chordDegrees(i).map((d) => composer.midi(d) % 12);
      expect(p.pad.map((m) => m % 12).sort()).toEqual([...pcs].sort());
      for (const m of p.pad) expect(m).toBeGreaterThanOrEqual(composer.spec.root - 17);
      const prev = plans[i - 1]?.pad;
      // No voice leaps more than a fifth from one chord to the next.
      if (prev !== undefined) for (const [k, m] of p.pad.entries()) expect(Math.abs(m - (prev[k] ?? m))).toBeLessThanOrEqual(7);
    });
  });

  it.each(MOOD_NAMES)('writes %s phrases that breathe and land on the chord', (mood) => {
    const { composer, plans } = bars(mood, 32, 11);
    let leads = 0;
    plans.forEach((p, i) => {
      for (const e of p.lead) {
        expect(e.at).toBeGreaterThanOrEqual(0);
        expect(e.at).toBeLessThan(STEPS_PER_BAR);
        expect(e.len).toBeGreaterThan(0);
        leads++;
      }
      // Every two-bar phrase ends in a rest, and its last note is a chord tone.
      if (i % 2 === 1) {
        const phrase = [...(plans[i - 1]?.lead ?? []).map((e) => ({ ...e, bar: i - 1 })), ...p.lead.map((e) => ({ ...e, bar: i }))];
        const last = phrase.at(-1);
        if (last === undefined) return;
        expect(last.release).toBe(true);
        expect(last.bar * STEPS_PER_BAR + last.at + last.len).toBeLessThan((i + 1) * STEPS_PER_BAR);
        const chordPcs = composer.chordDegrees(last.bar).map((d) => composer.midi(d) % 12);
        expect(chordPcs).toContain(last.midi % 12);
      }
    });
    expect(leads).toBeGreaterThan(0);
  });

  it('moves the melody mostly by step', () => {
    const { plans } = bars('calm', 64, 5);
    const notes = plans.flatMap((p) => p.lead.filter((e) => e.tied).map((e) => e.midi));
    const all = plans.flatMap((p) => p.lead);
    let leaps = 0;
    for (let i = 1; i < all.length; i++) if (all[i]?.tied === true && Math.abs((all[i]?.midi ?? 0) - (all[i - 1]?.midi ?? 0)) > 5) leaps++;
    expect(notes.length).toBeGreaterThan(10);
    expect(leaps / notes.length).toBeLessThan(0.25);
  });

  it('keeps quiet moods free of percussion', () => {
    for (const mood of ['menu', 'council', 'story', 'defeat'] as const) {
      expect(bars(mood, 8).plans.every((p) => p.pulse.length === 0)).toBe(true);
    }
  });

  it('gives every mood an eight-bar progression', () => {
    for (const mood of MOOD_NAMES) expect(MOODS[mood].progression).toHaveLength(8);
  });
});
