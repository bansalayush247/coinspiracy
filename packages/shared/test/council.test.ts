import { describe, expect, it } from 'vitest';
import {
  castVote,
  openCouncil,
  SKIP,
  tallyVotes,
  type Council,
  type Tally,
  type VoteTarget,
} from '../src/council.js';
import { rotateOut, setDisconnected } from '../src/guardians.js';
import type { Result } from '../src/result.js';
import { PlayerIdSchema } from '../src/schemas.js';
import type { Guardian, GuardianStatus, PlayerId, Role } from '../src/types.js';
import { evaluateWinner } from '../src/win.js';

type Ballot = readonly [voter: PlayerId, target: VoteTarget];

const NOW = 100;
const DURATION = 30;
const CLOSES = NOW + DURATION;

// Ticks a buggy server could pass; every rule must throw, never fail open.
const BAD_TICKS = [
  { label: 'NaN', value: Number.NaN },
  { label: 'Infinity', value: Number.POSITIVE_INFINITY },
  { label: 'negative', value: -1 },
  { label: 'fractional', value: 1.5 },
  { label: 'unsafe (2^53)', value: 2 ** 53 },
] as const;

const NOVA = 'guardian-nova';
const VEX = 'guardian-vex';
const ORIN = 'guardian-orin';
const KAI = 'guardian-kai';
const MIRA = 'guardian-mira';
const JUNO = 'guardian-juno';
const SOL = 'guardian-sol';
const STRANGER = 'guardian-stranger';
const GHOST = 'guardian-ghost';

function guardian(id: PlayerId, role: Role = 'honest', status: GuardianStatus = 'active'): Guardian {
  return { id, role, status };
}

// Deep-frozen copy, so any write throws.
function freezeRoster(guardians: readonly Guardian[]): readonly Guardian[] {
  return Object.freeze(guardians.map((g) => Object.freeze({ ...g })));
}

// Copy of a map whose writers throw.
function lockedMap<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  const fail = {
    value: (): never => {
      throw new TypeError('votes map was mutated');
    },
  };
  return Object.freeze(
    Object.defineProperties(new Map(source), { set: fail, delete: fail, clear: fail }),
  );
}

function freezeCouncil(council: Council): Council {
  return Object.freeze({ ...council, votes: lockedMap(council.votes) });
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.value;
}

function playerId(seat: number): PlayerId {
  return `player-${String(seat).padStart(2, '0')}`;
}

function activeRoster(size: number): readonly Guardian[] {
  return freezeRoster(Array.from({ length: size }, (_, seat) => guardian(playerId(seat))));
}

// The design's six guardians plus one already rotated out.
const ROSTER = freezeRoster([
  guardian(NOVA),
  guardian(VEX, 'byzantine'),
  guardian(ORIN),
  guardian(KAI, 'honest', 'disconnected'),
  guardian(MIRA),
  guardian(JUNO),
  guardian(SOL, 'honest', 'rotatedOut'),
]);

function openFor(guardians: readonly Guardian[] = ROSTER, caller: PlayerId = NOVA): Council {
  return freezeCouncil(unwrap(openCouncil(caller, guardians, NOW, DURATION)));
}

function castAll(
  council: Council,
  guardians: readonly Guardian[],
  ballots: readonly Ballot[],
  nowTick = NOW,
): Council {
  let current = council;
  for (const [voter, target] of ballots) {
    current = freezeCouncil(unwrap(castVote(current, voter, target, guardians, nowTick)));
  }
  return current;
}

function rotate(guardians: readonly Guardian[], ...ids: PlayerId[]): readonly Guardian[] {
  let current = guardians;
  for (const id of ids) current = freezeRoster(unwrap(rotateOut(current, id)));
  return current;
}

function disconnect(guardians: readonly Guardian[], id: PlayerId): readonly Guardian[] {
  return freezeRoster(unwrap(setDisconnected(guardians, id, true)));
}

function reconnect(guardians: readonly Guardian[], id: PlayerId): readonly Guardian[] {
  return freezeRoster(unwrap(setDisconnected(guardians, id, false)));
}

function tallyOf(
  counts: readonly (readonly [PlayerId, number])[],
  skips: number,
  ejected: PlayerId | null,
): Tally {
  return { counts: new Map(counts), skips, ejected };
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

describe('SKIP', () => {
  it('is the literal "skip" and can never be a valid player id', () => {
    expect(SKIP).toBe('skip');
    expect(PlayerIdSchema.safeParse(SKIP).success).toBe(false);
  });
});

describe('openCouncil', () => {
  it('lets an active member call a council that closes durationTicks from now', () => {
    expect(openCouncil(NOVA, ROSTER, NOW, DURATION)).toEqual({
      ok: true,
      value: { calledBy: NOVA, closesAtTick: CLOSES, votes: new Map() },
    });
  });

  it('lets an active Byzantine call a council', () => {
    expect(unwrap(openCouncil(VEX, ROSTER, NOW, DURATION)).calledBy).toBe(VEX);
  });

  it.each([
    { who: 'a disconnected member', caller: KAI, error: 'cannotAct' },
    { who: 'a rotated-out guardian', caller: SOL, error: 'notGuardian' },
    { who: 'an unknown id', caller: STRANGER, error: 'notGuardian' },
    { who: 'an empty id', caller: '', error: 'notGuardian' },
  ])('refuses $who with $error', ({ caller, error }) => {
    expect(openCouncil(caller, ROSTER, NOW, DURATION)).toEqual({ ok: false, error });
  });

  it('refuses a member who disconnected, and accepts them again once reconnected', () => {
    const offline = disconnect(ROSTER, ORIN);
    expect(openCouncil(ORIN, offline, NOW, DURATION)).toEqual({ ok: false, error: 'cannotAct' });
    expect(openCouncil(ORIN, reconnect(offline, ORIN), NOW, DURATION).ok).toBe(true);
  });

  it.each([
    { nowTick: 0, durationTicks: 1, closesAtTick: 1 },
    { nowTick: 100, durationTicks: 30, closesAtTick: 130 },
    { nowTick: 7, durationTicks: 600, closesAtTick: 607 },
    { nowTick: 0, durationTicks: Number.MAX_SAFE_INTEGER, closesAtTick: Number.MAX_SAFE_INTEGER },
  ])(
    'opened at tick $nowTick for $durationTicks ticks closes at $closesAtTick',
    ({ nowTick, durationTicks, closesAtTick }) => {
      expect(unwrap(openCouncil(NOVA, ROSTER, nowTick, durationTicks)).closesAtTick).toBe(
        closesAtTick,
      );
    },
  );

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('throws RangeError for durationTicks %s', (durationTicks) => {
    expect(() => openCouncil(NOVA, ROSTER, NOW, durationTicks)).toThrow(RangeError);
  });

  it.each(BAD_TICKS)('throws RangeError for a $label nowTick', ({ value }) => {
    expect(() => openCouncil(NOVA, ROSTER, value, DURATION)).toThrow(RangeError);
  });

  it('throws RangeError when the closing tick would not be a safe integer', () => {
    expect(() => openCouncil(NOVA, ROSTER, Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
  });

  it('accepts a deep-frozen roster and leaves it unchanged', () => {
    const before = structuredClone(ROSTER);
    unwrap(openCouncil(NOVA, ROSTER, NOW, DURATION));
    expect(ROSTER).toEqual(before);
  });
});

describe('castVote', () => {
  it('records a vote for another member and keeps the council settings', () => {
    expect(unwrap(castVote(openFor(), NOVA, VEX, ROSTER, NOW))).toEqual({
      calledBy: NOVA,
      closesAtTick: CLOSES,
      votes: new Map([[NOVA, VEX]]),
    });
  });

  it('records a skip', () => {
    expect(unwrap(castVote(openFor(), ORIN, SKIP, ROSTER, NOW)).votes).toEqual(
      new Map([[ORIN, SKIP]]),
    );
  });

  it('lets an active Byzantine vote', () => {
    expect(unwrap(castVote(openFor(), VEX, NOVA, ROSTER, NOW)).votes).toEqual(
      new Map([[VEX, NOVA]]),
    );
  });

  it('lets the caller and other members each cast one ballot', () => {
    const ballots: Ballot[] = [
      [NOVA, VEX],
      [VEX, NOVA],
      [ORIN, SKIP],
      [MIRA, VEX],
      [JUNO, KAI],
    ];
    expect(castAll(openFor(), ROSTER, ballots).votes).toEqual(new Map(ballots));
  });

  it.each([
    { why: 'the voter is not a guardian', voter: STRANGER, target: VEX, error: 'notGuardian' },
    { why: 'an unknown voter skips', voter: STRANGER, target: SKIP, error: 'notGuardian' },
    { why: 'the voter was rotated out', voter: SOL, target: VEX, error: 'notGuardian' },
    { why: 'a rotated-out voter skips', voter: SOL, target: SKIP, error: 'notGuardian' },
    { why: 'the voter is disconnected', voter: KAI, target: VEX, error: 'cannotAct' },
    { why: 'a disconnected voter skips', voter: KAI, target: SKIP, error: 'cannotAct' },
    { why: 'the voter targets themselves', voter: NOVA, target: NOVA, error: 'selfVote' },
    { why: 'a Byzantine targets themselves', voter: VEX, target: VEX, error: 'selfVote' },
    { why: 'the target is not a guardian', voter: NOVA, target: STRANGER, error: 'invalidTarget' },
    { why: 'the target was rotated out', voter: NOVA, target: SOL, error: 'invalidTarget' },
    { why: 'the target is an empty id', voter: NOVA, target: '', error: 'invalidTarget' },
    { why: 'the target only resembles skip', voter: NOVA, target: 'SKIP', error: 'invalidTarget' },
  ])('returns $error when $why', ({ voter, target, error }) => {
    expect(castVote(openFor(), voter, target, ROSTER, NOW)).toEqual({ ok: false, error });
  });

  it.each([
    { first: VEX, second: VEX },
    { first: VEX, second: ORIN },
    { first: VEX, second: SKIP },
    { first: SKIP, second: VEX },
    { first: SKIP, second: SKIP },
  ])('returns alreadyVoted on a second ballot ($first, then $second)', ({ first, second }) => {
    const council = castAll(openFor(), ROSTER, [[NOVA, first]]);
    expect(castVote(council, NOVA, second, ROSTER, NOW)).toEqual({
      ok: false,
      error: 'alreadyVoted',
    });
  });

  it('accepts votes from the opening tick up to one tick before closesAtTick', () => {
    expect(castVote(openFor(), NOVA, VEX, ROSTER, NOW).ok).toBe(true);
    expect(castVote(openFor(), NOVA, VEX, ROSTER, CLOSES - 1).ok).toBe(true);
  });

  it.each([
    { tick: CLOSES, target: VEX },
    { tick: CLOSES, target: SKIP },
    { tick: CLOSES + 1, target: VEX },
    { tick: CLOSES + 1000, target: SKIP },
  ])('returns votingClosed at tick $tick for target $target', ({ tick, target }) => {
    expect(castVote(openFor(), NOVA, target, ROSTER, tick)).toEqual({
      ok: false,
      error: 'votingClosed',
    });
  });

  it.each(BAD_TICKS)('throws RangeError for a $label nowTick', ({ value }) => {
    expect(() => castVote(openFor(), NOVA, VEX, ROSTER, value)).toThrow(RangeError);
  });

  it('fails closed on a council whose closing tick was corrupted', () => {
    const corrupted: Council = { ...openFor(), closesAtTick: Number.NaN };
    expect(castVote(corrupted, NOVA, VEX, ROSTER, NOW)).toEqual({
      ok: false,
      error: 'votingClosed',
    });
  });

  it('closes a one-tick council on the very next tick', () => {
    const council = freezeCouncil(unwrap(openCouncil(NOVA, ROSTER, NOW, 1)));
    expect(castVote(council, ORIN, VEX, ROSTER, NOW).ok).toBe(true);
    expect(castVote(council, ORIN, VEX, ROSTER, NOW + 1)).toEqual({
      ok: false,
      error: 'votingClosed',
    });
  });

  it('lets members vote for a disconnected member', () => {
    expect(unwrap(castVote(openFor(), NOVA, KAI, ROSTER, NOW)).votes.get(NOVA)).toBe(KAI);
  });

  it('stops a member who disconnects mid-council until they reconnect', () => {
    const council = openFor();
    const offline = disconnect(ROSTER, ORIN);
    expect(castVote(council, ORIN, VEX, offline, NOW)).toEqual({ ok: false, error: 'cannotAct' });
    expect(castVote(council, NOVA, ORIN, offline, NOW).ok).toBe(true);
    expect(castVote(council, ORIN, VEX, reconnect(offline, ORIN), NOW).ok).toBe(true);
  });

  it('treats a guardian rotated out mid-council as neither voter nor target', () => {
    const council = openFor();
    const after = rotate(ROSTER, VEX);
    expect(castVote(council, VEX, NOVA, after, NOW)).toEqual({ ok: false, error: 'notGuardian' });
    expect(castVote(council, NOVA, VEX, after, NOW)).toEqual({ ok: false, error: 'invalidTarget' });
  });

  it('returns a new council and never mutates the one it was given', () => {
    const council = castAll(openFor(), ROSTER, [[NOVA, VEX]]);
    const next = unwrap(castVote(council, ORIN, SKIP, ROSTER, NOW));
    expect(next).not.toBe(council);
    expect(next.votes).not.toBe(council.votes);
    expect(next.votes).toEqual(
      new Map([
        [NOVA, VEX],
        [ORIN, SKIP],
      ]),
    );
    expect(council.votes).toEqual(new Map([[NOVA, VEX]]));
    expect(council.closesAtTick).toBe(CLOSES);
  });

  it('leaves the council and roster untouched when a vote is refused', () => {
    const council = castAll(openFor(), ROSTER, [[NOVA, VEX]]);
    const rosterBefore = structuredClone(ROSTER);
    const refused: Ballot[] = [
      [NOVA, ORIN],
      [KAI, VEX],
      [ORIN, ORIN],
      [ORIN, SOL],
      [STRANGER, VEX],
    ];
    for (const [voter, target] of refused) {
      expect(castVote(council, voter, target, ROSTER, NOW).ok).toBe(false);
    }
    expect(castVote(council, ORIN, VEX, ROSTER, CLOSES).ok).toBe(false);
    expect(council.votes).toEqual(new Map([[NOVA, VEX]]));
    expect(ROSTER).toEqual(rosterBefore);
  });
});

describe('tallyVotes', () => {
  it('ejects nobody from an empty council', () => {
    expect(tallyVotes(openFor(), ROSTER)).toEqual(tallyOf([], 0, null));
  });

  it('ejects nobody when every voter skips', () => {
    const council = castAll(openFor(), ROSTER, [
      [NOVA, SKIP],
      [VEX, SKIP],
      [ORIN, SKIP],
      [MIRA, SKIP],
      [JUNO, SKIP],
    ]);
    expect(tallyVotes(council, ROSTER)).toEqual(tallyOf([], 5, null));
  });

  it('ejects a clear winner', () => {
    const council = castAll(openFor(), ROSTER, [
      [NOVA, VEX],
      [ORIN, VEX],
      [MIRA, VEX],
      [VEX, MIRA],
      [JUNO, SKIP],
    ]);
    expect(tallyVotes(council, ROSTER)).toEqual(
      tallyOf(
        [
          [VEX, 3],
          [MIRA, 1],
        ],
        1,
        VEX,
      ),
    );
  });

  it('ejects on a single vote when nobody skips', () => {
    const council = castAll(openFor(), ROSTER, [[NOVA, VEX]]);
    expect(tallyVotes(council, ROSTER)).toEqual(tallyOf([[VEX, 1]], 0, VEX));
  });

  it('ejects nobody on a two-way tie for the top', () => {
    const council = castAll(openFor(), ROSTER, [
      [NOVA, VEX],
      [ORIN, VEX],
      [VEX, MIRA],
      [JUNO, MIRA],
      [MIRA, ORIN],
    ]);
    expect(tallyVotes(council, ROSTER)).toEqual(
      tallyOf(
        [
          [VEX, 2],
          [MIRA, 2],
          [ORIN, 1],
        ],
        0,
        null,
      ),
    );
  });

  it('ejects nobody on a three-way tie', () => {
    const council = castAll(openFor(), ROSTER, [
      [NOVA, VEX],
      [VEX, ORIN],
      [ORIN, MIRA],
    ]);
    expect(tallyVotes(council, ROSTER).ejected).toBeNull();
  });

  it('ejects the unique leader even when lower targets tie', () => {
    const council = castAll(openFor(), ROSTER, [
      [VEX, ORIN],
      [JUNO, MIRA],
      [NOVA, VEX],
      [ORIN, VEX],
      [MIRA, VEX],
    ]);
    expect(tallyVotes(council, ROSTER)).toEqual(
      tallyOf(
        [
          [ORIN, 1],
          [MIRA, 1],
          [VEX, 3],
        ],
        0,
        VEX,
      ),
    );
  });

  it('ejects nobody when the top count only equals the skips', () => {
    const council = castAll(openFor(), ROSTER, [
      [NOVA, VEX],
      [ORIN, VEX],
      [MIRA, SKIP],
      [JUNO, SKIP],
    ]);
    expect(tallyVotes(council, ROSTER)).toEqual(tallyOf([[VEX, 2]], 2, null));
  });

  it('ejects when the top count beats the skips by one', () => {
    const council = castAll(openFor(), ROSTER, [
      [NOVA, VEX],
      [ORIN, VEX],
      [MIRA, VEX],
      [JUNO, SKIP],
      [VEX, SKIP],
    ]);
    expect(tallyVotes(council, ROSTER)).toEqual(tallyOf([[VEX, 3]], 2, VEX));
  });

  it('ignores votes and skips from guardians rotated out before the tally', () => {
    const council = castAll(openFor(), ROSTER, [
      [NOVA, VEX],
      [ORIN, VEX],
      [MIRA, SKIP],
      [JUNO, SKIP],
    ]);
    expect(tallyVotes(council, ROSTER).ejected).toBeNull();
    expect(tallyVotes(council, rotate(ROSTER, JUNO))).toEqual(tallyOf([[VEX, 2]], 1, VEX));
    expect(tallyVotes(council, rotate(ROSTER, ORIN))).toEqual(tallyOf([[VEX, 1]], 2, null));
    expect(tallyVotes(council, rotate(ROSTER, NOVA, ORIN))).toEqual(tallyOf([], 2, null));
  });

  it('ignores votes for a target rotated out before the tally', () => {
    const council = castAll(openFor(), ROSTER, [
      [NOVA, VEX],
      [ORIN, VEX],
      [VEX, KAI],
      [MIRA, KAI],
      [JUNO, KAI],
    ]);
    expect(tallyVotes(council, ROSTER)).toEqual(
      tallyOf(
        [
          [VEX, 2],
          [KAI, 3],
        ],
        0,
        KAI,
      ),
    );
    const tally = tallyVotes(council, rotate(ROSTER, KAI));
    expect(tally.counts.has(KAI)).toBe(false);
    expect(tally).toEqual(tallyOf([[VEX, 2]], 0, VEX));
  });

  it('still counts ballots from members who disconnected after voting', () => {
    const council = castAll(openFor(), ROSTER, [
      [NOVA, VEX],
      [ORIN, VEX],
      [JUNO, SKIP],
    ]);
    const later = disconnect(disconnect(ROSTER, NOVA), JUNO);
    expect(tallyVotes(council, later)).toEqual(tallyOf([[VEX, 2]], 1, VEX));
  });

  it('can eject a disconnected member', () => {
    const council = castAll(openFor(), ROSTER, [
      [NOVA, KAI],
      [ORIN, KAI],
      [VEX, SKIP],
    ]);
    expect(tallyVotes(council, ROSTER)).toEqual(tallyOf([[KAI, 2]], 1, KAI));
  });

  it('ignores ballots from, or for, ids that are not guardians', () => {
    const council = freezeCouncil({
      calledBy: NOVA,
      closesAtTick: CLOSES,
      votes: new Map([
        [STRANGER, SKIP],
        [GHOST, SKIP],
        [SOL, SKIP],
        [NOVA, STRANGER],
        [ORIN, VEX],
      ]),
    });
    expect(tallyVotes(council, ROSTER)).toEqual(tallyOf([[VEX, 1]], 0, VEX));
  });

  it('never mutates the council or roster', () => {
    const council = castAll(openFor(), ROSTER, [
      [NOVA, VEX],
      [ORIN, SKIP],
    ]);
    const rosterBefore = structuredClone(ROSTER);
    tallyVotes(council, ROSTER);
    expect(council.votes).toEqual(
      new Map([
        [NOVA, VEX],
        [ORIN, SKIP],
      ]),
    );
    expect(ROSTER).toEqual(rosterBefore);
  });

  const seven = activeRoster(7);
  const orderCases: { label: string; ballots: Ballot[]; expected: Tally }[] = [
    {
      label: 'a tie at the top',
      ballots: [
        [playerId(0), playerId(6)],
        [playerId(1), playerId(6)],
        [playerId(2), playerId(5)],
        [playerId(3), playerId(5)],
        [playerId(4), SKIP],
        [playerId(5), playerId(4)],
      ],
      expected: tallyOf(
        [
          [playerId(6), 2],
          [playerId(5), 2],
          [playerId(4), 1],
        ],
        1,
        null,
      ),
    },
    {
      label: 'a unique leader over a tie below it',
      ballots: [
        [playerId(0), playerId(6)],
        [playerId(1), playerId(6)],
        [playerId(2), playerId(5)],
        [playerId(3), playerId(4)],
        [playerId(5), SKIP],
      ],
      expected: tallyOf(
        [
          [playerId(6), 2],
          [playerId(5), 1],
          [playerId(4), 1],
        ],
        1,
        playerId(6),
      ),
    },
  ];

  it.each(orderCases)('gives the same result for every ballot order: $label', ({ ballots, expected }) => {
    const council = openFor(seven, playerId(0));
    for (const order of permutations(ballots)) {
      expect(tallyVotes(castAll(council, seven, order), seven)).toEqual(expected);
    }
  });
});

describe('tallyVotes across match sizes', () => {
  // Smallest vote count that wins when every other ballot skips.
  const majorities = [
    { players: 5, majority: 3 },
    { players: 6, majority: 4 },
    { players: 7, majority: 4 },
    { players: 8, majority: 5 },
    { players: 9, majority: 5 },
  ];
  const skipCases = majorities.flatMap(({ players, majority }) =>
    Array.from({ length: players }, (_, against) => ({
      players,
      against,
      skips: players - against,
      ejects: against >= majority,
    })),
  );

  it.each(skipCases)(
    '$players players, $against against one and $skips skips: ejects=$ejects',
    ({ players, against, skips, ejects }) => {
      const guardians = activeRoster(players);
      const suspect = playerId(0);
      const ballots: Ballot[] = [[suspect, SKIP]];
      for (let seat = 1; seat < players; seat += 1) {
        ballots.push([playerId(seat), seat <= against ? suspect : SKIP]);
      }
      const tally = tallyVotes(castAll(openFor(guardians, suspect), guardians, ballots), guardians);
      expect(tally).toEqual(
        tallyOf(against === 0 ? [] : [[suspect, against]], skips, ejects ? suspect : null),
      );
    },
  );

  // Two suspects vote for each other; everyone else alternates between them.
  it.each([
    { players: 5, forA: 3, forB: 2 },
    { players: 6, forA: 3, forB: 3 },
    { players: 7, forA: 4, forB: 3 },
    { players: 8, forA: 4, forB: 4 },
    { players: 9, forA: 5, forB: 4 },
  ])('$players players split $forA to $forB between two suspects', ({ players, forA, forB }) => {
    const guardians = activeRoster(players);
    const a = playerId(0);
    const b = playerId(1);
    const ballots: Ballot[] = [
      [a, b],
      [b, a],
    ];
    for (let seat = 2; seat < players; seat += 1) {
      ballots.push([playerId(seat), seat % 2 === 0 ? a : b]);
    }
    const tally = tallyVotes(castAll(openFor(guardians, a), guardians, ballots), guardians);
    expect(tally).toEqual(
      tallyOf(
        [
          [a, forA],
          [b, forB],
        ],
        0,
        forA > forB ? a : null,
      ),
    );
  });
});

describe('design scenario: the council that catches Vex', () => {
  const guardians = freezeRoster([
    guardian(NOVA),
    guardian(VEX, 'byzantine'),
    guardian(ORIN),
    guardian(KAI, 'honest', 'disconnected'),
    guardian(MIRA),
    guardian(JUNO),
  ]);

  it('uses six guardians with valid player ids', () => {
    expect(guardians).toHaveLength(6);
    for (const { id } of guardians) expect(PlayerIdSchema.safeParse(id).success).toBe(true);
  });

  it('ejects Vex with 4 votes to 1 skip, and rotating him out wins for the honest side', () => {
    const opened = freezeCouncil(unwrap(openCouncil(NOVA, guardians, NOW, DURATION)));
    const council = castAll(
      opened,
      guardians,
      [
        [NOVA, VEX],
        [ORIN, VEX],
        [MIRA, VEX],
        [JUNO, VEX],
        [VEX, SKIP],
      ],
      NOW + 5,
    );
    expect(castVote(council, KAI, VEX, guardians, NOW + 6)).toEqual({
      ok: false,
      error: 'cannotAct',
    });
    expect(tallyVotes(council, guardians)).toEqual(tallyOf([[VEX, 4]], 1, VEX));

    const after = rotate(guardians, VEX);
    expect(evaluateWinner({ guardians: after, proposals: [], consensus: 0 })).toEqual({
      side: 'honest',
      reason: 'allByzantineRotatedOut',
    });
  });
});
