import { describe, expect, it } from 'vitest';
import { CEREMONY_TIMING, COUNCIL_SEAL, COUNCIL_TIMING, SERVER_TICK_HZ, SKIP, TASK_TIMING, msToTicks, type CouncilTiming, type Guardian, type Vec2 } from '@byzantine-council/shared';
import { Ceremony } from '../src/ceremony.js';
import { Match } from '../src/match.js';
import { MeetingDesk } from '../src/meeting.js';

const IDS = ['player-aa', 'player-bb', 'player-cc', 'player-dd', 'player-ee'];
const T0 = 500_000;
const TIMING: CouncilTiming = { ...COUNCIL_TIMING, openingMs: 1000, votingMs: 10_000, resultMs: 2000, cooldownMs: 5000, perPlayer: 1, chatPerCouncil: 2, chatGapMs: 500 };
const VOTE_TICKS = msToTicks(TIMING.votingMs);
const AWAY: Vec2 = { x: 3.5, y: 16.5 };

function guardians(out: readonly string[] = []): Guardian[] {
  return IDS.map((id, i) => ({ id, role: i === 0 ? 'byzantine' : 'honest', status: out.includes(id) ? 'rotatedOut' : 'active' }));
}

function opened(): MeetingDesk {
  const desk = new MeetingDesk(TIMING, T0);
  expect(desk.call('player-bb', COUNCIL_SEAL, guardians(), T0 + 1000, 0)).toEqual({ ok: true });
  return desk;
}

describe('calling a council', () => {
  it('needs the seal, waits out the opening, and allows one call per guardian', () => {
    const desk = new MeetingDesk(TIMING, T0);
    expect(desk.call('player-bb', AWAY, guardians(), T0 + 2000, 0)).toEqual({ ok: false, reason: 'notHere' });
    expect(desk.call('player-bb', COUNCIL_SEAL, guardians(), T0 + 400, 0)).toEqual({ ok: false, reason: 'cooldown', retryInMs: 600 });
    expect(desk.call('player-bb', COUNCIL_SEAL, guardians(), T0 + 1000, 0)).toEqual({ ok: true });
    expect(desk.active).toBe(true);
    expect(desk.calledBy).toBe('player-bb');
    expect(desk.call('player-cc', COUNCIL_SEAL, guardians(), T0 + 1001, 0)).toEqual({ ok: false, reason: 'notYet' });
    // Finish this council, then the caller is used up and others wait out the cooldown.
    for (const id of IDS) desk.vote(id, SKIP, guardians(), 1);
    desk.tick(T0 + 1100, 2, guardians(), IDS);
    expect(desk.tick(T0 + 3100, 3, guardians(), IDS)).toEqual({ kind: 'ended', pausedTicks: 3, pausedMs: 2100 });
    expect(desk.call('player-bb', COUNCIL_SEAL, guardians(), T0 + 20_000, 4)).toEqual({ ok: false, reason: 'usedUp' });
    expect(desk.call('player-cc', COUNCIL_SEAL, guardians(), T0 + 4000, 4)).toEqual({ ok: false, reason: 'cooldown', retryInMs: 4100 });
    expect(desk.call('player-cc', COUNCIL_SEAL, guardians(), T0 + 8100, 4)).toEqual({ ok: true });
    expect(desk.number).toBe(2);
  });

  it('is refused to a guardian whose key was rotated out', () => {
    const desk = new MeetingDesk(TIMING, T0);
    expect(desk.call('player-bb', COUNCIL_SEAL, guardians(['player-bb']), T0 + 1000, 0)).toEqual({ ok: false, reason: 'cannotAct' });
  });
});

describe('voting', () => {
  it('keeps choices private until everyone voted, then ejects the top target', () => {
    const desk = opened();
    for (const id of ['player-bb', 'player-cc', 'player-dd']) expect(desk.vote(id, 'player-aa', guardians(), 1)).toEqual({ ok: true });
    expect(desk.vote('player-aa', 'player-bb', guardians(), 1)).toEqual({ ok: true });
    expect(desk.voted().sort()).toEqual(['player-aa', 'player-bb', 'player-cc', 'player-dd']);
    expect(desk.tick(T0 + 1500, 2, guardians(), IDS)).toBeNull();
    desk.vote('player-ee', SKIP, guardians(), 2);
    const event = desk.tick(T0 + 1600, 3, guardians(), IDS);
    expect(event?.kind).toBe('tallied');
    if (event?.kind !== 'tallied') return;
    expect(event.tally.ejected).toBe('player-aa');
    expect(event.ballots.get('player-ee')).toBe(SKIP);
    expect(desk.stage).toBe('result');
  });

  it('closes at the deadline and ejects nobody on a tie or when skips win', () => {
    const tie = opened();
    tie.vote('player-bb', 'player-aa', guardians(), 1);
    tie.vote('player-aa', 'player-bb', guardians(), 1);
    expect(tie.tick(T0 + 2000, VOTE_TICKS - 1, guardians(), IDS)).toBeNull();
    const event = tie.tick(T0 + 2000, VOTE_TICKS, guardians(), IDS);
    expect(event?.kind === 'tallied' && event.tally.ejected).toBeNull();

    const skips = opened();
    skips.vote('player-bb', 'player-aa', guardians(), 1);
    for (const id of ['player-cc', 'player-dd']) skips.vote(id, SKIP, guardians(), 1);
    const skipped = skips.tick(T0 + 2000, VOTE_TICKS, guardians(), IDS);
    expect(skipped?.kind === 'tallied' && skipped.tally.ejected).toBeNull();
  });

  it('refuses double votes, self votes, unknown targets and late votes', () => {
    const desk = opened();
    expect(desk.vote('player-bb', 'player-bb', guardians(), 1)).toEqual({ ok: false, reason: 'selfVote' });
    expect(desk.vote('player-bb', 'stranger-01', guardians(), 1)).toEqual({ ok: false, reason: 'invalidTarget' });
    expect(desk.vote('player-bb', SKIP, guardians(), 1)).toEqual({ ok: true });
    expect(desk.vote('player-bb', 'player-cc', guardians(), 1)).toEqual({ ok: false, reason: 'alreadyVoted' });
    expect(desk.vote('player-cc', SKIP, guardians(), VOTE_TICKS)).toEqual({ ok: false, reason: 'votingClosed' });
    expect(desk.vote('player-dd', SKIP, guardians(['player-dd']), 1)).toEqual({ ok: false, reason: 'cannotAct' });
  });

  it('only counts voters who can still vote when deciding to close early', () => {
    const desk = opened();
    for (const id of IDS.slice(0, 4)) desk.vote(id, SKIP, guardians(), 1);
    // The fifth guardian is disconnected, so the four present are everyone.
    expect(desk.tick(T0 + 1500, 2, guardians(), IDS.slice(0, 4))?.kind).toBe('tallied');
  });
});

describe('quick chat limits', () => {
  it('paces lines and caps them per council', () => {
    const desk = opened();
    expect(desk.chat('player-bb', T0 + 1000)).toEqual({ ok: true });
    expect(desk.chat('player-bb', T0 + 1200)).toEqual({ ok: false, reason: 'chatLimit', retryInMs: 300 });
    expect(desk.chat('player-bb', T0 + 1500)).toEqual({ ok: true });
    expect(desk.chat('player-bb', T0 + 3000)).toEqual({ ok: false, reason: 'chatLimit' });
    expect(desk.chat('player-cc', T0 + 3000)).toEqual({ ok: true });
  });
});

describe('the match during councils', () => {
  it('pauses proposal deadlines and the spawn timer for the length of the council', () => {
    const c = new Ceremony(IDS, { ...CEREMONY_TIMING, firstProposalMs: 0, spawnMinMs: 10_000, spawnMaxMs: 10_000 }, { int: () => 0 }, T0);
    c.tick(T0, 0, guardians(), () => undefined);
    const before = c.proposals[0]?.expiresAtTick ?? 0;
    c.resume(5 * SERVER_TICK_HZ, 5000);
    expect(c.proposals[0]?.expiresAtTick).toBe(before + 5 * SERVER_TICK_HZ);
    c.tick(T0 + 14_999, 1, guardians(), () => undefined);
    expect(c.proposals).toHaveLength(1);
    c.tick(T0 + 15_000, 2, guardians(), () => undefined);
    expect(c.proposals).toHaveLength(2);
  });

  it('rotating out the only Byzantine wins it for the honest guardians', () => {
    const m = new Match(IDS, TASK_TIMING);
    const byz = IDS.find((id) => m.role(id) === 'byzantine') ?? '';
    expect(m.rotateOut(byz)).toBe(true);
    expect(m.rotateOut(byz)).toBe(false);
    expect(m.isMember(byz)).toBe(false);
    expect(m.winner()).toEqual({ side: 'honest', reason: 'allByzantineRotatedOut' });
  });

  it('rotating out honest guardians can halt the federation', () => {
    const m = new Match(IDS, TASK_TIMING);
    const honest = IDS.filter((id) => m.role(id) === 'honest');
    m.rotateOut(honest[0] ?? '');
    expect(m.winner()).toBeNull();
    m.rotateOut(honest[1] ?? '');
    expect(m.winner()).toEqual({ side: 'byzantine', reason: 'federationHalted' });
  });

  it('a rotated-out guardian can no longer open tasks', () => {
    const m = new Match(IDS, TASK_TIMING);
    const [id = ''] = IDS;
    m.rotateOut(id);
    expect(m.openTask(id, 'ledger', { x: 19.5, y: 8.5 }, T0, 900_000)).toEqual({ ok: false, reason: 'unavailable' });
  });
});
