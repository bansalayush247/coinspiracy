import { describe, expect, it } from 'vitest';
import { CONSENSUS_GOAL } from '../src/constants.js';
import {
  createProposal,
  refuseProposal,
  signProposal,
  type Proposal,
  type ProposalStatus,
} from '../src/proposals.js';
import type { Result } from '../src/result.js';
import type { Guardian, GuardianStatus, PlayerId } from '../src/types.js';
import { evaluateWinner, type MatchSnapshot, type Winner } from '../src/win.js';

const FORGERY: Winner = { side: 'byzantine', reason: 'forgedProposalPassed' };
const HALT: Winner = { side: 'byzantine', reason: 'federationHalted' };
const PURGE: Winner = { side: 'honest', reason: 'allByzantineRotatedOut' };
const CONSENSUS: Winner = { side: 'honest', reason: 'consensusReached' };

// Spec: f = floor((n - 1) / 3), and the halt needs n - 3f honest ejections.
const SIZES = [
  { players: 5, byzantines: 1, haltAfter: 2 },
  { players: 6, byzantines: 1, haltAfter: 3 },
  { players: 7, byzantines: 2, haltAfter: 1 },
  { players: 8, byzantines: 2, haltAfter: 2 },
  { players: 9, byzantines: 2, haltAfter: 3 },
];

const UNDECIDED_STATUSES: readonly ProposalStatus[] = ['open', 'rejected', 'expired'];

function playerId(seat: number): PlayerId {
  return `player-${String(seat).padStart(2, '0')}`;
}

// Byzantines take the first seats.
function roster(players: number, byzantines: number): Guardian[] {
  return Array.from({ length: players }, (_, seat): Guardian => ({
    id: playerId(seat),
    role: seat < byzantines ? 'byzantine' : 'honest',
    status: 'active',
  }));
}

function seats(first: number, count: number): PlayerId[] {
  return Array.from({ length: count }, (_, i) => playerId(first + i));
}

function withStatus(
  guardians: readonly Guardian[],
  ids: readonly PlayerId[],
  status: GuardianStatus,
): Guardian[] {
  return guardians.map((g) => (ids.includes(g.id) ? { ...g, status } : g));
}

function proposal(status: ProposalStatus, forged: boolean): Proposal {
  return {
    id: `${status}-${forged ? 'forged' : 'honest'}`,
    amount: 5000,
    requestedBy: playerId(0),
    forged,
    signatures: [],
    refusals: [],
    status,
    expiresAtTick: 600,
  };
}

interface SnapshotOptions {
  readonly proposals?: readonly Proposal[];
  readonly consensus?: number;
}

// Deep-frozen, so any write during evaluation throws.
function snapshot(
  guardians: readonly Guardian[],
  { proposals = [], consensus = 0 }: SnapshotOptions = {},
): MatchSnapshot {
  return Object.freeze({
    guardians: Object.freeze(guardians.map((g) => Object.freeze({ ...g }))),
    proposals: Object.freeze(
      proposals.map((p) =>
        Object.freeze({
          ...p,
          signatures: Object.freeze([...p.signatures]),
          refusals: Object.freeze([...p.refusals]),
        }),
      ),
    ),
    consensus,
  });
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.value;
}

function newForgery(): Proposal {
  return createProposal({
    id: 'withdraw-1',
    amount: 21_000,
    requestedBy: playerId(0),
    forged: true,
    expiresAtTick: 50,
  });
}

describe('evaluateWinner: undecided matches', () => {
  it.each(SIZES)(
    'a fresh $players-player match with $byzantines Byzantine(s) has no winner',
    ({ players, byzantines }) => {
      expect(evaluateWinner(snapshot(roster(players, byzantines)))).toBeNull();
    },
  );

  it.each(SIZES)(
    'a fresh $players-player match is won by reaching consensus',
    ({ players, byzantines }) => {
      expect(evaluateWinner(snapshot(roster(players, byzantines), { consensus: 100 }))).toEqual(
        CONSENSUS,
      );
    },
  );

  it('stays undecided while a Byzantine remains, the federation holds and consensus is short', () => {
    // 9 players minus one Byzantine and two honest: 1 Byzantine of 6
    const guardians = withStatus(roster(9, 2), [playerId(0), ...seats(2, 2)], 'rotatedOut');
    expect(evaluateWinner(snapshot(guardians, { consensus: 99 }))).toBeNull();
  });
});

describe('evaluateWinner: each way to win', () => {
  it('Byzantines win when a forged proposal passes', () => {
    const match = snapshot(roster(5, 1), { proposals: [proposal('passed', true)] });
    expect(evaluateWinner(match)).toEqual(FORGERY);
  });

  it('Byzantines win when they make up a third of the members', () => {
    // 5 players minus two honest: 1 Byzantine of 3
    expect(evaluateWinner(snapshot(withStatus(roster(5, 1), seats(1, 2), 'rotatedOut')))).toEqual(
      HALT,
    );
  });

  it('Byzantines win when only Byzantines are left', () => {
    expect(evaluateWinner(snapshot(withStatus(roster(7, 2), seats(2, 5), 'rotatedOut')))).toEqual(
      HALT,
    );
  });

  it('honest guardians win once every Byzantine is rotated out', () => {
    expect(evaluateWinner(snapshot(withStatus(roster(7, 2), seats(0, 2), 'rotatedOut')))).toEqual(
      PURGE,
    );
  });

  it('honest guardians win at the consensus goal', () => {
    expect(evaluateWinner(snapshot(roster(5, 1), { consensus: 100 }))).toEqual(CONSENSUS);
  });
});

describe('evaluateWinner: precedence', () => {
  const halted = withStatus(roster(5, 1), seats(1, 2), 'rotatedOut');
  const purged = withStatus(roster(5, 1), [playerId(0)], 'rotatedOut');
  const forgeries = [proposal('passed', true)];

  it('a passed forgery beats reaching consensus', () => {
    const match = snapshot(roster(5, 1), { proposals: forgeries, consensus: 100 });
    expect(evaluateWinner(match)).toEqual(FORGERY);
  });

  it('a passed forgery beats having rotated every Byzantine out', () => {
    expect(evaluateWinner(snapshot(purged, { proposals: forgeries }))).toEqual(FORGERY);
    expect(evaluateWinner(snapshot(purged, { proposals: forgeries, consensus: 100 }))).toEqual(
      FORGERY,
    );
  });

  it('a passed forgery is reported ahead of a halt', () => {
    expect(evaluateWinner(snapshot(halted, { proposals: forgeries }))).toEqual(FORGERY);
  });

  it('a halt beats reaching consensus', () => {
    expect(evaluateWinner(snapshot(halted, { consensus: 100 }))).toEqual(HALT);
  });

  it('rotating every Byzantine out is reported ahead of consensus', () => {
    expect(evaluateWinner(snapshot(purged, { consensus: 100 }))).toEqual(PURGE);
  });

  it('a federation with no members left is halted, even at the consensus goal', () => {
    const everyoneOut = withStatus(roster(5, 1), seats(0, 5), 'rotatedOut');
    expect(evaluateWinner(snapshot(everyoneOut))).toEqual(HALT);
    expect(evaluateWinner(snapshot(everyoneOut, { consensus: 100 }))).toEqual(HALT);
    expect(evaluateWinner(snapshot([], { consensus: 100 }))).toEqual(HALT);
  });
});

describe('evaluateWinner: wrong ejections lead to a halt', () => {
  it('6 players with 1 Byzantine halt after 3 honest ejections, not after 2', () => {
    const start = roster(6, 1);
    expect(evaluateWinner(snapshot(withStatus(start, seats(1, 2), 'rotatedOut')))).toBeNull();
    expect(evaluateWinner(snapshot(withStatus(start, seats(1, 3), 'rotatedOut')))).toEqual(HALT);
  });

  it('7 players with 2 Byzantines halt after a single honest ejection', () => {
    const start = roster(7, 2);
    expect(evaluateWinner(snapshot(start))).toBeNull();
    expect(evaluateWinner(snapshot(withStatus(start, [playerId(2)], 'rotatedOut')))).toEqual(HALT);
  });

  it.each(SIZES)(
    '$players players with $byzantines Byzantine(s) halt after exactly $haltAfter honest ejections',
    ({ players, byzantines, haltAfter }) => {
      const start = roster(players, byzantines);
      const holding = withStatus(start, seats(byzantines, haltAfter - 1), 'rotatedOut');
      const fallen = withStatus(start, seats(byzantines, haltAfter), 'rotatedOut');
      expect(evaluateWinner(snapshot(holding))).toBeNull();
      expect(evaluateWinner(snapshot(holding, { consensus: 100 }))).toEqual(CONSENSUS);
      expect(evaluateWinner(snapshot(fallen))).toEqual(HALT);
      expect(evaluateWinner(snapshot(fallen, { consensus: 100 }))).toEqual(HALT);
    },
  );

  it('does not count rotated-out Byzantines toward a halt', () => {
    // 7 players minus one Byzantine and one honest: 1 Byzantine of 5
    const start = roster(7, 2);
    const oneEach = withStatus(start, [playerId(0), playerId(2)], 'rotatedOut');
    expect(evaluateWinner(snapshot(oneEach))).toBeNull();
    expect(evaluateWinner(snapshot(withStatus(oneEach, [playerId(1)], 'rotatedOut')))).toEqual(
      PURGE,
    );
  });
});

describe('evaluateWinner: proposals', () => {
  it.each(UNDECIDED_STATUSES)('a forged proposal that is %s does not end the match', (status) => {
    expect(evaluateWinner(snapshot(roster(5, 1), { proposals: [proposal(status, true)] }))).toBeNull();
  });

  it.each(UNDECIDED_STATUSES)('a forged proposal that is %s does not block a consensus win', (status) => {
    const match = snapshot(roster(5, 1), { proposals: [proposal(status, true)], consensus: 100 });
    expect(evaluateWinner(match)).toEqual(CONSENSUS);
  });

  it('an honest proposal that passes does not end the match', () => {
    expect(evaluateWinner(snapshot(roster(5, 1), { proposals: [proposal('passed', false)] }))).toBeNull();
  });

  it('finds a passed forgery among other proposals', () => {
    const proposals = [
      proposal('passed', false),
      proposal('open', true),
      proposal('rejected', true),
      proposal('expired', true),
      proposal('passed', true),
    ];
    expect(evaluateWinner(snapshot(roster(5, 1), { proposals }))).toEqual(FORGERY);
  });

  it('a forgery signed up to the threshold hands the Byzantines the win', () => {
    // 5 members need 4 signatures
    const guardians = roster(5, 1);
    let forged = newForgery();
    for (const signer of seats(0, 3)) forged = unwrap(signProposal(forged, signer, guardians, 10));
    expect(forged.status).toBe('open');
    expect(evaluateWinner(snapshot(guardians, { proposals: [forged] }))).toBeNull();

    forged = unwrap(signProposal(forged, playerId(3), guardians, 10));
    expect(forged.status).toBe('passed');
    expect(evaluateWinner(snapshot(guardians, { proposals: [forged] }))).toEqual(FORGERY);
  });

  it('a forgery refused by enough honest guardians cannot win', () => {
    // 5 members, threshold 4: two refusals sink it
    const guardians = roster(5, 1);
    let forged = unwrap(signProposal(newForgery(), playerId(0), guardians, 10));
    forged = unwrap(refuseProposal(forged, playerId(1), guardians, 10));
    forged = unwrap(refuseProposal(forged, playerId(2), guardians, 10));
    expect(forged.status).toBe('rejected');
    expect(evaluateWinner(snapshot(guardians, { proposals: [forged] }))).toBeNull();
  });
});

describe('evaluateWinner: consensus', () => {
  it('has a goal of 100', () => {
    expect(CONSENSUS_GOAL).toBe(100);
  });

  it('99 is one short and 100 wins', () => {
    expect(evaluateWinner(snapshot(roster(5, 1), { consensus: 99 }))).toBeNull();
    expect(evaluateWinner(snapshot(roster(5, 1), { consensus: 100 }))).toEqual(CONSENSUS);
  });

  it.each([0, 1, 50, 98, 99])('consensus %s is not a win yet', (consensus) => {
    expect(evaluateWinner(snapshot(roster(5, 1), { consensus }))).toBeNull();
  });

  it.each([100, 101, 5000, Number.MAX_SAFE_INTEGER])(
    'consensus %s wins for the honest side',
    (consensus) => {
      expect(evaluateWinner(snapshot(roster(5, 1), { consensus }))).toEqual(CONSENSUS);
    },
  );

  it.each([
    -1,
    -0.5,
    -Number.MIN_VALUE,
    -Number.MAX_VALUE,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('throws RangeError for consensus %s', (consensus) => {
    expect(() => evaluateWinner(snapshot(roster(5, 1), { consensus }))).toThrow(RangeError);
  });

  it('rejects an invalid consensus even when the match is already decided', () => {
    const forged = { proposals: [proposal('passed', true)] };
    expect(() => evaluateWinner(snapshot(roster(5, 1), { ...forged, consensus: Number.NaN }))).toThrow(
      RangeError,
    );
    const purged = withStatus(roster(5, 1), [playerId(0)], 'rotatedOut');
    expect(() => evaluateWinner(snapshot(purged, { consensus: -1 }))).toThrow(RangeError);
    const halted = withStatus(roster(5, 1), seats(1, 2), 'rotatedOut');
    expect(() =>
      evaluateWinner(snapshot(halted, { consensus: Number.POSITIVE_INFINITY })),
    ).toThrow(RangeError);
  });
});

describe('evaluateWinner: disconnected guardians', () => {
  it('a disconnected Byzantine is still a member, so the honest side has not won', () => {
    const guardians = withStatus(roster(5, 1), [playerId(0)], 'disconnected');
    expect(evaluateWinner(snapshot(guardians))).toBeNull();
    expect(evaluateWinner(snapshot(guardians, { consensus: 100 }))).toEqual(CONSENSUS);
  });

  it('disconnected Byzantines still count toward a halt', () => {
    const start = withStatus(roster(7, 2), seats(0, 2), 'disconnected');
    expect(evaluateWinner(snapshot(start))).toBeNull();
    expect(evaluateWinner(snapshot(withStatus(start, [playerId(2)], 'rotatedOut')))).toEqual(HALT);
  });

  it('a disconnected lone Byzantine halts 6 players after 3 honest ejections', () => {
    const start = withStatus(roster(6, 1), [playerId(0)], 'disconnected');
    expect(evaluateWinner(snapshot(withStatus(start, seats(1, 2), 'rotatedOut')))).toBeNull();
    expect(evaluateWinner(snapshot(withStatus(start, seats(1, 3), 'rotatedOut')))).toEqual(HALT);
  });

  it('disconnected honest guardians still count as members', () => {
    // 6 players minus two honest, two more disconnected: 1 Byzantine of 4
    const shrunk = withStatus(roster(6, 1), seats(1, 2), 'rotatedOut');
    expect(evaluateWinner(snapshot(withStatus(shrunk, seats(3, 2), 'disconnected')))).toBeNull();
  });
});

describe('evaluateWinner: inputs', () => {
  it('never mutates the snapshot', () => {
    const match = snapshot(withStatus(roster(7, 2), [playerId(2)], 'disconnected'), {
      proposals: [proposal('passed', true), proposal('open', true)],
      consensus: 100,
    });
    const before = structuredClone(match);
    evaluateWinner(match);
    expect(match).toEqual(before);
  });

  it('returns the same verdict on repeated calls', () => {
    const match = snapshot(withStatus(roster(5, 1), seats(1, 2), 'rotatedOut'));
    expect(evaluateWinner(match)).toEqual(evaluateWinner(match));
  });
});
