import { describe, expect, it } from 'vitest';
import { CLIENT_MESSAGE_PAYLOADS, RELAYS, TASK_TIMING } from '@byzantine-council/shared';
import { BYZANTINE_SOCIAL, HONEST_SOCIAL, byzantineStrategy, honestStrategy, type BotView, type ProposalSeen } from '../../src/bots/strategy.js';
import { HUMANLIKE_PROFILE } from '../../src/bots/profile.js';
import { seededRandom } from '../../src/bots/random.js';

const SELF = 'self-0001';
const A = 'player-aa';
const B = 'player-bb';
const C = 'player-cc';

function view(over: Partial<BotView> = {}): BotView {
  return {
    selfId: SELF,
    position: { x: 15.5, y: 15.5 },
    role: 'honest',
    phase: 'playing',
    todo: [],
    others: [A, B, C].map((id, i) => ({ id, x: 15 + i, y: 16, active: true, fellow: false })),
    now: 1000,
    suspicion: new Map(),
    partition: 0,
    relays: 0,
    forgeAt: Infinity,
    partitionAt: Infinity,
    freezeAt: Infinity,
    canCallCouncil: false,
    ...over,
  };
}

const proposal = (over: Partial<ProposalSeen> = {}): ProposalSeen => ({ id: 'p1', signers: [], forged: null, warned: false, vouched: false, ...over });

function tally<T>(n: number, fn: (seed: number) => T): Map<T, number> {
  const out = new Map<T, number>();
  for (let i = 0; i < n; i++) {
    const v = fn(i);
    out.set(v, (out.get(v) ?? 0) + 1);
  }
  return out;
}

describe('honest bots', () => {
  it('vote out the guardian caught signing a forgery, and skip without evidence', () => {
    const suspicion = new Map([[B, 4]]);
    expect(HONEST_SOCIAL.onCouncil(view({ suspicion }), [A, B, C], seededRandom(1))).toBe(B);
    expect(HONEST_SOCIAL.onCouncil(view(), [A, B, C], seededRandom(1))).toBe('skip');
  });

  it('mostly refuse withdrawals someone warned about, and mostly sign the rest', () => {
    const warned = tally(200, (s) => HONEST_SOCIAL.onProposal(view(), proposal({ warned: true }), seededRandom(s)));
    const plain = tally(200, (s) => HONEST_SOCIAL.onProposal(view(), proposal(), seededRandom(s)));
    expect(warned.get('refuse') ?? 0).toBeGreaterThan(120);
    expect(plain.get('sign') ?? 0).toBeGreaterThan(120);
  });

  it('name their top suspect in a council', () => {
    expect(HONEST_SOCIAL.onChat(view({ suspicion: new Map([[C, 2]]) }), 'councilOpened', seededRandom(3))).toEqual({ phrase: 'suspect', playerId: C });
  });

  it('head for a free relay during a partition, spreading between the two', () => {
    const s = honestStrategy(HUMANLIKE_PROFILE, TASK_TIMING);
    const plans = Array.from({ length: 100 }, (_, seed) => s.next(view({ partition: 30, relays: 0b01, selfId: `bot-${String(seed)}xxxx` }), seededRandom(seed)));
    const relayVisits = plans.filter((p) => p.kind === 'visit' && p.lingerMs === 20_000);
    expect(relayVisits.length).toBeGreaterThan(50);
    // Relay 0 is already held, so every bot that goes heads for relay 1.
    for (const p of relayVisits) if (p.kind === 'visit') expect(p.to).toEqual(RELAYS[1]);
  });
});

describe('Byzantine bots', () => {
  it('always sign their own forgeries and never vote for a fellow', () => {
    for (let s = 0; s < 50; s++) expect(BYZANTINE_SOCIAL.onProposal(view(), proposal({ forged: true }), seededRandom(s))).toBe('sign');
    const others = [
      { id: A, x: 15, y: 16, active: true, fellow: true },
      { id: B, x: 16, y: 16, active: true, fellow: false },
    ];
    for (let s = 0; s < 50; s++) expect(BYZANTINE_SOCIAL.onCouncil(view({ role: 'byzantine', others }), [A, B], seededRandom(s))).not.toBe(A);
  });

  it('sabotage only when the server says it is ready', () => {
    const s = byzantineStrategy(HUMANLIKE_PROFILE, TASK_TIMING);
    const idle = tally(100, (seed) => s.next(view({ role: 'byzantine' }), seededRandom(seed)).kind);
    expect(idle.has('now')).toBe(false);
    const ready = tally(100, (seed) => s.next(view({ role: 'byzantine', partitionAt: 0 }), seededRandom(seed)).kind);
    expect(ready.get('now') ?? 0).toBeGreaterThan(10);
  });

  it('only produce chat lines the server accepts', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (const social of [HONEST_SOCIAL, BYZANTINE_SOCIAL]) {
        const line = social.onChat(view({ suspicion: new Map([[A, seed % 3]]) }), 'councilOpened', seededRandom(seed));
        if (line !== null) expect(CLIENT_MESSAGE_PAYLOADS.quickChat.safeParse({ chat: line }).success).toBe(true);
      }
    }
  });
});
