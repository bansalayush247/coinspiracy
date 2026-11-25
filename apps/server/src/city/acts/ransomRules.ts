// Act two's own rules: Ivy on the Mint steps, five guardians to ask (three signatures lock the words into the
// federation, and Wren never signs), the Locksmith's lookouts walking the breakwater with torches (one fewer if
// the crew caught the recording), and who turns up for the last scenes.
import { TICK_SECONDS, type Vec2 } from '@byzantine-council/shared';
import {
  BREAKWATER,
  GUARDIANS,
  IVY_SPOT,
  LIGHTHOUSE_DOOR,
  LOOKOUT_ROUTES,
  LOOKOUT_SPEED,
  MissionNpc,
  SIGNATURES_NEEDED,
  inTorch,
  walkRoute,
} from '@byzantine-council/shared/city';
import { npc, type ActContext, type ActRules, type CrewMember } from './rules.js';

const PATROLLING: ReadonlySet<string> = new Set(['breakwater', 'sneak', 'door']);

export class RansomRules implements ActRules {
  #signatures = 0;
  readonly #legs = LOOKOUT_ROUTES.map(() => 0);

  setup(ctx: ActContext): void {
    const npcs = ctx.state.npcs;
    npcs.set('ivy', new MissionNpc({ kind: 'ivy', x: IVY_SPOT.x, y: IVY_SPOT.y - 0.5 }));
    GUARDIANS.forEach((g, i) => {
      npcs.set(`guardian${String(i)}`, new MissionNpc({ kind: 'guardian', name: g.label, x: g.at.x, y: g.at.y, facing: Math.PI / 2 }));
    });
    LOOKOUT_ROUTES.forEach((route, i) => {
      const start = route[0] ?? BREAKWATER;
      npcs.set(`lookout${String(i)}`, new MissionNpc({ kind: 'lookout', x: start.x, y: start.y, shown: false }));
    });
    npcs.set('teo', new MissionNpc({ kind: 'teo', x: LIGHTHOUSE_DOOR.x, y: LIGHTHOUSE_DOOR.y, shown: false }));
    npcs.set('brannigan', new MissionNpc({ kind: 'brannigan', x: IVY_SPOT.x + 1.5, y: IVY_SPOT.y, shown: false }));
  }

  tick(ctx: ActContext, now: number): void {
    if (!PATROLLING.has(ctx.state.step)) return;
    LOOKOUT_ROUTES.forEach((route, i) => {
      const look = ctx.state.npcs.get(`lookout${String(i)}`);
      if (look === undefined || !look.shown) return;
      const next = walkRoute({ x: look.x, y: look.y, facing: look.facing, leg: this.#legs[i] ?? 0 }, route, LOOKOUT_SPEED, TICK_SECONDS);
      look.x = next.x;
      look.y = next.y;
      look.facing = next.facing;
      this.#legs[i] = next.leg;
    });
    if (ctx.state.step !== 'sneak' || ctx.inScene()) return;
    for (const m of ctx.crew()) {
      if (now < m.caughtUntil) continue;
      const lit = LOOKOUT_ROUTES.some((_r, i) => {
        const look = ctx.state.npcs.get(`lookout${String(i)}`);
        return look !== undefined && look.shown && inTorch(look, look.facing, m.player);
      });
      if (lit) ctx.catchMember(m, 'lookout', BREAKWATER, now);
    }
  }

  onStep(ctx: ActContext, step: string): void {
    if (step === 'toLighthouse') npc(ctx.state, 'brannigan', (n) => {
      n.shown = false;
    });
    if (step !== 'breakwater') return;
    LOOKOUT_ROUTES.forEach((_r, i) => {
      npc(ctx.state, `lookout${String(i)}`, (n) => {
        n.shown = i === 0 || !ctx.marks.has('clueRecording');
      });
    });
  }

  onScene(ctx: ActContext, node: string): void {
    const hero = ctx.anchor();
    if (node === 'brannigan' && hero !== null) this.#place(ctx, 'brannigan', { x: hero.x + 1.4, y: hero.y + 0.3 });
    if (node === 'door') this.#place(ctx, 'teo', { x: LIGHTHOUSE_DOOR.x - 0.6, y: LIGHTHOUSE_DOOR.y });
    if (node === 'brannDoor' && hero !== null) this.#place(ctx, 'brannigan', { x: hero.x + 1.2, y: hero.y + 0.6 });
  }

  worked(ctx: ActContext, spot: number, _by: CrewMember, now: number): string {
    const guardian = GUARDIANS[spot];
    if (guardian === undefined) return '';
    if (guardian.refuses === true) ctx.mark('wrenRefused');
    else if (++this.#signatures >= SIGNATURES_NEEDED) ctx.setStep('locked', now);
    return guardian.note;
  }

  #place(ctx: ActContext, id: string, at: Vec2): void {
    npc(ctx.state, id, (n) => {
      n.x = at.x;
      n.y = at.y;
      n.shown = true;
    });
  }
}
