// What an act's own rules can see and do inside the shared mission room: the crew, the state, the clock, and the
// few levers that change the story (steps, marks, catches).
import type { RandomSource, Vec2 } from '@byzantine-council/shared';
import type { CatcherId, CityPlayer, MissionNpc, MissionState, StoryAct } from '@byzantine-council/shared/city';

export interface CrewMember {
  readonly id: string;
  readonly player: CityPlayer;
  readonly caughtUntil: number;
}

export interface ActContext {
  readonly act: StoryAct;
  readonly state: MissionState;
  readonly random: RandomSource;
  readonly marks: ReadonlySet<string>;
  crew(): Iterable<CrewMember>;
  // Whoever the story is happening to right now, else the lead.
  anchor(): Vec2 | null;
  inScene(): boolean;
  setStep(step: string, now: number): void;
  mark(mark: string): void;
  // Sends a crew member back to `to` for a moment and tells the crew who it was.
  catchMember(member: CrewMember, by: CatcherId, to: Vec2, now: number): void;
  broadcast(type: string, payload: unknown): void;
  // Cuts the whole crew to a new place for a scene that happens somewhere else.
  moveCrew(to: Vec2): void;
}

export interface ActRules {
  // The spot only the server knows about (where something is hidden), for tests; never sent to a client.
  readonly secret?: number;
  setup(ctx: ActContext): void;
  // Patrols, chases and catches; tests can switch these off for a quiet night.
  tick?(ctx: ActContext, now: number): void;
  // Characters who walk with the crew; unlike `tick`, this runs on a quiet night too.
  move?(ctx: ActContext, now: number): void;
  onStep?(ctx: ActContext, step: string, now: number): void;
  onScene?(ctx: ActContext, node: string): void;
  // Why a crew member can't start on a spot right now (told only to them), or null to let them.
  refuse?(ctx: ActContext, spot: number, by: CrewMember): string | null;
  // A crew member has finished working a spot; returns what they found or were told.
  worked(ctx: ActContext, spot: number, by: CrewMember, now: number): string;
}

export function npc(state: MissionState, id: string, fn: (n: MissionNpc) => void): void {
  const n = state.npcs.get(id);
  if (n !== undefined) fn(n);
}

export const near = (a: Vec2, b: Vec2, range: number): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= range;

// How many spots the crew has worked that count towards the act's goal.
export const workedCount = (ctx: ActContext): number => ctx.state.spots.filter((s, i) => s.done && ctx.act.spots[i]?.refuses !== true).length;

export function place(ctx: ActContext, id: string, at: Vec2, shown = true): void {
  npc(ctx.state, id, (n) => {
    n.x = at.x;
    n.y = at.y;
    n.shown = shown;
  });
}
