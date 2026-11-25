// A story crew: up to four friends in one private night, joined by a room code. Choices are the crew's: everyone
// votes, the most votes win, and a tie goes to whoever leads the crew.
import type { Vec2 } from '../map.js';
import { canStand } from '../pathfinding.js';
import { CITY_MAP } from './map.js';

export const CREW_MAX = 4;
// Once the first vote is in, the rest of the crew has this long before the votes cast so far decide.
export const CREW_VOTE_MS = 15_000;
// A crew member further than this from a scene is brought to it, so nobody watches a scene from across town.
export const CREW_GATHER = 3;

// The winning choice: most votes, a tie broken by the lead's vote, then by whichever choice was picked first.
export function crewChoice(votes: Iterable<readonly [string, string]>, lead: string): string | null {
  const counts = new Map<string, number>();
  let leadVote: string | undefined;
  for (const [voter, choice] of votes) {
    counts.set(choice, (counts.get(choice) ?? 0) + 1);
    if (voter === lead) leadVote = choice;
  }
  let best = 0;
  for (const n of counts.values()) best = Math.max(best, n);
  const top = [...counts].filter(([, n]) => n === best).map(([c]) => c);
  if (leadVote !== undefined && top.includes(leadVote)) return leadVote;
  return top[0] ?? null;
}

const RING: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0.4],
  [-1, 0.4],
  [0.5, 1.1],
  [-0.5, 1.1],
  [1.4, -0.6],
  [-1.4, -0.6],
  [0, -1.2],
  [2, 0],
  [-2, 0],
];

// Somewhere to stand at or beside `at`, away from the spots already taken.
export function besideSpot(at: Vec2, taken: readonly Vec2[]): Vec2 {
  for (const [dx, dy] of RING) {
    const p = { x: at.x + dx, y: at.y + dy };
    if (canStand(CITY_MAP, p) && taken.every((t) => Math.hypot(t.x - p.x, t.y - p.y) >= 0.7)) return p;
  }
  return { x: at.x, y: at.y };
}
