// The Last Alert's own rules: Mags following the nearest of the crew across the tip, Rex's volunteers combing it
// with torches, and Mags hurrying back to her hatch whenever a torch finds her. Once she reaches the aerial, the walk is over.
import { TICK_SECONDS } from '@byzantine-council/shared';
import {
  AERIAL,
  AERIAL_REACH,
  CITY_MAP,
  GATE_SPOT,
  HATCH,
  IVY_SPOT,
  MAGS_SPOTTED,
  MISSION_MESSAGES,
  MissionNpc,
  VOLUNTEER_ROUTES,
  VOLUNTEER_SPEED,
  follow,
  follower,
  inTorch,
  type Follower,
} from '@byzantine-council/shared/city';
import { Patrols } from './patrols.js';
import { near, place, type ActContext, type ActRules } from './rules.js';

const VOLUNTEERS = VOLUNTEER_ROUTES.map((route, i) => ({ id: `volunteer${String(i)}`, kind: 'lookout' as const, name: 'Volunteer', route, speed: VOLUNTEER_SPEED, by: 'lookout' as const, back: GATE_SPOT }));
const REX_BELOW = Object.freeze({ x: AERIAL.x + 3, y: AERIAL.y });

export class AlertRules implements ActRules {
  #mags: Follower = follower(HATCH);
  spotted = 0;
  readonly #patrols = new Patrols(VOLUNTEERS, ['escort']);

  setup(ctx: ActContext): void {
    const npcs = ctx.state.npcs;
    npcs.set('ozzy', new MissionNpc({ kind: 'ozzy', x: IVY_SPOT.x + 1.2, y: IVY_SPOT.y }));
    npcs.set('ivy', new MissionNpc({ kind: 'ivy', x: IVY_SPOT.x - 1.2, y: IVY_SPOT.y }));
    npcs.set('mags', new MissionNpc({ kind: 'mags', x: HATCH.x, y: HATCH.y }));
    npcs.set('duncan', new MissionNpc({ kind: 'duncan', x: HATCH.x - 1, y: HATCH.y + 0.4 }));
    npcs.set('rex', new MissionNpc({ kind: 'rex', x: REX_BELOW.x, y: REX_BELOW.y, shown: false }));
    this.#patrols.setup(ctx);
  }

  onScene(ctx: ActContext, node: string): void {
    if (node === 'aerial') {
      ctx.moveCrew(AERIAL);
      place(ctx, 'mags', AERIAL);
      place(ctx, 'rex', REX_BELOW);
    } else if (node === 'dawn') {
      ctx.moveCrew(GATE_SPOT);
      place(ctx, 'mags', HATCH);
      place(ctx, 'rex', REX_BELOW, false);
    }
  }

  move(ctx: ActContext, now: number): void {
    if (ctx.state.step !== 'escort' || ctx.inScene()) return;
    const crew = [...ctx.crew()].filter((m) => now >= m.caughtUntil).map((m) => m.player);
    this.#mags = follow(this.#mags, crew, TICK_SECONDS, CITY_MAP);
    const at = this.#mags.walker;
    const n = ctx.state.npcs.get('mags');
    if (n !== undefined) {
      n.x = at.x;
      n.y = at.y;
      n.facing = at.facing;
    }
    if (near(at, AERIAL, AERIAL_REACH)) ctx.setStep('aerial', now);
  }

  tick(ctx: ActContext, now: number): void {
    this.#patrols.tick(ctx, now);
    if (ctx.state.step !== 'escort' || ctx.inScene() || !this.#lit(ctx, this.#mags.walker)) return;
    this.spotted++;
    this.#mags = follower(HATCH);
    place(ctx, 'mags', HATCH);
    ctx.broadcast(MISSION_MESSAGES.NOTE, { text: MAGS_SPOTTED });
  }

  #lit(ctx: ActContext, at: { x: number; y: number }): boolean {
    return VOLUNTEERS.some((v) => {
      const n = ctx.state.npcs.get(v.id);
      return n !== undefined && inTorch(n, n.facing, at);
    });
  }

  worked(): string {
    return '';
  }
}
