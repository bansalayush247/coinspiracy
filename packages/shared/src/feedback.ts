// Playtest feedback: a 1–5 "how fun was that" and a short note, with where in the game it was sent from. It carries
// nothing that identifies a player, and the server keeps no address or profile with it.
import { z } from 'zod';

/** The route the client posts feedback to. */
export const FEEDBACK_PATH = '/api/feedback';
/** The longest note a player can send, in characters. */
export const FEEDBACK_MAX_TEXT = 600;

// Control characters (bar tab and newline) and bidi overrides could hide text or break a log line, so they're refused.
function unsafe(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a) || c === 0x7f || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) return true;
  }
  return false;
}

/** One piece of feedback, as the client sends it. */
export const FeedbackSchema = z.strictObject({
  fun: z.int().min(1).max(5),
  text: z
    .string()
    .max(FEEDBACK_MAX_TEXT)
    .refine((t) => !unsafe(t), 'unsupported characters')
    .transform((t) => t.trim()),
  where: z.string().regex(/^[a-z][a-z0-9:-]{0,39}$/),
  locale: z.enum(['en', 'es']),
  build: z.string().regex(/^[A-Za-z0-9._-]{1,40}$/),
});
/** One piece of feedback, as the client sends it. */
export type Feedback = z.infer<typeof FeedbackSchema>;
/** What the client sends before parsing (the note is not yet trimmed). */
export type FeedbackInput = z.input<typeof FeedbackSchema>;

/** Where in the game the player is, for feedback: e.g. `menu`, `match`, `city`, `story:book`. */
export function feedbackWhere(screen: string, act?: string): string {
  const raw = act === undefined || act === '' ? screen : `${screen}:${act}`;
  const clean = raw.toLowerCase().replace(/[^a-z0-9:-]/g, '').slice(0, 40);
  return /^[a-z]/.test(clean) ? clean : 'menu';
}
