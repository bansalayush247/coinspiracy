// The Seal Book: an achievement tree in five tabs. A seal is earned whenever its criterion holds;
// its parent only decides when it becomes visible. Ids are stored, so never rename one.
import type { RewardId } from '../economy/catalog.js';
import type { CounterId, Counters } from './counters.js';

export const SEAL_TABS = ['citadel', 'signing', 'council', 'peaks', 'byzantine', 'chain', 'academy', 'town', 'reef'] as const;
export type SealTab = (typeof SEAL_TABS)[number];
export const SEAL_TAB_NAMES: Readonly<Record<SealTab, string>> = Object.freeze({
  citadel: 'The Citadel',
  signing: 'Signing Isle',
  council: 'Council Isle',
  peaks: 'Watchtower Peaks',
  byzantine: 'Byzantine Arts',
  chain: 'Chain & Seasons',
  academy: 'Academy',
  town: 'Beach Town',
  reef: 'Lightning Reef',
});

export type SealFrame = 'normal' | 'goal' | 'legend';
export const SEAL_XP: Readonly<Record<SealFrame, number>> = Object.freeze({ normal: 25, goal: 75, legend: 200 });

export const SEAL_TITLE_IDS = [
  'blindSigner',
  'doubleSpendDetective',
  'pathfinder',
  'watchkeeper',
  'oldGuard',
  'thresholdKeeper',
  'keenEye',
  'bridgeBuilder',
  'consensusBuilder',
  'silverTongue',
  'byzantineGeneral',
  'timechainRegular',
  'halvingWitness',
  'scholar',
  'harbourRunner',
  'reefWarden',
  'channelMaster',
  'peakWarden',
  'pillarOfTheMint',
] as const;
export type SealTitleId = (typeof SEAL_TITLE_IDS)[number];
export const SEAL_TITLE_NAMES: Readonly<Record<SealTitleId, string>> = Object.freeze({
  blindSigner: 'Blind Signer',
  doubleSpendDetective: 'Double-Spend Detective',
  pathfinder: 'Pathfinder',
  watchkeeper: 'Watchkeeper',
  oldGuard: 'Old Guard',
  thresholdKeeper: 'Threshold Keeper',
  keenEye: 'Keen Eye',
  bridgeBuilder: 'Bridge Builder',
  consensusBuilder: 'Consensus Builder',
  silverTongue: 'Silver Tongue',
  byzantineGeneral: 'Byzantine General',
  timechainRegular: 'Timechain Regular',
  halvingWitness: 'Halving Witness',
  scholar: 'Scholar',
  harbourRunner: 'Harbour Runner',
  reefWarden: 'Reef Warden',
  channelMaster: 'Channel Master',
  peakWarden: 'Peak Warden',
  pillarOfTheMint: 'Pillar of the Mint',
});

export interface Seal {
  readonly id: string;
  readonly tab: SealTab;
  readonly parent: string | null;
  readonly name: string;
  readonly goal: string;
  readonly frame: SealFrame;
  readonly hidden: boolean;
  // One counter at a target, or every listed counter at the target.
  readonly counters: readonly CounterId[];
  readonly target: number;
  readonly item?: RewardId;
  readonly title?: SealTitleId;
}

type Spec = Omit<Seal, 'hidden' | 'counters'> & { readonly hidden?: boolean; readonly counter?: CounterId; readonly counters?: readonly CounterId[] };

// A chain of three tiers on one counter, each the parent of the next.
function chain(tab: SealTab, base: string, parent: string | null, counter: CounterId, names: readonly [string, string, string], goal: (n: number) => string, targets: readonly number[], title?: SealTitleId): Spec[] {
  const frames: readonly SealFrame[] = ['normal', 'goal', 'legend'];
  return targets.map((target, i) => ({
    id: `${base}${String(i + 1)}`,
    tab,
    parent: i === 0 ? parent : `${base}${String(i)}`,
    name: names[i] ?? base,
    goal: goal(target),
    frame: frames[i] ?? 'normal',
    counter,
    target,
    ...(i === 2 && title !== undefined ? { title } : {}),
  }));
}

// Gives one tier of a chain a reward item.
function withItem(specs: Spec[], tier: number, item: RewardId): Spec[] {
  return specs.map((s, i) => (i === tier ? { ...s, item } : s));
}

const SPECS: readonly Spec[] = [
  // The Citadel
  { id: 'firstShift', tab: 'citadel', parent: null, name: 'First Shift', goal: 'Finish your first match.', frame: 'goal', counter: 'matchesFinished', target: 1, item: 'firstMatch' },
  { id: 'allStations', tab: 'citadel', parent: 'firstShift', name: 'Every Station', goal: 'Complete a task at all four stations.', frame: 'normal', counters: ['tasksDeposit', 'tasksLedger', 'tasksRoute', 'tasksWatchtower'], target: 1 },
  ...chain('citadel', 'deposit', 'firstShift', 'tasksDeposit', ['Blind Signer I', 'Blind Signer II', 'Blind Signer III'], (n) => `Blind-sign ${String(n)} deposits at the Deposit Gate.`, [5, 25, 100], 'blindSigner'),
  ...chain('citadel', 'ledger', 'firstShift', 'tasksLedger', ['Ledger Sleuth I', 'Ledger Sleuth II', 'Double-Spend Detective'], (n) => `Check the notes ${String(n)} times at the Ledger Archive.`, [5, 25, 100], 'doubleSpendDetective'),
  ...chain('citadel', 'route', 'firstShift', 'tasksRoute', ['Route Runner I', 'Route Runner II', 'Pathfinder'], (n) => `Route ${String(n)} Lightning payments at the Gateway Dock.`, [5, 25, 100], 'pathfinder'),
  ...chain('citadel', 'watch', 'firstShift', 'tasksWatchtower', ['Lookout I', 'Lookout II', 'Watchkeeper'], (n) => `Confirm the block height ${String(n)} times at the Watchtower.`, [5, 25, 100], 'watchkeeper'),
  { id: 'veteran', tab: 'citadel', parent: 'firstShift', name: 'Veteran', goal: 'Finish 10 matches.', frame: 'goal', counter: 'matchesFinished', target: 10, item: 'veteran' },
  { id: 'regular', tab: 'citadel', parent: 'veteran', name: 'Regular', goal: 'Finish 50 matches.', frame: 'goal', counter: 'matchesFinished', target: 50 },
  { id: 'oldGuard', tab: 'citadel', parent: 'regular', name: 'Old Guard', goal: 'Finish 250 matches.', frame: 'legend', counter: 'matchesFinished', target: 250, title: 'oldGuard' },
  // The Council
  // Signing Isle
  { id: 'firstSignature', tab: 'signing', parent: null, name: 'First Signature', goal: 'Sign a real withdrawal.', frame: 'normal', counter: 'legitSigned', target: 1 },
  ...chain('signing', 'threshold', 'firstSignature', 'forgedRefused', ['Not On My Watch', 'Forgery Spotter', 'Threshold Keeper'], (n) => `Refuse ${String(n)} forged withdrawal${n === 1 ? '' : 's'}.`, [1, 10, 50], 'thresholdKeeper'),
  // Council Isle
  ...chain('council', 'keenEye', null, 'byzantineVotes', ['Hunch', 'Sharp Eyes', 'Keen Eye'], (n) => `Vote for a Byzantine guardian in ${String(n)} council${n === 1 ? '' : 's'}.`, [1, 10, 50], 'keenEye'),
  // Watchtower Peaks
  ...chain('peaks', 'mender', null, 'partitionsRepaired', ['Reconnected', 'Link Layer', 'Bridge Builder'], (n) => `Help repair ${String(n)} partition${n === 1 ? '' : 's'}.`, [1, 10, 50], 'bridgeBuilder'),
  { id: 'honestWin', tab: 'council', parent: null, name: 'Honest Work', goal: 'Win a match as an honest guardian.', frame: 'goal', counter: 'honestWins', target: 1, item: 'honestWin' },
  ...chain('council', 'consensus', 'honestWin', 'consensusWins', ['Consensus', 'Steady Hands', 'Consensus Builder'], (n) => `Win ${String(n)} match${n === 1 ? '' : 'es'} by filling the Consensus bar.`, [1, 10, 50], 'consensusBuilder'),
  { id: 'sweep1', tab: 'council', parent: 'honestWin', name: 'Clean Sweep', goal: 'Win by rotating out every Byzantine.', frame: 'normal', counter: 'rotationWins', target: 1 },
  { id: 'sweep2', tab: 'council', parent: 'sweep1', name: 'Spotless', goal: 'Win 10 matches by rotating out every Byzantine.', frame: 'goal', counter: 'rotationWins', target: 10 },
  // Byzantine Arts
  { id: 'undercover', tab: 'byzantine', parent: null, name: 'Undercover', goal: 'Win a match as a Byzantine guardian.', frame: 'goal', counter: 'byzantineWins', target: 1, item: 'byzantineWin' },
  ...chain('byzantine', 'tongue', 'undercover', 'forgeWins', ['Smooth Talk', 'Persuader', 'Silver Tongue'], (n) => `Win ${String(n)} match${n === 1 ? '' : 'es'} with a forged withdrawal.`, [1, 5, 25], 'silverTongue'),
  ...chain('byzantine', 'general', 'undercover', 'haltWins', ['Halt!', 'Gridlock', 'Byzantine General'], (n) => `Win ${String(n)} match${n === 1 ? '' : 'es'} by halting the federation.`, [1, 5, 25], 'byzantineGeneral'),
  { id: 'misdirect1', tab: 'byzantine', parent: 'undercover', name: 'Misdirection', goal: 'Have an honest guardian rotated out while you are Byzantine.', frame: 'normal', counter: 'misdirections', target: 1 },
  { id: 'misdirect2', tab: 'byzantine', parent: 'misdirect1', name: 'Smoke and Mirrors', goal: 'Have 10 honest guardians rotated out while you are Byzantine.', frame: 'goal', counter: 'misdirections', target: 10 },
  // Chain & Seasons
  ...chain('chain', 'epoch', null, 'epochsPlayed', ['New Epoch', 'Epoch Hopper', 'Timechain Regular'], (n) => `Finish matches in ${String(n)} difficulty epoch${n === 1 ? '' : 's'}.`, [1, 3, 12], 'timechainRegular'),
  { id: 'genesisDay', tab: 'chain', parent: 'epoch1', name: 'Genesis Day', goal: 'Finish a match on 3 January, the genesis block’s birthday.', frame: 'goal', hidden: true, counter: 'eventGenesisDay', target: 1 },
  { id: 'pizzaDay', tab: 'chain', parent: 'epoch1', name: 'Pizza Day', goal: 'Finish a match on 22 May, Bitcoin Pizza Day.', frame: 'goal', hidden: true, counter: 'eventPizzaDay', target: 1 },
  { id: 'whitepaperDay', tab: 'chain', parent: 'epoch1', name: 'Whitepaper Day', goal: 'Finish a match on 31 October, the whitepaper’s birthday.', frame: 'goal', hidden: true, counter: 'eventWhitepaperDay', target: 1 },
  { id: 'halving', tab: 'chain', parent: 'epoch1', name: 'Halving Witness', goal: 'Finish a match around a halving.', frame: 'legend', hidden: true, counter: 'eventHalving', target: 1, title: 'halvingWitness' },
  { id: 'fullHouse', tab: 'chain', parent: 'epoch1', name: 'Full House', goal: 'Finish a match with nine guardians.', frame: 'normal', counter: 'fullMatches', target: 1 },
  { id: 'friends1', tab: 'chain', parent: 'epoch1', name: 'Among Friends', goal: 'Finish a match in an invite room.', frame: 'normal', counter: 'privateMatches', target: 1 },
  { id: 'friends2', tab: 'chain', parent: 'friends1', name: 'The Usual Crew', goal: 'Finish 10 matches in invite rooms.', frame: 'goal', counter: 'privateMatches', target: 10 },
  // Academy
  { id: 'academy1', tab: 'academy', parent: null, name: 'First Lesson', goal: 'Clear an Academy level.', frame: 'normal', counter: 'academyClears', target: 1 },
  { id: 'graduate', tab: 'academy', parent: 'academy1', name: 'Graduate', goal: 'Clear five Academy levels.', frame: 'goal', counter: 'academyClears', target: 5, item: 'graduate' },
  // Beach Town
  ...chain('town', 'courier', null, 'courierDeliveries', ['First Parcel', 'Regular Runner', 'Harbour Runner'], (n) => `Deliver ${String(n)} parcel${n === 1 ? '' : 's'} between Beach Town stalls.`, [1, 10, 50], 'harbourRunner'),
  { id: 'topOfClass', tab: 'academy', parent: 'graduate', name: 'Top of the Class', goal: 'Earn 15 Academy stars.', frame: 'legend', counter: 'academyStars', target: 15, title: 'scholar' },
  // Lightning Reef: matches on the islets, and payments through the harbour's tight channels.
  ...withItem(chain('reef', 'reef', null, 'reefMatches', ['Reef Walker', 'Tidekeeper', 'Reef Warden'], (n) => `Finish ${String(n)} match${n === 1 ? '' : 'es'} on Lightning Reef.`, [1, 10, 50], 'reefWarden'), 0, 'reefWalker'),
  ...withItem(chain('reef', 'channel', 'reef1', 'reefRoutes', ['Thin Margins', 'Channel Hopper', 'Channel Master'], (n) => `Route ${String(n)} payment${n === 1 ? '' : 's'} through the Gateway Harbour’s tight channels.`, [1, 10, 50], 'channelMaster'), 1, 'channelHopper'),
  // Island Academy pages, appended after the books above.
  { id: 'signingScholar', tab: 'signing', parent: 'firstSignature', name: 'Threshold Scholar', goal: 'Clear both Signing Isle Academy levels.', frame: 'goal', counter: 'clearsSigning', target: 2, item: 'signingScholar' },
  ...chain('signing', 'cosigner', 'firstSignature', 'legitSigned', ['Co-signer', 'Trusted Hand', 'Pillar of the Mint'], (n) => `Sign ${String(n)} real withdrawal${n === 1 ? '' : 's'}.`, [10, 50, 250], 'pillarOfTheMint'),
  { id: 'councilScholar', tab: 'council', parent: null, name: 'Rule of Thirds', goal: 'Clear both Council Isle Academy levels.', frame: 'goal', counter: 'clearsCouncil', target: 2, item: 'councilScholar' },
  { id: 'peaksScholar', tab: 'peaks', parent: null, name: 'Split Reader', goal: 'Clear both Watchtower Peaks Academy levels.', frame: 'goal', counter: 'clearsPeaks', target: 2 },
  ...withItem(chain('peaks', 'peaks', null, 'peaksMatches', ['Mountaineer', 'Ridge Runner', 'Peak Warden'], (n) => `Finish ${String(n)} match${n === 1 ? '' : 'es'} on Watchtower Peaks.`, [1, 10, 50], 'peakWarden'), 0, 'mountaineer'),
];

export const SEALS: readonly Seal[] = Object.freeze(
  SPECS.map((s) => Object.freeze({ ...s, hidden: s.hidden ?? false, counters: Object.freeze(s.counters ?? (s.counter === undefined ? [] : [s.counter])) })),
);
export const SEAL_IDS: readonly string[] = Object.freeze(SEALS.map((s) => s.id));
const BY_ID: ReadonlyMap<string, Seal> = new Map(SEALS.map((s) => [s.id, s]));

export function sealById(id: string): Seal | undefined {
  return BY_ID.get(id);
}

// Progress toward a seal: the lowest of its counters, capped at the target.
export function sealProgress(seal: Seal, counters: Counters): number {
  const values = seal.counters.map((c) => counters[c] ?? 0);
  return Math.min(seal.target, values.length === 0 ? 0 : Math.min(...values));
}

export function sealDone(seal: Seal, counters: Counters): boolean {
  return sealProgress(seal, counters) >= seal.target;
}

// Seals newly earned with these counters, in book order.
export function newSeals(counters: Counters, earned: ReadonlySet<string>): Seal[] {
  return SEALS.filter((s) => !earned.has(s.id) && sealDone(s, counters));
}

// Visible: earned, a root, or the parent is earned; hidden seals show only once earned.
export function sealVisible(seal: Seal, earned: ReadonlySet<string>): boolean {
  if (earned.has(seal.id)) return true;
  if (seal.hidden) return false;
  return seal.parent === null || earned.has(seal.parent);
}
