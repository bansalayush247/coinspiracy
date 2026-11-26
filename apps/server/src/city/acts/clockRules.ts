// The Clock's own rules: a crowd of shoppers leaves Mint Hall at every chime and walks to the olive shop, and Mr
// Fennick clocks anyone inside his ring at the Saltmarket gate who hasn't enough of the crowd around them.
import { TICK_SECONDS } from '@byzantine-council/shared';
import {
  CROWD_SIZE,
  FENNICK_SEAT,
  GATHER_S,
  MINT_DOOR,
  MissionNpc,
  OLIVE_SHOP,
  clocked,
  crowdAt,
} from '@byzantine-council/shared/city';
import { place, type ActContext, type ActRules } from './rules.js';

// The first crowd leaves this soon after the crew is sent off, so nobody waits a whole round at the start.
const FIRST_CHIME_S = 4;

/** The Clock's rules: the crowd's rounds, and Mr Fennick's stopwatch at the gate. */
export class ClockRules implements ActRules {
  #t = 0;
  /** How many times Mr Fennick has clocked someone, for tests. */
  clockedCount = 0;

  setup(ctx: ActContext): void {
    const npcs = ctx.state.npcs;
    npcs.set('ivy', new MissionNpc({ kind: 'ivy', x: MINT_DOOR.x + 1, y: MINT_DOOR.y }));
    npcs.set('fennick', new MissionNpc({ kind: 'fennick', x: FENNICK_SEAT.x, y: FENNICK_SEAT.y, facing: Math.PI }));
    npcs.set('glass', new MissionNpc({ kind: 'glass', x: FENNICK_SEAT.x + 1, y: FENNICK_SEAT.y + 0.8, shown: false }));
    crowdAt(0).members.forEach((m, i) => npcs.set(`shopper${String(i)}`, new MissionNpc({ kind: 'shopper', x: m.x, y: m.y, facing: m.facing })));
  }

  onStep(_ctx: ActContext, step: string): void {
    if (step === 'blend') this.#t = GATHER_S - FIRST_CHIME_S;
  }

  onScene(ctx: ActContext, node: string): void {
    if (node !== 'market') return;
    ctx.moveCrew(OLIVE_SHOP);
    place(ctx, 'glass', { x: FENNICK_SEAT.x + 1, y: FENNICK_SEAT.y + 0.8 });
  }

  /** Walks the crowd and runs the HUD clock; on a quiet night too, so tests can walk with them. */
  move(ctx: ActContext): void {
    const live = ctx.state.step === 'blend' && !ctx.inScene();
    const fennick = ctx.state.npcs.get('fennick');
    if (fennick !== undefined) fennick.chasing = live;
    if (!live) {
      if (ctx.state.clock !== 0) ctx.state.clock = 0;
      return;
    }
    this.#t += TICK_SECONDS;
    const crowd = crowdAt(this.#t);
    for (let i = 0; i < CROWD_SIZE; i++) {
      const n = ctx.state.npcs.get(`shopper${String(i)}`);
      const m = crowd.members[i];
      if (n === undefined || m === undefined) continue;
      n.x = m.x;
      n.y = m.y;
      n.facing = m.facing;
    }
    const left = Math.ceil(crowd.leaveIn);
    if (left !== ctx.state.clock) ctx.state.clock = left;
  }

  tick(ctx: ActContext, now: number): void {
    if (ctx.state.step !== 'blend' || ctx.inScene()) return;
    const crowd = crowdAt(this.#t);
    for (const m of ctx.crew()) {
      if (now < m.caughtUntil || !clocked(crowd, m.player)) continue;
      this.clockedCount++;
      ctx.catchMember(m, 'stopwatch', MINT_DOOR, now);
    }
  }

  worked(): string {
    return '';
  }
}
