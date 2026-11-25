import { describe, expect, it } from 'vitest';
import type { MatchFacts, PlayerFacts } from '@byzantine-council/shared/progression';
import { awardMatch } from '../src/profile/rewards.js';
import { MemoryProfileStore } from '../src/profile/store.js';

const T0 = Date.UTC(2026, 10, 25, 22, 0, 0);

function match(over: Partial<MatchFacts> = {}): MatchFacts {
  return { matchId: 'ceremony-1', startedAtMs: T0 - 600_000, endedAtMs: T0, players: 5, humans: 5, privateRoom: true, winner: 'honest', reason: 'consensusReached', blockHeight: 925_000, events: [], ...over };
}

function player(over: Partial<PlayerFacts> = {}): PlayerFacts {
  return {
    role: 'honest',
    finished: true,
    afkKicked: false,
    movedTiles: 80,
    tasks: { deposit: 1, ledger: 1, route: 1, watchtower: 1 },
    legitSigned: 2,
    forgedRefused: 1,
    forgedSigned: 0,
    forgedSignaturesGathered: 0,
    byzantineVotes: 1,
    misdirections: 0,
    partitionsRepaired: 0,
    partitionsRunOut: 0,
    rotatedOut: false,
    ...over,
  };
}

async function storyOf(store: MemoryProfileStore, id: string) {
  let story: unknown;
  await store.change(id, null, T0, (data) => {
    story = data.progress.story;
    return null;
  });
  return story as { ceremony?: { done: boolean; honest: boolean; marks: string[] } } | undefined;
}

describe('the signing ceremony', () => {
  it('saves how a ceremony match ended, and which side each player sat on, for act four', async () => {
    const store = new MemoryProfileStore();
    await awardMatch(
      store,
      match({ ceremony: true, winner: 'byzantine', reason: 'forgedProposalPassed' }),
      [
        { sessionId: 'a', profileId: 'p-honest', facts: player() },
        { sessionId: 'b', profileId: 'p-byz', facts: player({ role: 'byzantine' }) },
      ],
      T0,
    );
    expect((await storyOf(store, 'p-honest'))?.ceremony).toEqual({ done: true, honest: false, marks: ['satHonest'] });
    expect((await storyOf(store, 'p-byz'))?.ceremony).toEqual({ done: true, honest: false, marks: ['satByzantine'] });
  });

  it('leaves the story alone after an ordinary council match', async () => {
    const store = new MemoryProfileStore();
    await awardMatch(store, match(), [{ sessionId: 'a', profileId: 'p', facts: player() }], T0);
    expect((await storyOf(store, 'p'))?.ceremony).toBeUndefined();
  });
});
