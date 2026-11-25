// Act three of "The Cold Key": The Insider. Every family the Locksmith rang bought a wallet from the same shop, and
// its customer list leaked. Nonce, a kid in the Docks, knows where the buyer logged in: the dead Gate exchange.
// Behind its lobby terminals, past the night watchman's torch, sits Teo's account, frozen for eleven years, and a
// login from last night. Teo staged it all. The act ends as Ivy calls: a signing ceremony, tonight, and one of her
// guardians is already the Locksmith's. The finale is a live Council match.
import type { Vec2 } from '../map.js';
import { BREAKWATER } from './ransom.js';
import type { Mark, Script } from './script.js';
import type { StoryAct, StorySpot } from './story.js';

export const INSIDER_STEPS = ['call', 'toNonce', 'nonce', 'toTower', 'tower', 'search', 'found', 'done'] as const;
export type InsiderStep = (typeof INSIDER_STEPS)[number];

export const INSIDER_START: Vec2 = Object.freeze({ x: BREAKWATER.x, y: BREAKWATER.y });
export const NONCE_SPOT: Vec2 = Object.freeze({ x: 24.5, y: 66.5 });
export const TOWER_SPOT: Vec2 = Object.freeze({ x: 80, y: 59.8 });

// The dead exchange's lobby terminals, two on each side of the tower. The buyer's login is on one of the east two.
export const TERMINALS: readonly (StorySpot & { readonly east: boolean })[] = Object.freeze([
  { at: { x: 74.6, y: 51.5 }, label: 'north-west', east: false },
  { at: { x: 74.6, y: 57.5 }, label: 'south-west', east: false },
  { at: { x: 84.6, y: 51.5 }, label: 'north-east', east: true },
  { at: { x: 84.6, y: 57.5 }, label: 'south-east', east: true },
]);
export const LOGIN_TERMINALS: readonly number[] = Object.freeze(TERMINALS.flatMap((t, i) => (t.east ? [i] : [])));
export const SEARCH_REACH = 1.5;
export const SEARCH_MS = 1_600;

export const TEO_ACCOUNT = 'TEO_DIAMONDHANDS. Frozen for eleven years. Last login: last night, from this terminal.';
export const OTHER_ACCOUNTS: readonly string[] = Object.freeze([
  'A frozen account: GRANDMA_JOAN. Last login 2014. Memo: “for the grandkids”.',
  'A frozen account: PIZZA_MIKE_99. Two large pizzas’ worth, eleven years ago. A fortune now.',
  'A frozen account: ANON_ANON. Last login 2014. Password hint: “not your keys”.',
]);

// Gus walks the tower's walls all night. The tower itself blocks his torch, so the far side is the safe side.
export const WATCH_ROUTE: readonly Vec2[] = Object.freeze([
  { x: 73.5, y: 47.5 },
  { x: 85.5, y: 47.5 },
  { x: 85.5, y: 59.6 },
  { x: 73.5, y: 59.6 },
]);
export const WATCH_SPEED = 1.7;

export const INSIDER_OBJECTIVES: Readonly<Record<InsiderStep, string>> = Object.freeze({
  call: 'Brannigan is on the phone.',
  toNonce: 'Find Nonce in the container yard at the Reef Docks.',
  nonce: 'Talk to Nonce.',
  toTower: 'Get to the dead Gate exchange tower on Council Hill.',
  tower: 'The Gate exchange.',
  search: 'Search the lobby terminals for the buyer’s login. Stay out of Gus’s torch.',
  found: 'Floor one, a frozen account.',
  done: 'Act three complete.',
});

export const INSIDER_MARKS: Readonly<Record<string, Mark>> = Object.freeze({
  clueList: { text: 'Everyone the Locksmith rang bought a wallet from the same shop. Its customer list leaked.', clue: true },
  askedBrannigan: { who: 'brannigan', text: 'you asked how he knew to call you' },
  paidNonce: { who: 'nonce', text: 'you paid for the truth' },
  pushedNonce: { who: 'nonce', text: 'you leaned on him' },
  honestNonce: { who: 'nonce', text: 'you told him what the list did', honest: true },
  clueEast: { text: 'The buyer logged in from the Gate exchange’s old lobby terminals, on the east side.', clue: true },
  clueYacht: { text: 'The buyer’s phone case had a tacky yacht on it.', clue: true },
  talkedTeo: { who: 'teo', text: 'you sat down and listened', honest: true },
  cuffedTeo: { who: 'teo', text: 'you handed him to Brannigan' },
  askedCut: { who: 'teo', text: 'you asked what your cut would be' },
});

export const INSIDER_REWARD_SATS = 350;

export const INSIDER_SCRIPT: Script = Object.freeze({
  morning: {
    slug: 'EXT. THE OLD BREAKWATER — MORNING · PHONE CALL',
    action: 'Gulls. Brannigan’s name on Rook’s screen. Teo went home last night to “sleep it off”. He isn’t answering.',
    lines: [
      { who: 'brannigan', text: 'Morning. I did some homework, which I hate.' },
      { who: 'brannigan', text: 'Every family this Locksmith rang bought a wallet from the same little shop on Signet Row. Their customer list went up for sale online.' },
      { who: 'brannigan', text: 'Names, addresses, what they bought. He knew exactly who to call.' },
      { who: 'brannigan', text: 'There’s a kid in the Docks who knows who bought it. Calls himself Nonce. Don’t laugh at the name.' },
    ],
    choices: [
      { id: 'ask', tag: 'Ask', text: 'How did you know to call me?', go: 'morningAsk', mark: 'askedBrannigan' },
      { id: 'go', tag: 'Go', text: 'On my way.', go: 'morningGo' },
    ],
    seconds: 9,
    timeout: 'morningSilence',
  },
  morningAsk: {
    lines: [
      { who: 'brannigan', text: 'Your name’s on the list, Rook. You bought a wallet there in 2013. Under your own name. With your home address.' },
      { who: 'rook', paren: 'to self', text: 'Brilliant.' },
    ],
    next: 'morningEnd',
  },
  morningGo: { lines: [{ who: 'brannigan', text: 'Course you are. Try not to break anything. Including Nonce.' }], next: 'morningEnd' },
  morningSilence: { lines: [{ who: 'brannigan', text: 'I’ll take that as a grunt of thanks.' }], next: 'morningEnd' },
  morningEnd: {
    action: 'The line clicks off. Across the water the Docks cranes are already swinging.',
    lines: [{ who: 'rook', text: 'A leaked list. Somebody sold every name on it to a voice on the phone.' }],
    mark: 'clueList',
    then: 'toNonce',
  },

  nonce: {
    slug: 'EXT. REEF DOCKS, CONTAINER YARD — DAY',
    action: 'A shipping container with a door cut into it. Inside: three laptops, a beanbag, and NONCE, seventeen, who doesn’t look up.',
    lines: [
      { who: 'nonce', text: 'Respectfully, I don’t do walk-ins.' },
      { who: 'rook', text: 'The wallet shop’s customer list. Who bought it?' },
      { who: 'nonce', text: 'Hypothetically? Somebody paid for a hypothetical list in gift cards. Very hypothetical gift cards.' },
    ],
    choices: [
      { id: 'pay', tag: 'Pay', text: 'Name your price. In play sats. I’m not made of money.', go: 'noncePay', mark: 'paidNonce' },
      { id: 'push', tag: 'Push', text: 'Brannigan’s outside. Talk to me or talk to him.', go: 'noncePush', mark: 'pushedNonce' },
      { id: 'truth', tag: 'Truth', text: 'Someone used that list to scare my friend half to death.', go: 'nonceTruth', mark: 'honestNonce' },
    ],
    seconds: 12,
    timeout: 'nonceSilence',
  },
  noncePay: {
    lines: [
      { who: 'nonce', text: 'Ugh. Fine. Respect.' },
      { who: 'nonce', text: 'The buyer only ever logged in from the dead Gate exchange. The old lobby terminals, east side. Weird flex.' },
    ],
    mark: 'clueEast',
    next: 'nonceEnd',
  },
  noncePush: {
    lines: [
      { who: 'nonce', paren: 'pale', text: 'Okay. Okay, wow. Okay.' },
      { who: 'nonce', text: 'The Gate exchange. The old lobby terminals. That’s all I’ve got. Please don’t bring the raincoat in here.' },
    ],
    next: 'nonceEnd',
  },
  nonceTruth: {
    action: 'Nonce stops typing.',
    lines: [
      { who: 'nonce', text: 'Scared, like… actually scared?' },
      { who: 'nonce', text: 'I thought it was just, like, marketing.' },
      { who: 'nonce', text: 'The Gate exchange. Old lobby terminals, east side. And the buyer’s phone case had a yacht on it. A really tacky yacht.' },
    ],
    mark: 'clueEast',
    next: 'nonceYacht',
  },
  nonceYacht: { lines: [{ who: 'rook', paren: 'to self', text: 'A yacht. Every one of Teo’s posts has a yacht in it.' }], mark: 'clueYacht', next: 'nonceEnd' },
  nonceSilence: {
    lines: [
      { who: 'nonce', text: 'Cool. A staring contest. I was raised by the internet, I can do this all day.' },
      { who: 'nonce', paren: 'cracking first', text: 'The Gate exchange. Lobby terminals. Now please leave, you’re blocking my wifi.' },
    ],
    next: 'nonceEnd',
  },
  nonceEnd: {
    lines: [{ who: 'nonce', text: 'And if you go in there: the night watchman’s called Gus. Big torch. Bigger opinions.' }],
    then: 'toTower',
  },

  tower: {
    slug: 'EXT. GATE EXCHANGE TOWER — NIGHT',
    action: 'Thirty-one dead floors. Behind the lobby glass the old terminals still glow: WITHDRAWALS TEMPORARILY PAUSED. They have said so for eleven years.',
    lines: [
      { who: 'watchman', paren: 'somewhere round the corner, singing badly', text: 'Paused, paused, temporarily paaaused…' },
      { who: 'rook', paren: 'whispering', if: 'clueEast', text: 'East side. Start with the east terminals.' },
      { who: 'rook', paren: 'whispering', unless: 'clueEast', text: 'Four terminals. One of them has the buyer’s login.' },
      { who: 'rook', paren: 'whispering', text: 'Stay out of Gus’s torch. The tower’s between us and him if we’re quick.' },
    ],
    then: 'search',
  },

  account: {
    slug: 'INT. GATE EXCHANGE, LOBBY — NIGHT',
    action: 'The terminal wakes. A frozen account, eleven years old. Balance: everything Teo ever had. Last login: last night. TEO_DIAMONDHANDS.',
    lines: [
      { who: 'rook', text: 'No.' },
      { who: 'teo', paren: 'from the dark behind them, in yesterday’s shirt', text: 'You know what it’s like to watch your whole life sit behind that sentence for eleven years?' },
      { who: 'rook', text: 'You could have told me.' },
      { who: 'teo', text: 'Told you what? That the guy who taught you what a wallet was didn’t hold his own keys?' },
      { who: 'teo', paren: 'a laugh that goes wrong halfway', text: 'He never had me, Rook. I phoned him. Best business call I’ve made in years.' },
    ],
    choices: [
      { id: 'talk', tag: 'Talk', text: 'Sit down, Teo. Tell me all of it.', go: 'teoTalk', mark: 'talkedTeo' },
      { id: 'cuff', tag: 'Cuff', text: 'Brannigan’s on his way. Hands where I can see them.', go: 'teoCuff', mark: 'cuffedTeo' },
      { id: 'cut', tag: 'Cut', text: 'What was my cut going to be?', go: 'teoCut', mark: 'askedCut' },
    ],
    seconds: 12,
    timeout: 'teoSilence',
  },
  teoTalk: {
    action: 'Teo sits down on the lobby floor, under the glowing sign.',
    lines: [
      { who: 'teo', text: 'He gets the lists. I pick the names. People I knew would pay quick and never ring the police.' },
      { who: 'teo', text: 'Then he said: one more. Someone with a key to the whole vault.' },
      { who: 'rook', text: 'Who?' },
      { who: 'teo', text: 'One of Ivy’s guardians. He’s already got one inside, Rook. He just needs a few more.' },
    ],
    next: 'teoEnd',
  },
  teoCuff: {
    action: 'Teo holds out his wrists, almost relieved.',
    lines: [{ who: 'teo', text: 'You’ll want the last name on the list first. Ask Ivy which guardian never signs before lunch.' }],
    next: 'teoEnd',
  },
  teoCut: {
    lines: [
      { who: 'teo', paren: 'slowly, the grin coming back', text: 'Now that’s the Rook I know.' },
      { who: 'teo', text: 'Half. Of everything in Ivy’s vault. All it takes is enough guardians signing at once, and he’s already got one.' },
    ],
    next: 'teoEnd',
  },
  teoSilence: {
    lines: [
      { who: 'teo', text: 'Say something. You’re doing the face again.' },
      { who: 'teo', text: 'Fine. He has one of Ivy’s guardians. He needs a few more. That’s all I know.' },
    ],
    next: 'teoEnd',
  },
  teoEnd: {
    action: 'Rook’s phone buzzes. IVY.',
    lines: [
      { who: 'ivy', paren: 'on the phone, very calm, which is worse', text: 'Rook. Wren has just called a signing ceremony. Tonight. To move the whole vault.' },
      { who: 'ivy', text: 'Enough signatures move it. The Locksmith needs enough of us. He has at least one.' },
      { who: 'rook', text: 'Then nobody signs anything until we know who’s lying.' },
    ],
    after: 'Outside, Gus’s torch swings past the lobby glass, and keeps going.',
    then: 'done',
  },
});

export const INSIDER_ACT: StoryAct = Object.freeze({
  id: 'insider',
  kind: 'act',
  number: 'Act three',
  title: 'The Insider',
  blurb: 'Inspired by a wallet maker’s leaked customer list, and an exchange that froze withdrawals.',
  steps: INSIDER_STEPS,
  scenes: Object.freeze({ call: 'morning', nonce: 'nonce', tower: 'tower', found: 'account' }),
  objectives: INSIDER_OBJECTIVES,
  targets: Object.freeze({ toNonce: NONCE_SPOT, toTower: TOWER_SPOT }),
  arrivals: Object.freeze({ toNonce: { at: NONCE_SPOT, range: 2.5, to: 'nonce' }, toTower: { at: TOWER_SPOT, range: 2.5, to: 'tower' } }),
  closed: ['found', 'done'],
  workStep: 'search',
  spots: TERMINALS,
  workReach: SEARCH_REACH,
  workMs: SEARCH_MS,
  workGoal: 0,
  workVerb: 'Search the {} terminal',
  markers: 'labels',
  hint: 'Four lobby terminals, one with the buyer’s login. Search while Gus is round the other side.',
  night: 0.6,
  nights: Object.freeze({ call: 0.12, toNonce: 0.12, nonce: 0.12, toTower: 0.12 }),
  catchers: Object.freeze({
    guard: {
      name: 'Gus',
      where: 'the front of the tower',
      lines: [
        'Gus: “Oi! Lobby’s shut. Has been for eleven years. Out the front, please.”',
        'Gus: “You again? Withdrawals are paused. So are you. Front, now.”',
        'Gus: “Third time. I’m putting you in my song.”',
      ],
    },
  }),
  start: INSIDER_START,
  script: INSIDER_SCRIPT,
  marks: INSIDER_MARKS,
  rewardSats: INSIDER_REWARD_SATS,
  lesson:
    'Your coins are only as private as the shop that sold you the wallet. A leaked customer list told a con man exactly who to call. Buy privately, keep your holdings to yourself, and remember: an exchange that holds your keys can freeze them for eleven years.',
  next: 'Finale: the signing ceremony is a live Council match, and how it ends follows you into act four. Gather five or more guardians, and find out who’s lying before anyone signs.',
  finale: 'Start the signing ceremony',
});
