import { describe, expect, it } from 'vitest';
import {
  BENCHES,
  BINS,
  BISCUIT_TO_BINS,
  BRANNIGAN_ROUNDS,
  BRANNIGAN_SEARCH_MS,
  BRANNIGAN_SPEED,
  CITY_MAP,
  COINS_ACT,
  COINS_START,
  DEADMAN_ACT,
  DETAILS,
  GULLS,
  KEEPER_ROUTE,
  KEEPER_SPEED,
  KENNEL_SPOT,
  LYCHGATE,
  MEMORIES,
  NUMBER_ACT,
  PASSWORD_ACT,
  PASSWORD_SCRIPT,
  PIZZA_ACT,
  POPCORN_ACT,
  POPCORN_SCRIPT,
  POPCORN_START,
  SHARES_NEEDED,
  SIDE_CASES,
  SPEAKERS,
  STORY_ACTS,
  TINY_ROUTE,
  TINY_SPEED,
  TIP_JARS,
  districtAt,
  honestIn,
  inTorch,
  nextOf,
  sceneStarts,
  scriptProblems,
  walkPath,
  walkRoute,
  type ActId,
  type CatcherId,
  type ScriptNode,
  type Walker,
} from '../src/city/index.js';
import { PLAYER_SPEED } from '../src/movement.js';
import { canStand, findPath, isClearSegment, pathLength } from '../src/pathfinding.js';
import type { Vec2 } from '../src/map.js';

const clearLoop = (route: readonly Vec2[]): boolean => route.every((a, i) => isClearSegment(CITY_MAP, a, route[(i + 1) % route.length] ?? a));
const clearPath = (path: readonly Vec2[]): boolean => path.every((a, i) => i === 0 || isClearSegment(CITY_MAP, path[i - 1] ?? a, a));

function walkTime(from: Vec2, to: Vec2): number {
  const path = findPath(CITY_MAP, from, to);
  if (!path.ok) throw new Error(`no path ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
  return pathLength(from, path.value) / PLAYER_SPEED;
}

// The longest stretch, in seconds over a minute, that a spot spends out of every patrol's torch.
function darkestStretch(spot: Vec2, routes: readonly { route: readonly Vec2[]; speed: number }[]): number {
  const dt = 0.05;
  let walkers: Walker[] = routes.map((r) => ({ x: r.route[0]?.x ?? 0, y: r.route[0]?.y ?? 0, facing: 0, leg: 0 }));
  let unlit = 0;
  let best = 0;
  for (let t = 0; t < 60; t += dt) {
    walkers = walkers.map((w, i) => walkRoute(w, routes[i]?.route ?? [], routes[i]?.speed ?? 1, dt));
    unlit = walkers.some((w) => inTorch(w, w.facing, spot)) ? 0 : unlit + dt;
    best = Math.max(best, unlit);
  }
  return best;
}

const everLit = (spot: Vec2, routes: readonly { route: readonly Vec2[]; speed: number }[]): boolean => darkestStretch(spot, routes) < 59.9;

describe('the side cases', () => {
  it('are every story of the case kind, after the acts', () => {
    expect(Object.keys(STORY_ACTS)).toEqual(['dump', 'ransom', 'insider', 'founder', 'overflow', 'split', 'receipt', 'alert', 'popcorn', 'number', 'coins', 'deadman', 'password', 'pizza']);
    expect(SIDE_CASES.map((c) => c.id)).toEqual(['popcorn', 'number', 'coins', 'deadman', 'password', 'pizza']);
    for (const act of Object.values(STORY_ACTS)) expect(act.kind === 'case', act.id).toBe(SIDE_CASES.includes(act));
  });

  for (const act of SIDE_CASES) {
    describe(act.title, () => {
      it('has a sound script with every speaker and mark known', () => {
        expect(scriptProblems(act.script, sceneStarts(act), act.steps)).toEqual([]);
        const marks = Object.keys(act.marks);
        for (const node of Object.values(act.script)) {
          for (const line of node.lines) {
            expect(SPEAKERS).toContain(line.who);
            for (const m of [line.if, line.unless]) if (m !== undefined) expect(marks).toContain(m);
          }
          for (const m of [node.mark, node.jump?.if, ...(node.choices ?? []).flatMap((c) => [c.mark, c.if, c.unless])]) if (m !== undefined) expect(marks, m).toContain(m);
          for (const c of node.choices ?? []) {
            expect(c.text.length).toBeLessThanOrEqual(90);
            expect(c.id.length).toBeLessThanOrEqual(16);
          }
          if (node.seconds !== undefined) expect(node.seconds).toBeGreaterThanOrEqual(10);
        }
        expect(Object.values(act.marks).some((m) => m.honest === true), 'an honest choice').toBe(true);
        expect(act.rewardSats).toBeGreaterThan(0);
        expect(act.rewardSats).toBeLessThanOrEqual(250);
      });

      it('puts every place on open ground the crew can walk to, spots far enough apart to tell apart', () => {
        const places = [act.start, ...Object.values(act.targets), ...Object.values(act.arrivals).map((a) => a.at), ...act.spots.map((s) => s.at)];
        for (const p of places) {
          expect(canStand(CITY_MAP, p), JSON.stringify(p)).toBe(true);
          expect(findPath(CITY_MAP, act.start, p).ok, JSON.stringify(p)).toBe(true);
        }
        for (const [i, a] of act.spots.entries())
          for (const b of act.spots.slice(i + 1)) expect(Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y), `${a.label} / ${b.label}`).toBeGreaterThanOrEqual(2 * act.workReach);
        expect(act.workGoal).toBeLessThanOrEqual(act.spots.filter((s) => s.refuses !== true).length);
      });
    });
  }
});

describe('The Popcorn Tin', () => {
  it('walks Brannigan through the yard once, the obvious places first and the kennel last, on clear ground', () => {
    expect(districtAt(POPCORN_START)?.id).toBe('lowtide');
    expect(BRANNIGAN_ROUNDS.map((r) => r.spot).sort()).toEqual(POPCORN_ACT.spots.map((_, i) => i));
    expect(BRANNIGAN_ROUNDS.at(-1)?.spot).toBe(KENNEL_SPOT);
    for (const [i, round] of BRANNIGAN_ROUNDS.entries()) {
      expect(clearPath(round.path), `round ${String(i)}`).toBe(true);
      expect(round.path.at(-1)).toEqual(POPCORN_ACT.spots[round.spot]?.at);
      if (i > 0) expect(round.path[0]).toEqual(BRANNIGAN_ROUNDS[i - 1]?.path.at(-1));
    }
    expect(clearPath(BISCUIT_TO_BINS)).toBe(true);
  });

  it('gives Brannigan the tin in under two minutes alone, and lets a crew that rattles the bins beat him', () => {
    const dt = 0.05;
    let t = 0;
    for (const round of BRANNIGAN_ROUNDS) {
      let w: Walker = { x: round.path[0]?.x ?? 0, y: round.path[0]?.y ?? 0, facing: 0, leg: 0 };
      while (w.leg < round.path.length - 1) {
        w = walkPath(w, round.path, BRANNIGAN_SPEED, dt);
        t += dt;
      }
      t += BRANNIGAN_SEARCH_MS / 1000;
    }
    expect(t).toBeGreaterThan(40);
    expect(t).toBeLessThan(120);
    const bins = POPCORN_ACT.spots[BINS]?.at ?? POPCORN_START;
    const kennel = POPCORN_ACT.spots[KENNEL_SPOT]?.at ?? POPCORN_START;
    const solo = walkTime(POPCORN_START, bins) + POPCORN_ACT.workMs / 1000 + walkTime(bins, kennel) + POPCORN_ACT.workMs / 1000;
    expect(solo + 15).toBeLessThan(t);
  });

  it('only tells a polite crew about the kennel', () => {
    const kennel = Object.entries(POPCORN_SCRIPT).filter(([, n]) => n.mark === 'clueKennel' || (n.choices ?? []).some((c) => c.mark === 'clueKennel'));
    expect(kennel.map(([id]) => id)).toEqual(['okaforPolite']);
    expect(POPCORN_SCRIPT['street']?.choices?.find((c) => c.go === 'okaforPolite')?.mark).toBe('politeOkafor');
    expect(honestIn(POPCORN_ACT, ['politeOkafor'])).toBe(true);
    expect(honestIn(POPCORN_ACT, ['fibbedOkafor', 'photoTin'])).toBe(false);
  });
});

describe('Borrowed Number', () => {
  it('needs all three details, each a different clue, found in Saltmarket', () => {
    expect(NUMBER_ACT.workGoal).toBe(3);
    expect(new Set(DETAILS.map((d) => d.mark)).size).toBe(3);
    for (const d of DETAILS) {
      expect(NUMBER_ACT.marks[d.mark]?.clue).toBe(true);
      expect(districtAt(d.at)?.id).toBe('saltmarket');
    }
  });
});

describe('Follow the Coins', () => {
  const tiny = [{ route: TINY_ROUTE, speed: TINY_SPEED }];

  it('walks Tiny on clear ground, never lights the top of the market, and gives every tip jar time to be scanned', () => {
    expect(clearLoop(TINY_ROUTE)).toBe(true);
    expect(everLit(COINS_START, tiny)).toBe(false);
    for (const jar of TIP_JARS) expect(darkestStretch(jar.at, tiny), jar.label).toBeGreaterThan(COINS_ACT.workMs / 1000 + 3);
    expect(COINS_ACT.catchers.guard).toBeDefined();
  });

  it('teaches both rules of thumb whatever the crew answers', () => {
    for (const start of ['chain', 'chainTwo']) {
      const node = COINS_ACT.script[start];
      for (const c of node?.choices ?? []) {
        const marks = new Set<string>();
        let id: string | undefined = c.go;
        if (c.mark !== undefined) marks.add(c.mark);
        while (id !== undefined && id !== 'chainEnd' && id !== 'chainTwo') {
          const n: ScriptNode | undefined = COINS_ACT.script[id];
          if (n?.mark !== undefined) marks.add(n.mark);
          id = n === undefined ? undefined : nextOf(n, marks);
        }
        expect([...marks].some((m) => m === 'gotChange' || m === 'gotCommon'), `${start} ${c.id}`).toBe(true);
      }
    }
  });
});

describe('The Dead Man’s Vault', () => {
  const keeper = [{ route: KEEPER_ROUTE, speed: KEEPER_SPEED }];

  it('needs three shares of five, with two plaques gone', () => {
    expect(BENCHES).toHaveLength(5);
    expect(BENCHES.filter((b) => b.refuses === true)).toHaveLength(2);
    expect(SHARES_NEEDED).toBe(3);
    expect(DEADMAN_ACT.workGoal).toBe(SHARES_NEEDED);
    for (const b of BENCHES) expect(districtAt(b.at)?.id).toBe('heights');
  });

  it('walks Mrs Bellweather on clear ground, never lights the lychgate, and gives every bench time to be read', () => {
    expect(clearLoop(KEEPER_ROUTE)).toBe(true);
    expect(everLit(LYCHGATE, keeper)).toBe(false);
    for (const b of BENCHES) expect(darkestStretch(b.at, keeper), b.label).toBeGreaterThan(DEADMAN_ACT.workMs / 1000 + 3);
  });
});

describe('The Forgotten Password', () => {
  const play = (picks: readonly string[]): string[] => {
    const seen: string[] = [];
    let id: string | undefined = 'guess3';
    let pick = 0;
    while (id !== undefined && id !== 'ending') {
      seen.push(id);
      const n: (typeof PASSWORD_SCRIPT)[string] | undefined = PASSWORD_SCRIPT[id];
      if (n === undefined) break;
      if (n.choices === undefined) id = n.next;
      else {
        const want = picks[pick++];
        id = n.choices.find((c) => c.id === want)?.go;
      }
    }
    return seen;
  };

  it('opens on the right password, and wipes after three wrong ones', () => {
    expect(play(['exact'])).toEqual(['guess3', 'unlocked']);
    expect(play(['caps', 'exact'])).toEqual(['guess3', 'guess3caps', 'guess2', 'unlocked']);
    expect(play(['caps', 'boat', 'name'])).toEqual(['guess3', 'guess3caps', 'guess2', 'guess2boat', 'guess1', 'guess1name', 'lockedOut']);
  });

  it('plays a memory at each of the three places, and sends the crew home after the last', () => {
    expect(PASSWORD_ACT.workGoal).toBe(MEMORIES.length);
    const clues = new Set<string>();
    for (const m of MEMORIES) {
      const node = m.scene === undefined ? undefined : PASSWORD_SCRIPT[m.scene];
      expect(node, m.label).toBeDefined();
      if (node?.mark !== undefined) clues.add(node.mark);
      expect(node?.next).toBe('memoryBack');
    }
    expect([...clues].sort()).toEqual(['clueBoat', 'clueLower', 'clueYear']);
    expect(PASSWORD_SCRIPT['memoryBack']?.jump).toEqual({ if: 'allMemories', to: 'memoriesDone' });
    expect(PASSWORD_SCRIPT['memoriesDone']?.then).toBe('toFlat');
    expect(PASSWORD_SCRIPT['memoryOn']?.then).toBe(PASSWORD_ACT.workStep);
  });
});

describe('Pizza Night', () => {
  const gulls = GULLS.map((g) => ({ route: g.route, speed: g.speed }));

  it('flies the gulls over clear road, and never over where they send you', () => {
    for (const g of GULLS) {
      expect(clearLoop(g.route)).toBe(true);
      expect(canStand(CITY_MAP, g.back)).toBe(true);
      expect(everLit(g.back, gulls), JSON.stringify(g.back)).toBe(false);
    }
  });

  it('leaves a way through the gulls from Marco’s to Benny’s for a crew that times it', () => {
    const [from, to] = [PIZZA_ACT.targets['toMarco'], PIZZA_ACT.targets['deliver']] as [Vec2, Vec2];
    const path = findPath(CITY_MAP, from, to);
    if (!path.ok) throw new Error('no road');
    const dt = 0.05;
    let clean = 0;
    for (let start = 0; start < 30; start += 1) {
      let walkers: Walker[] = gulls.map((g) => ({ x: g.route[0]?.x ?? 0, y: g.route[0]?.y ?? 0, facing: 0, leg: 0 }));
      for (let t = 0; t < start; t += dt) walkers = walkers.map((w, i) => walkRoute(w, gulls[i]?.route ?? [], gulls[i]?.speed ?? 1, dt));
      let me: Walker = { x: from.x, y: from.y, facing: 0, leg: 0 };
      const route = [from, ...path.value];
      let seen = false;
      while (me.leg < route.length - 1 && !seen) {
        me = walkPath(me, route, PLAYER_SPEED, dt);
        walkers = walkers.map((w, i) => walkRoute(w, gulls[i]?.route ?? [], gulls[i]?.speed ?? 1, dt));
        seen = walkers.some((w) => inTorch(w, w.facing, me));
      }
      if (!seen) clean++;
    }
    expect(clean).toBeGreaterThan(0);
    expect(clean).toBeLessThan(30);
  });
});

describe('every story', () => {
  it('names a catcher for every catch an act can make', () => {
    const needs: Readonly<Partial<Record<ActId, readonly CatcherId[]>>> = { coins: ['guard'], deadman: ['keeper'], pizza: ['gull'] };
    for (const act of SIDE_CASES) for (const by of needs[act.id] ?? []) expect(act.catchers[by], `${act.id} ${by}`).toBeDefined();
  });
});
