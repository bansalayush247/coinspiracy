import { describe, expect, it } from 'vitest';
import { rotateOut, setDisconnected } from '../src/guardians.js';
import {
  createProposal,
  expireProposal,
  refuseProposal,
  settleProposal,
  signProposal,
  toPublicProposal,
  type NewProposal,
  type Proposal,
  type ProposalStatus,
  type PublicProposal,
} from '../src/proposals.js';
import type { Result } from '../src/result.js';
import type { Guardian, GuardianStatus, PlayerId } from '../src/types.js';

const IDS = [
  'guardian-1',
  'guardian-2',
  'guardian-3',
  'guardian-4',
  'guardian-5',
  'guardian-6',
  'guardian-7',
  'guardian-8',
  'guardian-9',
] as const;
const [G1, G2, G3, G4, G5] = IDS;
const G7 = IDS[6];
const STRANGER = 'stranger-99';
const DEADLINE = 10;
const PUBLIC_KEYS = ['amount', 'expiresAtTick', 'id', 'refusals', 'requestedBy', 'signatures', 'status'];

// Spec threshold t and fault limit f for every match size.
const SIZES = [
  { n: 5, t: 4, f: 1 },
  { n: 6, t: 5, f: 1 },
  { n: 7, t: 5, f: 2 },
  { n: 8, t: 6, f: 2 },
  { n: 9, t: 7, f: 2 },
] as const;

const RESPONDERS = [
  { name: 'signProposal', respond: signProposal, field: 'signatures', other: 'refusals' },
  { name: 'refuseProposal', respond: refuseProposal, field: 'refusals', other: 'signatures' },
] as const;

const CLOSED = ['passed', 'rejected', 'expired'] as const;

// Ticks a buggy server could pass; every rule must throw, never fail open.
const BAD_TICKS = [
  { label: 'NaN', value: Number.NaN },
  { label: 'Infinity', value: Number.POSITIVE_INFINITY },
  { label: 'negative', value: -1 },
  { label: 'fractional', value: 1.5 },
  { label: 'unsafe (2^53)', value: 2 ** 53 },
] as const;

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.value;
}

function at<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`nothing at index ${index}`);
  return item;
}

function ids(n: number): PlayerId[] {
  return IDS.slice(0, n);
}

// Freezes the roster and each guardian so any in-place write throws.
function freezeRoster(list: Guardian[]): readonly Guardian[] {
  for (const g of list) Object.freeze(g);
  return Object.freeze(list);
}

// Freezes a proposal and its response arrays.
function freeze(p: Proposal): Proposal {
  Object.freeze(p.signatures);
  Object.freeze(p.refusals);
  return Object.freeze(p);
}

// The first n ids as honest guardians, active unless overridden.
function roster(
  n: number,
  statuses: Readonly<Record<PlayerId, GuardianStatus>> = {},
): readonly Guardian[] {
  return freezeRoster(
    ids(n).map((id): Guardian => ({ id, role: 'honest', status: statuses[id] ?? 'active' })),
  );
}

function draft(overrides: Partial<NewProposal> = {}): NewProposal {
  return {
    id: 'proposal-1',
    amount: 500,
    requestedBy: G1,
    forged: false,
    expiresAtTick: DEADLINE,
    ...overrides,
  };
}

function open(overrides: Partial<NewProposal> = {}): Proposal {
  return freeze(createProposal(draft(overrides)));
}

function signAll(p: Proposal, signers: readonly PlayerId[], guardians: readonly Guardian[]): Proposal {
  let current = p;
  for (const id of signers) current = freeze(unwrap(signProposal(current, id, guardians, 0)));
  return current;
}

function refuseAll(
  p: Proposal,
  refusers: readonly PlayerId[],
  guardians: readonly Guardian[],
): Proposal {
  let current = p;
  for (const id of refusers) current = freeze(unwrap(refuseProposal(current, id, guardians, 0)));
  return current;
}

// Closes a proposal through the rules on a full 5-member roster; G1 never responds.
function closed(status: Exclude<ProposalStatus, 'open'>, overrides: Partial<NewProposal> = {}): Proposal {
  const guardians = roster(5);
  if (status === 'passed') return signAll(open(overrides), [G2, G3, G4, G5], guardians);
  if (status === 'rejected') return refuseAll(open(overrides), [G2, G3], guardians);
  return freeze(expireProposal(signAll(open(overrides), [G2, G3, G4], guardians), DEADLINE));
}

// A response is refused if it returns an error or throws a RangeError.
function isRefused(run: () => Result<Proposal>): boolean {
  try {
    return !run().ok;
  } catch (error) {
    return error instanceof RangeError;
  }
}

describe('createProposal', () => {
  it('opens a proposal with no responses and copies the input fields', () => {
    const input = Object.freeze(draft({ forged: true }));
    expect(createProposal(input)).toStrictEqual({
      id: 'proposal-1',
      amount: 500,
      requestedBy: G1,
      forged: true,
      expiresAtTick: DEADLINE,
      signatures: [],
      refusals: [],
      status: 'open',
    });
    expect(input).toStrictEqual(draft({ forged: true }));
  });

  it.each([1, 2, 21_000, Number.MAX_SAFE_INTEGER])('accepts amount %d', (amount) => {
    expect(createProposal(draft({ amount })).amount).toBe(amount);
  });

  it.each([
    { label: 'zero', value: 0 },
    { label: 'negative zero', value: -0 },
    { label: 'negative', value: -5 },
    { label: 'fractional', value: 2.5 },
    { label: 'tiny fractional', value: Number.EPSILON },
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
    { label: '-Infinity', value: Number.NEGATIVE_INFINITY },
    { label: 'unsafe integer (2^53)', value: 2 ** 53 },
    { label: 'unsafe integer (MAX_VALUE)', value: Number.MAX_VALUE },
  ])('rejects a $label amount with RangeError', ({ value }) => {
    expect(() => createProposal(draft({ amount: value }))).toThrow(RangeError);
  });

  it.each([0, 1, DEADLINE, Number.MAX_SAFE_INTEGER])('accepts expiresAtTick %d', (tick) => {
    expect(createProposal(draft({ expiresAtTick: tick })).expiresAtTick).toBe(tick);
  });

  it.each([
    { label: 'negative', value: -1 },
    { label: 'fractional', value: 0.5 },
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
    { label: '-Infinity', value: Number.NEGATIVE_INFINITY },
    { label: 'unsafe integer (2^53)', value: 2 ** 53 },
  ])('rejects a $label expiresAtTick with RangeError', ({ value }) => {
    expect(() => createProposal(draft({ expiresAtTick: value }))).toThrow(RangeError);
  });
});

describe('toPublicProposal', () => {
  // Open proposal signed by G2 and refused by G3 on a 5-member roster.
  function answered(forged: boolean): Proposal {
    const guardians = roster(5);
    return refuseAll(signAll(open({ forged }), [G2], guardians), [G3], guardians);
  }

  it.each([true, false])('never exposes the forged flag (forged = %s)', (forged) => {
    const pub = toPublicProposal(answered(forged));
    expect(Object.keys(pub).sort()).toEqual(PUBLIC_KEYS);
    expect(Object.hasOwn(pub, 'forged')).toBe(false);
    expect('forged' in pub).toBe(false);
    expect(JSON.stringify(pub)).not.toContain('forged');
  });

  it('keeps every public field', () => {
    expect(toPublicProposal(answered(true))).toStrictEqual({
      id: 'proposal-1',
      amount: 500,
      requestedBy: G1,
      signatures: [G2],
      refusals: [G3],
      status: 'open',
      expiresAtTick: DEADLINE,
    });
  });

  it('makes a forged proposal indistinguishable from an honest one', () => {
    expect(JSON.stringify(toPublicProposal(answered(true)))).toBe(
      JSON.stringify(toPublicProposal(answered(false))),
    );
  });

  it('copies the response arrays instead of sharing them', () => {
    const p = answered(false);
    const pub = toPublicProposal(p);
    expect(pub.signatures).not.toBe(p.signatures);
    expect(pub.refusals).not.toBe(p.refusals);
    (pub.signatures as PlayerId[]).push(STRANGER);
    (pub.refusals as PlayerId[]).push(STRANGER);
    expect(p.signatures).toEqual([G2]);
    expect(p.refusals).toEqual([G3]);
  });

  it('copies only the public fields, so new server fields never leak', () => {
    const withSecret = { ...answered(true), vaultKey: 'server-only-secret' };
    const pub = toPublicProposal(withSecret);
    expect(Object.keys(pub).sort()).toEqual(PUBLIC_KEYS);
    expect(JSON.stringify(pub)).not.toContain('server-only-secret');
  });

  it.each(CLOSED)('shows a %s status but still hides forged', (status) => {
    const pub = toPublicProposal(closed(status, { forged: true }));
    expect(pub.status).toBe(status);
    expect(Object.keys(pub).sort()).toEqual(PUBLIC_KEYS);
    expect(JSON.stringify(pub)).not.toContain('forged');
  });

  it('does not mutate the proposal', () => {
    const p = answered(true);
    const before = structuredClone(p);
    toPublicProposal(p);
    expect(p).toStrictEqual(before);
  });

  it('refuses a raw Proposal where a PublicProposal is expected, at compile time', () => {
    const raw = open({ forged: true });
    // @ts-expect-error a raw Proposal carries forged and must never type-check as public
    const leaked: PublicProposal = raw;
    expect(leaked).toBe(raw);
  });
});

describe.each(SIZES)('a federation of $n guardians (threshold $t, f = $f)', ({ n, t, f }) => {
  const everyone = ids(n);

  it('passes at exactly the threshold, not one signature before', () => {
    const guardians = roster(n);
    const almost = signAll(open(), everyone.slice(0, t - 1), guardians);
    expect(almost.status).toBe('open');
    expect(almost.signatures).toEqual(everyone.slice(0, t - 1));
    const passed = unwrap(signProposal(almost, at(everyone, t - 1), guardians, 0));
    expect(passed.status).toBe('passed');
    expect(passed.signatures).toEqual(everyone.slice(0, t));
  });

  it('stays open with f refusals and is rejected by refusal f + 1', () => {
    const guardians = roster(n);
    const refused = refuseAll(open(), everyone.slice(0, f), guardians);
    expect(refused.status).toBe('open');
    const rejected = unwrap(refuseProposal(refused, at(everyone, f), guardians, 0));
    expect(rejected.status).toBe('rejected');
    expect(rejected.refusals).toHaveLength(f + 1);
  });

  it('can still pass after f refusals when every other member signs', () => {
    const guardians = roster(n);
    const refused = refuseAll(open(), everyone.slice(0, f), guardians);
    expect(signAll(refused, everyone.slice(f), guardians).status).toBe('passed');
  });

  it('lets the last undecided member decide after t - 1 signatures and f refusals', () => {
    const guardians = roster(n);
    const signed = signAll(open(), everyone.slice(0, t - 1), guardians);
    const pending = refuseAll(signed, everyone.slice(t - 1, n - 1), guardians);
    expect(pending.refusals).toHaveLength(f);
    expect(pending.status).toBe('open');
    const last = at(everyone, n - 1);
    expect(unwrap(signProposal(pending, last, guardians, 0)).status).toBe('passed');
    expect(unwrap(refuseProposal(pending, last, guardians, 0)).status).toBe('rejected');
  });

  it('counts a disconnected member, who cannot respond, toward the threshold', () => {
    const offline = at(everyone, n - 1);
    const guardians = roster(n, { [offline]: 'disconnected' });
    const almost = signAll(open(), everyone.slice(0, t - 1), guardians);
    expect(almost.status).toBe('open');
    expect(signProposal(almost, offline, guardians, 0)).toEqual({ ok: false, error: 'cannotAct' });
    expect(refuseProposal(almost, offline, guardians, 0)).toEqual({ ok: false, error: 'cannotAct' });
    expect(unwrap(signProposal(almost, at(everyone, t - 1), guardians, 0)).status).toBe('passed');
  });
});

describe.each(RESPONDERS)('$name', ({ respond, field, other }) => {
  // Four members need 3: G1-G3 active, G4 disconnected; G5 is rotated out.
  const guardians = roster(5, { [G4]: 'disconnected', [G5]: 'rotatedOut' });

  it('records an active member response and keeps every other field', () => {
    const p = open({ forged: true });
    const before = structuredClone(p);
    const rosterBefore = structuredClone(guardians);
    const next = unwrap(respond(p, G2, guardians, 0));
    expect(next).toStrictEqual({ ...before, [field]: [G2] });
    expect(next[other]).toEqual([]);
    expect(p).toStrictEqual(before);
    expect(guardians).toStrictEqual(rosterBefore);
  });

  it('lets the requester respond like any other active member', () => {
    expect(unwrap(respond(open({ requestedBy: G1 }), G1, guardians, 0))[field]).toEqual([G1]);
  });

  it.each(CLOSED)('returns notOpen once the proposal is %s', (status) => {
    const p = closed(status);
    expect(p.status).toBe(status);
    expect(respond(p, G1, roster(5), 0)).toEqual({ ok: false, error: 'notOpen' });
    expect(respond(p, G1, roster(5), DEADLINE + 1)).toEqual({ ok: false, error: 'notOpen' });
  });

  it('accepts a response one tick before the deadline', () => {
    expect(unwrap(respond(open(), G1, guardians, DEADLINE - 1))[field]).toEqual([G1]);
  });

  it.each([DEADLINE, DEADLINE + 1, Number.MAX_SAFE_INTEGER])(
    'returns expired at tick %d',
    (tick) => {
      expect(respond(open(), G1, guardians, tick)).toEqual({ ok: false, error: 'expired' });
    },
  );

  it('cannot answer a proposal that is due at tick 0', () => {
    expect(respond(open({ expiresAtTick: 0 }), G1, guardians, 0)).toEqual({
      ok: false,
      error: 'expired',
    });
  });

  it('refuses a response at a NaN tick, which is not before the deadline', () => {
    expect(isRefused(() => respond(open(), G1, guardians, Number.NaN))).toBe(true);
  });

  it.each(BAD_TICKS)('throws RangeError for a $label tick', ({ value }) => {
    expect(() => respond(open(), G1, guardians, value)).toThrow(RangeError);
  });

  it('fails closed on a proposal whose deadline was corrupted', () => {
    const corrupted = freeze({ ...open(), expiresAtTick: Number.NaN });
    expect(respond(corrupted, G1, guardians, 0)).toEqual({ ok: false, error: 'expired' });
    expect(expireProposal(corrupted, 0).status).toBe('expired');
    expect(settleProposal(corrupted, guardians, 0).status).toBe('expired');
  });

  it.each([
    { who: 'an unknown id', id: STRANGER },
    { who: 'a rotated-out guardian', id: G5 },
  ])('returns notGuardian for $who', ({ id }) => {
    expect(respond(open(), id, guardians, 0)).toEqual({ ok: false, error: 'notGuardian' });
  });

  it('returns notGuardian on an empty roster', () => {
    expect(respond(open(), G1, [], 0)).toEqual({ ok: false, error: 'notGuardian' });
  });

  it('returns cannotAct for a disconnected member until they reconnect', () => {
    expect(respond(open(), G4, guardians, 0)).toEqual({ ok: false, error: 'cannotAct' });
    const back = freezeRoster(unwrap(setDisconnected(guardians, G4, false)));
    expect(unwrap(respond(open(), G4, back, 0))[field]).toEqual([G4]);
  });

  it.each([
    { earlier: 'signed', first: signProposal },
    { earlier: 'refused', first: refuseProposal },
  ])('returns alreadyResponded when the member already $earlier', ({ first }) => {
    const once = freeze(unwrap(first(open(), G1, guardians, 0)));
    expect(once.status).toBe('open');
    expect(respond(once, G1, guardians, 1)).toEqual({ ok: false, error: 'alreadyResponded' });
  });
});

describe('settleProposal', () => {
  it('leaves an open proposal open while it can still pass', () => {
    const guardians = roster(5);
    const p = signAll(open(), [G1, G2, G3], guardians);
    expect(settleProposal(p, guardians, 0)).toStrictEqual(p);
  });

  it('stops counting a signer who is rotated out', () => {
    const guardians = roster(5);
    const p = signAll(open(), [G1, G2, G3], guardians);
    const smaller = freezeRoster(unwrap(rotateOut(guardians, G1)));
    const settled = freeze(settleProposal(p, smaller, 0));
    expect(settled.status).toBe('open');
    expect(unwrap(signProposal(settled, G4, smaller, 0)).status).toBe('passed');
  });

  it('passes existing signatures once a non-signer leaves and the threshold drops', () => {
    const guardians = roster(5);
    const p = signAll(open(), [G1, G2, G3], guardians);
    expect(settleProposal(p, freezeRoster(unwrap(rotateOut(guardians, G5))), 0).status).toBe('passed');
  });

  it.each([
    { n: 5, signed: 3, after: 'passed' },
    { n: 6, signed: 4, after: 'passed' },
    { n: 7, signed: 4, after: 'open' },
    { n: 8, signed: 5, after: 'passed' },
    { n: 9, signed: 6, after: 'passed' },
  ] as const)(
    'n = $n: $signed signatures are $after after one non-signer is rotated out',
    ({ n, signed, after }) => {
      const guardians = roster(n);
      const p = signAll(open(), ids(signed), guardians);
      expect(p.status).toBe('open');
      const smaller = freezeRoster(unwrap(rotateOut(guardians, at(ids(n), n - 1))));
      expect(settleProposal(p, smaller, 0).status).toBe(after);
    },
  );

  it('stops counting a refuser who is rotated out', () => {
    const guardians = roster(7);
    const p = refuseAll(open(), [G1, G2], guardians);
    expect(p.status).toBe('open');
    expect(settleProposal(p, freezeRoster(unwrap(rotateOut(guardians, G1))), 0).status).toBe('open');
  });

  it('rejects once a smaller federation can no longer reach the threshold', () => {
    const guardians = roster(7);
    const p = refuseAll(open(), [G1, G2], guardians);
    expect(settleProposal(p, freezeRoster(unwrap(rotateOut(guardians, G7))), 0).status).toBe(
      'rejected',
    );
  });

  it('keeps counting a signer who disconnects', () => {
    const guardians = roster(5);
    const p = signAll(open(), [G1, G2, G3], guardians);
    const offline = freezeRoster(unwrap(setDisconnected(guardians, G1, true)));
    expect(settleProposal(p, offline, 0).status).toBe('open');
    expect(unwrap(signProposal(p, G4, offline, 0)).status).toBe('passed');
  });

  it('keeps a proposal passable while disconnected members could still sign', () => {
    const guardians = roster(5, { [G4]: 'disconnected', [G5]: 'disconnected' });
    const p = signAll(refuseAll(open(), [G1], guardians), [G2, G3], guardians);
    expect(p.status).toBe('open');
    const g4Back = freezeRoster(unwrap(setDisconnected(guardians, G4, false)));
    const three = freeze(unwrap(signProposal(p, G4, g4Back, 0)));
    expect(three.status).toBe('open');
    const allBack = freezeRoster(unwrap(setDisconnected(g4Back, G5, false)));
    expect(unwrap(signProposal(three, G5, allBack, 0)).status).toBe('passed');
  });

  it('ignores signatures and refusals from ids that are not members', () => {
    const guardians = roster(5);
    const ghosts = ['ghost-0001', 'ghost-0002', 'ghost-0003'];
    const signedByGhosts = freeze({ ...open(), signatures: [...ghosts, G1] });
    expect(settleProposal(signedByGhosts, guardians, 0).status).toBe('open');
    const refusedByGhosts = freeze({ ...open(), refusals: ghosts });
    expect(settleProposal(refusedByGhosts, guardians, 0).status).toBe('open');
  });

  it('rejects an open proposal when no members are left', () => {
    const allOut = freezeRoster(
      ids(5).map((id): Guardian => ({ id, role: 'honest', status: 'rotatedOut' })),
    );
    expect(settleProposal(open(), allOut, 0).status).toBe('rejected');
    expect(settleProposal(open(), [], 0).status).toBe('rejected');
  });

  it.each(CLOSED)('never changes a %s proposal, whatever the roster', (status) => {
    const p = closed(status);
    const rosters = [
      roster(5),
      freezeRoster(unwrap(rotateOut(roster(5), G5))),
      freezeRoster(unwrap(rotateOut(roster(5), G2))),
      [],
    ];
    for (const guardians of rosters) expect(settleProposal(p, guardians, 0)).toStrictEqual(p);
  });

  it('does not mutate the proposal or the roster', () => {
    const guardians = roster(5);
    const p = signAll(open(), [G1, G2, G3], guardians);
    const smaller = freezeRoster(unwrap(rotateOut(guardians, G5)));
    const before = structuredClone(p);
    const rosterBefore = structuredClone(smaller);
    expect(settleProposal(p, smaller, 0).status).toBe('passed');
    expect(p).toStrictEqual(before);
    expect(smaller).toStrictEqual(rosterBefore);
  });

  it('expires an overdue forged proposal instead of passing it after a rotation', () => {
    const guardians = roster(5);
    const p = signAll(open({ forged: true }), [G1, G2, G3], guardians);
    const smaller = freezeRoster(unwrap(rotateOut(guardians, G5)));
    expect(settleProposal(p, smaller, DEADLINE - 1).status).toBe('passed');
    expect(settleProposal(p, smaller, DEADLINE).status).toBe('expired');
    expect(settleProposal(p, smaller, DEADLINE + 50).status).toBe('expired');
  });

  it.each(BAD_TICKS)('throws RangeError for a $label tick', ({ value }) => {
    expect(() => settleProposal(open(), roster(5), value)).toThrow(RangeError);
  });
});

describe('expireProposal', () => {
  it.each([0, DEADLINE - 1])('leaves an open proposal open at tick %d', (tick) => {
    const p = open();
    expect(expireProposal(p, tick)).toStrictEqual(p);
  });

  it.each([DEADLINE, DEADLINE + 1, Number.MAX_SAFE_INTEGER])(
    'expires an open proposal at tick %d and keeps its other fields',
    (tick) => {
      const guardians = roster(5);
      const p = refuseAll(signAll(open({ forged: true }), [G1], guardians), [G2], guardians);
      const before = structuredClone(p);
      expect(expireProposal(p, tick)).toStrictEqual({ ...before, status: 'expired' });
      expect(p).toStrictEqual(before);
    },
  );

  it.each(CLOSED)('leaves a %s proposal unchanged', (status) => {
    const p = closed(status);
    expect(expireProposal(p, DEADLINE - 1)).toStrictEqual(p);
    expect(expireProposal(p, DEADLINE + 100)).toStrictEqual(p);
  });

  it('blocks every further response once expired', () => {
    const guardians = roster(5);
    const expired = freeze(expireProposal(open(), DEADLINE));
    expect(signProposal(expired, G1, guardians, 0)).toEqual({ ok: false, error: 'notOpen' });
    expect(refuseProposal(expired, G1, guardians, 0)).toEqual({ ok: false, error: 'notOpen' });
  });

  it.each(BAD_TICKS)('throws RangeError for a $label tick', ({ value }) => {
    expect(() => expireProposal(open(), value)).toThrow(RangeError);
  });
});

describe('a forged proposal', () => {
  it('keeps its hidden flag on the server while every public view hides it', () => {
    const guardians = roster(5);
    let p = open({ forged: true });
    for (const id of [G1, G2, G3, G4]) {
      p = freeze(unwrap(signProposal(p, id, guardians, 0)));
      expect(p.forged).toBe(true);
      expect(toPublicProposal(p)).not.toHaveProperty('forged');
    }
    expect(p.status).toBe('passed');
  });
});
