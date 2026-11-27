// The face each story line is said with, so the speaker's portrait can show it. A line can name its face; otherwise
// it is read from the English stage direction and the line itself, so every language shows the same face.
import type { ScriptLine, Speaker } from './script.js';

/** Every face a story portrait can make. */
export const FACES = ['calm', 'happy', 'angry', 'worried', 'surprised', 'sad', 'smug', 'whisper', 'curious'] as const;
/** A face a story portrait can make. */
export type Face = (typeof FACES)[number];

// Checked in order, so a smile held back is smug before it is happy, and a whisper beats both.
const FROM_DIRECTION: readonly (readonly [Face, RegExp])[] = [
  ['whisper', /whisper|quietly|\bsmall\b|hand over it|very faint/],
  ['smug', /almost smiles|nearly smiling|despite|amused|laughs, short|hear him smile|which is worse|unhurried|flattered|doesn.t blink/],
  ['worried', /pale|strained|cracking|pink|goes wrong|gets to her|realising|crying/],
  ['happy', /smil|grin|delighted|laugh|lighting up|cheerful|waving|rapping|jumping|shaking rook|honestly/],
  ['angry', /\bcold\b|\bflat\b|narrows/],
  ['sad', /grave|remembering|after a long|long pause|a long look|taking off the hat/],
  ['surprised', /surprised|spotting|stopping|arriving|beat too long/],
];

const FROM_TEXT: readonly (readonly [Face, RegExp])[] = [
  ['worried', /^(…|\.\.\.)/],
  ['surprised', /\?!|!\?|^(wait|what|oh|huh)\b/i],
  ['sad', /\bsorry\b/i],
  ['happy', /\bha(ha)?\b/i],
  ['worried', /\b(no|nobody|stop|never|don.t)\b.*!|!.*\b(no|nobody|stop|never)\b/i],
  ['happy', /!/],
  ['curious', /\?/],
];

// Characters whose resting face is not calm: the polite threats, the showmen.
const RESTING: Readonly<Partial<Record<Speaker, Face>>> = { pell: 'smug', voice: 'smug', glass: 'smug', rex: 'happy', mc: 'happy' };

/** The face a story line is said with: its own, else from its stage direction, its words, then the speaker. */
export function faceOf(line: Pick<ScriptLine, 'who' | 'text' | 'paren' | 'face'>): Face {
  if (line.face !== undefined) return line.face;
  const paren = (line.paren ?? '').toLowerCase();
  for (const [face, pattern] of FROM_DIRECTION) if (pattern.test(paren)) return face;
  for (const [face, pattern] of FROM_TEXT) if (pattern.test(line.text)) return face;
  return RESTING[line.who] ?? 'calm';
}
