import { describe, expect, it } from 'vitest';
import { PLAYER_SPEED } from '../src/movement.js';
import {
  ALONE_S,
  BOOK_ACT,
  BOOK_POSTS,
  BOOK_SCRIPT,
  BOOK_TUNING,
  BookTuningSchema,
  CITY_MAP,
  GLASS_ARRIVES,
  HANDS,
  MOTION_NEEDED,
  READING_TABLE,
  SPEAKERS,
  STORY_ACTS,
  TABLE_REACH,
  TAKE_MS,
  TAKE_REACH,
  VARNISH_ROUND_S,
  VARNISH_ROUTE,
  VOTE_S,
  VOTE_SEATS,
  aloneCount,
  bookTuningProblems,
  carriedMarks,
  districtAt,
  freshPosts,
  handedBetween,
  honestIn,
  motionCarries,
  postsAfter,
  sceneStarts,
  scriptProblems,
  takeLetter,
  varnishAt,
  walkPath,
  type Post,
  type Walker,
} from '../src/city/index.js';
import { canStand, findPath, isClearSegment } from '../src/pathfinding.js';

const DT = 0.05;

type Line = 'oldest' | 'nearest' | 'westWall' | 'pocket' | 'wait';

interface Runner {
  w: Walker;
  path: { x: number; y: number }[];
  target: number;
  holding: boolean;
  until: number;
}

const pathTo = (from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number }[] => {
  const found = findPath(CITY_MAP, from, to);
  if (!found.ok) throw new Error(`no path to ${JSON.stringify(to)}`);
  return [from, ...found.value];
};

function play(crew: number, line: Line): { carried: boolean; at: number; maxAlone: number; read: number } {
  let posts: readonly Post[] = freshPosts();
  const runners: Runner[] = Array.from({ length: crew }, (_, i) => ({ w: { x: READING_TABLE.x + i * 0.3, y: READING_TABLE.y, facing: 0, leg: 0 }, path: [], target: -1, holding: false, until: 0 }));
  let maxAlone = 0;
  let read = 0;
  for (let t = 0; t < VOTE_S; t += DT) {
    posts = postsAfter(posts, t, t + DT).posts;
    for (const r of runners) {
      const at = { x: r.w.x, y: r.w.y };
      if (r.holding) {
        if (line !== 'pocket' && Math.hypot(at.x - READING_TABLE.x, at.y - READING_TABLE.y) <= TABLE_REACH) {
          r.holding = false;
          read++;
        } else r.w = walkPath(r.w, r.path, PLAYER_SPEED, DT);
        continue;
      }
      if (line === 'wait' || (line === 'pocket' && read + runners.filter((o) => o.holding).length > 0)) continue;
      if (r.target >= 0 && posts[r.target]?.letter !== true) r.target = -1;
      if (r.target < 0) {
        const claimed = new Set(runners.map((o) => o.target));
        let best = -1;
        let score = Infinity;
        posts.forEach((p, i) => {
          const g = BOOK_POSTS[i]?.at;
          if (g === undefined || !p.letter || claimed.has(i) || (line === 'westWall' && g.x > READING_TABLE.x - 3)) return;
          const s = line === 'nearest' ? Math.hypot(g.x - at.x, g.y - at.y) : -p.age;
          if (s < score) {
            score = s;
            best = i;
          }
        });
        const goal = BOOK_POSTS[best]?.at;
        if (goal === undefined) continue;
        r.target = best;
        r.path = pathTo(at, goal);
        r.w = { ...r.w, leg: 0 };
        r.until = 0;
      }
      const g = BOOK_POSTS[r.target]?.at ?? READING_TABLE;
      if (Math.hypot(at.x - g.x, at.y - g.y) > TAKE_REACH) {
        r.w = walkPath(r.w, r.path, PLAYER_SPEED, DT);
        continue;
      }
      if (r.until === 0) r.until = t + TAKE_MS / 1000;
      if (t < r.until) continue;
      const took = takeLetter(posts, r.target);
      r.target = -1;
      if (took === null) continue;
      posts = took.posts;
      r.holding = true;
      r.path = line === 'pocket' ? [at] : pathTo(at, READING_TABLE);
      r.w = { ...r.w, leg: 0 };
    }
    maxAlone = Math.max(maxAlone, aloneCount(posts));
    if (motionCarries(posts)) return { carried: true, at: t, maxAlone, read };
  }
  return { carried: false, at: VOTE_S, maxAlone, read };
}

describe('season three, act four: The Little Book', () => {
  it('follows The Clock and ends season three, with a sound script and every speaker and mark known', () => {
    expect(Object.keys(STORY_ACTS).slice(10, 12)).toEqual(['clock', 'book']);
    expect(scriptProblems(BOOK_SCRIPT, sceneStarts(BOOK_ACT), BOOK_ACT.steps)).toEqual([]);
    const marks = Object.keys(BOOK_ACT.marks);
    let timed = 0;
    for (const node of Object.values(BOOK_SCRIPT)) {
      for (const line of node.lines) {
        expect(SPEAKERS).toContain(line.who);
        for (const m of [line.if, line.unless]) if (m !== undefined) expect(marks).toContain(m);
      }
      for (const m of [node.mark, node.jump?.if, ...(node.choices ?? []).flatMap((c) => [c.mark, c.if])]) if (m !== undefined) expect(marks).toContain(m);
      for (const c of node.choices ?? []) expect(c.text.length).toBeLessThanOrEqual(90);
      if (node.choices !== undefined) {
        expect(node.seconds).toBe(15);
        expect(node.choices.map((c) => c.go)).toContain(node.timeout);
        timed++;
      }
    }
    expect(timed).toBeGreaterThanOrEqual(3);
    expect(Object.keys(BOOK_ACT.objectives)).toEqual([...BOOK_ACT.steps]);
    expect(BOOK_SCRIPT['closing']?.then).toBe('done');
    expect(BOOK_SCRIPT['closing']?.lines.at(-1)?.who).toBe('ivy');
    expect(BOOK_SCRIPT['closing']?.after).toContain('SEASON THREE');
    expect(BOOK_ACT.next).toContain('season four');
    expect(honestIn(BOOK_ACT, ['readTogether'])).toBe(true);
    expect(honestIn(BOOK_ACT, ['thankedGuardians'])).toBe(true);
    expect(honestIn(BOOK_ACT, ['kindGlass'])).toBe(true);
    expect(honestIn(BOOK_ACT, ['toreLetters', 'askedOffer', 'mockedVarnish', 'askedFour', 'gloatedFinal', 'askedFuture', 'handsSome'])).toBe(false);
  });

  it('lets Perpetua Glass remember what Rook told her at the olive shop in The Clock', () => {
    expect(carriedMarks({ clock: { marks: ['refusedBook'] } })).toEqual(['pastRefusedBook']);
    expect(carriedMarks({ clock: { marks: ['askedBook'] } })).toEqual(['pastAskedBook']);
    expect(carriedMarks({ clock: { marks: ['joinedQueue'] } })).toEqual(['pastOlive']);
    expect(carriedMarks({ clock: { marks: ['waitedChime'] } })).toEqual([]);
    for (const m of carriedMarks({ clock: { marks: ['refusedBook', 'askedBook', 'joinedQueue'] }, envelope: { marks: ['politeGlass'] } })) expect(Object.keys(BOOK_ACT.marks)).toContain(m);
  });

  it('reads its places and numbers from the tuning file, and refuses a broken one', () => {
    expect(BOOK_ACT.rewardSats).toBe(BOOK_TUNING.rewardSats);
    expect(BOOK_ACT.rewardSats).toBeGreaterThanOrEqual(500);
    expect(BOOK_ACT.workMs).toBe(BOOK_TUNING.takeMs);
    expect(bookTuningProblems(BOOK_TUNING)).toEqual([]);
    expect(BookTuningSchema.safeParse({ ...BOOK_TUNING, extra: 1 }).success).toBe(false);
    expect(BookTuningSchema.safeParse({ ...BOOK_TUNING, aloneSeconds: 0 }).success).toBe(false);
    expect(BookTuningSchema.safeParse({ ...BOOK_TUNING, varnish: { ...BOOK_TUNING.varnish, speed: -1 } }).success).toBe(false);
    expect(BookTuningSchema.safeParse({ ...BOOK_TUNING, varnish: { ...BOOK_TUNING.varnish, route: [{ x: 1, y: 1 }] } }).success).toBe(false);
    const stray = { ...BOOK_TUNING, varnish: { ...BOOK_TUNING.varnish, route: [...BOOK_TUNING.varnish.route, { x: 80, y: 28, guardian: 9 }] } };
    expect(bookTuningProblems(stray)).toContain('no guardian 9');
    const skipped = { ...BOOK_TUNING, varnish: { ...BOOK_TUNING.varnish, route: BOOK_TUNING.varnish.route.map((p) => ({ x: p.x, y: p.y })) } };
    expect(bookTuningProblems(skipped)).toContain('Mr Varnish must call on every guardian');
    expect(bookTuningProblems({ ...BOOK_TUNING, voteSeats: [] })).toContain('one vote seat per guardian');
  });

  it('puts every place on the streets round Mint Hall, where the crew can walk', () => {
    for (const p of [BOOK_ACT.start, READING_TABLE, GLASS_ARRIVES, ...VOTE_SEATS, ...BOOK_POSTS.map((s) => s.at), ...VARNISH_ROUTE]) {
      expect(canStand(CITY_MAP, p), JSON.stringify(p)).toBe(true);
      expect(findPath(CITY_MAP, BOOK_ACT.start, p).ok, JSON.stringify(p)).toBe(true);
    }
    VARNISH_ROUTE.forEach((a, i) => {
      const b = VARNISH_ROUTE[(i + 1) % VARNISH_ROUTE.length] ?? a;
      expect(isClearSegment(CITY_MAP, a, b), `leg ${String(i)}`).toBe(true);
    });
    for (const p of [BOOK_ACT.start, READING_TABLE, ...BOOK_POSTS.map((s) => s.at), ...VARNISH_ROUTE]) expect(districtAt(p)?.id).toBe('mint');
    expect(BOOK_ACT.targets['letters']).toBe(READING_TABLE);
    expect(BOOK_ACT.spots).toBe(BOOK_POSTS);
  });

  it('needs four of the five guardians to change the rules, the federation’s threshold', () => {
    const n = BOOK_POSTS.length;
    expect(n).toBe(5);
    expect(MOTION_NEEDED).toBe(n - Math.floor((n - 1) / 3));
    expect(MOTION_NEEDED).toBe(4);
    const alone = (k: number): Post[] => BOOK_POSTS.map((_, i) => ({ letter: i < k, age: ALONE_S }));
    expect(motionCarries(alone(1))).toBe(false);
    expect(motionCarries(alone(3))).toBe(false);
    expect(motionCarries(alone(4))).toBe(true);
    expect(motionCarries(BOOK_POSTS.map(() => ({ letter: true, age: ALONE_S - 0.1 })))).toBe(false);
  });

  it('walks Mr Varnish round every guardian once a round, handing each a letter after his pitch', () => {
    expect(HANDS.map((h) => h.guardian).sort()).toEqual(BOOK_POSTS.map((_, i) => i));
    for (const h of HANDS) {
      const v = varnishAt(h.at - 0.1);
      expect(v.pitching).toBe(h.guardian);
      const g = BOOK_POSTS[h.guardian]?.at ?? READING_TABLE;
      expect(Math.hypot(v.x - g.x, v.y - g.y)).toBeLessThan(TAKE_REACH);
    }
    expect(varnishAt(VARNISH_ROUND_S + 0.01).x).toBeCloseTo(varnishAt(0.01).x);
    expect(handedBetween(0, VARNISH_ROUND_S).map((h) => h.guardian).sort()).toEqual(BOOK_POSTS.map((_, i) => i));
    expect(handedBetween(0, 3 * VARNISH_ROUND_S)).toHaveLength(3 * BOOK_POSTS.length);
    const first = HANDS[0];
    if (first === undefined) throw new Error('no hands');
    const after = postsAfter(freshPosts(), first.at - DT, first.at + DT);
    expect(after.handed).toEqual([first.guardian]);
    const aged = postsAfter(after.posts, first.at + DT, first.at + ALONE_S);
    expect(aged.alone).toEqual([first.guardian]);
    expect(postsAfter(aged.posts, first.at + ALONE_S, first.at + ALONE_S + DT).alone).toEqual([]);
    const took = takeLetter(aged.posts, first.guardian);
    expect(took?.posts[first.guardian]?.letter).toBe(false);
    expect(takeLetter(freshPosts(), first.guardian)).toBeNull();
  });

  it('holds until the vote for a crew that reads every letter out, alone or four strong', () => {
    for (const crew of [1, 2, 4]) {
      for (const line of ['oldest', 'nearest'] as const) {
        const run = play(crew, line);
        expect(run.carried, `${String(crew)} ${line}`).toBe(false);
        expect(run.read).toBeGreaterThanOrEqual(2 * BOOK_POSTS.length - 2);
      }
    }
    expect(play(1, 'oldest').maxAlone).toBeGreaterThan(0);
    expect(play(4, 'oldest').maxAlone).toBe(0);
  });

  it('lets the vote be called early on a crew that waits at the table, or pockets a letter', () => {
    const waited = play(1, 'wait');
    expect(waited.carried).toBe(true);
    expect(waited.at).toBeLessThan(VOTE_S / 2);
    expect(play(1, 'pocket').carried).toBe(true);
    expect(play(4, 'wait').carried).toBe(true);
  });

  it('never starts a book on three guardians alone: looking after just the two on the west wall is enough', () => {
    const run = play(1, 'westWall');
    expect(run.maxAlone).toBe(MOTION_NEEDED - 1);
    expect(run.carried).toBe(false);
  });
});
