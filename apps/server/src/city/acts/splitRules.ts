// The Split's own rules: six shopkeepers round Council Hill, and Rex Bigsby on his rounds with a megaphone, talking
// back round anyone the crew has won but left on their own once they've had time to waver. Five at once settles it.
import { TICK_SECONDS, type Vec2 } from '@byzantine-council/shared';
import {
  CITY_MAP,
  GUARD_RANGE,
  HALL_STEPS,
  IVY_SPOT,
  MissionNpc,
  REX_NOTE,
  REX_REACH,
  REX_SPEED,
  SHOPKEEPERS,
  SIGNALS_NEEDED,
  WON_FIRM_MS,
  WON_NOTES,
  rexTarget,
  walkPath,
  type Walker,
} from '@byzantine-council/shared/city';
import { findPath } from '@byzantine-council/shared/pathfinding';
import { near, place, workedCount, type ActContext, type ActRules, type CrewMember } from './rules.js';

const NAMES = ['Baker', 'Florist', 'Barber', 'Café owner', 'Cobbler', 'Bookseller'];
const REX_HOME: Vec2 = Object.freeze({ x: HALL_STEPS.x + 1.4, y: HALL_STEPS.y - 0.6 });

export class SplitRules implements ActRules {
  #rex: Walker = { x: REX_HOME.x, y: REX_HOME.y, facing: Math.PI / 2, leg: 0 };
  #path: Vec2[] = [];
  #target = -2;
  readonly #wonAt = new Map<number, number>();
  flips = 0;

  setup(ctx: ActContext): void {
    const npcs = ctx.state.npcs;
    npcs.set('ivy', new MissionNpc({ kind: 'ivy', x: IVY_SPOT.x + 1.2, y: IVY_SPOT.y }));
    npcs.set('rex', new MissionNpc({ kind: 'rex', x: REX_HOME.x, y: REX_HOME.y }));
    SHOPKEEPERS.forEach((s, i) => {
      npcs.set(`shop${String(i)}`, new MissionNpc({ kind: 'stall', name: NAMES[i] ?? '', x: s.at.x + 0.6, y: s.at.y - 0.5 }));
    });
  }

  onScene(ctx: ActContext, node: string): void {
    if (node !== 'count') return;
    ctx.moveCrew(HALL_STEPS);
    place(ctx, 'rex', REX_HOME);
    place(ctx, 'ivy', { x: HALL_STEPS.x + 1.4, y: HALL_STEPS.y + 0.8 });
  }

  // Rex makes for the nearest won shopkeeper nobody is guarding, talks them round, and otherwise heads home.
  tick(ctx: ActContext, now: number): void {
    if (ctx.state.step !== 'canvass' || ctx.inScene()) return;
    const crew = [...ctx.crew()];
    const won = SHOPKEEPERS.map((_, i) => ctx.state.spots[i]?.done === true);
    const guarded = SHOPKEEPERS.map((s, i) => now - (this.#wonAt.get(i) ?? -Infinity) < WON_FIRM_MS || crew.some((m) => near(m.player, s.at, GUARD_RANGE)));
    const target = rexTarget(this.#rex, won, guarded);
    if (target !== this.#target) {
      this.#target = target;
      const goal = SHOPKEEPERS[target]?.at ?? REX_HOME;
      const found = findPath(CITY_MAP, this.#rex, goal);
      this.#path = found.ok ? [{ x: this.#rex.x, y: this.#rex.y }, ...found.value] : [];
      this.#rex = { ...this.#rex, leg: 0 };
    }
    if (this.#path.length > 1) this.#rex = walkPath(this.#rex, this.#path, REX_SPEED, TICK_SECONDS);
    const n = ctx.state.npcs.get('rex');
    if (n !== undefined) {
      n.x = this.#rex.x;
      n.y = this.#rex.y;
      n.facing = this.#rex.facing;
    }
    const shop = SHOPKEEPERS[target];
    const spot = ctx.state.spots[target];
    if (shop === undefined || spot === undefined || !near(this.#rex, shop.at, REX_REACH)) return;
    spot.done = false;
    spot.note = REX_NOTE(shop.label);
    this.flips++;
  }

  worked(ctx: ActContext, spot: number, _by: CrewMember, now: number): string {
    this.#wonAt.set(spot, now);
    if (workedCount(ctx) >= SIGNALS_NEEDED) ctx.setStep('count', now);
    return WON_NOTES[spot] ?? '';
  }
}
