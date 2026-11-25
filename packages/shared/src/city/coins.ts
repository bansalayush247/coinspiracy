// Side case: Follow the Coins. Coins stolen seven years ago moved last night, and on a public chain every move is
// there for anyone to read. Brannigan and Rook follow them by two old rules of thumb (the odd amount is the change;
// coins spent together share an owner) to an address reused on a tip jar in the Saltmarket market, past a music
// video shoot, to the rapper who boasted about it.
import type { Vec2 } from '../map.js';
import type { Mark, Script } from './script.js';
import type { StoryAct, StorySpot } from './story.js';

export const COINS_STEPS = ['call', 'scan', 'found', 'toStudio', 'studio', 'done'] as const;

export const COINS_START: Vec2 = Object.freeze({ x: 50.5, y: 79.5 });
export const STUDIO_DOOR: Vec2 = Object.freeze({ x: 45.5, y: 74.5 });

// The market's tip jars; the thief's reused address is on one of them, picked by the server.
export const TIP_JARS: readonly StorySpot[] = Object.freeze([
  { at: { x: 48.5, y: 82.5 }, label: 'fishmonger’s' },
  { at: { x: 53.5, y: 86.8 }, label: 'oyster stall’s' },
  { at: { x: 48.5, y: 91.5 }, label: 'crêpe stall’s' },
  { at: { x: 53.5, y: 96.8 }, label: 'flower stall’s' },
]);
export const JAR_REACH = 1.3;
export const JAR_MS = 1_600;
export const JAR_FOUND = 'The QR code on this tip jar matches. Same address, used over and over. Sixty-one payments.';
export const JAR_NOTES: readonly string[] = Object.freeze([
  'A QR code for tips. A fresh address every week, the stallholder says proudly. Not this one.',
  'A QR code for tips. A different address entirely. Not this one.',
  'A QR code for tips, and a sign: “cash also welcome, honestly prefer it”. Not this one.',
]);

// The video crew's runner, Tiny, walks the east lane of the market with a ring light.
export const TINY_ROUTE: readonly Vec2[] = Object.freeze([
  { x: 54.6, y: 84.5 },
  { x: 54.6, y: 97.5 },
]);
export const TINY_SPEED = 1.5;

export const COINS_OBJECTIVES: Readonly<Record<(typeof COINS_STEPS)[number], string>> = Object.freeze({
  call: 'The top of the Saltmarket market. Brannigan has a tablet.',
  scan: 'Check the market’s tip jars for the reused address. Keep out of the music video’s ring light.',
  found: 'The tip jar.',
  toStudio: 'Get to the old warehouse on the docks.',
  studio: 'The old warehouse.',
  done: 'Case closed.',
});

export const COINS_MARKS: Readonly<Record<string, Mark>> = Object.freeze({
  gotChange: { text: 'Round amounts are usually payments; the odd leftover is the change, back to the same wallet.', clue: true },
  gotCommon: { text: 'Coins spent together in one payment almost always belong to one wallet.', clue: true },
  missedChange: { who: 'brannigan', text: 'you guessed the change wrong' },
  missedCommon: { who: 'brannigan', text: 'you guessed the shared spend wrong' },
  calledBrannigan: { who: 'mc', text: 'you called it in straight away', honest: true },
  letHimFinish: { who: 'mc', text: 'you let him finish the verse' },
  askedAutograph: { who: 'mc', text: 'you asked for an autograph' },
});

export const COINS_REWARD_SATS = 150;

export const COINS_SCRIPT: Script = Object.freeze({
  chain: {
    slug: 'EXT. SALTMARKET MARKET — MORNING',
    action: 'Brannigan, on a crate, with a tablet. On screen: a public ledger. Lines and numbers, all of it open to anyone.',
    lines: [
      { who: 'brannigan', text: 'Five coins, stolen seven years ago. They haven’t moved since. Until last night.' },
      { who: 'brannigan', text: 'One payment out. It split in two: exactly 2.0000 coins, and 2.9871 coins.' },
      { who: 'brannigan', text: 'One piece is what he paid. The other is his change, back to his own wallet. Which?' },
    ],
    choices: [
      { id: 'round', tag: '2.0000', text: 'The round 2.0000 is the change.', go: 'chainRound', mark: 'missedChange' },
      { id: 'odd', tag: '2.9871', text: 'The odd 2.9871 is the change.', go: 'chainOdd', mark: 'gotChange' },
    ],
    seconds: 15,
    timeout: 'chainOddHint',
  },
  chainRound: {
    lines: [
      { who: 'brannigan', text: 'Other way round. People pay round numbers: two coins, that’s a price.' },
      { who: 'brannigan', text: 'The odd leftover, 2.9871, is what came back to him.' },
    ],
    mark: 'gotChange',
    next: 'chainTwo',
  },
  chainOdd: { lines: [{ who: 'brannigan', text: 'That’s what I’d say. Round numbers are prices. Odd leftovers come home.' }], next: 'chainTwo' },
  chainOddHint: {
    lines: [{ who: 'brannigan', text: 'The odd one. Round numbers are prices; the odd leftover is his change.' }],
    mark: 'gotChange',
    next: 'chainTwo',
  },
  chainTwo: {
    action: 'He swipes. The 2.9871 moves again, this time paid out together with another coin, 1.5, in one payment.',
    lines: [{ who: 'brannigan', text: 'Two coins, spent in one go. What does that tell you?' }],
    choices: [
      { id: 'same', tag: 'Same', text: 'Both coins belong to the same wallet.', go: 'chainSame', mark: 'gotCommon' },
      { id: 'two', tag: 'Two', text: 'Two people chipped in together.', go: 'chainNot', mark: 'missedCommon' },
      { id: 'nothing', tag: 'Nothing', text: 'Nothing. Coins are coins.', go: 'chainNot', mark: 'missedCommon' },
    ],
    seconds: 15,
    timeout: 'chainNot',
  },
  chainSame: { lines: [{ who: 'brannigan', text: 'Right. Spending two coins at once takes both keys. Nearly always, one wallet.' }], next: 'chainEnd' },
  chainNot: {
    lines: [{ who: 'brannigan', text: 'Spending two coins at once takes both keys. Nearly always, that’s one wallet. So the 1.5 is his too.' }],
    mark: 'gotCommon',
    next: 'chainEnd',
  },
  chainEnd: {
    lines: [
      { who: 'brannigan', text: 'And that 1.5 came in as tips. Sixty-one little payments, all to one address he never changed.' },
      { who: 'brannigan', text: 'That address is printed on a QR code. In this market. On a tip jar.' },
      { who: 'rook', text: 'He used his stolen-coins wallet for tips.' },
      { who: 'brannigan', paren: 'pointing down the lane, where a ring light glows', text: 'And somebody’s shooting a music video down there. Don’t walk into it.' },
    ],
    then: 'scan',
  },

  jar: {
    slug: 'EXT. SALTMARKET MARKET — CONTINUOUS',
    action: 'The stallholder leans over the tip jar, delighted to be asked.',
    lines: [
      { who: 'stall', text: 'That QR? A lad in a gold tracksuit pays me a coin a week to keep it up. Tips for his music.' },
      { who: 'stall', text: 'He records in the old warehouse on the docks. Loud. Very loud. About money, mostly.' },
    ],
    then: 'toStudio',
  },

  studio: {
    slug: 'INT. OLD WAREHOUSE, REEF DOCKS — DAY',
    action: 'A sofa, a microphone, foil on the walls. MC MEMPOOL, in a gold tracksuit, mid-take.',
    lines: [
      { who: 'mc', paren: 'rapping', text: 'Mixed my coins like socks in a dryer / chain can’t see me, I’m a high flyer.' },
      { who: 'mc', paren: 'rapping', text: 'Tip jar QR on the fish market wall / one address, I don’t change it at all.' },
      { who: 'mc', paren: 'stopping', text: 'Who let you in? This is a closed set.' },
      { who: 'rook', text: 'You rapped your own address. And printed it on a tip jar.' },
    ],
    choices: [
      { id: 'call', tag: 'Call', text: 'Brannigan? He’s here. Bring the raincoat.', go: 'studioCall', mark: 'calledBrannigan' },
      { id: 'verse', tag: 'Verse', text: 'Finish the verse first. It’s catchy.', go: 'studioVerse', mark: 'letHimFinish' },
      { id: 'sign', tag: 'Sign', text: 'Would you sign my phone case? For my friend.', go: 'studioSign', mark: 'askedAutograph' },
    ],
    seconds: 12,
    timeout: 'studioCall',
  },
  studioCall: { lines: [{ who: 'mc', paren: 'sitting down on the sofa', text: 'This is going to ruin the video.' }], next: 'studioEnd' },
  studioVerse: {
    lines: [
      { who: 'mc', paren: 'rapping, quieter', text: 'Public ledger, open for days / every coin I touched left a trail of… oh no.' },
      { who: 'brannigan', paren: 'from the doorway', text: 'Great track. Hands where I can see them.' },
    ],
    next: 'studioEnd',
  },
  studioSign: {
    lines: [
      { who: 'mc', paren: 'signing it, flattered', text: 'To Rook’s friend. Stay gold.' },
      { who: 'brannigan', paren: 'from the doorway', text: 'Sign this too. It’s a statement.' },
    ],
    next: 'studioEnd',
  },
  studioEnd: {
    action: 'Outside, Brannigan scrolls back through seven years of payments, every one still there.',
    lines: [
      { who: 'brannigan', text: 'Seven years he thought he was hidden. The chain never forgets a thing. It just waits for someone to read it.' },
      { who: 'rook', text: 'With ecash the mint signs the notes without seeing who holds them. Nobody can follow a payment from one person to the next.' },
      { who: 'brannigan', text: 'Don’t tell the crooks.' },
    ],
    then: 'done',
  },
});

export const COINS_ACT: StoryAct = Object.freeze({
  id: 'coins',
  kind: 'case',
  number: 'Side case',
  title: 'Follow the Coins',
  blurb: 'Inspired by stolen coins traced for years to a rapping launderer. Read a public chain like a detective.',
  steps: COINS_STEPS,
  scenes: Object.freeze({ call: 'chain', found: 'jar', studio: 'studio' }),
  objectives: COINS_OBJECTIVES,
  targets: Object.freeze({ toStudio: STUDIO_DOOR }),
  arrivals: Object.freeze({ toStudio: { at: STUDIO_DOOR, range: 2.2, to: 'studio' } }),
  closed: ['studio', 'done'],
  workStep: 'scan',
  spots: TIP_JARS,
  workReach: JAR_REACH,
  workMs: JAR_MS,
  workGoal: 0,
  workVerb: 'Scan the {} tip jar',
  hint: 'Four tip jars. The lane on the east is in the music video. Wait for the ring light to pass.',
  markers: 'labels',
  night: 0.1,
  nights: Object.freeze({ studio: 0.35, done: 0.35 }),
  catchers: Object.freeze({
    guard: {
      name: 'Tiny',
      where: 'the top of the market',
      lines: [
        'Tiny, the video runner: “You’re in the shot. You’re IN the shot.” He walks you to the top of the market.',
        'Tiny: “Again? Do you want to be in the video? Because that’s how you get in the video.” Top of the market.',
        'Tiny: “Third time. The director says you’ve got presence. Still no.”',
      ],
    },
  }),
  start: COINS_START,
  script: COINS_SCRIPT,
  marks: COINS_MARKS,
  rewardSats: COINS_REWARD_SATS,
  lesson:
    'A public chain keeps every payment forever, and anyone can read it. Round payments give the change away, coins spent together give the wallet away, and one reused address ties it all to a face. Ecash is private by design: the mint signs notes blind, so nobody can follow a payment from one person to the next.',
  next: 'Case closed. More cases wait in the casebook.',
});
