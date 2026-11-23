// Smooth procedural music, planned one bar at a time: voice-led chords, a legato melody in phrases,
// rolling arpeggios and a soft pulse. Pure and seedable, so it is tested without an audio device.

export type Mood = 'menu' | 'calm' | 'proposals' | 'final' | 'council' | 'academy' | 'victory' | 'defeat' | 'beach' | 'story' | 'silent';
export type ArpVoice = 'keys' | 'pluck';

export interface MoodSpec {
  readonly bpm: number;
  // MIDI note of the tonic.
  readonly root: number;
  readonly scale: readonly number[];
  // Chord roots as scale degrees, one per bar.
  readonly progression: readonly number[];
  readonly pad: number;
  readonly arp: number;
  readonly arpVoice: ArpVoice;
  readonly lead: number;
  readonly bell: number;
  readonly bass: number;
  readonly pulse: number;
  // How busy the melody is, 0..1.
  readonly density: number;
}

// Times and lengths are in sixteenth notes from the start of the bar.
export interface NoteEvent {
  readonly midi: number;
  readonly at: number;
  readonly len: number;
}

export interface LeadEvent extends NoteEvent {
  // Follows the previous note with no gap, so the voice glides instead of re-attacking.
  readonly tied: boolean;
  // A rest or the phrase end follows, so the voice breathes out.
  readonly release: boolean;
}

export interface PulseEvent {
  readonly kind: 'thump' | 'shaker';
  readonly at: number;
  readonly level: number;
}

export interface BarPlan {
  readonly pad: readonly number[];
  readonly bass: readonly NoteEvent[];
  readonly arp: readonly NoteEvent[];
  readonly lead: readonly LeadEvent[];
  readonly bells: readonly NoteEvent[];
  readonly pulse: readonly PulseEvent[];
}

export const STEPS_PER_BAR = 16;
// The melody's range, in scale degrees above its base note.
const LEAD_LO = 0;
const LEAD_HI = 8;

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];

export const MOODS: Readonly<Record<Exclude<Mood, 'silent'>, MoodSpec>> = Object.freeze({
  menu: { bpm: 66, root: 62, scale: MAJOR, progression: [0, 5, 3, 4], pad: 0.55, arp: 0.35, arpVoice: 'keys', lead: 0.45, bell: 0.2, bass: 0.3, pulse: 0, density: 0.45 },
  calm: { bpm: 74, root: 55, scale: MIXOLYDIAN, progression: [0, 3, 6, 4], pad: 0.45, arp: 0.45, arpVoice: 'keys', lead: 0.3, bell: 0.1, bass: 0.35, pulse: 0.12, density: 0.4 },
  proposals: { bpm: 82, root: 62, scale: DORIAN, progression: [0, 3, 0, 4], pad: 0.45, arp: 0.5, arpVoice: 'keys', lead: 0.32, bell: 0.12, bass: 0.45, pulse: 0.3, density: 0.5 },
  final: { bpm: 94, root: 57, scale: AEOLIAN, progression: [0, 5, 3, 4], pad: 0.45, arp: 0.55, arpVoice: 'keys', lead: 0.32, bell: 0.15, bass: 0.55, pulse: 0.5, density: 0.55 },
  council: { bpm: 56, root: 50, scale: AEOLIAN, progression: [0, 0, 5, 4], pad: 0.65, arp: 0.15, arpVoice: 'keys', lead: 0.28, bell: 0.35, bass: 0.35, pulse: 0, density: 0.25 },
  // Under the storybook: slow, chime-led and gentle.
  story: { bpm: 54, root: 67, scale: MAJOR, progression: [0, 3, 5, 4], pad: 0.5, arp: 0.2, arpVoice: 'keys', lead: 0.3, bell: 0.55, bass: 0.2, pulse: 0, density: 0.35 },
  beach: { bpm: 84, root: 64, scale: MAJOR, progression: [0, 3, 4, 3], pad: 0.35, arp: 0.5, arpVoice: 'pluck', lead: 0.32, bell: 0.2, bass: 0.45, pulse: 0.2, density: 0.45 },
  academy: { bpm: 86, root: 60, scale: MAJOR, progression: [0, 4, 5, 3], pad: 0.4, arp: 0.45, arpVoice: 'keys', lead: 0.3, bell: 0.4, bass: 0.35, pulse: 0.15, density: 0.5 },
  victory: { bpm: 94, root: 60, scale: MAJOR, progression: [0, 3, 4, 0], pad: 0.55, arp: 0.5, arpVoice: 'keys', lead: 0.45, bell: 0.45, bass: 0.45, pulse: 0.25, density: 0.55 },
  defeat: { bpm: 60, root: 57, scale: AEOLIAN, progression: [0, 5, 3, 4], pad: 0.6, arp: 0.25, arpVoice: 'keys', lead: 0.35, bell: 0.15, bass: 0.35, pulse: 0, density: 0.3 },
});

// Two-bar melody rhythms in sixteenths; negative values are rests. Each ends with a breath.
const SPARSE_RHYTHMS: readonly (readonly number[])[] = [
  [8, 8, 12, -4],
  [12, 4, 12, -4],
  [16, 8, -8],
  [8, 4, 4, 12, -4],
];
const BUSY_RHYTHMS: readonly (readonly number[])[] = [
  [4, 4, 8, 4, 4, 4, -4],
  [4, 4, 4, 4, 12, -4],
  [6, 2, 8, 6, 2, 4, -4],
  [8, 4, 4, 8, 4, -4],
];

// Melody steps: mostly to a neighbour, sometimes a small leap or a repeat.
const MOVES: readonly (readonly [number, number])[] = [
  [-1, 0.33],
  [1, 0.33],
  [0, 0.1],
  [-2, 0.12],
  [2, 0.12],
];

// A small seedable generator (mulberry32) so a test can replay a tune.
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Composer {
  readonly #spec: MoodSpec;
  readonly #rand: () => number;
  #bar = 0;
  #voices: number[] | null = null;
  #lead = 2;
  #arpIndex = 0;
  #phrase: LeadEvent[] = [];

  constructor(spec: MoodSpec, rand: () => number = Math.random) {
    this.#spec = spec;
    this.#rand = rand;
  }

  get spec(): MoodSpec {
    return this.#spec;
  }

  // MIDI note of a scale degree (degrees past the scale wrap into higher octaves).
  midi(degree: number, octave = 0): number {
    const n = this.#spec.scale.length;
    const d = ((degree % n) + n) % n;
    return this.#spec.root + (this.#spec.scale[d] ?? 0) + 12 * (Math.floor(degree / n) + octave);
  }

  // The triad on the chord root for a bar, as scale degrees.
  chordDegrees(bar: number): number[] {
    const p = this.#spec.progression;
    const c = p[((bar % p.length) + p.length) % p.length] ?? 0;
    return [c, c + 2, c + 4];
  }

  next(): BarPlan {
    const bar = this.#bar;
    this.#bar += 1;
    const chord = this.chordDegrees(bar);
    const n = this.#spec.scale.length;
    if (bar % 2 === 0) this.#writePhrase(bar);
    const start = (bar % 2) * STEPS_PER_BAR;
    const lead = this.#phrase.filter((e) => e.at >= start && e.at < start + STEPS_PER_BAR).map((e) => ({ ...e, at: e.at - start }));
    return {
      pad: this.#spec.pad > 0 ? this.#voiceLead(chord) : [],
      bass: this.#bassLine(chord),
      arp: this.#arpeggio(chord, n),
      lead: this.#spec.lead > 0 ? lead : [],
      bells: this.#bells(chord),
      pulse: this.#pulse(),
    };
  }

  // Each pad voice moves to the nearest note of the new chord, so chords change without jumps.
  #voiceLead(chord: readonly number[]): number[] {
    const pcs = chord.map((d) => this.midi(d) % 12);
    const lo = this.#spec.root - 17;
    const hi = this.#spec.root - 1;
    const prev = this.#voices ?? chord.map((d) => this.midi(d, -1));
    let best: number[] = prev;
    let bestCost = Infinity;
    for (const order of PERMUTATIONS) {
      const voicing = order.map((k, i) => nearestWithPc(prev[i] ?? lo, pcs[k] ?? 0, lo, hi));
      if (new Set(voicing).size < voicing.length) continue;
      const cost = voicing.reduce((s, m, i) => s + Math.abs(m - (prev[i] ?? m)), 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = voicing;
      }
    }
    this.#voices = best;
    return [...best].sort((a, b) => a - b);
  }

  #bassLine(chord: readonly number[]): NoteEvent[] {
    if (this.#spec.bass <= 0) return [];
    let root = this.midi(chord[0] ?? 0, -2);
    while (root < 33) root += 12;
    if (this.#spec.bass < 0.45) return [{ midi: root, at: 0, len: STEPS_PER_BAR }];
    // A walking fifth late in the bar for the busier moods.
    let fifth = this.midi(chord[2] ?? 0, -2);
    while (fifth < root) fifth += 12;
    return [
      { midi: root, at: 0, len: 10 },
      { midi: fifth, at: 10, len: 6 },
    ];
  }

  // A rolling up-and-down arpeggio over the chord, continuing smoothly from bar to bar.
  #arpeggio(chord: readonly number[], n: number): NoteEvent[] {
    if (this.#spec.arp <= 0) return [];
    const tones = [chord[0] ?? 0, chord[1] ?? 2, chord[2] ?? 4, (chord[0] ?? 0) + n];
    const pattern = [0, 1, 2, 3, 2, 1];
    const step = this.#spec.arp >= 0.4 ? 2 : 4;
    const out: NoteEvent[] = [];
    for (let at = 0; at < STEPS_PER_BAR; at += step) {
      const tone = tones[pattern[this.#arpIndex % pattern.length] ?? 0] ?? 0;
      this.#arpIndex += 1;
      out.push({ midi: this.midi(tone), at, len: step * 1.5 });
    }
    return out;
  }

  // A two-bar phrase: stepwise motion that starts and lands on a chord tone.
  #writePhrase(bar: number): void {
    const busy = this.#rand() < this.#spec.density;
    const pool = busy ? BUSY_RHYTHMS : SPARSE_RHYTHMS;
    const rhythm = pool[Math.floor(this.#rand() * pool.length)] ?? SPARSE_RHYTHMS[0] ?? [];
    const notes: { deg: number; at: number; len: number }[] = [];
    let at = 0;
    rhythm.forEach((len, i) => {
      const length = Math.abs(len);
      if (len > 0) {
        const chordHere = this.chordDegrees(bar + Math.floor(at / STEPS_PER_BAR));
        const lastNote = rhythm.slice(i + 1).every((l) => l < 0);
        if (notes.length === 0 || lastNote) this.#lead = this.#snap(this.#lead, chordHere);
        else this.#lead = Math.max(LEAD_LO, Math.min(LEAD_HI, this.#lead + this.#move()));
        notes.push({ deg: this.#lead, at, len: length });
      }
      at += length;
    });
    const base = this.#spec.root < 60 ? this.#spec.root + 12 : this.#spec.root;
    this.#phrase = notes.map((note, i) => {
      const prev = notes[i - 1];
      const next = notes[i + 1];
      return {
        midi: base - this.#spec.root + this.midi(note.deg),
        at: note.at,
        len: note.len,
        tied: prev !== undefined && prev.at + prev.len === note.at,
        release: next === undefined || note.at + note.len < next.at,
      };
    });
  }

  #move(): number {
    let r = this.#rand();
    for (const [step, weight] of MOVES) {
      if (r < weight) return step;
      r -= weight;
    }
    return 1;
  }

  // The chord tone nearest a melody degree, inside the melody's range.
  #snap(degree: number, chord: readonly number[]): number {
    const n = this.#spec.scale.length;
    let best = degree;
    let bestDist = Infinity;
    for (let d = LEAD_LO; d <= LEAD_HI; d++) {
      const pc = ((d % n) + n) % n;
      if (!chord.some((c) => ((c % n) + n) % n === pc)) continue;
      const dist = Math.abs(d - degree);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best;
  }

  #bells(chord: readonly number[]): NoteEvent[] {
    if (this.#spec.bell <= 0 || this.#rand() >= this.#spec.bell * 0.6) return [];
    const tone = chord[Math.floor(this.#rand() * chord.length)] ?? 0;
    return [{ midi: this.midi(tone, 1), at: 2 * Math.floor(this.#rand() * 8), len: STEPS_PER_BAR }];
  }

  #pulse(): PulseEvent[] {
    const p = this.#spec.pulse;
    if (p <= 0) return [];
    const out: PulseEvent[] = [
      { kind: 'thump', at: 0, level: p },
      { kind: 'thump', at: 8, level: p * 0.7 },
    ];
    // Off-beat shakers; the tenser moods fill in every eighth with a soft accent pattern.
    for (let at = 2; at < STEPS_PER_BAR; at += 4) out.push({ kind: 'shaker', at, level: p * 0.5 });
    if (p > 0.45) for (let at = 0; at < STEPS_PER_BAR; at += 4) out.push({ kind: 'shaker', at, level: p * 0.25 });
    return out;
  }
}

const PERMUTATIONS: readonly (readonly number[])[] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

// The MIDI note with a pitch class closest to a target, kept inside a range.
function nearestWithPc(target: number, pc: number, lo: number, hi: number): number {
  let best = lo;
  let bestDist = Infinity;
  for (let m = lo; m <= hi; m++) {
    if (((m % 12) + 12) % 12 !== pc) continue;
    const d = Math.abs(m - target);
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best;
}
