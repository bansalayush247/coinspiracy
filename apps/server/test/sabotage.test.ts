import { describe, expect, it } from 'vitest';
import { CEREMONY_TIMING, LIVENESS_LIMIT, RELAYS, SABOTAGE_TIMING, TASK_TIMING, type SabotageTiming, type Vec2 } from '@byzantine-council/shared';
import { Match } from '../src/match.js';
import { Sabotage } from '../src/sabotage.js';

const T0 = 100_000;
const TIMING: SabotageTiming = { ...SABOTAGE_TIMING, openingMs: 1000, partitionMs: 10_000, partitionCooldownMs: 5000, repairMs: 2000, freezeMs: 4000, freezeCooldownMs: 6000 };
const [A, B] = RELAYS as [Vec2, Vec2];
const NEAR: Vec2 = { x: 15, y: 15 };
const BESIDE: Vec2 = { x: 15.8, y: 15.6 };
const FAR: Vec2 = { x: 20, y: 15 };

function started(): Sabotage {
  const s = new Sabotage(TIMING, T0);
  expect(s.partition('byzantine', T0 + 1000)).toEqual({ ok: true });
  return s;
}

describe('partitions', () => {
  it('are for Byzantines after the opening, one at a time', () => {
    const s = new Sabotage(TIMING, T0);
    expect(s.partition('honest', T0 + 2000)).toEqual({ ok: false, reason: 'cannotAct' });
    expect(s.partition('byzantine', T0 + 400)).toEqual({ ok: false, reason: 'notYet', retryInMs: 600 });
    expect(s.partition('byzantine', T0 + 1000)).toEqual({ ok: true });
    expect(s.partitioned).toBe(true);
    expect(s.partitionSecondsLeft(T0 + 1000)).toBe(10);
    expect(s.partition('byzantine', T0 + 1001)).toEqual({ ok: false, reason: 'active' });
  });

  it('are repaired only by holding both relays together long enough', () => {
    const s = started();
    s.tick(T0 + 1100, [A]);
    expect(s.relays).toBe(0b01);
    expect(s.repairPercent(T0 + 1100)).toBe(0);
    s.tick(T0 + 1200, [A, B]);
    expect(s.relays).toBe(0b11);
    s.tick(T0 + 2200, [A, B]);
    expect(s.repairPercent(T0 + 2200)).toBe(50);
    // Letting go of one relay starts the repair over.
    s.tick(T0 + 2300, [B]);
    s.tick(T0 + 2400, [A, B]);
    expect(s.tick(T0 + 4300, [A, B])).toEqual([]);
    expect(s.tick(T0 + 4400, [A, B])).toEqual([{ kind: 'repaired', by: [] }]);
    expect(s.partitioned).toBe(false);
    expect(s.outages).toBe(0);
  });

  it('cost an outage when the timer runs out, then wait out the cooldown', () => {
    const s = started();
    expect(s.tick(T0 + 10_999, [A])).toEqual([]);
    expect(s.tick(T0 + 11_000, [A])).toEqual([{ kind: 'outage', startedBy: '' }]);
    expect(s.outages).toBe(1);
    expect(s.partition('byzantine', T0 + 12_000)).toEqual({ ok: false, reason: 'cooldown', retryInMs: 4000 });
    expect(s.partition('byzantine', T0 + 16_000)).toEqual({ ok: true });
  });

  it('pause during councils', () => {
    const s = started();
    s.resume(5000);
    expect(s.tick(T0 + 15_999, [])).toEqual([]);
    expect(s.tick(T0 + 16_000, [])).toEqual([{ kind: 'outage', startedBy: '' }]);
  });
});

describe('freezing', () => {
  it('needs a Byzantine standing next to a member, on a cooldown', () => {
    const s = new Sabotage(TIMING, T0);
    expect(s.freeze('byz-player', 'byzantine', NEAR, 'target-01', BESIDE, true, T0 + 500).ok).toBe(false);
    expect(s.freeze('hon-player', 'honest', NEAR, 'target-01', BESIDE, true, T0 + 2000)).toEqual({ ok: false, reason: 'cannotAct' });
    expect(s.freeze('byz-player', 'byzantine', NEAR, 'target-01', FAR, true, T0 + 2000)).toEqual({ ok: false, reason: 'notHere' });
    expect(s.freeze('byz-player', 'byzantine', NEAR, 'byz-player', NEAR, true, T0 + 2000)).toEqual({ ok: false, reason: 'invalidTarget' });
    expect(s.freeze('byz-player', 'byzantine', NEAR, 'target-01', BESIDE, false, T0 + 2000)).toEqual({ ok: false, reason: 'invalidTarget' });
    expect(s.freeze('byz-player', 'byzantine', NEAR, 'target-01', BESIDE, true, T0 + 2000)).toEqual({ ok: true });
    expect(s.isFrozen('target-01')).toBe(true);
    expect(s.frozenSecondsLeft('target-01', T0 + 2000)).toBe(4);
    expect(s.freeze('byz-player', 'byzantine', NEAR, 'target-02', BESIDE, true, T0 + 3000)).toEqual({ ok: false, reason: 'cooldown', retryInMs: 5000 });
    expect(s.freeze('byz-other', 'byzantine', NEAR, 'target-01', BESIDE, true, T0 + 3000)).toEqual({ ok: false, reason: 'invalidTarget' });
  });

  it('thaws after the freeze time, and councils extend it', () => {
    const s = new Sabotage(TIMING, T0);
    s.freeze('byz-player', 'byzantine', NEAR, 'target-01', BESIDE, true, T0 + 2000);
    s.resume(1000);
    expect(s.tick(T0 + 6999, [])).toEqual([]);
    expect(s.tick(T0 + 7000, [])).toEqual([{ kind: 'thawed', id: 'target-01' }]);
    expect(s.isFrozen('target-01')).toBe(false);
  });

  it('tells a Byzantine when their actions are ready', () => {
    const s = new Sabotage(TIMING, T0);
    expect(s.readiness('byz-player', T0)).toEqual({ partitionInMs: 1000, freezeInMs: 1000 });
    s.freeze('byz-player', 'byzantine', NEAR, 'target-01', BESIDE, true, T0 + 2000);
    expect(s.readiness('byz-player', T0 + 2000)).toEqual({ partitionInMs: 0, freezeInMs: 6000 });
  });
});

describe('the match under sabotage', () => {
  it('a frozen guardian is still a member but cannot sign', () => {
    const m = new Match(['player-aa', 'player-bb', 'player-cc', 'player-dd', 'player-ee'], TASK_TIMING, { ...CEREMONY_TIMING, firstProposalMs: 0 }, T0, undefined, TIMING);
    const byz = m.byzantines()[0] ?? '';
    const victim = ['player-aa', 'player-bb', 'player-cc'].find((id) => id !== byz) ?? '';
    m.ceremony.tick(T0, 0, m.guardians(), () => undefined);
    expect(m.sabotage.freeze(byz, 'byzantine', NEAR, victim, BESIDE, true, T0 + 2000)).toEqual({ ok: true });
    expect(m.guardians().find((g) => g.id === victim)?.status).toBe('disconnected');
    expect(m.ceremony.respond(victim, '1', true, m.guardians(), 1)).toEqual({ ok: false, reason: 'cannotAct' });
    expect(m.openTask(victim, 'ledger', { x: 19.5, y: 8.5 }, T0 + 2000, 900_000)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('enough outages lose the match on liveness', () => {
    const m = new Match(['player-aa', 'player-bb', 'player-cc', 'player-dd', 'player-ee'], TASK_TIMING, CEREMONY_TIMING, T0, undefined, { ...TIMING, partitionCooldownMs: 0 });
    let now = T0 + 1000;
    for (let i = 0; i < LIVENESS_LIMIT; i++) {
      expect(m.sabotage.partition('byzantine', now)).toEqual({ ok: true });
      now += TIMING.partitionMs;
      m.sabotage.tick(now, []);
      expect(m.winner()).toEqual(i + 1 < LIVENESS_LIMIT ? null : { side: 'byzantine', reason: 'livenessLost' });
    }
  });
});
