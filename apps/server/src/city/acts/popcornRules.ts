// The Popcorn Tin's own rules: Brannigan searching the yard in his own order, Biscuit asleep on the kennel until
// somebody rattles the bins, and the race for the tin. Whoever searches the kennel first ends the case.
import { TICK_SECONDS } from '@byzantine-council/shared';
import {
  BINS,
  BISCUIT_AWAY_MS,
  BISCUIT_BED,
  BISCUIT_REFUSES,
  BISCUIT_SPEED,
  BISCUIT_TO_BINS,
  BRANNIGAN_NOTE,
  BRANNIGAN_ROUNDS,
  BRANNIGAN_SEARCH_MS,
  BRANNIGAN_SPEED,
  KENNEL_SPOT,
  MISSION_MESSAGES,
  MissionNpc,
  OKAFOR_SPOT,
  POPCORN_START,
  YARD_NOTES,
  walkPath,
  type Walker,
} from '@byzantine-council/shared/city';
import { npc, type ActContext, type ActRules, type CrewMember } from './rules.js';

const BISCUIT_HOME = [...BISCUIT_TO_BINS].reverse();
const BRANNIGAN = 'brannigan';

export class PopcornRules implements ActRules {
  readonly secret = KENNEL_SPOT;
  #round = 0;
  #brannigan: Walker = { x: POPCORN_START.x + 1.2, y: POPCORN_START.y, facing: Math.PI / 2, leg: 0 };
  #searchUntil = 0;
  #biscuit: Walker = { x: BISCUIT_BED.x, y: BISCUIT_BED.y, facing: 0, leg: 0 };
  #awayUntil = 0;
  #heading: 'bins' | 'home' | null = null;

  setup(ctx: ActContext): void {
    const npcs = ctx.state.npcs;
    npcs.set('brannigan', new MissionNpc({ kind: 'brannigan', x: this.#brannigan.x, y: this.#brannigan.y }));
    npcs.set('okafor', new MissionNpc({ kind: 'okafor', x: OKAFOR_SPOT.x, y: OKAFOR_SPOT.y }));
    npcs.set('biscuit', new MissionNpc({ kind: 'duncan', name: 'Biscuit', x: BISCUIT_BED.x, y: BISCUIT_BED.y }));
  }

  onStep(ctx: ActContext, step: string): void {
    if (step !== 'search') for (const spot of ctx.state.spots) if (spot.worker === BRANNIGAN) spot.worker = '';
  }

  onScene(ctx: ActContext, node: string): void {
    const hero = ctx.anchor();
    if (node !== 'tin' || hero === null) return;
    npc(ctx.state, 'brannigan', (n) => {
      n.x = hero.x + 1;
      n.y = hero.y - 0.6;
    });
  }

  tick(ctx: ActContext, now: number): void {
    this.#walkBiscuit(ctx, now);
    if (ctx.state.step === 'search' && !ctx.inScene()) this.#search(ctx, now);
  }

  refuse(_ctx: ActContext, spot: number): string | null {
    return spot === KENNEL_SPOT && this.#awayUntil === 0 ? BISCUIT_REFUSES : null;
  }

  worked(ctx: ActContext, spot: number, _by: CrewMember, now: number): string {
    if (spot === KENNEL_SPOT) {
      ctx.setStep('found', now);
    } else if (spot === BINS) this.#lure(ctx, now);
    return YARD_NOTES[spot] ?? '';
  }

  // Brannigan walks to the next spot in his order, searches it unless the crew has, and moves on; the kennel last.
  #search(ctx: ActContext, now: number): void {
    const round = BRANNIGAN_ROUNDS[this.#round];
    const spot = round === undefined ? undefined : ctx.state.spots[round.spot];
    if (round === undefined || spot === undefined) return;
    if (this.#searchUntil > 0) {
      if (now < this.#searchUntil) return;
      this.#searchUntil = 0;
      if (spot.worker === BRANNIGAN) spot.worker = '';
      if (spot.done) {
        this.#nextRound();
        return;
      }
      spot.done = true;
      if (round.spot === KENNEL_SPOT) {
        spot.note = 'Brannigan found the tin in the kennel.';
        ctx.setStep('beaten', now);
        return;
      }
      spot.note = BRANNIGAN_NOTE;
      if (round.spot === BINS) this.#lure(ctx, now);
      this.#nextRound();
      return;
    }
    this.#brannigan = walkPath(this.#brannigan, round.path, BRANNIGAN_SPEED, TICK_SECONDS);
    npc(ctx.state, 'brannigan', (n) => {
      n.x = this.#brannigan.x;
      n.y = this.#brannigan.y;
      n.facing = this.#brannigan.facing;
    });
    if (this.#brannigan.leg < round.path.length - 1) return;
    if (spot.done) {
      this.#nextRound();
      return;
    }
    if (spot.worker !== '') return;
    spot.worker = BRANNIGAN;
    this.#searchUntil = now + BRANNIGAN_SEARCH_MS;
  }

  #nextRound(): void {
    this.#round++;
    this.#brannigan = { ...this.#brannigan, leg: 0 };
  }

  #lure(ctx: ActContext, now: number): void {
    if (this.#awayUntil === 0) ctx.broadcast(MISSION_MESSAGES.NOTE, { text: 'Biscuit leaps off the kennel and trots to the bins.' });
    this.#awayUntil = now + BISCUIT_AWAY_MS;
    if (this.#heading !== 'bins') {
      this.#heading = 'bins';
      this.#biscuit = { ...this.#biscuit, leg: this.#legFrom(BISCUIT_TO_BINS) };
    }
  }

  #walkBiscuit(ctx: ActContext, now: number): void {
    if (this.#awayUntil > 0 && now >= this.#awayUntil && ctx.state.step === 'search') {
      this.#awayUntil = 0;
      this.#heading = 'home';
      this.#biscuit = { ...this.#biscuit, leg: this.#legFrom(BISCUIT_HOME) };
      ctx.broadcast(MISSION_MESSAGES.NOTE, { text: 'Biscuit wanders back to the kennel and flops down on it.' });
    }
    if (this.#heading === null) return;
    const path = this.#heading === 'bins' ? BISCUIT_TO_BINS : BISCUIT_HOME;
    this.#biscuit = walkPath(this.#biscuit, path, BISCUIT_SPEED, TICK_SECONDS);
    if (this.#biscuit.leg >= path.length - 1) this.#heading = null;
    npc(ctx.state, 'biscuit', (n) => {
      n.x = this.#biscuit.x;
      n.y = this.#biscuit.y;
      n.chasing = this.#heading !== null;
    });
  }

  // Where along a path Biscuit picks up from: the waypoint nearest him, so turning back halfway never jumps.
  #legFrom(path: readonly { x: number; y: number }[]): number {
    let best = 0;
    let bestD = Infinity;
    path.forEach((p, i) => {
      const d = Math.hypot(p.x - this.#biscuit.x, p.y - this.#biscuit.y);
      if (d < bestD && i < path.length - 1) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }
}
