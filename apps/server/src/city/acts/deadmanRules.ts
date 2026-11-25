// The Dead Man's Vault's own rules: Mrs Bellweather's lantern round the graveyard, three key shares to find on the
// benches (two plaques are gone), and Ms Penrose and Brannigan waiting at the QuayEx tower.
import { BENCHES, DEADMAN_START, KEEPER_ROUTE, KEEPER_SPEED, LYCHGATE, MissionNpc, QUAYEX_DOOR, SHARES_NEEDED } from '@byzantine-council/shared/city';
import { Patrols } from './patrols.js';
import { place, workedCount, type ActContext, type ActRules, type CrewMember } from './rules.js';

export class DeadmanRules implements ActRules {
  readonly #patrols = new Patrols([{ id: 'keeper', kind: 'keeper', route: KEEPER_ROUTE, speed: KEEPER_SPEED, by: 'keeper', back: LYCHGATE }], ['shares']);

  setup(ctx: ActContext): void {
    const npcs = ctx.state.npcs;
    npcs.set('penrose', new MissionNpc({ kind: 'penrose', x: DEADMAN_START.x - 1.2, y: DEADMAN_START.y - 0.4 }));
    npcs.set('brannigan', new MissionNpc({ kind: 'brannigan', x: QUAYEX_DOOR.x + 1.4, y: QUAYEX_DOOR.y, shown: false }));
    this.#patrols.setup(ctx);
  }

  tick(ctx: ActContext, now: number): void {
    this.#patrols.tick(ctx, now);
  }

  onStep(ctx: ActContext, step: string): void {
    if (step !== 'toVault') return;
    place(ctx, 'penrose', { x: QUAYEX_DOOR.x - 1.4, y: QUAYEX_DOOR.y });
    place(ctx, 'brannigan', { x: QUAYEX_DOOR.x + 1.4, y: QUAYEX_DOOR.y });
  }

  worked(ctx: ActContext, spot: number, _by: CrewMember, now: number): string {
    const bench = BENCHES[spot];
    if (bench === undefined) return '';
    if (bench.refuses !== true && workedCount(ctx) >= SHARES_NEEDED) ctx.setStep('toVault', now);
    return bench.note;
  }
}
