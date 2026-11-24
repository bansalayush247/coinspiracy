// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { balanceOf, DEFAULT_LOOK, walletFromAmount } from '@byzantine-council/shared/economy';
import { AwardSchema, applyMatch, newProgress, toProgressView, type MatchFacts, type PlayerFacts } from '@byzantine-council/shared/progression';
import page from '../index.html?raw';
import { ProfileApi, type ProfileSummary } from '../src/profile/api.js';
import { ProgressPage } from '../src/profile/progressPage.js';
import { RewardsPanel } from '../src/profile/rewards.js';
import { SeasonBanner } from '../src/profile/season.js';
import { WorldMap, islandPreviewEnabled } from '../src/profile/worldMap.js';
import { Coach } from '../src/ui/coach.js';

function loadPage(): void {
  const doc = new DOMParser().parseFromString(page, 'text/html');
  for (const script of doc.querySelectorAll('script')) script.remove();
  document.body.replaceChildren(...Array.from(doc.body.childNodes, (n) => document.importNode(n, true)));
}

const T0 = Date.UTC(2026, 10, 23, 12);
const MATCH: MatchFacts = { matchId: 'm-1', startedAtMs: T0 - 600_000, endedAtMs: T0, players: 5, humans: 5, privateRoom: true, winner: 'honest', reason: 'consensusReached', blockHeight: 925_000, events: [] };
const PLAYER: PlayerFacts = { role: 'honest', finished: true, afkKicked: false, movedTiles: 50, tasks: { deposit: 1, ledger: 1, route: 1, watchtower: 1 }, legitSigned: 1, forgedRefused: 1, forgedSigned: 0, forgedSignaturesGathered: 0, byzantineVotes: 0, misdirections: 0, partitionsRepaired: 0, partitionsRunOut: 0, rotatedOut: false };

function summary(): ProfileSummary {
  const progress = applyMatch(newProgress(T0), MATCH, PLAYER).progress;
  const wallet = walletFromAmount(812);
  if (!wallet.ok) throw new Error('wallet');
  return { balance: balanceOf(wallet.value), notes: [...wallet.value], look: DEFAULT_LOOK, owned: ['outfit:genesis'], progress: toProgressView(progress, T0) };
}

beforeEach(() => {
  loadPage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rewards panel', () => {
  it('lists XP lines, the rank-up, unlocks, seals and the next goal', () => {
    const { award } = applyMatch(newProgress(T0), MATCH, PLAYER);
    const panel = new RewardsPanel();
    panel.show(AwardSchema.parse(award));
    const text = document.getElementById('rewards')?.textContent ?? '';
    expect(document.getElementById('rewards')?.hidden).toBe(false);
    expect(text).toContain('Finished the match');
    expect(text).toContain('Rank up!');
    expect(text).toContain('Genesis Robe');
    expect(text).toContain('Seal earned: First Shift');
    expect(text).toMatch(/XP to Rank \d+:/);
    panel.hide();
    expect(document.getElementById('rewards')?.hidden).toBe(true);
  });

  it('explains why a match paid nothing', () => {
    const { award } = applyMatch(newProgress(T0), MATCH, { ...PLAYER, finished: false });
    new RewardsPanel().show(AwardSchema.parse(award));
    expect(document.getElementById('rewards-body')?.textContent).toContain('You left before the end');
  });
});

describe('progress page', () => {
  it('shows each tab from the profile', () => {
    const p = new ProgressPage();
    p.setProfile(summary());
    p.open();
    expect(document.getElementById('progress-title')?.textContent).toMatch(/^Rank \d+ · /);
    expect(document.getElementById('progress-body')?.textContent).toContain('Rank Road');
    document.querySelector<HTMLButtonElement>('.progress-tabs [data-tab="seals"]')?.click();
    expect(document.querySelectorAll('.seal-card.done').length).toBeGreaterThan(0);
    // Only the next locked step shows past what is visible.
    expect(document.querySelectorAll('.seal-card').length).toBeLessThan(55);
    document.querySelector<HTMLButtonElement>('.progress-tabs [data-tab="quests"]')?.click();
    expect(document.querySelectorAll('.quest').length).toBe(3);
    document.querySelector<HTMLButtonElement>('.progress-tabs [data-tab="epoch"]')?.click();
    expect(document.getElementById('progress-body')?.textContent).toContain('Epoch');
  });

  it('sends a quest swap', () => {
    const p = new ProgressPage();
    const swapped: string[] = [];
    p.onReroll = (q) => swapped.push(q);
    p.setProfile(summary());
    p.open();
    document.querySelector<HTMLButtonElement>('.progress-tabs [data-tab="quests"]')?.click();
    document.querySelector<HTMLButtonElement>('.quest .reroll')?.click();
    expect(swapped).toHaveLength(1);
  });
});

describe('world map', () => {
  it('shows Mint Island open and later islands with how to open them', () => {
    const map = new WorldMap();
    map.setProfile(summary());
    expect(document.getElementById('world')?.hidden).toBe(true);
    expect(document.getElementById('open-world')?.hidden).toBe(false);
    map.open();
    expect(document.getElementById('world')?.hidden).toBe(false);
    const islands = document.querySelectorAll('.world-svg .island');
    expect(islands.length).toBe(6);
    expect(document.querySelectorAll('.world-svg .island.open').length).toBeGreaterThanOrEqual(1);
    expect(document.getElementById('world-card')?.textContent).toContain('Mint Island');
    const locked = Array.from(islands).find((g) => !g.classList.contains('open'));
    locked?.dispatchEvent(new Event('click'));
    expect(document.getElementById('world-card')?.textContent).toMatch(/Opens at Rank|Coming soon/);
  });

  it('opens every finished island in Explorer preview without changing progress', () => {
    expect(islandPreviewEnabled('?explore=all')).toBe(true);
    expect(islandPreviewEnabled('?explore=1')).toBe(false);
    const visits: string[] = [];
    const map = new WorldMap(true);
    map.onVisit = (id) => visits.push(id);
    map.setProfile(summary());
    map.open();
    const islands = document.querySelectorAll('.world-svg .island');
    expect(islands).toHaveLength(6);
    expect(document.querySelectorAll('.world-svg .island.open')).toHaveLength(6);
    expect(document.getElementById('world-title')?.textContent).toContain('Explorer preview');
    const beach = Array.from(islands).find((node) => node.getAttribute('aria-label')?.startsWith('Beach Town:'));
    beach?.dispatchEvent(new Event('click'));
    expect(document.getElementById('world-card')?.textContent).toContain('progression locks ignored');
    document.querySelector<HTMLButtonElement>('.world-visit')?.click();
    expect(visits).toEqual(['beach']);
  });
});

describe('event islands', () => {
  it('rise on the map while a seasonal event is live', () => {
    const map = new WorldMap();
    map.setProfile(summary());
    map.open();
    expect(document.querySelectorAll('.world-svg .island.event').length).toBe(0);
    map.setSeason({ height: 1_050_000, live: true, featured: { id: 'halving', title: 'Halving Party', headline: 'Halving! The block reward is now 1.5625 bitcoin.', blurb: 'Every 210,000 blocks the reward halves.', colors: ['#F4A340', '#FFE08A'] } });
    const island = document.querySelector('.world-svg .island.event');
    expect(island).not.toBeNull();
    island?.dispatchEvent(new Event('click'));
    expect(document.getElementById('world-card')?.textContent).toContain('hidden seal');
  });
});

describe('coach tips', () => {
  it('show each tip once per browser', () => {
    localStorage.clear();
    const coach = new Coach();
    coach.tip('council');
    expect(document.getElementById('coach')?.hidden).toBe(false);
    expect(document.getElementById('coach-text')?.textContent).toContain('skip');
    document.getElementById('coach-ok')?.click();
    expect(document.getElementById('coach')?.hidden).toBe(true);
    new Coach().tip('council');
    expect(document.getElementById('coach')?.hidden).toBe(true);
  });
});

describe('profile API', () => {
  it('sends credentials and rejects malformed responses', async () => {
    const good = summary();
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      calls.push(init);
      return Promise.resolve(new Response(JSON.stringify(calls.length === 1 ? good : { ...good, balance: -1 }), { status: 200 }));
    });
    const api = new ProfileApi('/colyseus');
    expect(await api.session()).toEqual(good);
    expect(calls[0]?.credentials).toBe('include');
    expect(await api.profile()).toBeNull();
  });

  it('returns null when the server is missing or failing', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('nope', { status: 404 })));
    expect(await new ProfileApi('').session()).toBeNull();
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    expect(await new ProfileApi('').profile()).toBeNull();
  });
});

describe('season banner', () => {
  it('shows the featured event in its colours and hides when there is none', () => {
    const banner = new SeasonBanner();
    banner.show({ height: 840_010, live: true, featured: { id: 'halving', title: 'Halving Party', headline: 'Halving! The block reward is now 3.125 bitcoin.', blurb: 'Every 210,000 blocks the reward halves.', colors: ['#F4A340', '#FFE08A'] } });
    const root = document.getElementById('season');
    expect(root?.hidden).toBe(false);
    expect(root?.textContent).toContain('3.125 bitcoin');
    expect(root?.style.getPropertyValue('--season-a')).toBe('#F4A340');
    banner.show({ height: 900_500, live: true, featured: null });
    expect(root?.hidden).toBe(true);
    banner.show(null);
    expect(root?.hidden).toBe(true);
  });
});
