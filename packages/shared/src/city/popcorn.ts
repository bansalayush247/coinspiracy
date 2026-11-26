// Side case: The Popcorn Tin. Years ago a burglar called Rollo Finch walked out of the Harbour Exchange with the
// card holding its cold wallet's twelve words. Finch is long gone; his old house in Low Tide is up for sale, and
// Brannigan has a warrant for nine o'clock. Rook gets there at quarter to. A friendly race round the yard: the
// tin is in the dog's kennel, and Biscuit the dog is asleep on it. He'd move for food.
import type { Vec2 } from '../map.js';
import type { Mark, Script } from './script.js';
import type { StoryAct, StorySpot } from './story.js';

export const POPCORN_STEPS = ['call', 'search', 'found', 'beaten', 'done'] as const;

export const POPCORN_START: Vec2 = Object.freeze({ x: 98.5, y: 84.5 });
export const OKAFOR_SPOT: Vec2 = Object.freeze({ x: 96.5, y: 86.5 });

export const YARD_SPOTS: readonly StorySpot[] = Object.freeze([
  { at: { x: 98.5, y: 88.5 }, label: 'doormat' },
  { at: { x: 96.5, y: 90.5 }, label: 'shed' },
  { at: { x: 98.5, y: 92.5 }, label: 'bathroom window' },
  { at: { x: 101, y: 90 }, label: 'freezer' },
  { at: { x: 101.2, y: 93.5 }, label: 'bins' },
  { at: { x: 96.5, y: 94.5 }, label: 'kennel' },
]);
export const BINS = 4;
export const KENNEL_SPOT = 5;
export const TIN_REACH = 1.3;
export const TIN_SEARCH_MS = 1_800;

// Where Biscuit sleeps, on the kennel, and the way he trots to the bins and back when anyone rattles them.
export const BISCUIT_BED: Vec2 = Object.freeze({ x: 95.6, y: 94.6 });
export const BISCUIT_TO_BINS: readonly Vec2[] = Object.freeze([BISCUIT_BED, { x: 96.5, y: 92.5 }, { x: 101, y: 92.5 }, { x: 101.6, y: 92.9 }]);
export const BISCUIT_SPEED = 2.2;
export const BISCUIT_AWAY_MS = 14_000;
// Brannigan searches the yard in his own order, the obvious places first and the kennel last, skipping anything
// already searched. Each round is the path he walks to that spot.
export const BRANNIGAN_ROUNDS: readonly { readonly spot: number; readonly path: readonly Vec2[] }[] = Object.freeze([
  { spot: 0, path: [POPCORN_START, { x: 100.5, y: 84.5 }, { x: 100.5, y: 88.5 }, { x: 98.5, y: 88.5 }] },
  { spot: 1, path: [{ x: 98.5, y: 88.5 }, { x: 96.5, y: 88.5 }, { x: 96.5, y: 90.5 }] },
  { spot: 2, path: [{ x: 96.5, y: 90.5 }, { x: 96.5, y: 92.5 }, { x: 98.5, y: 92.5 }] },
  { spot: 3, path: [{ x: 98.5, y: 92.5 }, { x: 101, y: 92.5 }, { x: 101, y: 90 }] },
  { spot: 4, path: [{ x: 101, y: 90 }, { x: 101.2, y: 93.5 }] },
  { spot: 5, path: [{ x: 101.2, y: 93.5 }, { x: 101, y: 92.5 }, { x: 96.5, y: 92.5 }, { x: 96.5, y: 94.5 }] },
]);
export const BRANNIGAN_SPEED = 1.3;
export const BRANNIGAN_SEARCH_MS = 5_000;

export const YARD_NOTES: readonly string[] = Object.freeze([
  'Under the doormat: the front door key, and a note in Finch’s handwriting. “NOT UNDER HERE.”',
  'The shed: forty jars of screws, sorted by mood.',
  'The bathroom window. The floor in there was dug up years ago. Everyone looks there first.',
  'The freezer: fish fingers, and a frozen phone wearing a sticky note. “Not this one either.”',
  'The bins: popcorn bags. Dozens of them. Biscuit is suddenly wide awake.',
  'Under Biscuit’s blanket, in the kennel: a dented popcorn tin.',
]);
export const BRANNIGAN_NOTE = 'Brannigan searched it. Nothing, he says, humming.';
/** Told when Brannigan's search reaches the kennel, where the tin is. */
export const BRANNIGAN_FOUND = 'Brannigan found the tin in the kennel.';
/** Told to the crew when Biscuit leaves the kennel for the bins. */
export const BISCUIT_LEAPS = 'Biscuit leaps off the kennel and trots to the bins.';
/** Told to the crew when Biscuit comes back to lie on the kennel. */
export const BISCUIT_BACK = 'Biscuit wanders back to the kennel and flops down on it.';
export const BISCUIT_REFUSES = 'Biscuit is asleep on the kennel. All of him. He’d move for food, though.';

export const POPCORN_OBJECTIVES: Readonly<Record<(typeof POPCORN_STEPS)[number], string>> = Object.freeze({
  call: 'Finch’s old house, Low Tide. Quarter to nine.',
  search: 'Search the yard before Brannigan does. Biscuit won’t move off the kennel for nothing.',
  found: 'A dented popcorn tin.',
  beaten: 'Brannigan got there first.',
  done: 'Case closed.',
});

export const POPCORN_MARKS: Readonly<Record<string, Mark>> = Object.freeze({
  politeOkafor: { who: 'okafor', text: 'you asked after her roses', honest: true },
  fibbedOkafor: { who: 'okafor', text: 'you said you were from the council' },
  treatsOkafor: { who: 'okafor', text: 'you asked what the dog likes' },
  clueKennel: { text: 'Finch never let anyone near the dog’s kennel. Not even the dog, some nights.', clue: true },
  clueBins: { text: 'Biscuit would do anything for a rattle of the bins.', clue: true },
  handedTin: { who: 'brannigan', text: 'you handed him the tin unopened', honest: true },
  photoTin: { who: 'brannigan', text: 'you photographed the words first' },
  beatBrannigan: { who: 'brannigan', text: 'you beat him to it' },
  lostRace: { who: 'brannigan', text: 'he beat you to it, and you owe him a coffee' },
});

export const POPCORN_REWARD_SATS = 150;

export const POPCORN_SCRIPT: Script = Object.freeze({
  street: {
    slug: 'EXT. LOW TIDE, FINCH’S OLD HOUSE — MORNING',
    action: 'A FOR SALE sign, leaning. Brannigan, in the raincoat, checks his watch. It says 8:45. So does Rook’s.',
    lines: [
      { who: 'brannigan', text: 'Rollo Finch. Walked out of the Harbour Exchange with the card for its cold wallet. Twelve words. Every customer’s coins.' },
      { who: 'brannigan', text: 'He’s long gone. The card never left this house. My warrant says nine o’clock.' },
      { who: 'rook', text: 'And it’s quarter to.' },
      { who: 'brannigan', paren: 'not unkindly', text: 'Bet you a coffee I find it first.' },
      { who: 'okafor', paren: 'over the fence, in a dressing gown', text: 'If you two are going to dig up that bathroom again, I’m putting the kettle on.' },
    ],
    choices: [
      { id: 'polite', tag: 'Polite', text: 'Morning, Mrs Okafor. Lovely roses. Did you know Mr Finch?', go: 'okaforPolite', mark: 'politeOkafor' },
      { id: 'fib', tag: 'Fib', text: 'We’re from the council. Routine inspection.', go: 'okaforFib', mark: 'fibbedOkafor' },
      { id: 'dog', tag: 'Dog', text: 'Whose is the dog?', go: 'okaforDog', mark: 'treatsOkafor' },
    ],
    seconds: 12,
    timeout: 'okaforSilence',
  },
  okaforPolite: {
    lines: [
      { who: 'okafor', text: 'Oh, he was a strange one. Fed that dog better than himself.' },
      { who: 'okafor', text: 'Never let anyone near that kennel. Not even the dog, some nights.' },
      { who: 'okafor', text: 'Biscuit stayed when the house was sold. Sleeps on it all day. He’d sell his soul for a rattle of the bins.' },
    ],
    mark: 'clueKennel',
    next: 'okaforBins',
  },
  okaforBins: { lines: [{ who: 'rook', paren: 'to self', text: 'Bins first, then. Get him off the kennel.' }], mark: 'clueBins', next: 'streetEnd' },
  okaforFib: {
    lines: [
      { who: 'okafor', text: 'The council. Of course. You’ve got crisps on your jumper.' },
      { who: 'okafor', paren: 'the window closes', text: 'Good morning.' },
    ],
    next: 'streetEnd',
  },
  okaforDog: {
    lines: [
      { who: 'okafor', text: 'Biscuit? Nobody’s, now. Finch’s, before. He stayed when the house was sold.' },
      { who: 'okafor', text: 'He’d sell his soul for a rattle of the bins. Don’t tell him I said.' },
    ],
    mark: 'clueBins',
    next: 'streetEnd',
  },
  okaforSilence: {
    lines: [{ who: 'okafor', text: 'Suit yourselves. The dog’s friendlier than both of you.' }],
    next: 'streetEnd',
  },
  streetEnd: {
    action: 'Brannigan’s watch beeps. He pushes the gate open with one finger.',
    lines: [{ who: 'brannigan', text: 'Nine o’clock. Somewhere. May the best detective win.' }],
    then: 'search',
  },

  tin: {
    slug: 'EXT. FINCH’S YARD — CONTINUOUS',
    action: 'The lid comes off with a pop. Stale popcorn, and under it a laminated card. Twelve words in Finch’s capitals. Brannigan arrives, out of breath.',
    lines: [
      { who: 'brannigan', text: 'The dog bed. Of course it was the dog bed.' },
      { who: 'rook', text: 'Every customer of the Harbour Exchange. On a card. In a tin.' },
      { who: 'brannigan', text: 'Anyone who reads those words owns those coins. Me, you, the dog.' },
    ],
    choices: [
      { id: 'hand', tag: 'Hand over', text: 'Snap the lid back on and hand it to Brannigan, unread.', go: 'tinHand', mark: 'handedTin' },
      { id: 'photo', tag: 'Photo', text: 'Take a quick photo of the card first. For the case file.', go: 'tinPhoto', mark: 'photoTin' },
    ],
    seconds: 12,
    timeout: 'tinSilence',
  },
  tinHand: {
    lines: [
      { who: 'brannigan', paren: 'surprised', text: 'Unread. Huh. Coffee’s on me, then.' },
      { who: 'brannigan', text: 'The exchange moves the coins to a fresh wallet by lunch. The customers get theirs back.' },
    ],
    next: 'tinEnd',
  },
  tinPhoto: {
    lines: [
      { who: 'brannigan', text: 'Delete that.' },
      { who: 'rook', text: 'It’s just a—' },
      { who: 'brannigan', text: 'It’s the coins, Rook. A photo of the words is the coins. Now there are two tins, and one of them is in your pocket, backed up to the cloud.' },
      { who: 'rook', paren: 'deleting it', text: 'Deleted. And from the bin.' },
    ],
    next: 'tinEnd',
  },
  tinSilence: {
    lines: [{ who: 'brannigan', paren: 'taking the tin gently', text: 'I’ll take that before you get ideas. Coffee’s on me.' }],
    next: 'tinEnd',
  },
  tinEnd: {
    action: 'Biscuit noses the empty kennel, then the tin, then Brannigan’s pocket.',
    lines: [{ who: 'brannigan', text: 'Finch hid the whole exchange in a popcorn tin. And the dog knew.' }],
    mark: 'beatBrannigan',
    then: 'done',
  },

  beaten: {
    slug: 'EXT. FINCH’S YARD — CONTINUOUS',
    action: 'Brannigan, on one knee by the kennel, a bag of dog treats open. Biscuit is eating all of them. Brannigan holds up a dented popcorn tin.',
    lines: [
      { who: 'brannigan', text: 'The dog bed. I always bring treats. Twenty years in this job.' },
      { who: 'brannigan', text: 'Twelve words on a card, in a tin. Anyone who reads them owns every coin. Even a detective with a dog in his lap.' },
      { who: 'rook', text: 'Coffee’s on me, then.' },
      { who: 'brannigan', text: 'Large. With the little biscuit.' },
    ],
    mark: 'lostRace',
    then: 'done',
  },
});

export const POPCORN_ACT: StoryAct = Object.freeze({
  id: 'popcorn',
  kind: 'case',
  number: 'Side case',
  title: 'The Popcorn Tin',
  blurb: 'Inspired by stolen bitcoin found hidden in a popcorn tin. Race Brannigan round a burglar’s yard.',
  steps: POPCORN_STEPS,
  scenes: Object.freeze({ call: 'street', found: 'tin', beaten: 'beaten' }),
  objectives: POPCORN_OBJECTIVES,
  targets: Object.freeze({}),
  arrivals: Object.freeze({}),
  closed: ['found', 'beaten', 'done'],
  workStep: 'search',
  spots: YARD_SPOTS,
  workReach: TIN_REACH,
  workMs: TIN_SEARCH_MS,
  workGoal: 0,
  workVerb: 'Search the {}',
  hint: 'Six places in the yard. Brannigan searches them one by one, the obvious places first. Beat him to the tin.',
  markers: 'labels',
  night: 0.08,
  catchers: Object.freeze({}),
  start: POPCORN_START,
  script: POPCORN_SCRIPT,
  marks: POPCORN_MARKS,
  rewardSats: POPCORN_REWARD_SATS,
  lesson:
    'Twelve words on a card are the coins. Whoever reads them owns everything: a burglar, a detective, or anyone who sees a photo. A single paper backup is only as safe as the place it’s hidden. Split it, lock it away, or let a federation of guardians hold it, so no one tin can be found and emptied.',
  next: 'Case closed. More cases wait in the casebook.',
});
