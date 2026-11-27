// How a story line is delivered: the pace and movement each face is said with, and each speaker's talking voice,
// a short synthesized syllable per few letters whose pitch and loudness follow the face.
import type { Face, Speaker } from '@byzantine-council/shared/city';

/** How a portrait moves when its speaker starts a line. */
export type PortraitMove = 'none' | 'shake' | 'hop' | 'bob' | 'sink' | 'tilt' | 'tremble';
/** How the line's text moves when it starts. */
export type TextMove = 'none' | 'shake' | 'pop' | 'tremble';

/** The pace, movement and voice a face is said with. */
export interface Delivery {
  // Multiplies the time per letter: above 1 is slower.
  readonly tempo: number;
  readonly text: TextMove;
  readonly portrait: PortraitMove;
  readonly pitch: number;
  readonly level: number;
  // Said on the breath, as a hiss instead of a tone.
  readonly breathy: boolean;
}

/** Every face's delivery. */
export const DELIVERY: Readonly<Record<Face, Delivery>> = Object.freeze({
  calm: { tempo: 1, text: 'none', portrait: 'none', pitch: 1, level: 1, breathy: false },
  happy: { tempo: 0.95, text: 'none', portrait: 'bob', pitch: 1.12, level: 1.05, breathy: false },
  angry: { tempo: 0.85, text: 'shake', portrait: 'shake', pitch: 0.82, level: 1.3, breathy: false },
  worried: { tempo: 1.1, text: 'tremble', portrait: 'tremble', pitch: 1.06, level: 0.85, breathy: false },
  surprised: { tempo: 0.9, text: 'pop', portrait: 'hop', pitch: 1.25, level: 1.15, breathy: false },
  sad: { tempo: 1.25, text: 'none', portrait: 'sink', pitch: 0.86, level: 0.75, breathy: false },
  smug: { tempo: 1.1, text: 'none', portrait: 'tilt', pitch: 0.95, level: 0.9, breathy: false },
  whisper: { tempo: 1.2, text: 'none', portrait: 'none', pitch: 1, level: 0.5, breathy: true },
  curious: { tempo: 1, text: 'none', portrait: 'tilt', pitch: 1.06, level: 1, breathy: false },
});

/** A speaker's talking voice: the pitch it sits at, the shape of its tone, and the device it comes through. */
export interface TalkVoice {
  readonly hz: number;
  readonly wave: OscillatorType;
  readonly through?: 'phone' | 'tape';
}

const v = (hz: number, wave: OscillatorType, through?: 'phone' | 'tape'): TalkVoice => (through === undefined ? { hz, wave } : { hz, wave, through });

/** Every speaker's talking voice. */
export const VOICES: Readonly<Record<Speaker, TalkVoice>> = Object.freeze({
  rook: v(200, 'triangle'),
  dani: v(262, 'triangle'),
  mags: v(176, 'triangle'),
  pell: v(118, 'sine'),
  voice: v(150, 'square', 'phone'),
  teo: v(232, 'triangle'),
  ivy: v(300, 'sine'),
  brannigan: v(108, 'sawtooth'),
  lookout: v(212, 'square'),
  nonce: v(284, 'square'),
  watchman: v(132, 'triangle'),
  quint: v(142, 'sine'),
  sharpe: v(190, 'sine'),
  choir: v(220, 'sine'),
  founder: v(165, 'triangle', 'tape'),
  okafor: v(208, 'sine'),
  pip: v(384, 'triangle'),
  juno: v(292, 'triangle'),
  crane: v(124, 'sawtooth'),
  stall: v(242, 'square'),
  mc: v(252, 'sawtooth'),
  penrose: v(228, 'sine'),
  keeper: v(198, 'sine'),
  kit: v(340, 'triangle'),
  sol: v(186, 'triangle'),
  marco: v(160, 'sawtooth'),
  benny: v(270, 'square'),
  ozzy: v(150, 'sawtooth'),
  rex: v(170, 'sawtooth'),
  nell: v(312, 'sine'),
  silas: v(114, 'sine'),
  clerk: v(204, 'square'),
  dee: v(256, 'triangle'),
  fennick: v(136, 'sine'),
  glass: v(246, 'sine'),
  lumley: v(146, 'triangle'),
  varnish: v(126, 'square'),
  wren: v(320, 'triangle'),
  marta: v(224, 'sine'),
});

/** The talking voice's tuning: how often it speaks a syllable and how far its pitch wanders. */
export const TALK = Object.freeze({
  everyLetters: 2,
  steps: [0, 2, -1, 3, 1, -2, 4],
  stepRatio: 0.03,
  questionRise: 0.18,
});

/** A syllable of a talking voice, ready to play. */
export interface Syllable {
  readonly hz: number;
  readonly wave: OscillatorType;
  readonly level: number;
  readonly breathy: boolean;
  readonly through: 'phone' | 'tape' | undefined;
}

/** Whether a talking voice says a syllable on the `index`th letter of a line, letters only. */
export function speaksOn(ch: string, index: number): boolean {
  return /\p{L}|\p{N}/u.test(ch) && index % TALK.everyLetters === 0;
}

// The same letter always lands on the same step, so a line sounds the same each time it is read.
function stepOf(ch: string): number {
  const steps = TALK.steps;
  return steps[(ch.codePointAt(0) ?? 0) % steps.length] ?? 0;
}

/** The syllable a speaker says on a letter, with the face's pitch and loudness, rising toward the end of a question. */
export function syllable(who: Speaker, face: Face, ch: string, progress: number, question: boolean): Syllable {
  const voice = VOICES[who];
  const d = DELIVERY[face];
  const rise = question && progress > 0.7 ? 1 + TALK.questionRise * ((progress - 0.7) / 0.3) : 1;
  return {
    hz: voice.hz * d.pitch * (1 + stepOf(ch.toLowerCase()) * TALK.stepRatio) * rise,
    wave: voice.wave,
    level: d.level,
    breathy: d.breathy,
    through: voice.through,
  };
}
