// How a bot paces itself. Times are in ms; the server's own minimums still apply on top.
import { z } from 'zod';

// Ten minutes is far beyond any sensible pause and keeps ranges safe for RandomSource.
const MAX_MS = 600_000;
const Range = z
  .tuple([z.number().int().min(0).max(MAX_MS), z.number().int().min(0).max(MAX_MS)])
  .refine(([min, max]) => min <= max, 'range min must not exceed max')
  .readonly();
const Percent = z.number().int().min(0).max(100);

export const BotProfileSchema = z
  .strictObject({
    // Pause after a match starts, as if reading the role card.
    reactMs: Range,
    // Pause at a station before opening it.
    settleMs: Range,
    // Extra thinking on top of the server's minSolveMs, per task.
    thinkMs: z.strictObject({ deposit: Range, ledger: Range, route: Range, watchtower: Range }).readonly(),
    // Pause at a point of interest.
    lingerMs: Range,
    // Gap between short strolls in the lobby.
    lobbyStrollMs: Range,
    // Pause after finishing a task before choosing the next thing to do.
    afterTaskMs: Range,
    // Chance an honest bot fumbles an answer.
    mistakePercent: Percent,
    // Chance of a detour to another room between tasks.
    detourPercent: Percent,
    // Byzantine: chance of walking off a fake task without answering.
    fakeAbandonPercent: Percent,
    // Byzantine: chance of wandering instead of faking the next task.
    byzantineWanderPercent: Percent,
  })
  .readonly();
export type BotProfile = z.infer<typeof BotProfileSchema>;

// Paced like a person who knows the game: quick, but never instant.
export const HUMANLIKE_PROFILE: BotProfile = BotProfileSchema.parse({
  reactMs: [1200, 3000],
  settleMs: [300, 1200],
  thinkMs: { deposit: [1500, 4000], ledger: [2500, 6000], route: [2000, 5000], watchtower: [1200, 3500] },
  lingerMs: [1500, 5000],
  lobbyStrollMs: [20_000, 60_000],
  afterTaskMs: [300, 1200],
  mistakePercent: 8,
  detourPercent: 20,
  fakeAbandonPercent: 15,
  byzantineWanderPercent: 35,
});
