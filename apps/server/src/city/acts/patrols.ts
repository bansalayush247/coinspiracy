// Guards on fixed rounds for any act: each walks a closed route, and anyone caught in a torch cone during the
// watched steps is sent back to that patrol's spot.
import { TICK_SECONDS, type Vec2 } from '@byzantine-council/shared';
import { MissionNpc, inTorch, walkRoute, type CatcherId, type NpcKind, type Walker } from '@byzantine-council/shared/city';
import type { ActContext } from './rules.js';

export interface PatrolDef {
  readonly id: string;
  readonly kind: NpcKind;
  readonly name?: string;
  readonly route: readonly Vec2[];
  readonly speed: number;
  readonly by: CatcherId;
  // Where a catch sends you.
  readonly back: Vec2;
}

export class Patrols {
  readonly #walkers = new Map<string, Walker>();

  constructor(
    private readonly defs: readonly PatrolDef[],
    // The steps in which the patrols catch anyone; they walk all night.
    private readonly watched: readonly string[],
  ) {}

  setup(ctx: ActContext): void {
    for (const d of this.defs) {
      const first = d.route[0];
      if (first === undefined) continue;
      this.#walkers.set(d.id, { x: first.x, y: first.y, facing: 0, leg: 0 });
      ctx.state.npcs.set(d.id, new MissionNpc({ kind: d.kind, name: d.name ?? '', x: first.x, y: first.y }));
    }
  }

  tick(ctx: ActContext, now: number): void {
    const watching = this.watched.includes(ctx.state.step) && !ctx.inScene();
    for (const d of this.defs) {
      const w = this.#walkers.get(d.id);
      const n = ctx.state.npcs.get(d.id);
      if (w === undefined || n === undefined) continue;
      const next = walkRoute(w, d.route, d.speed, TICK_SECONDS);
      this.#walkers.set(d.id, next);
      n.x = next.x;
      n.y = next.y;
      n.facing = next.facing;
      if (!watching) continue;
      for (const m of ctx.crew()) if (now >= m.caughtUntil && inTorch(next, next.facing, m.player)) ctx.catchMember(m, d.by, d.back, now);
    }
  }
}
