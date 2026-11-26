// Act four's own rules: the Choir's runners combing both sides of the radio mast with phone lights once the city
// goes dark, three of four generators to put the station back on air, Dr Sharpe at the microphone, and the cut to
// the tip gate at dawn where every ending closes.
import { TICK_SECONDS } from '@byzantine-council/shared';
import { CHOIR_ROUTES, CHOIR_SPEED, GATE_SPOT, GENERATORS_NEEDED, GENERATOR_STARTED, KENNEL, MAST_SPOT, MissionNpc, inTorch, walkRoute } from '@byzantine-council/shared/city';
import { npc, type ActContext, type ActRules, type CrewMember } from './rules.js';

const COMBING: ReadonlySet<string> = new Set(['blackout', 'power']);

export class FounderRules implements ActRules {
  #running = 0;
  readonly #legs = CHOIR_ROUTES.map(() => 0);

  setup(ctx: ActContext): void {
    CHOIR_ROUTES.forEach((route, i) => {
      const start = route[0] ?? MAST_SPOT;
      ctx.state.npcs.set(`choir${String(i)}`, new MissionNpc({ kind: 'choir', x: start.x, y: start.y, shown: false }));
    });
    ctx.state.npcs.set('sharpe', new MissionNpc({ kind: 'sharpe', x: MAST_SPOT.x + 2.5, y: MAST_SPOT.y + 1.5, shown: false }));
    ctx.state.npcs.set('mags', new MissionNpc({ kind: 'mags', x: GATE_SPOT.x, y: GATE_SPOT.y - 0.9, shown: false }));
    ctx.state.npcs.set('duncan', new MissionNpc({ kind: 'duncan', x: KENNEL.x + 2, y: KENNEL.y + 0.5, shown: false }));
  }

  onScene(ctx: ActContext, node: string): void {
    if (node !== 'dawn') return;
    ctx.moveCrew({ x: GATE_SPOT.x + 0.4, y: GATE_SPOT.y + 0.8 });
    for (const id of ['mags', 'duncan']) npc(ctx.state, id, (n) => {
      n.shown = true;
    });
    npc(ctx.state, 'sharpe', (n) => {
      n.shown = false;
    });
  }

  tick(ctx: ActContext, now: number): void {
    if (!COMBING.has(ctx.state.step)) return;
    CHOIR_ROUTES.forEach((route, i) => {
      const runner = ctx.state.npcs.get(`choir${String(i)}`);
      if (runner === undefined) return;
      const next = walkRoute({ x: runner.x, y: runner.y, facing: runner.facing, leg: this.#legs[i] ?? 0 }, route, CHOIR_SPEED, TICK_SECONDS);
      runner.x = next.x;
      runner.y = next.y;
      runner.facing = next.facing;
      this.#legs[i] = next.leg;
    });
    if (ctx.state.step !== 'power' || ctx.inScene()) return;
    for (const m of ctx.crew()) {
      if (now < m.caughtUntil) continue;
      const lit = CHOIR_ROUTES.some((_r, i) => {
        const runner = ctx.state.npcs.get(`choir${String(i)}`);
        return runner !== undefined && runner.shown && inTorch(runner, runner.facing, m.player);
      });
      if (lit) ctx.catchMember(m, 'choir', MAST_SPOT, now);
    }
  }

  onStep(ctx: ActContext, step: string): void {
    if (step === 'blackout') {
      CHOIR_ROUTES.forEach((_r, i) => {
        npc(ctx.state, `choir${String(i)}`, (n) => {
          n.shown = true;
        });
      });
    }
    if (step === 'radio') {
      CHOIR_ROUTES.forEach((_r, i) => {
        npc(ctx.state, `choir${String(i)}`, (n) => {
          n.shown = false;
        });
      });
      const hero = ctx.anchor();
      npc(ctx.state, 'sharpe', (n) => {
        n.x = (hero?.x ?? MAST_SPOT.x) + 1.3;
        n.y = (hero?.y ?? MAST_SPOT.y) + 0.6;
        n.shown = true;
      });
    }
  }

  worked(ctx: ActContext, _spot: number, _by: CrewMember, now: number): string {
    if (++this.#running >= GENERATORS_NEEDED) ctx.setStep('radio', now);
    return GENERATOR_STARTED;
  }
}
