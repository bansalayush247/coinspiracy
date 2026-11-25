// Pizza Night's own rules: Marco at his door, toppings round Saltmarket (no anchovies, ever), and three gulls on
// the road east, each watching its own stretch while the pizzas go by.
import { BENNY_DOOR, GULLS, MARCO_DOOR, MissionNpc, TOPPINGS, TOPPINGS_NEEDED } from '@byzantine-council/shared/city';
import { Patrols } from './patrols.js';
import { workedCount, type ActContext, type ActRules, type CrewMember } from './rules.js';

export class PizzaRules implements ActRules {
  readonly #patrols = new Patrols(
    GULLS.map((g, i) => ({ id: `gull${String(i)}`, kind: 'gull', route: g.route, speed: g.speed, by: 'gull', back: g.back })),
    ['deliver'],
  );

  setup(ctx: ActContext): void {
    const npcs = ctx.state.npcs;
    npcs.set('marco', new MissionNpc({ kind: 'marco', x: MARCO_DOOR.x, y: MARCO_DOOR.y - 1 }));
    npcs.set('benny', new MissionNpc({ kind: 'benny', x: BENNY_DOOR.x + 1.2, y: BENNY_DOOR.y }));
    this.#patrols.setup(ctx);
  }

  tick(ctx: ActContext, now: number): void {
    this.#patrols.tick(ctx, now);
  }

  worked(ctx: ActContext, spot: number, _by: CrewMember, now: number): string {
    const topping = TOPPINGS[spot];
    if (topping === undefined) return '';
    if (topping.refuses !== true && workedCount(ctx) >= TOPPINGS_NEEDED) ctx.setStep('toMarco', now);
    return topping.note;
  }
}
