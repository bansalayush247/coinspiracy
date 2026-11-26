// The Dust's own rules: warning the street (Mr Adeyemi's door gives the clue), then Mr Fennick's walk from Dee's
// shop to Glasshouse. He looks back at every corner after the first; anyone he sees, or a crew that falls too far
// behind for too long, sends the tail back to Dee's to start again.
import { TICK_SECONDS } from '@byzantine-council/shared';
import {
  ADEYEMI,
  DEE_SHOP,
  DOORS_NEEDED,
  DOOR_NOTES,
  DUST_LOST,
  GLASSHOUSE_DOOR,
  LOSE_S,
  MISSION_MESSAGES,
  MissionNpc,
  OKAFOR_SPOT,
  TAIL_LOSE,
  courierArrived,
  courierAtStart,
  courierSees,
  courierStep,
  type Courier,
} from '@byzantine-council/shared/city';
import { near, place, workedCount, type ActContext, type ActRules, type CrewMember } from './rules.js';

const FENNICK_WAITING = Object.freeze({ x: DEE_SHOP.x + 0.8, y: DEE_SHOP.y - 0.6 });

/** The Dust's rules: the doors, and Mr Fennick's round with its two ways to lose him. */
export class DustRules implements ActRules {
  #courier: Courier = courierAtStart();
  #farSince: number | null = null;
  /** How many times he has caught someone looking, for tests. */
  spotted = 0;
  /** How many times the crew has fallen too far behind, for tests. */
  lost = 0;

  setup(ctx: ActContext): void {
    const npcs = ctx.state.npcs;
    npcs.set('okafor', new MissionNpc({ kind: 'okafor', x: OKAFOR_SPOT.x, y: OKAFOR_SPOT.y }));
    npcs.set('dee', new MissionNpc({ kind: 'dee', x: DEE_SHOP.x + 1.1, y: DEE_SHOP.y + 0.6 }));
    npcs.set('fennick', new MissionNpc({ kind: 'fennick', x: FENNICK_WAITING.x, y: FENNICK_WAITING.y }));
    npcs.set('glass', new MissionNpc({ kind: 'glass', x: GLASSHOUSE_DOOR.x + 1.2, y: GLASSHOUSE_DOOR.y, shown: false }));
  }

  onStep(ctx: ActContext, step: string): void {
    if (step !== 'tail') return;
    this.#restart(ctx);
  }

  onScene(ctx: ActContext, node: string): void {
    if (node !== 'office') return;
    ctx.moveCrew(GLASSHOUSE_DOOR);
    place(ctx, 'fennick', { x: GLASSHOUSE_DOOR.x - 1.2, y: GLASSHOUSE_DOOR.y });
    place(ctx, 'glass', { x: GLASSHOUSE_DOOR.x + 1.2, y: GLASSHOUSE_DOOR.y });
  }

  /** Walks Mr Fennick on; on a quiet night too, so tests can follow him without the catches. */
  move(ctx: ActContext, now: number): void {
    if (ctx.state.step !== 'tail' || ctx.inScene()) return;
    this.#courier = courierStep(this.#courier, TICK_SECONDS);
    this.#show(ctx);
    if (!courierArrived(this.#courier)) return;
    if ([...ctx.crew()].some((m) => near(m.player, GLASSHOUSE_DOOR, TAIL_LOSE))) ctx.setStep('office', now);
  }

  tick(ctx: ActContext, now: number): void {
    if (ctx.state.step !== 'tail' || ctx.inScene()) return;
    const crew = [...ctx.crew()].filter((m) => now >= m.caughtUntil);
    const seen = crew.find((m) => courierSees(this.#courier, m.player));
    if (seen !== undefined) {
      this.spotted++;
      this.#restart(ctx);
      ctx.moveCrew(DEE_SHOP);
      ctx.catchMember(seen, 'courier', DEE_SHOP, now);
      return;
    }
    const w = this.#courier.walker;
    if (crew.length === 0 || crew.some((m) => near(m.player, w, TAIL_LOSE))) {
      this.#farSince = null;
      return;
    }
    this.#farSince ??= now;
    if (now - this.#farSince < LOSE_S * 1000) return;
    this.lost++;
    this.#restart(ctx);
    ctx.moveCrew(DEE_SHOP);
    ctx.broadcast(MISSION_MESSAGES.NOTE, { text: DUST_LOST });
  }

  worked(ctx: ActContext, spot: number, _by: CrewMember, now: number): string {
    if (spot === ADEYEMI) ctx.mark('clueGreyCoat');
    if (workedCount(ctx) >= DOORS_NEEDED) ctx.setStep('toShop', now);
    return DOOR_NOTES[spot] ?? '';
  }

  #restart(ctx: ActContext): void {
    this.#courier = courierAtStart();
    this.#farSince = null;
    this.#show(ctx);
  }

  #show(ctx: ActContext): void {
    const n = ctx.state.npcs.get('fennick');
    if (n === undefined) return;
    const w = this.#courier.walker;
    n.x = w.x;
    n.y = w.y;
    n.facing = w.facing;
    n.chasing = this.#courier.glance > 0;
  }
}
