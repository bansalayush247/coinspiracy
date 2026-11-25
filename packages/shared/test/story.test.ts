import { describe, expect, it } from 'vitest';
import {
  CHOIR_ROUTES,
  CHOIR_SPEED,
  FOUNDER_ACT,
  FOUNDER_MARKS,
  FOUNDER_SCRIPT,
  FOUNDER_START,
  FOUNDER_STEPS,
  GENERATORS,
  MAST_SPOT,
  carriedMarks,
  visibleChoices,
  INSIDER_ACT,
  INSIDER_MARKS,
  INSIDER_SCRIPT,
  INSIDER_START,
  INSIDER_STEPS,
  LOGIN_TERMINALS,
  NONCE_SPOT,
  OTHER_ACCOUNTS,
  TERMINALS,
  TOWER_SPOT,
  WATCH_ROUTE,
  WATCH_SPEED,
  BREAKWATER,
  CITY_MAP,
  CREW_MAX,
  DUMP_ACT,
  GUARDIANS,
  IVY_SPOT,
  LIGHTHOUSE_DOOR,
  LOOKOUT_ROUTES,
  LOOKOUT_SPEED,
  RANSOM_ACT,
  RANSOM_MARKS,
  RANSOM_SCRIPT,
  RANSOM_START,
  RANSOM_STEPS,
  SIGNATURES_NEEDED,
  STORY_ACTS,
  actOf,
  canWork,
  honestIn,
  isActId,
  walkRoute,
  workLabel,
  type Walker,
  besideSpot,
  crewChoice,
  CITY_SPAWNS,
  DANI_SPOT,
  DEVICE_HEAPS,
  DUMP_MARKS,
  DUMP_SCENES,
  DUMP_SCRIPT,
  DUMP_START,
  DUMP_STEPS,
  GATE_SPOT,
  HEAPS,
  KENNEL,
  PATROL,
  SPEAKERS,
  TORCH_RANGE,
  canDig,
  districtAt,
  heapCentre,
  inTorch,
  inYard,
  isHonest,
  readMs,
  scriptProblems,
  visibleLines,
  type Script,
} from '../src/city/index.js';
import { tileAt } from '../src/map.js';
import { canStand, findPath, isClearSegment } from '../src/pathfinding.js';
import { stepMovement } from '../src/movement.js';

describe('the story script engine', () => {
  it('finds broken links, dead ends and unreachable nodes', () => {
    const bad: Script = {
      a: { lines: [{ who: 'rook', text: 'hi' }], next: 'missing' },
      b: { lines: [{ who: 'rook', text: 'alone' }], then: 'nowhere' },
      c: { lines: [], choices: [{ id: 'x', tag: 'X', text: 'x', go: 'a' }], seconds: 3 },
    };
    const problems = scriptProblems(bad, ['a'], ['done']);
    expect(problems).toContain('a -> missing missing');
    expect(problems).toContain('b hands back to unknown step nowhere');
    expect(problems).toContain('b is unreachable');
    expect(problems.some((p) => p.startsWith('c has a clock without'))).toBe(true);
    expect(problems).toContain('c says nothing');
    const jumpy: Script = {
      a: { lines: [{ who: 'rook', text: 'a' }], next: 'b', jump: { if: 'm', to: 'c' } },
      b: { lines: [{ who: 'rook', text: 'b' }], then: 'done' },
      c: { lines: [{ who: 'rook', text: 'c' }], then: 'done' },
      d: { lines: [{ who: 'rook', text: 'd' }], jump: { if: 'm', to: 'c' }, then: 'done' },
    };
    const jumpProblems = scriptProblems(jumpy, ['a', 'd'], ['done']);
    expect(jumpProblems).toEqual(['d jumps without a next']);
  });

  it('shows lines by what characters remember, and paces reading by length', () => {
    const node = DUMP_SCRIPT['ask'];
    if (node === undefined) throw new Error('ask');
    expect(visibleLines(node, new Set()).map((l) => l.text)).toEqual(['Ask me nicely.']);
    expect(visibleLines(node, new Set(['askedOnce'])).map((l) => l.text)).toEqual(['Again. Nicely.']);
    const given = DUMP_SCRIPT['given'];
    if (given === undefined) throw new Error('given');
    expect(readMs(given, new Set(['apologised', 'liedDani']))).toBeGreaterThan(readMs(given, new Set()));
    for (const n of Object.values(DUMP_SCRIPT)) expect(readMs(n, new Set())).toBeLessThanOrEqual(30_000);
  });
});

describe('act one: The Dump', () => {
  it('has a sound script: every node reachable, every choice leads somewhere, every scene hands back', () => {
    expect(scriptProblems(DUMP_SCRIPT, Object.values(DUMP_SCENES), DUMP_STEPS)).toEqual([]);
    for (const node of Object.values(DUMP_SCRIPT)) {
      for (const line of node.lines) {
        expect(SPEAKERS).toContain(line.who);
        for (const m of [line.if, line.unless]) if (m !== undefined) expect(Object.keys(DUMP_MARKS)).toContain(m);
      }
      for (const m of [node.mark, ...(node.choices ?? []).map((c) => c.mark)]) if (m !== undefined) expect(Object.keys(DUMP_MARKS)).toContain(m);
      for (const c of node.choices ?? []) expect(c.text.length).toBeLessThanOrEqual(90);
      if (node.seconds !== undefined) expect(node.seconds).toBeGreaterThanOrEqual(6);
    }
    expect(DUMP_SCRIPT['selfie']?.then).toBe('done');
  });

  it('gives the winter clue only to players who listened', () => {
    const marksAfter = (path: readonly string[]): string[] =>
      path.flatMap((id) => {
        const mark = DUMP_SCRIPT[id]?.mark;
        return mark === undefined ? [] : [mark];
      });
    expect(marksAfter(['daniCalm'])).toContain('clueWinter');
    expect(marksAfter(['daniSilence', 'daniWinter'])).toContain('clueWinter');
    expect(marksAfter(['daniAnger'])).not.toContain('clueWinter');
    expect(marksAfter(['magsPay', 'magsWinter'])).toEqual(['clueSkip', 'clueWinter']);
  });

  it('counts honesty from the honest choices only', () => {
    expect(isHonest(['honestDani'])).toBe(true);
    expect(isHonest(['apologised'])).toBe(true);
    expect(isHonest(['liedDani', 'bluffedMags', 'askedOnce'])).toBe(false);
  });

  it('puts every place on open ground the player can walk to', () => {
    const from = CITY_SPAWNS[0];
    if (from === undefined) throw new Error('spawn');
    for (const [name, spot] of Object.entries({ DUMP_START, DANI_SPOT, GATE_SPOT, KENNEL })) {
      expect(canStand(CITY_MAP, spot), name).toBe(true);
      expect(findPath(CITY_MAP, DUMP_START, spot).ok, name).toBe(true);
    }
    expect(districtAt(GATE_SPOT)?.id).toBe('gullmoor');
    expect(Math.hypot(DANI_SPOT.x - GATE_SPOT.x, DANI_SPOT.y - GATE_SPOT.y)).toBeGreaterThan(40);
  });

  it('buries the device in a winter 2013 heap that can be reached and dug', () => {
    expect(HEAPS.filter((h) => h.winter)).toHaveLength(3);
    expect(HEAPS.filter((h) => h.bySkip)).toHaveLength(1);
    expect(DEVICE_HEAPS).toHaveLength(2);
    for (const i of DEVICE_HEAPS) expect(HEAPS[i]?.bySkip).toBe(false);
    expect(new Set(HEAPS.map((h) => h.tile.join(','))).size).toBe(HEAPS.length);
    for (const h of HEAPS) {
      expect(tileAt(CITY_MAP, h.tile[0], h.tile[1]), h.label).toBe('M');
      expect(inYard(heapCentre(h))).toBe(true);
      const spots = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dc = 0, dr = 0]) => ({ x: h.tile[0] + dc + 0.5, y: h.tile[1] + dr + 0.5 })).filter((p) => canStand(CITY_MAP, p) && canDig(p, h));
      expect(spots.length, h.label).toBeGreaterThan(0);
      expect(spots.some((p) => findPath(CITY_MAP, GATE_SPOT, p).ok), h.label).toBe(true);
    }
  });

  it('walks Ivor on clear ground, and his torch is a cone that heaps block', () => {
    for (let i = 0; i < PATROL.length; i++) {
      const a = PATROL[i];
      const b = PATROL[(i + 1) % PATROL.length];
      if (a === undefined || b === undefined) throw new Error('patrol');
      expect(isClearSegment(CITY_MAP, a, b), `leg ${String(i)}`).toBe(true);
      expect(inYard(a)).toBe(true);
    }
    const guard = { x: 13.5, y: 19.5 };
    expect(inTorch(guard, 0, { x: 16, y: 19.5 })).toBe(true);
    expect(inTorch(guard, Math.PI, { x: 16, y: 19.5 })).toBe(false);
    expect(inTorch(guard, 0, { x: 13.5 + TORCH_RANGE + 0.5, y: 19.5 })).toBe(false);
    expect(inTorch({ x: 11.5, y: 22.5 }, -Math.PI / 2, { x: 11.5, y: 19.5 })).toBe(false);
    expect(inTorch({ x: 12.5, y: 22.5 }, -Math.PI / 2, { x: 12.5, y: 19.5 })).toBe(true);
    for (const p of PATROL) expect(Math.hypot(p.x - GATE_SPOT.x, p.y - GATE_SPOT.y)).toBeGreaterThan(TORCH_RANGE + 1);
  });
});

describe('crew votes', () => {
  it('goes with the most votes', () => {
    expect(crewChoice([['a', 'joke'], ['b', 'promise'], ['c', 'promise']], 'a')).toBe('promise');
  });

  it('breaks a tie with the lead’s vote', () => {
    expect(crewChoice([['a', 'joke'], ['b', 'promise']], 'b')).toBe('promise');
    expect(crewChoice([['a', 'joke'], ['b', 'promise']], 'a')).toBe('joke');
  });

  it('breaks a tie without the lead by the choice picked first', () => {
    expect(crewChoice([['a', 'joke'], ['b', 'promise']], 'gone')).toBe('joke');
  });

  it('has no answer without votes', () => {
    expect(crewChoice([], 'a')).toBeNull();
  });

  it('finds somewhere to stand beside a spot, apart from the crew already there', () => {
    const at = { x: DANI_SPOT.x, y: DANI_SPOT.y };
    const first = besideSpot(at, []);
    expect(first).toEqual(at);
    const taken = [first];
    for (let i = 0; i < CREW_MAX - 1; i++) {
      const p = besideSpot(at, taken);
      expect(canStand(CITY_MAP, p)).toBe(true);
      for (const t of taken) expect(Math.hypot(t.x - p.x, t.y - p.y)).toBeGreaterThanOrEqual(0.7);
      taken.push(p);
    }
  });
});

describe('the acts', () => {
  it('lists every act once, picks act one for anything unknown, and labels work by the act', () => {
    expect(Object.keys(STORY_ACTS).slice(0, 4)).toEqual(['dump', 'ransom', 'insider', 'founder']);
    expect(isActId('ransom')).toBe(true);
    expect(isActId('__proto__')).toBe(false);
    expect(actOf('nope')).toBe(DUMP_ACT);
    expect(workLabel(RANSOM_ACT, { at: { x: 0, y: 0 }, label: 'Osei' })).toBe('Ask Osei to sign');
    expect(workLabel(DUMP_ACT, { at: { x: 0, y: 0 }, label: '2015' })).toBe('Dig the 2015 heap');
    for (const act of Object.values(STORY_ACTS)) {
      for (const [step, scene] of Object.entries(act.scenes)) {
        expect(act.steps, act.id).toContain(step);
        expect(act.script[scene], `${act.id} ${scene}`).toBeDefined();
      }
      for (const [step, arrival] of Object.entries(act.arrivals)) {
        expect(act.steps).toContain(step);
        expect(act.steps).toContain(arrival.to);
        expect(canStand(CITY_MAP, arrival.at), `${act.id} ${step}`).toBe(true);
      }
      expect(act.steps).toContain(act.workStep);
      expect(act.steps.at(-1)).toBe('done');
      for (const step of act.steps) expect(act.objectives[step], `${act.id} ${step}`).toBeDefined();
    }
  });
});

describe('act two: The Ransom Call', () => {
  it('has a sound script with every speaker and mark known', () => {
    expect(scriptProblems(RANSOM_SCRIPT, Object.values(RANSOM_ACT.scenes), RANSOM_STEPS)).toEqual([]);
    for (const node of Object.values(RANSOM_SCRIPT)) {
      for (const line of node.lines) {
        expect(SPEAKERS).toContain(line.who);
        for (const m of [line.if, line.unless]) if (m !== undefined) expect(Object.keys(RANSOM_MARKS)).toContain(m);
      }
      for (const m of [node.mark, node.jump?.if, ...(node.choices ?? []).map((c) => c.mark)]) if (m !== undefined) expect(Object.keys(RANSOM_MARKS)).toContain(m);
      for (const c of node.choices ?? []) expect(c.text.length).toBeLessThanOrEqual(90);
      if (node.seconds !== undefined) expect(node.seconds).toBeGreaterThanOrEqual(6);
    }
    expect(RANSOM_SCRIPT['brannDoor']?.then).toBe('done');
  });

  it('only gives the recording clue to a crew that asked twice and caught it', () => {
    const catches = Object.entries(RANSOM_SCRIPT).flatMap(([id, n]) => (n.choices ?? []).filter((c) => c.mark === 'clueRecording').map(() => id));
    expect(catches).toEqual(['proofAgain']);
    expect(RANSOM_SCRIPT['ransom']?.choices?.find((c) => c.go === 'proof')).toBeDefined();
    expect(RANSOM_SCRIPT['proof']?.choices?.find((c) => c.go === 'proofAgain')).toBeDefined();
    expect(RANSOM_SCRIPT['locked']?.jump).toEqual({ if: 'clueRecording', to: 'lockedClue' });
  });

  it('counts honesty from asking Ivy or thanking Brannigan', () => {
    expect(honestIn(RANSOM_ACT, ['askedIvy'])).toBe(true);
    expect(honestIn(RANSOM_ACT, ['thankedBrannigan'])).toBe(true);
    expect(honestIn(RANSOM_ACT, ['wouldPay', 'liedBrannigan', 'agreedLocksmith'])).toBe(false);
  });

  it('puts every place and guardian on open ground the crew can walk to', () => {
    for (const [name, spot] of Object.entries({ RANSOM_START, IVY_SPOT, BREAKWATER, LIGHTHOUSE_DOOR })) {
      expect(canStand(CITY_MAP, spot), name).toBe(true);
      expect(findPath(CITY_MAP, RANSOM_START, spot).ok, name).toBe(true);
    }
    expect(districtAt(IVY_SPOT)?.id).toBe('mint');
    expect(GUARDIANS).toHaveLength(5);
    expect(GUARDIANS.filter((g) => g.refuses === true)).toHaveLength(1);
    expect(GUARDIANS.length - 1).toBeGreaterThanOrEqual(SIGNATURES_NEEDED);
    for (const g of GUARDIANS) {
      const beside = [[0, 1], [1, 0], [-1, 0], [0, -1]].map(([dx = 0, dy = 0]) => ({ x: g.at.x + dx, y: g.at.y + dy })).filter((p) => canStand(CITY_MAP, p) && canWork(p, g, RANSOM_ACT.workReach));
      expect(beside.length, g.label).toBeGreaterThan(0);
      expect(beside.some((p) => findPath(CITY_MAP, IVY_SPOT, p).ok), g.label).toBe(true);
    }
  });

  it('walks the lookouts on clear ground, never lights the breakwater start, and leaves a way to the door', () => {
    for (const route of LOOKOUT_ROUTES) {
      for (let i = 0; i < route.length; i++) {
        const a = route[i];
        const b = route[(i + 1) % route.length];
        if (a === undefined || b === undefined) throw new Error('route');
        expect(isClearSegment(CITY_MAP, a, b)).toBe(true);
      }
    }
    const path = [{ x: 10, y: 76.6 }, { x: 5, y: 76.6 }, LIGHTHOUSE_DOOR];
    const doorRange = RANSOM_ACT.arrivals['sneak']?.range ?? 0;
    const dt = 0.05;
    const tries = (routes: readonly (readonly { x: number; y: number }[])[]): number => {
      let wins = 0;
      for (let t0 = 0; t0 < 30; t0 += 0.25) {
        let walkers: Walker[] = routes.map((r) => ({ x: r[0]?.x ?? 0, y: r[0]?.y ?? 0, facing: 0, leg: 0 }));
        const lit = (p: { x: number; y: number }): boolean => walkers.some((w) => inTorch(w, w.facing, p));
        for (let t = 0; t < t0; t += dt) {
          walkers = walkers.map((w, i) => walkRoute(w, routes[i] ?? [], LOOKOUT_SPEED, dt));
          expect(lit(BREAKWATER)).toBe(false);
        }
        let p = { x: BREAKWATER.x, y: BREAKWATER.y };
        let leg = 0;
        let ok = true;
        for (let t = 0; t < 15 && leg < path.length; t += dt) {
          walkers = walkers.map((w, i) => walkRoute(w, routes[i] ?? [], LOOKOUT_SPEED, dt));
          const goal = path[leg];
          if (goal === undefined) break;
          const d = Math.hypot(goal.x - p.x, goal.y - p.y);
          if (d < 0.15) {
            leg++;
            continue;
          }
          p = stepMovement(p, { x: (goal.x - p.x) / d, y: (goal.y - p.y) / d }, dt, CITY_MAP);
          if (Math.hypot(p.x - LIGHTHOUSE_DOOR.x, p.y - LIGHTHOUSE_DOOR.y) <= doorRange) {
            leg = path.length;
            break;
          }
          if (lit(p)) {
            ok = false;
            break;
          }
        }
        if (ok && leg >= path.length) wins++;
      }
      return wins;
    };
    const one = tries(LOOKOUT_ROUTES.slice(0, 1));
    const two = tries(LOOKOUT_ROUTES);
    expect(two).toBeGreaterThan(0);
    expect(one).toBeGreaterThan(two);
    expect(one).toBeLessThan(120);
  });

  it('walks a route at a steady pace, facing the way it goes', () => {
    const route = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }];
    let w: Walker = { x: 0, y: 0, facing: 0, leg: 0 };
    w = walkRoute(w, route, 2, 1);
    expect(w).toEqual({ x: 2, y: 0, facing: 0, leg: 0 });
    w = walkRoute(w, route, 2, 2);
    expect(w.leg).toBe(1);
    expect(w.x).toBe(4);
    expect(w.y).toBeCloseTo(2);
    expect(w.facing).toBeCloseTo(Math.PI / 2);
    expect(walkRoute(w, [{ x: 1, y: 1 }], 2, 1)).toBe(w);
  });
});

describe('act three: The Insider', () => {
  it('has a sound script with every speaker and mark known, ending on the ceremony', () => {
    expect(scriptProblems(INSIDER_SCRIPT, Object.values(INSIDER_ACT.scenes), INSIDER_STEPS)).toEqual([]);
    for (const node of Object.values(INSIDER_SCRIPT)) {
      for (const line of node.lines) {
        expect(SPEAKERS).toContain(line.who);
        for (const m of [line.if, line.unless]) if (m !== undefined) expect(Object.keys(INSIDER_MARKS)).toContain(m);
      }
      for (const m of [node.mark, ...(node.choices ?? []).map((c) => c.mark)]) if (m !== undefined) expect(Object.keys(INSIDER_MARKS)).toContain(m);
      for (const c of node.choices ?? []) expect(c.text.length).toBeLessThanOrEqual(90);
    }
    expect(INSIDER_SCRIPT['teoEnd']?.then).toBe('done');
    expect(INSIDER_ACT.finale).toBeDefined();
  });

  it('gives the east-side clue for paying or for the truth, never for pushing', () => {
    const marksOf = (ids: readonly string[]): string[] =>
      ids.flatMap((id) => {
        const mark = INSIDER_SCRIPT[id]?.mark;
        return mark === undefined ? [] : [mark];
      });
    expect(marksOf(['noncePay'])).toContain('clueEast');
    expect(marksOf(['nonceTruth', 'nonceYacht'])).toEqual(['clueEast', 'clueYacht']);
    expect(marksOf(['noncePush', 'nonceSilence'])).toEqual([]);
    expect(honestIn(INSIDER_ACT, ['honestNonce'])).toBe(true);
    expect(honestIn(INSIDER_ACT, ['askedCut', 'pushedNonce', 'cuffedTeo'])).toBe(false);
  });

  it('puts every place on open ground the crew can walk to, and hides the login on the east side', () => {
    for (const [name, spot] of Object.entries({ INSIDER_START, NONCE_SPOT, TOWER_SPOT })) {
      expect(canStand(CITY_MAP, spot), name).toBe(true);
      expect(findPath(CITY_MAP, INSIDER_START, spot).ok, name).toBe(true);
    }
    expect(districtAt(NONCE_SPOT)?.id).toBe('docks');
    expect(districtAt(TOWER_SPOT)?.id).toBe('council');
    expect(LOGIN_TERMINALS.length).toBe(2);
    for (const i of LOGIN_TERMINALS) expect(TERMINALS[i]?.east).toBe(true);
    expect(OTHER_ACCOUNTS.length).toBeGreaterThanOrEqual(TERMINALS.length - 1);
    for (const t of TERMINALS) {
      expect(canStand(CITY_MAP, t.at), t.label).toBe(true);
      expect(findPath(CITY_MAP, TOWER_SPOT, t.at).ok, t.label).toBe(true);
    }
  });

  it('walks Gus round the tower on clear ground, and every terminal has time to be searched unseen', () => {
    for (let i = 0; i < WATCH_ROUTE.length; i++) {
      const a = WATCH_ROUTE[i];
      const b = WATCH_ROUTE[(i + 1) % WATCH_ROUTE.length];
      if (a === undefined || b === undefined) throw new Error('route');
      expect(isClearSegment(CITY_MAP, a, b), `leg ${String(i)}`).toBe(true);
    }
    const dt = 0.05;
    let gus: Walker = { x: WATCH_ROUTE[0]?.x ?? 0, y: WATCH_ROUTE[0]?.y ?? 0, facing: 0, leg: 0 };
    const unlit = TERMINALS.map(() => 0);
    const best = TERMINALS.map(() => 0);
    for (let t = 0; t < 60; t += dt) {
      gus = walkRoute(gus, WATCH_ROUTE, WATCH_SPEED, dt);
      TERMINALS.forEach((term, i) => {
        unlit[i] = inTorch(gus, gus.facing, term.at) ? 0 : (unlit[i] ?? 0) + dt;
        best[i] = Math.max(best[i] ?? 0, unlit[i] ?? 0);
      });
    }
    for (const [i, b] of best.entries()) expect(b, TERMINALS[i]?.label).toBeGreaterThan(INSIDER_ACT.workMs / 1000 + 3);
  });
});

describe('act four: The Founder’s Coins', () => {
  it('has a sound script with every speaker and mark known, ending the season at the tip gate', () => {
    expect(scriptProblems(FOUNDER_SCRIPT, Object.values(FOUNDER_ACT.scenes), FOUNDER_STEPS)).toEqual([]);
    for (const node of Object.values(FOUNDER_SCRIPT)) {
      for (const line of node.lines) {
        expect(SPEAKERS).toContain(line.who);
        for (const m of [line.if, line.unless]) if (m !== undefined) expect(Object.keys(FOUNDER_MARKS)).toContain(m);
      }
      for (const c of node.choices ?? []) {
        for (const m of [c.mark, c.if, c.unless]) if (m !== undefined) expect(Object.keys(FOUNDER_MARKS)).toContain(m);
        expect(c.text.length).toBeLessThanOrEqual(90);
      }
      if (node.mark !== undefined) expect(Object.keys(FOUNDER_MARKS)).toContain(node.mark);
    }
    for (const end of ['endGuardian', 'endBurn', 'endByzantine', 'endSilence']) {
      let id: string | undefined = end;
      const seen: string[] = [];
      while (id !== undefined && id !== 'voicemail' && seen.length < 10) {
        seen.push(id);
        id = FOUNDER_SCRIPT[id]?.next;
      }
      expect(seen, end).toContain('dawn');
    }
    expect(FOUNDER_SCRIPT['voicemail']?.then).toBe('done');
  });

  it('only offers the Byzantine ending to a crew that once asked for a cut', () => {
    const choice = FOUNDER_SCRIPT['theChoice'];
    if (choice === undefined) throw new Error('choice');
    expect(visibleChoices(choice, new Set()).map((c) => c.id)).toEqual(['guardian', 'burn']);
    expect(visibleChoices(choice, new Set(['pastCut'])).map((c) => c.id)).toEqual(['guardian', 'burn', 'byzantine']);
    expect(visibleLines(choice, new Set(['pastCeremony', 'pastCeremonyHeld'])).map((l) => l.text)[0]).toContain('The ceremony held');
    expect(visibleLines(choice, new Set()).map((l) => l.text)[0]).toContain('Everyone is listening');
  });

  it('carries honesty, a cut and the ceremony from a saved story, and nothing from an empty one', () => {
    expect(carriedMarks(undefined)).toEqual([]);
    expect(carriedMarks({ dump: { honest: false }, insider: { marks: ['talkedTeo'] } })).toEqual([]);
    expect(carriedMarks({ dump: { honest: true }, insider: { marks: ['askedCut'] }, ceremony: { done: true, honest: false } })).toEqual(['pastHonest', 'pastCut', 'pastCeremony', 'pastCeremonyLost']);
    for (const m of carriedMarks({ dump: { honest: true }, insider: { marks: ['askedCut'] }, ceremony: { done: true, honest: true } })) {
      expect(Object.keys(FOUNDER_MARKS)).toContain(m);
      expect(m).toMatch(/^[a-zA-Z]{1,24}$/);
    }
  });

  it('puts the mast and generators where the crew can walk, and gives each generator time out of the Choir’s lights', () => {
    for (const [name, spot] of Object.entries({ FOUNDER_START, MAST_SPOT })) {
      expect(canStand(CITY_MAP, spot), name).toBe(true);
      expect(findPath(CITY_MAP, FOUNDER_START, spot).ok, name).toBe(true);
    }
    expect(districtAt(MAST_SPOT)?.id).toBe('heights');
    for (const g of GENERATORS) {
      expect(canStand(CITY_MAP, g.at), g.label).toBe(true);
      expect(findPath(CITY_MAP, MAST_SPOT, g.at).ok, g.label).toBe(true);
    }
    for (const route of CHOIR_ROUTES) {
      for (let i = 0; i < route.length; i++) {
        const a = route[i];
        const b = route[(i + 1) % route.length];
        if (a === undefined || b === undefined) throw new Error('route');
        expect(isClearSegment(CITY_MAP, a, b)).toBe(true);
      }
    }
    const dt = 0.05;
    let runners: Walker[] = CHOIR_ROUTES.map((r) => ({ x: r[0]?.x ?? 0, y: r[0]?.y ?? 0, facing: 0, leg: 0 }));
    const unlit = GENERATORS.map(() => 0);
    const best = GENERATORS.map(() => 0);
    for (let t = 0; t < 60; t += dt) {
      runners = runners.map((w, i) => walkRoute(w, CHOIR_ROUTES[i] ?? [], CHOIR_SPEED, dt));
      GENERATORS.forEach((g, i) => {
        unlit[i] = runners.some((w) => inTorch(w, w.facing, g.at)) ? 0 : (unlit[i] ?? 0) + dt;
        best[i] = Math.max(best[i] ?? 0, unlit[i] ?? 0);
      });
    }
    for (const [i, b] of best.entries()) expect(b, GENERATORS[i]?.label).toBeGreaterThan(FOUNDER_ACT.workMs / 1000 + 2);
  });
});
