import { describe, expect, it } from 'vitest';
import {
  CEREMONY_TIMING,
  LIVENESS_LIMIT,
  TASK_TIMING,
  msToTicks,
  stationCenter,
  threshold,
  type CeremonyTiming,
  type Guardian,
  type RandomSource,
  type Vec2,
} from '@byzantine-council/shared';
import { Ceremony, RECENT_CLOSED } from '../src/ceremony.js';
import { Match } from '../src/match.js';

const IDS = ['player-aa', 'player-bb', 'player-cc', 'player-dd', 'player-ee'];
const T0 = 1_000_000;
const HALL: Vec2 = { x: 3.5, y: 15.5 };
const DESK = stationCenter('ledger');
const PLAZA: Vec2 = { x: 15, y: 15 };
const TIMING: CeremonyTiming = { ...CEREMONY_TIMING, firstProposalMs: 1000, spawnMinMs: 5000, spawnMaxMs: 5000, ttlMs: 10_000, maxOpen: 3, forgeCooldownMs: 4000, auditMs: 3000, auditCooldownMs: 6000 };
const TTL_TICKS = msToTicks(TIMING.ttlMs);
const ZERO: RandomSource = { int: () => 0 };

// The first id is Byzantine; everyone else honest.
function guardians(ids: readonly string[] = IDS): Guardian[] {
  return ids.map((id, i) => ({ id, role: i === 0 ? 'byzantine' : 'honest', status: 'active' }));
}

function ceremony(): Ceremony {
  return new Ceremony(IDS, TIMING, ZERO, T0);
}

const nowhere = (): Vec2 | undefined => PLAZA;

describe('legitimate withdrawals', () => {
  it('appear only after the calm opening, then on the spawn timer', () => {
    const c = ceremony();
    c.tick(T0 + 999, 0, guardians(), nowhere);
    expect(c.proposals).toHaveLength(0);
    c.tick(T0 + 1000, 1, guardians(), nowhere);
    expect(c.proposals).toHaveLength(1);
    expect(c.proposals[0]).toMatchObject({ id: '1', forged: false, status: 'open', expiresAtTick: 1 + TTL_TICKS });
    c.tick(T0 + 5999, 2, guardians(), nowhere);
    expect(c.proposals).toHaveLength(1);
    c.tick(T0 + 6000, 3, guardians(), nowhere);
    expect(c.proposals).toHaveLength(2);
  });

  it('never keep more than maxOpen open', () => {
    const c = ceremony();
    for (let i = 0; i < 10; i++) c.tick(T0 + 1000 + i * 5000, i, guardians(), nowhere);
    expect(c.proposals.filter((p) => p.status === 'open')).toHaveLength(TIMING.maxOpen);
  });

  it('pass at the threshold and expire after the deadline', () => {
    const c = ceremony();
    c.tick(T0 + 1000, 0, guardians(), nowhere);
    const needed = threshold(IDS.length);
    for (const id of IDS.slice(1, needed)) expect(c.respond(id, '1', true, guardians(), 1).ok).toBe(true);
    expect(c.proposals[0]?.status).toBe('open');
    const last = c.respond(IDS[needed] ?? '', '1', true, guardians(), 1);
    expect(last.ok && last.proposal.status).toBe('passed');

    c.tick(T0 + 6000, 2, guardians(), nowhere);
    const events = c.tick(T0 + 6001, 2 + TTL_TICKS, guardians(), nowhere);
    expect(events.closed.map((p) => [p.id, p.status])).toEqual([['2', 'expired']]);
  });

  it('refuse double answers and answers to closed or unknown proposals', () => {
    const c = ceremony();
    c.tick(T0 + 1000, 0, guardians(), nowhere);
    expect(c.respond('player-bb', '1', true, guardians(), 1).ok).toBe(true);
    expect(c.respond('player-bb', '1', false, guardians(), 1)).toEqual({ ok: false, reason: 'alreadyResponded' });
    expect(c.respond('player-bb', '99', true, guardians(), 1)).toEqual({ ok: false, reason: 'notOpen' });
    expect(c.respond('stranger-x', '1', true, guardians(), 1)).toEqual({ ok: false, reason: 'cannotAct' });
    expect(c.respond('player-cc', '1', true, guardians(), 1 + TTL_TICKS)).toEqual({ ok: false, reason: 'notOpen' });
  });

  it('keep only a few closed ones on screen', () => {
    const c = ceremony();
    for (let i = 0; i < 12; i++) c.tick(T0 + 1000 + i * 5000, i * TTL_TICKS, guardians(), nowhere);
    const visible = c.visible();
    expect(visible.filter((p) => p.status !== 'open').length).toBeLessThanOrEqual(RECENT_CLOSED);
    expect(visible.filter((p) => p.status === 'open').length).toBeGreaterThan(0);
  });
});

describe('forging', () => {
  it('is for Byzantines in the Signing Hall, after the opening, on a cooldown', () => {
    const c = ceremony();
    expect(c.forge('player-aa', 'byzantine', HALL, T0 + 500, 0)).toEqual({ ok: false, reason: 'notYet' });
    expect(c.forge('player-bb', 'honest', HALL, T0 + 2000, 0)).toEqual({ ok: false, reason: 'cannotAct' });
    expect(c.forge('player-aa', 'byzantine', PLAZA, T0 + 2000, 0)).toEqual({ ok: false, reason: 'notHere' });
    const first = c.forge('player-aa', 'byzantine', HALL, T0 + 2000, 0);
    expect(first).toEqual({ ok: true, proposalId: '1' });
    expect(c.proposals[0]).toMatchObject({ forged: true, requestedBy: 'player-aa' });
    expect(c.forgedOpen()).toEqual(['1']);
    expect(c.forge('player-aa', 'byzantine', HALL, T0 + 3000, 0)).toEqual({ ok: false, reason: 'cooldown', retryInMs: 3000 });
  });

  it('shares the id counter with real withdrawals so ids give nothing away', () => {
    const c = ceremony();
    c.tick(T0 + 1000, 0, guardians(), nowhere);
    const forged = c.forge('player-aa', 'byzantine', HALL, T0 + 1500, 1);
    expect(forged).toEqual({ ok: true, proposalId: '2' });
  });

  it('respects the open limit', () => {
    const c = ceremony();
    for (let i = 0; i < 3; i++) c.tick(T0 + 1000 + i * 5000, i, guardians(), nowhere);
    expect(c.forge('player-aa', 'byzantine', HALL, T0 + 20_000, 4)).toEqual({ ok: false, reason: 'tooMany' });
  });
});

describe('audits', () => {
  function withProposal(): Ceremony {
    const c = ceremony();
    c.forge('player-aa', 'byzantine', HALL, T0 + 1000, 0);
    return c;
  }

  it('reveal the truth to the auditor after standing at the desk long enough', () => {
    const c = withProposal();
    expect(c.startAudit('player-bb', '1', PLAZA, T0 + 1000)).toEqual({ ok: false, reason: 'notHere' });
    expect(c.startAudit('player-bb', '1', DESK, T0 + 1000)).toEqual({ ok: true });
    expect(c.startAudit('player-bb', '1', DESK, T0 + 1001)).toEqual({ ok: false, reason: 'busy' });
    const at = (): Vec2 => DESK;
    expect(c.tick(T0 + 3999, 1, guardians(), at).audits).toEqual([]);
    expect(c.tick(T0 + 4000, 2, guardians(), at).audits).toEqual([{ id: 'player-bb', status: 'done', proposalId: '1', forged: true }]);
    expect(c.startAudit('player-bb', '1', DESK, T0 + 20_000)).toEqual({ ok: false, reason: 'audited' });
  });

  it('are cancelled by walking away, then wait out the cooldown only after a finished audit', () => {
    const c = withProposal();
    c.startAudit('player-cc', '1', DESK, T0 + 1000);
    expect(c.tick(T0 + 2000, 1, guardians(), () => PLAZA).audits).toEqual([{ id: 'player-cc', status: 'cancelled', proposalId: '1' }]);
    expect(c.startAudit('player-cc', '1', DESK, T0 + 2001)).toEqual({ ok: true });
    c.tick(T0 + 5001, 2, guardians(), () => DESK);
    c.tick(T0 + 6000, 3, guardians(), nowhere);
    const second = c.proposals.find((p) => p.id === '2');
    expect(second).toBeDefined();
    expect(c.startAudit('player-cc', '2', DESK, T0 + 6000)).toEqual({ ok: false, reason: 'cooldown', retryInMs: 5001 });
  });

  it('are cancelled when the proposal closes or the auditor drops', () => {
    const c = withProposal();
    c.startAudit('player-dd', '1', DESK, T0 + 1000);
    expect(c.cancelAudit('player-dd')).toBe('1');
    expect(c.cancelAudit('player-dd')).toBeNull();
    c.startAudit('player-dd', '1', DESK, T0 + 1000);
    const events = c.tick(T0 + 1500, TTL_TICKS + 5, guardians(), () => DESK);
    expect(events.audits).toEqual([{ id: 'player-dd', status: 'cancelled', proposalId: '1' }]);
  });

  it('refuse closed proposals', () => {
    const c = withProposal();
    c.tick(T0 + 1000, TTL_TICKS + 1, guardians(), nowhere);
    expect(c.startAudit('player-bb', '1', DESK, T0 + 1000)).toEqual({ ok: false, reason: 'notOpen' });
  });
});

describe('match rules with ceremonies', () => {
  // Five players, so one Byzantine; the ids the RNG makes Byzantine vary, so look them up.
  function match(): { m: Match; byz: string; honest: string[] } {
    const m = new Match(IDS, TASK_TIMING, TIMING, T0);
    const byz = IDS.find((id) => m.role(id) === 'byzantine') ?? '';
    return { m, byz, honest: IDS.filter((id) => id !== byz) };
  }

  it('gives the Byzantines the win when a forgery collects enough signatures', () => {
    const { m, byz, honest } = match();
    const forged = m.ceremony.forge(byz, 'byzantine', HALL, T0 + 1000, 0);
    if (!forged.ok) throw new Error('forge failed');
    const needed = threshold(IDS.length);
    m.ceremony.respond(byz, forged.proposalId, true, m.guardians(), 1);
    for (const id of honest.slice(0, needed - 1)) m.ceremony.respond(id, forged.proposalId, true, m.guardians(), 1);
    expect(m.winner()).toEqual({ side: 'byzantine', reason: 'forgedProposalPassed' });
  });

  it('gives the Byzantines the win when enough real withdrawals fail', () => {
    const { m } = match();
    let tick = 0;
    for (let i = 0; i < LIVENESS_LIMIT; i++) {
      m.ceremony.tick(T0 + 1000 + i * 5000, tick, m.guardians(), nowhere);
      tick += TTL_TICKS;
      m.ceremony.tick(T0 + 1001 + i * 5000, tick, m.guardians(), nowhere);
      expect(m.winner()).toEqual(i + 1 < LIVENESS_LIMIT ? null : { side: 'byzantine', reason: 'livenessLost' });
    }
  });

  it('lets honest guardians block a forgery without losing anything', () => {
    const { m, byz, honest } = match();
    const forged = m.ceremony.forge(byz, 'byzantine', HALL, T0 + 1000, 0);
    if (!forged.ok) throw new Error('forge failed');
    for (const id of honest.slice(0, 2)) m.ceremony.respond(id, forged.proposalId, false, m.guardians(), 1);
    expect(m.ceremony.proposals[0]?.status).toBe('rejected');
    expect(m.winner()).toBeNull();
  });

  it('re-settles proposals against the remaining members when a guardian leaves', () => {
    const { m, honest } = match();
    m.ceremony.tick(T0 + 1000, 0, m.guardians(), nowhere);
    const needed = threshold(IDS.length);
    for (const id of honest.slice(0, needed - 1)) m.ceremony.respond(id, '1', true, m.guardians(), 1);
    expect(m.ceremony.proposals[0]?.status).toBe('open');
    const leaver = IDS.find((id) => !m.ceremony.proposals[0]?.signatures.includes(id)) ?? '';
    m.leave(leaver);
    m.ceremony.tick(T0 + 1001, 2, m.guardians(), nowhere);
    expect(m.ceremony.proposals[0]?.status).toBe('passed');
  });
});
