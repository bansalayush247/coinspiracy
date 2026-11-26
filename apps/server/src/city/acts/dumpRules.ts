// Act one's own rules: where the device is buried (never sent to anyone), Ivor's rounds with his torch, Duncan
// let off the chain by a bluff or by too much digging, and what each wrong heap turns up.
import { TICK_SECONDS, stepMovement, type Vec2 } from '@byzantine-council/shared';
import { findPath } from '@byzantine-council/shared/pathfinding';
import {
  CITY_MAP,
  DANI_SPOT,
  DEVICE_NOTE,
  DEVICE_HEAPS,
  DUNCAN_CATCH,
  DUNCAN_SMELL,
  DUNCAN_SPEED_SCALE,
  DUNCAN_WRONG_HEAPS,
  GATE_SPOT,
  GUITAR,
  HEAPS,
  JUNK,
  KENNEL,
  MISSION_MESSAGES,
  MissionNpc,
  PATROL,
  PATROL_SPEED,
  SKIP_HEAP,
  inTorch,
  inYard,
  walkRoute,
} from '@byzantine-council/shared/city';
import { near, npc, type ActContext, type ActRules, type CrewMember } from './rules.js';

const DUNCAN_REPATH_MS = 400;
const DUNCAN_REST_MS = 4_000;

export class DumpRules implements ActRules {
  secret = -1;
  #wrong = 0;
  #junk = 0;
  #guitar = false;
  #leg = 0;
  #dogOut = false;
  #dogPath: Vec2[] = [];
  #repathAt = 0;
  #restUntil = 0;

  setup(ctx: ActContext): void {
    this.secret = DEVICE_HEAPS[ctx.random.int(DEVICE_HEAPS.length)] ?? 0;
    const npcs = ctx.state.npcs;
    npcs.set('dani', new MissionNpc({ kind: 'dani', x: DANI_SPOT.x, y: DANI_SPOT.y - 0.8 }));
    npcs.set('mags', new MissionNpc({ kind: 'mags', x: GATE_SPOT.x, y: GATE_SPOT.y - 0.9 }));
    const first = PATROL[0] ?? GATE_SPOT;
    npcs.set('guard', new MissionNpc({ kind: 'guard', x: first.x, y: first.y }));
    npcs.set('duncan', new MissionNpc({ kind: 'duncan', x: KENNEL.x, y: KENNEL.y }));
  }

  tick(ctx: ActContext, now: number): void {
    this.#patrol(ctx);
    this.#walkDog(ctx, now);
    this.#catch(ctx, now);
  }

  onStep(ctx: ActContext, step: string): void {
    if (step === 'toTip') npc(ctx.state, 'dani', (n) => {
      n.shown = false;
    });
    if (step === 'dig' && ctx.marks.has('bluffedMags')) this.#dogOut = true;
  }

  onScene(ctx: ActContext, node: string): void {
    const hero = ctx.anchor();
    if (hero === null) return;
    if (node === 'slip') npc(ctx.state, 'dani', (n) => {
      n.x = hero.x + 1;
      n.y = hero.y + 0.4;
      n.shown = true;
    });
    if (node === 'selfie') {
      this.#dogOut = false;
      npc(ctx.state, 'duncan', (n) => {
        n.x = hero.x - 0.9;
        n.y = hero.y + 0.5;
        n.chasing = false;
      });
    }
  }

  worked(ctx: ActContext, spot: number, _by: CrewMember, now: number): string {
    const heap = HEAPS[spot];
    if (heap === undefined) return '';
    if (spot === this.secret) {
      ctx.setStep('found', now);
      return DEVICE_NOTE;
    }
    let note: string;
    if (heap.bySkip) note = SKIP_HEAP;
    else if (heap.winter && !this.#guitar) {
      this.#guitar = true;
      note = GUITAR;
    } else note = JUNK[this.#junk++ % JUNK.length] ?? '';
    this.#wrong++;
    if (this.#wrong >= DUNCAN_WRONG_HEAPS && !this.#dogOut) {
      this.#dogOut = true;
      ctx.broadcast(MISSION_MESSAGES.DUNCAN, {});
    }
    return note;
  }

  // Ivor walks his rounds at a steady pace, his torch pointing the way he walks.
  #patrol(ctx: ActContext): void {
    const guard = ctx.state.npcs.get('guard');
    if (guard === undefined) return;
    const next = walkRoute({ x: guard.x, y: guard.y, facing: guard.facing, leg: this.#leg }, PATROL, PATROL_SPEED, TICK_SECONDS);
    guard.x = next.x;
    guard.y = next.y;
    guard.facing = next.facing;
    this.#leg = next.leg;
  }

  // The crew member Duncan can smell: in his yard, not just caught, the nearest one.
  #prey(ctx: ActContext, dog: Vec2, now: number): CrewMember | null {
    if (ctx.state.step !== 'dig' || ctx.inScene() || now < this.#restUntil) return null;
    let best: CrewMember | null = null;
    let bestDist = DUNCAN_SMELL;
    for (const m of ctx.crew()) {
      const d = Math.hypot(m.player.x - dog.x, m.player.y - dog.y);
      if (now >= m.caughtUntil && inYard(m.player) && d <= bestDist) {
        best = m;
        bestDist = d;
      }
    }
    return best;
  }

  // Duncan chases whoever he can smell in his yard, gives up at the fence, and goes home after a catch.
  #walkDog(ctx: ActContext, now: number): void {
    const dog = ctx.state.npcs.get('duncan');
    if (dog === undefined || !this.#dogOut) return;
    const prey = this.#prey(ctx, dog, now);
    const goal: Vec2 = prey?.player ?? KENNEL;
    if (dog.chasing !== (prey !== null)) dog.chasing = prey !== null;
    if (near(dog, goal, 0.2)) return;
    if (now >= this.#repathAt) {
      this.#repathAt = now + DUNCAN_REPATH_MS;
      const path = findPath(CITY_MAP, dog, goal);
      this.#dogPath = path.ok ? path.value : [];
    }
    const next = this.#dogPath[0];
    if (next === undefined) return;
    const dx = next.x - dog.x;
    const dy = next.y - dog.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.15) {
      this.#dogPath.shift();
      return;
    }
    const moved = stepMovement({ x: dog.x, y: dog.y }, { x: (dx / dist) * DUNCAN_SPEED_SCALE, y: (dy / dist) * DUNCAN_SPEED_SCALE }, TICK_SECONDS, CITY_MAP);
    dog.x = moved.x;
    dog.y = moved.y;
    dog.facing = Math.atan2(dy, dx);
  }

  #catch(ctx: ActContext, now: number): void {
    if (ctx.state.step !== 'dig' || ctx.inScene()) return;
    const guard = ctx.state.npcs.get('guard');
    const dog = ctx.state.npcs.get('duncan');
    for (const m of ctx.crew()) {
      if (now < m.caughtUntil) continue;
      const byGuard = guard !== undefined && inTorch(guard, guard.facing, m.player);
      const byDog = !byGuard && dog !== undefined && this.#dogOut && dog.chasing && near(dog, m.player, DUNCAN_CATCH);
      if (!byGuard && !byDog) continue;
      if (byDog) {
        this.#restUntil = now + DUNCAN_REST_MS;
        this.#dogPath = [];
      }
      ctx.catchMember(m, byGuard ? 'guard' : 'duncan', GATE_SPOT, now);
    }
  }
}
