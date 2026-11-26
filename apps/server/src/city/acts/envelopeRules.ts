// The Envelope's own rules: Lumley's camera sweeps the Mint Hall steps while the crew seals envelopes at the
// desks. Anyone it catches mid-writing loses that envelope and is sent back up the steps; standing in view is fine.
import { TICK_SECONDS } from '@byzantine-council/shared';
import {
  CAMERA_AT,
  COUNTER,
  DEE_SHOP,
  DESK_NOTES,
  ENVELOPES_NEEDED,
  HALL_STEPS_EAST,
  MissionNpc,
  cameraFacing,
  cameraSees,
} from '@byzantine-council/shared/city';
import { place, workedCount, type ActContext, type ActRules, type CrewMember } from './rules.js';

/** The Envelope's rules: the desks, and the camera that must not see anyone write. */
export class EnvelopeRules implements ActRules {
  #sweep = 0;
  /** How many serials the camera has caught, for tests. */
  snapped = 0;

  setup(ctx: ActContext): void {
    const npcs = ctx.state.npcs;
    npcs.set('ivy', new MissionNpc({ kind: 'ivy', x: COUNTER.x, y: COUNTER.y }));
    npcs.set('lumley', new MissionNpc({ kind: 'lumley', x: CAMERA_AT.x, y: CAMERA_AT.y, facing: cameraFacing(0) }));
    npcs.set('dee', new MissionNpc({ kind: 'dee', x: DEE_SHOP.x + 1.1, y: DEE_SHOP.y + 0.6 }));
    npcs.set('fennick', new MissionNpc({ kind: 'fennick', x: DEE_SHOP.x + 0.8, y: DEE_SHOP.y - 0.6 }));
    npcs.set('glass', new MissionNpc({ kind: 'glass', x: DEE_SHOP.x - 1.2, y: DEE_SHOP.y, shown: false }));
  }

  onScene(ctx: ActContext, node: string): void {
    if (node === 'counter') ctx.moveCrew(COUNTER);
    if (node !== 'till') return;
    ctx.moveCrew(DEE_SHOP);
    place(ctx, 'glass', { x: DEE_SHOP.x - 1.2, y: DEE_SHOP.y });
  }

  /** Turns the camera; on a quiet night too, so tests can watch it without the catches. */
  move(ctx: ActContext): void {
    const lumley = ctx.state.npcs.get('lumley');
    if (lumley === undefined) return;
    const live = ctx.state.step === 'seal' && !ctx.inScene();
    if (live) this.#sweep += TICK_SECONDS;
    lumley.facing = cameraFacing(this.#sweep);
    lumley.chasing = live;
  }

  tick(ctx: ActContext, now: number): void {
    if (ctx.state.step !== 'seal' || ctx.inScene()) return;
    const facing = cameraFacing(this.#sweep);
    const writing = new Set(ctx.state.spots.filter((s) => !s.done && s.worker !== '').map((s) => s.worker));
    for (const m of ctx.crew()) {
      if (!writing.has(m.id) || now < m.caughtUntil || !cameraSees(facing, m.player)) continue;
      this.snapped++;
      ctx.catchMember(m, 'camera', HALL_STEPS_EAST, now);
    }
  }

  worked(ctx: ActContext, spot: number, _by: CrewMember, now: number): string {
    if (workedCount(ctx) >= ENVELOPES_NEEDED) ctx.setStep('counter', now);
    return DESK_NOTES[spot] ?? '';
  }
}
