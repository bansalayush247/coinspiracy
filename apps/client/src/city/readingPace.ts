// How fast story lines type out and how long auto mode holds each one: a steady pace that breathes at punctuation,
// at the speed the player picked.

/** The text speeds a player can pick, slowest first. */
export const TEXT_SPEEDS = ['slow', 'normal', 'fast', 'instant'] as const;
/** A text speed a player can pick. */
export type TextSpeed = (typeof TEXT_SPEEDS)[number];

/** The reading pace's tuning. */
export const READING = Object.freeze({
  charsPerSecond: { slow: 20, normal: 32, fast: 60 },
  pauseScale: { slow: 1.4, normal: 1, fast: 0.5 },
  pauseMs: { comma: 110, clause: 180, stop: 300, ellipsis: 420 },
  autoHoldMs: 1_300,
  autoPerCharMs: 48,
  blinkEveryMs: [2_600, 4_200, 3_400, 5_000],
  blinkMs: 130,
});

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** A line split into the letters a reader sees, so a letter with its marks types out whole in every script. */
export function graphemes(text: string): string[] {
  return Array.from(SEGMENTER.segment(text), (s) => s.segment);
}

/** Whether a value is a text speed. */
export function isTextSpeed(value: unknown): value is TextSpeed {
  return typeof value === 'string' && (TEXT_SPEEDS as readonly string[]).includes(value);
}

/** The next speed after this one, wrapping from instant back to slow. */
export function nextSpeed(speed: TextSpeed): TextSpeed {
  return TEXT_SPEEDS[(TEXT_SPEEDS.indexOf(speed) + 1) % TEXT_SPEEDS.length] ?? 'normal';
}

// The breath after a character: longer for a full stop than a comma, none mid-word or before closing punctuation.
function pauseAfter(ch: string, next: string | undefined): number {
  const p = READING.pauseMs;
  const end = next === undefined || /\s/.test(next);
  if (ch === '…') return p.ellipsis;
  if (!end) return 0;
  if (ch === '.' || ch === '!' || ch === '?') return p.stop;
  if (ch === ';' || ch === ':' || ch === '—' || ch === '–') return p.clause;
  if (ch === ',') return p.comma;
  return 0;
}

/** Milliseconds to wait after typing `ch`, given the character after it; 0 at instant speed. */
export function charDelayMs(ch: string, next: string | undefined, speed: TextSpeed): number {
  if (speed === 'instant') return 0;
  return 1000 / READING.charsPerSecond[speed] + pauseAfter(ch, next) * READING.pauseScale[speed];
}

/** How long auto mode leaves a finished line on screen before the next, longer for longer lines and slower speeds. */
export function holdMs(text: string, speed: TextSpeed): number {
  const scale = speed === 'instant' || speed === 'fast' ? 0.8 : speed === 'slow' ? 1.3 : 1;
  return Math.round((READING.autoHoldMs + graphemes(text).length * READING.autoPerCharMs) * scale);
}
