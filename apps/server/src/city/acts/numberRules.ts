// Borrowed Number's own rules: Pip at his arcade, three of his details lying about Saltmarket, and Juno behind the
// phone shop counter, with Mr Crane in the back until he isn't.
import { DETAILS, MissionNpc, PIP_SPOT, SHOP_DOOR } from '@byzantine-council/shared/city';
import { place, workedCount, type ActContext, type ActRules, type CrewMember } from './rules.js';

const JUNO = { x: SHOP_DOOR.x + 1.3, y: SHOP_DOOR.y } as const;
const CRANE = { x: SHOP_DOOR.x - 1.3, y: SHOP_DOOR.y } as const;

export class NumberRules implements ActRules {
  setup(ctx: ActContext): void {
    const npcs = ctx.state.npcs;
    npcs.set('pip', new MissionNpc({ kind: 'pip', x: PIP_SPOT.x, y: PIP_SPOT.y }));
    npcs.set('juno', new MissionNpc({ kind: 'juno', x: JUNO.x, y: JUNO.y }));
    npcs.set('crane', new MissionNpc({ kind: 'crane', x: CRANE.x, y: CRANE.y, shown: false }));
  }

  onScene(ctx: ActContext, node: string): void {
    if (node === 'crane') place(ctx, 'crane', CRANE);
    const hero = ctx.anchor();
    if (node === 'craneEnd' && hero !== null) place(ctx, 'pip', { x: hero.x - 1.1, y: hero.y + 0.6 });
  }

  worked(ctx: ActContext, spot: number, _by: CrewMember, now: number): string {
    const detail = DETAILS[spot];
    if (detail === undefined) return '';
    ctx.mark(detail.mark);
    if (workedCount(ctx) >= ctx.act.workGoal) ctx.setStep('toShop', now);
    return detail.note;
  }
}
