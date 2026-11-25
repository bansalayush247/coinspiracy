// Follow the Coins' own rules: Tiny walking the market lane with the video's ring light, which tip jar carries the
// reused address (picked here, never sent until it's found), and the rapper in his warehouse.
import { COINS_START, JAR_FOUND, JAR_NOTES, MissionNpc, STUDIO_DOOR, TINY_ROUTE, TINY_SPEED, TIP_JARS } from '@byzantine-council/shared/city';
import { Patrols } from './patrols.js';
import { place, type ActContext, type ActRules, type CrewMember } from './rules.js';

export class CoinsRules implements ActRules {
  secret = -1;
  #wrong = 0;
  readonly #patrols = new Patrols([{ id: 'tiny', kind: 'guard', name: 'Tiny', route: TINY_ROUTE, speed: TINY_SPEED, by: 'guard', back: COINS_START }], ['scan']);

  setup(ctx: ActContext): void {
    this.secret = ctx.random.int(TIP_JARS.length);
    const npcs = ctx.state.npcs;
    npcs.set('brannigan', new MissionNpc({ kind: 'brannigan', x: COINS_START.x + 1.2, y: COINS_START.y }));
    npcs.set('stall', new MissionNpc({ kind: 'stall', x: COINS_START.x, y: COINS_START.y, shown: false }));
    npcs.set('mc', new MissionNpc({ kind: 'mc', x: STUDIO_DOOR.x - 0.9, y: STUDIO_DOOR.y + 0.4 }));
    this.#patrols.setup(ctx);
  }

  tick(ctx: ActContext, now: number): void {
    this.#patrols.tick(ctx, now);
  }

  onScene(ctx: ActContext, node: string): void {
    const hero = ctx.anchor();
    if (hero === null) return;
    if (node === 'jar') place(ctx, 'stall', { x: hero.x + 1, y: hero.y - 0.5 });
    if (node === 'studioVerse' || node === 'studioSign' || node === 'studioEnd') place(ctx, 'brannigan', { x: hero.x + 1.1, y: hero.y + 0.5 });
  }

  worked(ctx: ActContext, spot: number, _by: CrewMember, now: number): string {
    if (spot === this.secret) {
      ctx.setStep('found', now);
      return JAR_FOUND;
    }
    return JAR_NOTES[this.#wrong++ % JAR_NOTES.length] ?? '';
  }
}
