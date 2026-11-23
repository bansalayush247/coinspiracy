import { describe, expect, it } from 'vitest';
import {
  canAct,
  findGuardian,
  isMember,
  members,
  rotateOut,
  setDisconnected,
} from '../src/guardians.js';
import type { Result } from '../src/result.js';
import type { Guardian, GuardianStatus, PlayerId, Role } from '../src/types.js';

const ALICE = 'alice-0001';
const BOB = 'bobby-0002';
const CAROL = 'carol-0003';
const DAVE = 'davey-0004';
const ERIN = 'erinn-0005';
const STRANGER = 'stranger-99';
const IDS = Array.from({ length: 9 }, (_, i) => `guardian-${i + 1}`);

const STATUSES = [
  { status: 'active', member: true, acts: true },
  { status: 'disconnected', member: true, acts: false },
  { status: 'rotatedOut', member: false, acts: false },
] as const;

function guardian(id: PlayerId, status: GuardianStatus = 'active', role: Role = 'honest'): Guardian {
  return { id, role, status };
}

// Freezes the roster and each guardian so any in-place write throws.
function freezeAll(list: Guardian[]): readonly Guardian[] {
  for (const g of list) Object.freeze(g);
  return Object.freeze(list);
}

// Alice active, Bob disconnected, Carol rotated out, Dave and Erin Byzantine.
function mixedRoster(): readonly Guardian[] {
  return freezeAll([
    guardian(ALICE),
    guardian(BOB, 'disconnected'),
    guardian(CAROL, 'rotatedOut'),
    guardian(DAVE, 'active', 'byzantine'),
    guardian(ERIN, 'disconnected', 'byzantine'),
  ]);
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.value;
}

function mustFind(roster: readonly Guardian[], id: PlayerId): Guardian {
  const found = findGuardian(roster, id);
  if (found === undefined) throw new Error(`missing guardian ${id}`);
  return found;
}

// Expected roster after one guardian's status changes.
function withStatus(roster: readonly Guardian[], id: PlayerId, status: GuardianStatus): Guardian[] {
  return roster.map((g) => (g.id === id ? { ...g, status } : { ...g }));
}

describe('isMember and canAct', () => {
  describe.each(['honest', 'byzantine'] as const)('for a %s guardian', (role) => {
    it.each(STATUSES)('$status: member $member, can act $acts', ({ status, member, acts }) => {
      const g = Object.freeze(guardian(ALICE, status, role));
      expect(isMember(g)).toBe(member);
      expect(canAct(g)).toBe(acts);
    });
  });
});

describe('findGuardian', () => {
  it('returns the guardian object with that id', () => {
    const roster = mixedRoster();
    expect(findGuardian(roster, DAVE)).toBe(roster[3]);
    expect(findGuardian(roster, DAVE)).toStrictEqual({ id: DAVE, role: 'byzantine', status: 'active' });
  });

  it.each([
    { status: 'disconnected', id: BOB },
    { status: 'rotatedOut', id: CAROL },
  ])('finds a $status guardian too', ({ status, id }) => {
    expect(findGuardian(mixedRoster(), id)?.status).toBe(status);
  });

  it('returns undefined for an unknown id', () => {
    expect(findGuardian(mixedRoster(), STRANGER)).toBeUndefined();
  });

  it('matches ids exactly', () => {
    expect(findGuardian(mixedRoster(), ALICE.toUpperCase())).toBeUndefined();
    expect(findGuardian(mixedRoster(), ALICE.slice(0, -1))).toBeUndefined();
    expect(findGuardian(mixedRoster(), `${ALICE} `)).toBeUndefined();
  });

  it('returns undefined on an empty roster', () => {
    expect(findGuardian([], ALICE)).toBeUndefined();
  });
});

describe('members', () => {
  it('keeps active and disconnected guardians in order and drops rotated-out ones', () => {
    expect(members(mixedRoster()).map((g) => g.id)).toEqual([ALICE, BOB, DAVE, ERIN]);
  });

  it('returns a new array even when nobody is rotated out', () => {
    const roster = freezeAll([guardian(ALICE), guardian(BOB, 'disconnected')]);
    const result = members(roster);
    expect(result).not.toBe(roster);
    expect(result).toStrictEqual([...roster]);
  });

  it('is empty for an empty roster or when everyone is rotated out', () => {
    expect(members([])).toEqual([]);
    expect(members(freezeAll([guardian(ALICE, 'rotatedOut'), guardian(BOB, 'rotatedOut')]))).toEqual(
      [],
    );
  });

  it('does not mutate the roster', () => {
    const roster = mixedRoster();
    const before = structuredClone(roster);
    members(roster);
    expect(roster).toStrictEqual(before);
  });
});

describe('rotateOut', () => {
  it.each([
    { from: 'an active', id: DAVE },
    { from: 'a disconnected', id: BOB },
  ])('rotates out $from member and leaves everyone else untouched', ({ id }) => {
    const roster = mixedRoster();
    const before = structuredClone(roster);
    const next = unwrap(rotateOut(roster, id));
    expect(next).not.toBe(roster);
    expect(next).toStrictEqual(withStatus(before, id, 'rotatedOut'));
    expect(roster).toStrictEqual(before);
  });

  it('keeps the guardian on the roster but out of the members and unable to act', () => {
    const next = unwrap(rotateOut(mixedRoster(), ALICE));
    expect(next).toHaveLength(5);
    expect(isMember(mustFind(next, ALICE))).toBe(false);
    expect(canAct(mustFind(next, ALICE))).toBe(false);
    expect(members(next).map((g) => g.id)).toEqual([BOB, DAVE, ERIN]);
  });

  it.each([
    { what: 'an unknown id', id: STRANGER },
    { what: 'an already rotated-out guardian', id: CAROL },
  ])('returns invalidTarget for $what without touching the roster', ({ id }) => {
    const roster = mixedRoster();
    const before = structuredClone(roster);
    expect(rotateOut(roster, id)).toEqual({ ok: false, error: 'invalidTarget' });
    expect(roster).toStrictEqual(before);
  });

  it('returns invalidTarget on an empty roster', () => {
    expect(rotateOut([], ALICE)).toEqual({ ok: false, error: 'invalidTarget' });
  });

  it('cannot rotate out the same guardian twice', () => {
    const once = freezeAll(unwrap(rotateOut(mixedRoster(), ALICE)));
    expect(rotateOut(once, ALICE)).toEqual({ ok: false, error: 'invalidTarget' });
  });

  it.each([5, 6, 7, 8, 9])('in a federation of %i, rotating out anyone leaves the rest in order', (n) => {
    const everyone = IDS.slice(0, n);
    const roster = freezeAll(everyone.map((id) => guardian(id)));
    for (const id of everyone) {
      const next = unwrap(rotateOut(roster, id));
      expect(next).toHaveLength(n);
      expect(mustFind(next, id).status).toBe('rotatedOut');
      expect(members(next).map((g) => g.id)).toEqual(everyone.filter((other) => other !== id));
    }
  });
});

describe('setDisconnected', () => {
  it('disconnects an active member, who stays a member but cannot act', () => {
    const roster = mixedRoster();
    const before = structuredClone(roster);
    const next = unwrap(setDisconnected(roster, ALICE, true));
    expect(next).toStrictEqual(withStatus(before, ALICE, 'disconnected'));
    expect(isMember(mustFind(next, ALICE))).toBe(true);
    expect(canAct(mustFind(next, ALICE))).toBe(false);
    expect(roster).toStrictEqual(before);
  });

  it('brings a disconnected member back to active with the same role', () => {
    const roster = mixedRoster();
    const before = structuredClone(roster);
    const next = unwrap(setDisconnected(roster, ERIN, false));
    expect(next).toStrictEqual(withStatus(before, ERIN, 'active'));
    expect(canAct(mustFind(next, ERIN))).toBe(true);
    expect(mustFind(next, ERIN).role).toBe('byzantine');
    expect(roster).toStrictEqual(before);
  });

  it('round-trips active to disconnected and back', () => {
    const roster = mixedRoster();
    const away = freezeAll(unwrap(setDisconnected(roster, DAVE, true)));
    expect(unwrap(setDisconnected(away, DAVE, false))).toStrictEqual(structuredClone(roster));
  });

  it.each([
    { id: ALICE, disconnected: false, status: 'active' },
    { id: BOB, disconnected: true, status: 'disconnected' },
  ])('succeeds without change when $id is already $status', ({ id, disconnected, status }) => {
    const roster = mixedRoster();
    const next = unwrap(setDisconnected(roster, id, disconnected));
    expect(next).not.toBe(roster);
    expect(next).toStrictEqual(structuredClone(roster));
    expect(mustFind(next, id).status).toBe(status);
  });

  it.each([
    { what: 'an unknown id', id: STRANGER, disconnected: true },
    { what: 'an unknown id', id: STRANGER, disconnected: false },
    { what: 'a rotated-out guardian', id: CAROL, disconnected: true },
    { what: 'a rotated-out guardian', id: CAROL, disconnected: false },
  ])(
    'returns invalidTarget for $what (disconnected = $disconnected)',
    ({ id, disconnected }) => {
      const roster = mixedRoster();
      const before = structuredClone(roster);
      expect(setDisconnected(roster, id, disconnected)).toEqual({ ok: false, error: 'invalidTarget' });
      expect(roster).toStrictEqual(before);
    },
  );

  it('never brings a rotated-out guardian back', () => {
    const roster = freezeAll(unwrap(rotateOut(mixedRoster(), ALICE)));
    expect(setDisconnected(roster, ALICE, false)).toEqual({ ok: false, error: 'invalidTarget' });
    expect(setDisconnected(roster, ALICE, true)).toEqual({ ok: false, error: 'invalidTarget' });
    expect(mustFind(roster, ALICE).status).toBe('rotatedOut');
  });
});
