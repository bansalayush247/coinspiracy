// Season two, act three of "The Cold Key": The Old Receipt. Silas's ferry and the fishermen's co-op keep a running
// tab: every delivery they both sign a new receipt and tear up the old one. Tonight Silas has handed the harbour
// office a month-old receipt that says the co-op owes him. Until the tide turns, anyone can show a newer receipt,
// and a cheat who is caught loses the whole tab; that is the deal they both signed. Ozzy's watchtower spots it.
// The crew finds Nell's newest receipt on one of her boats, past Silas's deckhands, and runs it to the office.
import type { Vec2 } from '../map.js';
import { IVY_SPOT } from './ransom.js';
import type { Mark, Script } from './script.js';
import type { StoryAct, StorySpot } from './story.js';

export const RECEIPT_STEPS = ['call', 'toDocks', 'coop', 'search', 'deliver', 'office', 'missed', 'done'] as const;

export const COOP_YARD: Vec2 = Object.freeze({ x: 25, y: 54.5 });
export const HARBOUR_OFFICE: Vec2 = Object.freeze({ x: 26.5, y: 72.3 });

// Nell's six boats on three jetties, north to south; the server picks the one holding the newest receipt.
export const BOATS: readonly (StorySpot & { readonly jetty: 0 | 1 | 2 })[] = Object.freeze([
  { at: { x: 9.5, y: 48.7 }, label: 'Marigold II', jetty: 0 },
  { at: { x: 17.5, y: 49.3 }, label: 'Sea Biscuit', jetty: 0 },
  { at: { x: 8.5, y: 58.7 }, label: 'Lucky Nell', jetty: 1 },
  { at: { x: 16.5, y: 59.3 }, label: 'Salt Queen', jetty: 1 },
  { at: { x: 8.5, y: 68.7 }, label: 'Tern', jetty: 2 },
  { at: { x: 16.5, y: 69.3 }, label: 'Codfather', jetty: 2 },
]);
export const JETTY_MARKS = ['jettyNorth', 'jettyMiddle', 'jettySouth'] as const;
export const BOAT_REACH = 1.3;
export const BOAT_MS = 1_800;
export const RECEIPT_FOUND = 'In a biscuit tin under the bench: the newest receipt. Signed by Nell and by Silas, last Tuesday. Silas owes the co-op eighty coins.';
export const BOAT_NOTES: readonly string[] = Object.freeze([
  'Nets, a flask, and a very old sandwich. No receipt.',
  'A drawer full of receipts, all older ones, all torn in half. Not this boat.',
  'A cat. The cat does not have the receipt. The cat does not care.',
  'Fishing tackle and a radio tuned to the Mint channel. No receipt.',
  'A logbook in Nell’s handwriting: “Receipts go in the biscuit tin.” Not on this boat.',
]);

// The tide turns this long after the search starts; until then a newer receipt beats an old one.
export const TIDE_MS = 150_000;

// Silas's deckhands walk the three jetties with lanterns.
export const DECKHAND_ROUTES: readonly (readonly Vec2[])[] = Object.freeze([
  [
    { x: 19.5, y: 48.9 },
    { x: 7, y: 48.9 },
  ],
  [
    { x: 19.5, y: 58.9 },
    { x: 7, y: 58.9 },
  ],
  [
    { x: 19.5, y: 68.9 },
    { x: 7, y: 68.9 },
  ],
]);
export const DECKHAND_SPEED = 1.5;
/** What the deckhands walking the jetties are called over their heads. */
export const DECKHAND_NAME = 'Deckhand';
export const DECKHAND_BACKS: readonly Vec2[] = Object.freeze([
  { x: 24.5, y: 46.6 },
  { x: 24.5, y: 56.5 },
  { x: 24.5, y: 66.5 },
]);

export const RECEIPT_OBJECTIVES: Readonly<Record<(typeof RECEIPT_STEPS)[number], string>> = Object.freeze({
  call: 'The Mint’s watchtower room. Ozzy’s alarm is going off.',
  toDocks: 'Get to the fishermen’s co-op yard at the Reef Docks.',
  coop: 'The co-op yard.',
  search: 'Find Nell’s newest receipt on one of her boats before the tide turns. Keep out of the deckhands’ lanterns.',
  deliver: 'Run the receipt to the harbour office before the tide turns.',
  office: 'The harbour office.',
  missed: 'The tide has turned.',
  done: 'Season two, act three complete.',
});

export const RECEIPT_MARKS: Readonly<Record<string, Mark>> = Object.freeze({
  clueTab: { text: 'A tab is settled by the newest receipt both signed. Show a newer one before the tide turns and the cheat loses the lot.', clue: true },
  thankedOzzy: { who: 'ozzy', text: 'you told him it was a good catch', honest: true },
  hurriedOzzy: { who: 'ozzy', text: 'you told him to get to the point' },
  calmedNell: { who: 'nell', text: 'you sat with her and helped her remember', honest: true },
  rushedNell: { who: 'nell', text: 'you rushed her' },
  jettyNorth: { text: 'Nell’s newest receipt is on a boat at the north jetty.', clue: true },
  jettyMiddle: { text: 'Nell’s newest receipt is on a boat at the middle jetty.', clue: true },
  jettySouth: { text: 'Nell’s newest receipt is on a boat at the south jetty.', clue: true },
  beatTide: { who: 'nell', text: 'you got her receipt in before the tide' },
  missedTide: { who: 'nell', text: 'the tide turned before you got there' },
  askedMercy: { who: 'silas', text: 'you asked Nell to leave him what was fairly his', honest: true },
  gloated: { who: 'silas', text: 'you waved goodbye to his ferry money' },
});

export const RECEIPT_REWARD_SATS = 400;

export const RECEIPT_SCRIPT: Script = Object.freeze({
  tower: {
    slug: 'INT. MINT WATCHTOWER ROOM — NIGHT',
    action: 'Six screens, a beanbag, and Ozzy in a hoodie that now says MINT. An alarm is going BWEEP.',
    lines: [
      { who: 'ozzy', text: 'Somebody’s closing a tab with an old receipt. I’ve been waiting all week for this to go off.' },
      { who: 'ozzy', text: 'Silas runs the ferry. He and the fishermen’s co-op keep a tab. Every delivery, they both sign a new receipt and tear up the old one.' },
      { who: 'ozzy', text: 'Last Tuesday the tab said Silas owes the co-op eighty. Tonight he’s handed the harbour office a receipt from last month that says they owe him fifty.' },
      { who: 'ozzy', text: 'The office waits for the tide. Until it turns, anyone can show a newer receipt. If they do, the cheat loses the whole tab. That’s the deal everyone signed.' },
      { who: 'rook', text: 'And if nobody shows one?' },
      { who: 'ozzy', text: 'Then he gets away with it. That’s what watchtowers are for. Tonight, that’s what you’re for.' },
    ],
    mark: 'clueTab',
    choices: [
      { id: 'thanks', tag: 'Good catch', text: 'Good catch, Ozzy. Really.', go: 'towerThanks', mark: 'thankedOzzy' },
      { id: 'point', tag: 'Hurry', text: 'Less talking. Where’s the newest receipt?', go: 'towerPoint', mark: 'hurriedOzzy' },
    ],
    seconds: 12,
    timeout: 'towerPoint',
  },
  towerThanks: {
    lines: [
      { who: 'ozzy', paren: 'going a bit pink', text: 'Oh. Thanks. Nobody says that to the watchtower.' },
      { who: 'ozzy', text: 'Nell at the co-op will have it. Go. The tide doesn’t wait.' },
    ],
    then: 'toDocks',
  },
  towerPoint: { lines: [{ who: 'ozzy', text: 'Nell, at the fishermen’s co-op. Reef Docks. Go. The tide doesn’t wait.' }], then: 'toDocks' },

  coop: {
    slug: 'EXT. FISHERMEN’S CO-OP YARD, REEF DOCKS — NIGHT',
    action: 'NELL, seventy, in oilskins, mending a net by lamplight. Out on the jetties, lanterns bob: Silas’s deckhands.',
    lines: [
      { who: 'nell', text: 'My newest receipt? On one of my boats. In the biscuit tin.' },
      { who: 'nell', text: 'Which boat… I’ve six, love. And it’s dark. And they’re all the same colour, which was a mistake.' },
    ],
    choices: [
      { id: 'calm', tag: 'Sit with her', text: 'Take your time. Where were you last Tuesday, when you signed it?', go: 'coopCalm', mark: 'calmedNell' },
      { id: 'rush', tag: 'Hurry', text: 'We haven’t got time. We’ll search them all.', go: 'coopRush', mark: 'rushedNell' },
    ],
    seconds: 12,
    timeout: 'coopRush',
  },
  coopCalm: {
    lines: [
      { who: 'nell', paren: 'putting the net down', text: 'Tuesday. Silas brought the ferry round, we signed it on deck, I put it in the tin…' },
      { who: 'nell', text: 'And the gulls were on the lamp at the end of the jetty. Which jetty had the gulls…' },
    ],
    next: 'coopMiddle',
    jump: { if: 'jettyNorth', to: 'coopNorth' },
  },
  coopMiddle: {
    action: 'Nell squints out at the water.',
    lines: [{ who: 'nell', text: 'Not the north one. Too windy.' }],
    next: 'coopMiddleSaid',
    jump: { if: 'jettySouth', to: 'coopSouth' },
  },
  coopNorth: { lines: [{ who: 'nell', text: 'The north jetty! The gulls always sit on the north lamp. One of the two boats up there.' }], next: 'coopEnd' },
  coopMiddleSaid: { lines: [{ who: 'nell', text: 'The middle jetty. I’m sure of it. One of the two boats there.' }], next: 'coopEnd' },
  coopSouth: { lines: [{ who: 'nell', text: 'The south jetty, by the harbour office. One of the two boats down there.' }], next: 'coopEnd' },
  coopRush: { lines: [{ who: 'nell', paren: 'picking the net back up', text: 'Suit yourself. They’re all mine. Mind the deckhands.' }], next: 'coopEnd' },
  coopEnd: {
    lines: [{ who: 'rook', paren: 'to the crew', text: 'Find the tin, then straight to the harbour office. The tide’s already coming in.' }],
    then: 'search',
  },

  office: {
    slug: 'INT. HARBOUR OFFICE — NIGHT',
    action: 'A clerk behind a high desk. SILAS, in a captain’s hat he did not earn, leaning on it. Nell arrives behind the crew, out of breath.',
    lines: [
      { who: 'clerk', text: 'Two receipts for one tab. Both signed by both of you. The office goes by the newest.' },
      { who: 'clerk', text: 'Mr Silas, you showed an old one. Under the rules you both signed, the whole tab goes to the co-op.' },
      { who: 'silas', text: 'The whole tab?! That’s my ferry money!' },
      { who: 'nell', text: 'Then you shouldn’t have tried it, Silas.' },
    ],
    mark: 'beatTide',
    choices: [
      { id: 'mercy', tag: 'Fair', text: 'Nell, maybe leave him what he was fairly owed. The rules made the point.', go: 'officeMercy', mark: 'askedMercy' },
      { id: 'gloat', tag: 'Wave', text: 'Bye-bye, ferry money.', go: 'officeGloat', mark: 'gloated' },
    ],
    seconds: 12,
    timeout: 'officeEnd',
  },
  officeMercy: {
    lines: [
      { who: 'nell', paren: 'after a long look at Silas', text: 'Fine. He keeps what he was owed. Everything else stays with the co-op. And he buys the next round.' },
      { who: 'silas', paren: 'quietly', text: 'Thank you, Nell.' },
    ],
    next: 'officeEnd',
  },
  officeGloat: { lines: [{ who: 'silas', paren: 'taking off the hat', text: 'Alright. Alright. I deserved that.' }], next: 'officeEnd' },
  officeEnd: {
    action: 'Rook’s phone buzzes. A message from Ozzy: a thumbs up, then a long string of watchtower emojis.',
    lines: [
      { who: 'rook', text: 'Nobody has to trust Silas. They just have to watch.' },
      { who: 'ozzy', paren: 'on the phone', text: 'And Rook? The Mint channel’s been busy tonight. Somebody in Gullmoor’s been listening to every word.' },
    ],
    then: 'done',
  },

  tideTurned: {
    slug: 'EXT. REEF DOCKS — NIGHT',
    action: 'The tide turns. In the harbour office, a stamp comes down on Silas’s old receipt. His ferry pulls away, lit up like a birthday cake.',
    lines: [
      { who: 'nell', text: 'Fifty coins we never owed him, and the eighty he owed us. Gone with the tide.' },
      { who: 'rook', text: 'We were too slow.' },
      { who: 'ozzy', paren: 'on the phone', text: 'That’s why watchtowers watch all night, every night. Next time we start sooner.' },
    ],
    mark: 'missedTide',
    then: 'done',
  },
});

export const RECEIPT_ACT: StoryAct = Object.freeze({
  id: 'receipt',
  kind: 'act',
  number: 'Season two, act three',
  title: 'The Old Receipt',
  blurb: 'Inspired by how a payment channel punishes anyone who tries to close it with an old state.',
  steps: RECEIPT_STEPS,
  scenes: Object.freeze({ call: 'tower', coop: 'coop', office: 'office', missed: 'tideTurned' }),
  objectives: RECEIPT_OBJECTIVES,
  targets: Object.freeze({ toDocks: COOP_YARD, deliver: HARBOUR_OFFICE }),
  arrivals: Object.freeze({ toDocks: { at: COOP_YARD, range: 2.5, to: 'coop' }, deliver: { at: HARBOUR_OFFICE, range: 2, to: 'office' } }),
  closed: ['office', 'missed', 'done'],
  workStep: 'search',
  spots: BOATS,
  workReach: BOAT_REACH,
  workMs: BOAT_MS,
  workGoal: 0,
  clockLabel: 'Tide turns in',
  workVerb: 'Search the {}',
  hint: 'Six boats on three jetties. The deckhands walk the jetties with lanterns; follow behind them.',
  markers: 'labels',
  night: 0.6,
  nights: Object.freeze({ call: 0.45, office: 0.45, done: 0.45 }),
  catchers: Object.freeze({
    guard: {
      name: 'A deckhand',
      where: 'the shore',
      lines: [
        'A deckhand swings a lantern in your face: “Captain says nobody on the boats tonight.” Back to the shore.',
        'The deckhand again: “I’m paid by the hour, not by the chase. Shore. Please.”',
        'Deckhand: “Third time. I’m going to start charging you ferry fares.”',
      ],
    },
  }),
  carries: true,
  start: IVY_SPOT,
  script: RECEIPT_SCRIPT,
  marks: RECEIPT_MARKS,
  rewardSats: RECEIPT_REWARD_SATS,
  lesson:
    'A payment channel is a tab two people keep by signing each new state and cancelling the last. Anyone who closes it with an old one can be caught: show the newer state before the waiting period ends and the cheat loses everything. That only works if someone is watching, which is what watchtowers are for.',
  next: 'Season two ends next: the radio in Gullmoor, and the person listening to it.',
});
