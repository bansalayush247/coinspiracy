import { describe, expect, it } from 'vitest';
import {
  CLIENT_MESSAGE_PAYLOADS,
  COUNCIL_TIMING,
  CONSENSUS_GOAL,
  ClientMessageSchema,
  LIVENESS_LIMIT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PACING,
  SKIP,
  TIER_FEATURES,
  TIER_GATED_MESSAGES,
  TIER_IDS,
  TIER_TABLE,
  autoTier,
  blocksLeft,
  byzantineCount,
  castVote,
  createProposal,
  evaluateWinner,
  isHalted,
  messageAllowed,
  openCouncil,
  parseTierTable,
  playerTier,
  roomTier,
  settleProposal,
  signProposal,
  tallyVotes,
  threshold,
  tierAllows,
  tierPickable,
  tierRules,
  tierWinReasons,
  type ClientMessageType,
  type Guardian,
  type Proposal,
  type Side,
  type TierId,
  type WinReason,
  type Winner,
} from '../src/index.js';
import { RANK_START } from '../src/progression/rank.js';
import raw from '../src/tuning/tiers.json' with { type: 'json' };

const COUNTS = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i);
const SIDE_OF: Readonly<Record<WinReason, Side>> = {
  consensusReached: 'honest',
  allByzantineRotatedOut: 'honest',
  federationHalted: 'byzantine',
  outOfTime: 'byzantine',
  forgedProposalPassed: 'byzantine',
  livenessLost: 'byzantine',
};

function federation(n: number): Guardian[] {
  const f = byzantineCount(n);
  return Array.from({ length: n }, (_, i) => ({ id: `guardian-${String(i)}`, role: i < f ? 'byzantine' : 'honest', status: 'active' }));
}

const membersOf = (gs: readonly Guardian[]) => gs.filter((g) => g.status !== 'rotatedOut');

interface Table {
  guardians: Guardian[];
  proposals: Proposal[];
  consensus: number;
  outages: number;
  calls: Map<string, number>;
}

function table(n: number): Table {
  return { guardians: federation(n), proposals: [], consensus: 0, outages: 0, calls: new Map() };
}

const judge = (t: Table): Winner | null => evaluateWinner({ guardians: t.guardians, proposals: t.proposals, consensus: t.consensus, outages: t.outages });

function council(t: Table, target: string, misled: (voter: Guardian) => boolean): string | null {
  const caller = membersOf(t.guardians).find((g) => (t.calls.get(g.id) ?? 0) < COUNCIL_TIMING.perPlayer);
  if (caller === undefined) throw new Error('no guardian left who may call a council');
  t.calls.set(caller.id, (t.calls.get(caller.id) ?? 0) + 1);
  const opened = openCouncil(caller.id, t.guardians, 0, 100);
  if (!opened.ok) throw new Error(opened.error);
  let c = opened.value;
  for (const voter of membersOf(t.guardians)) {
    const vote = castVote(c, voter.id, voter.id !== target && misled(voter) ? target : SKIP, t.guardians, 1);
    if (!vote.ok) throw new Error(vote.error);
    c = vote.value;
  }
  const { ejected } = tallyVotes(c, t.guardians);
  if (ejected !== null) t.guardians = t.guardians.map((g) => (g.id === ejected ? { ...g, status: 'rotatedOut' } : g));
  return ejected;
}

function playUntil(t: Table, step: () => void): Winner {
  for (let i = 0; i < 64; i++) {
    expect(judge(t)).toBeNull();
    step();
    const winner = judge(t);
    if (winner !== null) return winner;
  }
  throw new Error('no winner');
}

function scenario(tier: TierId, n: number, reason: WinReason): Winner {
  const t = table(n);
  const rules = tierRules(tier);
  switch (reason) {
    case 'consensusReached':
      return playUntil(t, () => {
        t.consensus = Math.min(CONSENSUS_GOAL, t.consensus + 25);
      });
    case 'allByzantineRotatedOut':
      return playUntil(t, () => {
        const target = membersOf(t.guardians).find((g) => g.role === 'byzantine');
        if (target === undefined) throw new Error('no Byzantine left');
        expect(council(t, target.id, (v) => v.role === 'honest')).toBe(target.id);
      });
    case 'federationHalted':
      return playUntil(t, () => {
        const target = membersOf(t.guardians).find((g) => g.role === 'honest');
        if (target === undefined) throw new Error('no honest guardian left');
        expect(council(t, target.id, () => true)).toBe(target.id);
      });
    case 'outOfTime': {
      t.consensus = CONSENSUS_GOAL - 1;
      expect(blocksLeft(PACING.totalBlocks * PACING.blockMs - 1, PACING)).toBe(1);
      expect(blocksLeft(PACING.totalBlocks * PACING.blockMs, PACING)).toBe(0);
      expect(judge(t)).toBeNull();
      return { side: 'byzantine', reason: 'outOfTime' };
    }
    case 'forgedProposalPassed': {
      if (!rules.forging) throw new Error('forging is off');
      let forged = createProposal({ id: 'f1', amount: 1000, requestedBy: 'guardian-0', forged: true, expiresAtTick: 900 });
      t.proposals = [forged];
      const signers = [...membersOf(t.guardians)].sort((a, b) => (a.role === b.role ? 0 : a.role === 'byzantine' ? -1 : 1));
      expect(signers.length).toBeGreaterThanOrEqual(threshold(n));
      return playUntil(t, () => {
        const next = signers.shift();
        if (next === undefined) throw new Error('nobody left to sign');
        const signed = signProposal(forged, next.id, t.guardians, 1);
        if (!signed.ok) throw new Error(signed.error);
        forged = signed.value;
        t.proposals = [forged];
      });
    }
    case 'livenessLost': {
      if (rules.ceremonies) {
        let id = 0;
        return playUntil(t, () => {
          id += 1;
          const real = createProposal({ id: `w${String(id)}`, amount: 1000, requestedBy: 'federation', forged: false, expiresAtTick: 10 });
          t.proposals = [...t.proposals, settleProposal(real, t.guardians, 10)];
        });
      }
      if (!rules.partition) throw new Error('nothing can cost liveness');
      return playUntil(t, () => {
        t.outages += 1;
      });
    }
  }
}

function snapshots(tier: TierId, n: number): Winner[] {
  const rules = tierRules(tier);
  const f = byzantineCount(n);
  const results: Winner[] = [];
  for (let honestOut = 0; honestOut <= n - f; honestOut++) {
    for (let byzOut = 0; byzOut <= f; byzOut++) {
      const guardians = federation(n).map((g, i): Guardian => {
        const out = g.role === 'byzantine' ? i < byzOut : i - f < honestOut;
        return out ? { ...g, status: 'rotatedOut' } : g;
      });
      for (const consensus of [0, CONSENSUS_GOAL - 1, CONSENSUS_GOAL]) {
        for (let failed = 0; failed <= (rules.ceremonies ? LIVENESS_LIMIT : 0); failed++) {
          for (const forgedPassed of rules.forging ? [false, true] : [false]) {
            for (let outages = 0; outages <= (rules.partition ? LIVENESS_LIMIT : 0); outages++) {
              const proposals: Proposal[] = Array.from({ length: failed }, (_, i) => ({ ...createProposal({ id: `w${String(i)}`, amount: 1000, requestedBy: 'federation', forged: false, expiresAtTick: 5 }), status: 'expired' }));
              if (rules.ceremonies) proposals.push({ ...createProposal({ id: 'ok', amount: 1000, requestedBy: 'federation', forged: false, expiresAtTick: 5 }), status: 'passed' });
              if (forgedPassed) proposals.push({ ...createProposal({ id: 'f', amount: 1000, requestedBy: 'guardian-0', forged: true, expiresAtTick: 5 }), status: 'passed' });
              const winner = evaluateWinner({ guardians, proposals, consensus, outages });
              if (winner !== null) results.push(winner);
            }
          }
        }
      }
    }
  }
  return results;
}

describe('the tier table', () => {
  it('loads from tiers.json, checked and frozen', () => {
    expect(TIER_TABLE.tiers.map((t) => t.id)).toEqual([...TIER_IDS]);
    expect(Object.isFrozen(TIER_TABLE)).toBe(true);
    expect(Object.isFrozen(TIER_TABLE.tiers)).toBe(true);
    for (const t of TIER_TABLE.tiers) expect(Object.isFrozen(t)).toBe(true);
    expect(tierRules('apprentice')).toEqual({ id: 'apprentice', unlockIsland: null, ceremonies: false, forging: false, partition: false, freeze: false });
    expect(tierRules('journeyman')).toEqual({ id: 'journeyman', unlockIsland: 'signing', ceremonies: true, forging: true, partition: false, freeze: false });
    expect(tierRules('full')).toEqual({ id: 'full', unlockIsland: 'watchtower', ceremonies: true, forging: true, partition: true, freeze: true });
    expect(TIER_TABLE.fallback).toBe('full');
    expect(TIER_TABLE.ceremonyRoomMin).toBe('journeyman');
  });

  it('refuses edits that would break a tier', () => {
    const edit = (change: (t: typeof raw) => void): unknown => {
      const copy = structuredClone(raw);
      change(copy);
      return copy;
    };
    const broken = [
      edit((t) => t.tiers.reverse()),
      edit((t) => {
        t.tiers[1] = { ...t.tiers[1], ceremonies: false } as (typeof t.tiers)[1];
      }),
      edit((t) => {
        t.tiers[2] = { ...t.tiers[2], forging: false } as (typeof t.tiers)[2];
      }),
      edit((t) => {
        t.tiers[1] = { ...t.tiers[1], unlockIsland: 'atlantis' } as (typeof t.tiers)[1];
      }),
      edit((t) => {
        t.tiers[0] = { ...t.tiers[0], unlockIsland: 'mint' } as unknown as (typeof t.tiers)[0];
      }),
      edit((t) => {
        t.ceremonyRoomMin = 'apprentice';
      }),
      edit((t) => {
        t.fallback = 'expert';
      }),
      edit((t) => {
        (t.tiers[0] as Record<string, unknown>)['sabotage'] = true;
      }),
      edit((t) => {
        t.tiers.pop();
      }),
    ];
    for (const table of broken) expect(() => parseTierTable(table)).toThrow();
    expect(() => parseTierTable(structuredClone(raw))).not.toThrow();
  });

  it('only ever adds rules going up a tier', () => {
    for (const feature of TIER_FEATURES) {
      const on = TIER_IDS.map((id) => tierAllows(id, feature));
      expect(on.indexOf(true)).toBeGreaterThanOrEqual(0);
      expect(on.slice(on.indexOf(true)).every(Boolean)).toBe(true);
    }
  });
});

describe('what each tier lets a client do', () => {
  it('gates exactly the ceremony and sabotage messages', () => {
    const types = Object.keys(CLIENT_MESSAGE_PAYLOADS) as ClientMessageType[];
    expect(types.filter((type) => !messageAllowed('apprentice', type)).sort()).toEqual(['auditProposal', 'forgeProposal', 'freeze', 'partition', 'refuseProposal', 'signProposal']);
    expect(types.filter((type) => !messageAllowed('journeyman', type)).sort()).toEqual(['freeze', 'partition']);
    expect(types.filter((type) => !messageAllowed('full', type))).toEqual([]);
    for (const type of Object.keys(TIER_GATED_MESSAGES)) expect(types).toContain(type);
  });

  it('accepts a setTier message only for a real tier', () => {
    expect(ClientMessageSchema.safeParse({ type: 'setTier', tier: 'journeyman' }).success).toBe(true);
    for (const tier of ['expert', 'FULL', '', 3, null]) expect(ClientMessageSchema.safeParse({ type: 'setTier', tier }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: 'setTier', tier: 'full', forging: true }).success).toBe(false);
  });
});

describe('choosing a tier', () => {
  it("follows the islands a player has opened, by rank or Academy stars", () => {
    expect(playerTier(0, [])).toBe('apprentice');
    expect(playerTier((RANK_START[1] ?? 0) - 1, [])).toBe('apprentice');
    expect(playerTier(RANK_START[1] ?? 0, [])).toBe('journeyman');
    expect(playerTier(0, [3])).toBe('journeyman');
    expect(playerTier((RANK_START[5] ?? 0) - 1, [])).toBe('journeyman');
    expect(playerTier(RANK_START[5] ?? 0, [])).toBe('full');
    expect(playerTier(0, [3, 3, 3])).toBe('full');
    expect(playerTier(Number.NaN, [-5, Number.NaN])).toBe('apprentice');
  });

  it('plays quick matches at the lowest tier anyone seated has learned', () => {
    expect(autoTier(['full', 'journeyman', 'full'])).toBe('journeyman');
    expect(autoTier(['full', 'apprentice', null])).toBe('apprentice');
    expect(autoTier(['full', null, null])).toBe('full');
    expect(autoTier([null, null])).toBe(TIER_TABLE.fallback);
    expect(autoTier([])).toBe(TIER_TABLE.fallback);
    for (const players of [['journeyman', 'full'], ['apprentice'], ['full', 'full']] as TierId[][]) {
      const chosen = autoTier(players);
      for (const p of players) expect(TIER_IDS.indexOf(chosen)).toBeLessThanOrEqual(TIER_IDS.indexOf(p));
    }
  });

  it("lets a private host pick, but keeps a signing ceremony's ceremonies", () => {
    expect(roomTier({ players: ['apprentice'], picked: 'full', ceremonyRoom: false })).toBe('full');
    expect(roomTier({ players: ['full'], picked: 'apprentice', ceremonyRoom: false })).toBe('apprentice');
    expect(roomTier({ players: ['full', 'apprentice'], picked: null, ceremonyRoom: false })).toBe('apprentice');
    expect(roomTier({ players: ['apprentice'], picked: null, ceremonyRoom: true })).toBe('journeyman');
    expect(roomTier({ players: [], picked: 'apprentice', ceremonyRoom: true })).toBe('journeyman');
    expect(tierPickable('apprentice', true)).toBe(false);
    expect(TIER_IDS.filter((id) => tierPickable(id, true))).toEqual(['journeyman', 'full']);
    expect(TIER_IDS.every((id) => tierPickable(id, false))).toBe(true);
  });
});

describe('every tier stays winnable for both sides', () => {
  for (const tier of TIER_IDS) {
    for (const n of COUNTS) {
      it(`${tier} with ${String(n)} guardians`, () => {
        const reasons = tierWinReasons(tier);
        expect(reasons.some((r) => SIDE_OF[r] === 'honest')).toBe(true);
        expect(reasons.some((r) => SIDE_OF[r] === 'byzantine')).toBe(true);
        for (const reason of reasons) expect(scenario(tier, n, reason), reason).toEqual({ side: SIDE_OF[reason], reason });
        for (const winner of snapshots(tier, n)) {
          expect(reasons).toContain(winner.reason);
          expect(winner.side).toBe(SIDE_OF[winner.reason]);
        }
      });
    }
  }

  it('never lets a tier without ceremonies or sabotage lose on forgeries or liveness', () => {
    expect(tierWinReasons('apprentice')).not.toContain('forgedProposalPassed');
    expect(tierWinReasons('apprentice')).not.toContain('livenessLost');
    expect([...tierWinReasons('full')].sort()).toEqual(Object.keys(SIDE_OF).sort());
  });

  it('lets partitions alone cost liveness wherever the tier has them', () => {
    for (const tier of TIER_IDS.filter((id) => tierAllows(id, 'partition'))) {
      for (const n of COUNTS) {
        const t = table(n);
        const winner = playUntil(t, () => {
          t.outages += 1;
        });
        expect(winner, tier).toEqual({ side: 'byzantine', reason: 'livenessLost' });
        expect(t.outages).toBe(LIVENESS_LIMIT);
      }
    }
  });

  it('halts only through councils the federation can actually hold', () => {
    for (const n of COUNTS) {
      const t = table(n);
      let councils = 0;
      while (!isHalted(byzantineCount(n), membersOf(t.guardians).length)) {
        const target = membersOf(t.guardians).find((g) => g.role === 'honest');
        if (target === undefined) throw new Error('no honest guardian left');
        council(t, target.id, () => true);
        councils += 1;
      }
      expect(councils).toBeLessThanOrEqual(n * COUNCIL_TIMING.perPlayer);
      expect(judge(t)).toEqual({ side: 'byzantine', reason: 'federationHalted' });
    }
  });
});
