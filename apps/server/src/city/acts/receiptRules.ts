// The Old Receipt's own rules: which of Nell's boats holds the newest receipt (picked here, never sent until it is
// found, and only narrowed to a jetty if Nell is helped to remember), Silas's deckhands on the jetties, and the
// tide: a clock that starts with the search and, if it runs out first, lets Silas's old receipt stand.
import { BOATS, BOAT_NOTES, COOP_YARD, DECKHAND_BACKS, DECKHAND_NAME, DECKHAND_ROUTES, DECKHAND_SPEED, HARBOUR_OFFICE, IVY_SPOT, JETTY_MARKS, MissionNpc, RECEIPT_FOUND, TIDE_MS } from '@byzantine-council/shared/city';
import { Patrols } from './patrols.js';
import { place, type ActContext, type ActRules, type CrewMember } from './rules.js';

const RUNNING = new Set(['search', 'deliver']);

export class ReceiptRules implements ActRules {
  secret = -1;
  #wrong = 0;
  #tideAt = 0;
  readonly #patrols = new Patrols(
    DECKHAND_ROUTES.map((route, i) => ({ id: `deckhand${String(i)}`, kind: 'lookout', name: DECKHAND_NAME, route, speed: DECKHAND_SPEED, by: 'guard', back: DECKHAND_BACKS[i] ?? COOP_YARD })),
    ['search', 'deliver'],
  );

  setup(ctx: ActContext): void {
    this.secret = ctx.random.int(BOATS.length);
    const npcs = ctx.state.npcs;
    npcs.set('ozzy', new MissionNpc({ kind: 'ozzy', x: IVY_SPOT.x + 1.2, y: IVY_SPOT.y }));
    npcs.set('nell', new MissionNpc({ kind: 'nell', x: COOP_YARD.x + 1.1, y: COOP_YARD.y - 0.5 }));
    npcs.set('clerk', new MissionNpc({ kind: 'stall', name: 'Harbour clerk', x: HARBOUR_OFFICE.x + 1.2, y: HARBOUR_OFFICE.y }));
    npcs.set('silas', new MissionNpc({ kind: 'silas', x: HARBOUR_OFFICE.x - 1.2, y: HARBOUR_OFFICE.y }));
    this.#patrols.setup(ctx);
  }

  onStep(ctx: ActContext, step: string, now: number): void {
    if (step === 'search') {
      this.#tideAt = now + TIDE_MS;
      ctx.state.clock = Math.ceil(TIDE_MS / 1000);
    } else if (!RUNNING.has(step)) {
      this.#tideAt = 0;
      ctx.state.clock = 0;
    }
  }

  onScene(ctx: ActContext, node: string): void {
    const boat = BOATS[this.secret];
    if (node === 'coopCalm' && boat !== undefined) ctx.mark(JETTY_MARKS[boat.jetty]);
    const hero = ctx.anchor();
    if (node === 'office' && hero !== null) place(ctx, 'nell', { x: hero.x - 1.1, y: hero.y + 0.6 });
  }

  tick(ctx: ActContext, now: number): void {
    this.#patrols.tick(ctx, now);
    if (this.#tideAt === 0 || !RUNNING.has(ctx.state.step)) return;
    const left = Math.max(0, Math.ceil((this.#tideAt - now) / 1000));
    if (left !== ctx.state.clock) ctx.state.clock = left;
    if (left === 0) ctx.setStep('missed', now);
  }

  worked(ctx: ActContext, spot: number, _by: CrewMember, now: number): string {
    if (spot === this.secret) {
      ctx.setStep('deliver', now);
      return RECEIPT_FOUND;
    }
    return BOAT_NOTES[this.#wrong++ % BOAT_NOTES.length] ?? '';
  }
}
