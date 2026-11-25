// The Overflow's own rules: which three Saltmarket stalls took a bad note (picked here, never sent until checked),
// and Ozzy lapping the market stalls, who sprints away from anyone close, turns back from anyone ahead of him,
// and runs out of puff. Whoever catches up with him starts the last scene there.
import { TICK_SECONDS, type Vec2 } from '@byzantine-council/shared';
import {
  BAD_NOTES,
  BAD_STALLS,
  CLEAN_NOTE,
  GATE_SPOT,
  IVY_SPOT,
  MissionNpc,
  OZZY_CAUGHT,
  OZZY_LOOP,
  OZZY_NOTICES,
  OZZY_REST_MS,
  OZZY_REST_SPEED,
  OZZY_SPRINT,
  OZZY_SPRINT_MS,
  OZZY_WALK,
  STALLS,
  walkRoute,
  type Walker,
} from '@byzantine-council/shared/city';
import { place, type ActContext, type ActRules, type CrewMember } from './rules.js';

const REVERSED = [...OZZY_LOOP].reverse();

export class OverflowRules implements ActRules {
  readonly bad = new Set<number>();
  #found = 0;
  #ozzy: Walker = { x: OZZY_LOOP[0]?.x ?? 0, y: OZZY_LOOP[0]?.y ?? 0, facing: Math.PI / 2, leg: 0 };
  #backwards = false;
  #mode: 'walk' | 'sprint' | 'rest' = 'walk';
  #until = 0;

  setup(ctx: ActContext): void {
    while (this.bad.size < BAD_STALLS) this.bad.add(ctx.random.int(STALLS.length));
    const npcs = ctx.state.npcs;
    npcs.set('mags', new MissionNpc({ kind: 'mags', x: GATE_SPOT.x + 1.1, y: GATE_SPOT.y - 0.6 }));
    npcs.set('ivy', new MissionNpc({ kind: 'ivy', x: IVY_SPOT.x + 1.2, y: IVY_SPOT.y }));
    npcs.set('ozzy', new MissionNpc({ kind: 'ozzy', x: this.#ozzy.x, y: this.#ozzy.y, shown: false }));
  }

  onStep(ctx: ActContext, step: string): void {
    if (step === 'chase') {
      ctx.mark('clueHoodie');
      place(ctx, 'ozzy', this.#ozzy);
    }
  }

  onScene(ctx: ActContext, node: string): void {
    if (node !== 'fixed') return;
    ctx.moveCrew(IVY_SPOT);
    place(ctx, 'ozzy', { x: IVY_SPOT.x - 1.2, y: IVY_SPOT.y + 0.4 });
  }

  tick(ctx: ActContext, now: number): void {
    if (ctx.state.step !== 'chase' || ctx.inScene()) return;
    let nearest: Vec2 | null = null;
    let best = Infinity;
    for (const m of ctx.crew()) {
      const d = Math.hypot(m.player.x - this.#ozzy.x, m.player.y - this.#ozzy.y);
      if (d < best) {
        best = d;
        nearest = m.player;
      }
    }
    if (best <= OZZY_CAUGHT) {
      const at = { x: this.#ozzy.x, y: this.#ozzy.y };
      ctx.moveCrew(at);
      ctx.setStep('caught', now);
      place(ctx, 'ozzy', at);
      return;
    }
    this.#pace(nearest, best, now);
    const speed = this.#mode === 'sprint' ? OZZY_SPRINT : this.#mode === 'rest' ? OZZY_REST_SPEED : OZZY_WALK;
    this.#ozzy = walkRoute(this.#ozzy, this.#backwards ? REVERSED : OZZY_LOOP, speed, TICK_SECONDS);
    const n = ctx.state.npcs.get('ozzy');
    if (n === undefined) return;
    n.x = this.#ozzy.x;
    n.y = this.#ozzy.y;
    n.facing = this.#ozzy.facing;
    n.chasing = this.#mode === 'sprint';
  }

  worked(ctx: ActContext, spot: number, _by: CrewMember, now: number): string {
    if (!this.bad.has(spot)) return CLEAN_NOTE;
    if (++this.#found >= BAD_STALLS) ctx.setStep('chase', now);
    return BAD_NOTES[spot] ?? CLEAN_NOTE;
  }

  // Walks, sprints when anyone comes close (turning back first if they're ahead of him), then rests, out of puff.
  #pace(nearest: Vec2 | null, distance: number, now: number): void {
    if (this.#mode === 'walk' && nearest !== null && distance <= OZZY_NOTICES) {
      this.#mode = 'sprint';
      this.#until = now + OZZY_SPRINT_MS;
      const ahead = Math.cos(this.#ozzy.facing) * (nearest.x - this.#ozzy.x) + Math.sin(this.#ozzy.facing) * (nearest.y - this.#ozzy.y) > 0;
      if (ahead) this.#turn();
    } else if (this.#mode === 'sprint' && now >= this.#until) {
      this.#mode = 'rest';
      this.#until = now + OZZY_REST_MS;
    } else if (this.#mode === 'rest' && now >= this.#until) this.#mode = 'walk';
  }

  // Runs the other way round the same loop from where he stands.
  #turn(): void {
    const n = OZZY_LOOP.length;
    this.#backwards = !this.#backwards;
    this.#ozzy = { ...this.#ozzy, leg: (((n - 2 - this.#ozzy.leg) % n) + n) % n, facing: this.#ozzy.facing + Math.PI };
  }
}
