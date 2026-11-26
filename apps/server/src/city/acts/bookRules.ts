// The Little Book's rules: Mr Varnish's rounds, the guardians' letters, and the early vote when four are alone at once.
import { TICK_SECONDS } from '@byzantine-council/shared';
import {
  BOOK_ALONE,
  BOOK_HANDS_FULL,
  BOOK_POSTS,
  BOOK_READ,
  BOOK_RECALLED,
  GLASS_ARRIVES,
  MISSION_MESSAGES,
  MissionNpc,
  POST_NOTES,
  READING_TABLE,
  TABLE_REACH,
  VOTE_S,
  VOTE_SEATS,
  aloneCount,
  freshPosts,
  isAlone,
  motionCarries,
  postsAfter,
  takeLetter,
  varnishAt,
  type Post,
} from '@byzantine-council/shared/city';
import { near, place, type ActContext, type ActRules, type CrewMember } from './rules.js';

const IN_FRONT = 0.05;

/** The Little Book's rules: letters handed out on Mr Varnish's rounds, carried to the table, and read out together. */
export class BookRules implements ActRules {
  #t = 0;
  #posts: readonly Post[] = freshPosts();
  readonly #carrying = new Map<string, { guardian: number; age: number }>();
  /** How many letters have been read out at the table, for tests. */
  read = 0;
  /** How many times four guardians were alone at once and the vote was called early, for tests. */
  recalled = 0;

  setup(ctx: ActContext): void {
    const npcs = ctx.state.npcs;
    npcs.set('ivy', new MissionNpc({ kind: 'ivy', x: READING_TABLE.x + 1.2, y: READING_TABLE.y }));
    const v = varnishAt(0);
    npcs.set('varnish', new MissionNpc({ kind: 'varnish', x: v.x, y: v.y, facing: v.facing }));
    npcs.set('glass', new MissionNpc({ kind: 'glass', x: GLASS_ARRIVES.x, y: GLASS_ARRIVES.y, shown: false }));
    BOOK_POSTS.forEach((g, i) => {
      npcs.set(`guardian${String(i)}`, new MissionNpc({ kind: 'guardian', name: g.label, x: g.at.x, y: g.at.y, facing: Math.PI / 2 }));
      npcs.set(`letter${String(i)}`, new MissionNpc({ kind: 'letter', x: g.at.x, y: g.at.y + IN_FRONT, shown: false }));
    });
    this.#sync(ctx);
  }

  onStep(ctx: ActContext, step: string): void {
    if (step === 'letters') this.#reset(ctx);
    if (step === 'vote') ctx.mark(aloneCount(this.#posts) === 0 ? 'handsNone' : 'handsSome');
  }

  onScene(ctx: ActContext, node: string): void {
    if (node === 'vote') {
      ctx.moveCrew(READING_TABLE);
      this.#posts = freshPosts();
      this.#carrying.clear();
      this.#sync(ctx);
      BOOK_POSTS.forEach((_, i) => {
        place(ctx, `guardian${String(i)}`, VOTE_SEATS[i] ?? READING_TABLE);
      });
      place(ctx, 'varnish', { x: READING_TABLE.x - 1.2, y: READING_TABLE.y + 0.6 });
    } else if (node === 'farewell') place(ctx, 'glass', GLASS_ARRIVES);
  }

  /** Walks Mr Varnish, ages and hands out letters, reads out any that reach the table, and runs the vote clock; on a quiet night too. */
  move(ctx: ActContext, now: number): void {
    const varnish = ctx.state.npcs.get('varnish');
    const live = ctx.state.step === 'letters' && !ctx.inScene();
    if (varnish !== undefined) varnish.chasing = live && varnishAt(this.#t).pitching >= 0;
    if (!live) {
      if (ctx.state.clock !== 0) ctx.state.clock = 0;
      return;
    }
    const next = postsAfter(this.#posts, this.#t, this.#t + TICK_SECONDS);
    this.#t += TICK_SECONDS;
    this.#posts = next.posts;
    for (const g of next.alone) ctx.broadcast(MISSION_MESSAGES.NOTE, { text: BOOK_ALONE(BOOK_POSTS[g]?.label ?? '', aloneCount(this.#posts)) });
    const crew = new Map([...ctx.crew()].map((m) => [m.id, m]));
    for (const [id, held] of this.#carrying) {
      const m = crew.get(id);
      if (m === undefined) {
        this.#carrying.delete(id);
        this.#posts = this.#posts.map((p, i) => (i === held.guardian ? { letter: true, age: held.age } : p));
      } else if (near(m.player, READING_TABLE, TABLE_REACH)) {
        this.#carrying.delete(id);
        this.read++;
        if (this.read === 1) {
          ctx.mark('clueTogether');
          ctx.broadcast(MISSION_MESSAGES.NOTE, { text: BOOK_READ });
        }
      }
    }
    if (varnish !== undefined) {
      const v = varnishAt(this.#t);
      varnish.x = v.x;
      varnish.y = v.y;
      varnish.facing = v.facing;
    }
    this.#sync(ctx, crew);
    const left = Math.max(0, Math.ceil(VOTE_S - this.#t));
    if (left !== ctx.state.clock) ctx.state.clock = left;
    if (this.#t >= VOTE_S) ctx.setStep('vote', now);
  }

  tick(ctx: ActContext): void {
    if (ctx.state.step !== 'letters' || ctx.inScene() || !motionCarries(this.#posts)) return;
    this.recalled++;
    ctx.broadcast(MISSION_MESSAGES.NOTE, { text: BOOK_RECALLED });
    this.#reset(ctx);
  }

  refuse(_ctx: ActContext, _spot: number, by: CrewMember): string | null {
    return this.#carrying.has(by.id) ? BOOK_HANDS_FULL : null;
  }

  worked(ctx: ActContext, spot: number, by: CrewMember): string {
    const took = takeLetter(this.#posts, spot);
    if (took === null) return '';
    this.#posts = took.posts;
    this.#carrying.set(by.id, { guardian: spot, age: took.age });
    this.#sync(ctx);
    return POST_NOTES[spot] ?? '';
  }

  #reset(ctx: ActContext): void {
    this.#t = 0;
    this.#posts = freshPosts();
    this.#carrying.clear();
    const v = varnishAt(0);
    place(ctx, 'varnish', v);
    ctx.state.clock = VOTE_S;
    this.#sync(ctx);
  }

  // Mirrors the letters into the state: a spot is done while its guardian holds no letter, and a carried letter rides with its carrier.
  #sync(ctx: ActContext, crew?: ReadonlyMap<string, CrewMember>): void {
    const carriedBy = new Map([...this.#carrying].map(([id, held]) => [held.guardian, id]));
    this.#posts.forEach((p, i) => {
      const spot = ctx.state.spots[i];
      if (spot !== undefined && spot.done === p.letter) spot.done = !p.letter;
      const letter = ctx.state.npcs.get(`letter${String(i)}`);
      if (letter === undefined) return;
      const carrier = carriedBy.get(i);
      const holder = carrier === undefined ? undefined : (crew ?? new Map([...ctx.crew()].map((m) => [m.id, m]))).get(carrier)?.player;
      const at = holder ?? BOOK_POSTS[i]?.at;
      const shown = p.letter || holder !== undefined;
      if (at !== undefined && (letter.x !== at.x || letter.y !== at.y + IN_FRONT)) {
        letter.x = at.x;
        letter.y = at.y + IN_FRONT;
      }
      if (letter.shown !== shown) letter.shown = shown;
      const alone = isAlone(p);
      if (letter.chasing !== alone) letter.chasing = alone;
    });
  }
}
