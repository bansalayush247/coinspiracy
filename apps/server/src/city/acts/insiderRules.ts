// Act three's own rules: Nonce in his container, Gus the night watchman walking the Gate tower's walls with a torch,
// and which lobby terminal holds the buyer's login (one of the east two, never sent to anyone until it is found).
import { TICK_SECONDS } from '@byzantine-council/shared';
import { LOGIN_TERMINALS, MissionNpc, NONCE_SPOT, OTHER_ACCOUNTS, TEO_ACCOUNT, TOWER_SPOT, WATCH_ROUTE, WATCH_SPEED, inTorch, walkRoute } from '@byzantine-council/shared/city';
import { npc, type ActContext, type ActRules, type CrewMember } from './rules.js';

export class InsiderRules implements ActRules {
  secret = -1;
  #leg = 0;
  #wrong = 0;

  setup(ctx: ActContext): void {
    this.secret = LOGIN_TERMINALS[ctx.random.int(LOGIN_TERMINALS.length)] ?? 0;
    const npcs = ctx.state.npcs;
    npcs.set('nonce', new MissionNpc({ kind: 'nonce', x: NONCE_SPOT.x, y: NONCE_SPOT.y - 0.8 }));
    const first = WATCH_ROUTE[0] ?? TOWER_SPOT;
    npcs.set('gus', new MissionNpc({ kind: 'guard', name: 'Gus', x: first.x, y: first.y }));
    npcs.set('teo', new MissionNpc({ kind: 'teo', x: TOWER_SPOT.x, y: TOWER_SPOT.y, shown: false }));
  }

  tick(ctx: ActContext, now: number): void {
    const gus = ctx.state.npcs.get('gus');
    if (gus === undefined) return;
    const next = walkRoute({ x: gus.x, y: gus.y, facing: gus.facing, leg: this.#leg }, WATCH_ROUTE, WATCH_SPEED, TICK_SECONDS);
    gus.x = next.x;
    gus.y = next.y;
    gus.facing = next.facing;
    this.#leg = next.leg;
    if (ctx.state.step !== 'search' || ctx.inScene()) return;
    for (const m of ctx.crew()) if (now >= m.caughtUntil && inTorch(gus, gus.facing, m.player)) ctx.catchMember(m, 'guard', TOWER_SPOT, now);
  }

  onScene(ctx: ActContext, node: string): void {
    const hero = ctx.anchor();
    if (node !== 'account' || hero === null) return;
    npc(ctx.state, 'teo', (n) => {
      n.x = hero.x + 1.2;
      n.y = hero.y + 0.8;
      n.shown = true;
    });
  }

  worked(ctx: ActContext, spot: number, _by: CrewMember, now: number): string {
    if (spot === this.secret) {
      ctx.setStep('found', now);
      return TEO_ACCOUNT;
    }
    return OTHER_ACCOUNTS[this.#wrong++ % OTHER_ACCOUNTS.length] ?? '';
  }
}
