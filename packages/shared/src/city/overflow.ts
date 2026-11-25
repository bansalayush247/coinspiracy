// Season two, act one of "The Cold Key": The Overflow. Rook asks Mags about the voicemail and gets "wrong number".
// Then Ivy calls: overnight, two notes worth ninety-two billion coins each were minted at the Concord Mint. The
// code that adds a payment up overflowed, so numbers too big to exist wrapped round and passed the check. The crew
// finds which Saltmarket stalls took the bad notes, catches the sixteen-year-old who found the bug, and the
// guardians agree on a fix within the hour. Nobody has to trust one coder; everyone checks the maths.
import type { Vec2 } from '../map.js';
import { GATE_SPOT } from './dump.js';
import { IVY_SPOT } from './ransom.js';
import type { Mark, Script } from './script.js';
import type { StoryAct, StorySpot } from './story.js';

export const OVERFLOW_STEPS = ['call', 'toMint', 'mint', 'verify', 'chase', 'caught', 'done'] as const;

export const OVERFLOW_START: Vec2 = Object.freeze({ x: GATE_SPOT.x, y: GATE_SPOT.y });

// The Saltmarket stalls that may have taken a bad note; the server picks which ones did.
export const STALLS: readonly StorySpot[] = Object.freeze([
  { at: { x: 60.5, y: 69.5 }, label: 'tomato stall' },
  { at: { x: 54.5, y: 70.5 }, label: 'fish market' },
  { at: { x: 71.5, y: 66.5 }, label: 'olive shop' },
  { at: { x: 53.5, y: 86.8 }, label: 'oyster stall' },
  { at: { x: 76.5, y: 85.5 }, label: 'cheese stall' },
]);
export const BAD_STALLS = 3;
export const STALL_REACH = 1.3;
export const STALL_MS = 1_800;
export const BAD_NOTES: readonly string[] = Object.freeze([
  'A note for 92,233,720,368 coins, for a bag of tomatoes. The change was everything in the till.',
  'A note for 92,233,720,368 coins, for one fish. “He said keep the change. I gave him the change.”',
  'A note for 92,233,720,368 coins, for a jar of olives. The shopkeeper had it framed.',
  'Another 92-billion note, for oysters. A kid in a green hoodie, the stallholder says. Ran towards the market.',
  'Another 92-billion note, for a whole wheel of cheese. A kid in a green hoodie. Couldn’t carry it.',
]);
export const CLEAN_NOTE = 'Every note in the till adds up. Nothing strange here.';

// Ozzy laps the stalls in the middle of the market, sprinting when anyone gets close, until he runs out of puff.
export const OZZY_LOOP: readonly Vec2[] = Object.freeze([
  { x: 48.5, y: 85.5 },
  { x: 48.5, y: 93.5 },
  { x: 54.6, y: 93.5 },
  { x: 54.6, y: 85.5 },
]);
export const OZZY_WALK = 2.2;
export const OZZY_SPRINT = 3.4;
export const OZZY_SPRINT_MS = 4_000;
export const OZZY_REST_MS = 3_000;
export const OZZY_REST_SPEED = 1;
// He starts sprinting when anyone is this close, and is caught when someone gets this close.
export const OZZY_NOTICES = 5;
export const OZZY_CAUGHT = 1;
export const MARKET_MIDDLE: Vec2 = Object.freeze({ x: 51.5, y: 89.5 });

export const OVERFLOW_OBJECTIVES: Readonly<Record<(typeof OVERFLOW_STEPS)[number], string>> = Object.freeze({
  call: 'Gullmoor tip, the gatehouse hatch. Morning.',
  toMint: 'Get to Ivy at the Concord Mint.',
  mint: 'Mint Hall.',
  verify: 'Check the notes at the Saltmarket stalls. Find the three that took a bad one.',
  chase: 'A kid in a green hoodie is running laps of the market. Catch up with him.',
  caught: 'The kid in the green hoodie.',
  done: 'Season two, act one complete.',
});

export const OVERFLOW_MARKS: Readonly<Record<string, Mark>> = Object.freeze({
  pastHonest: { text: 'you told the plain truth at least once at the tip' },
  pressedMags: { who: 'mags', text: 'you asked her straight out' },
  leftMags: { who: 'mags', text: 'you let her keep her secret', honest: true },
  thankedMags: { who: 'mags', text: 'you thanked her for the mug' },
  clueOverflow: { text: 'The note was so big the sum wrapped round and looked small, so the check passed.', clue: true },
  fixFirst: { who: 'ivy', text: 'you said fix it before anything else' },
  chaseFirst: { who: 'ivy', text: 'you went after the notes first' },
  doubtedIvy: { who: 'ivy', text: 'you asked how you could know it wasn’t her' },
  clueHoodie: { text: 'Whoever spent the bad notes wore a green hoodie, and ran towards the middle of the market.', clue: true },
  reportedBug: { who: 'ozzy', text: 'you asked him to show Ivy exactly how', honest: true },
  scoldedOzzy: { who: 'ozzy', text: 'you told him off' },
  recruitedOzzy: { who: 'ozzy', text: 'you said he should be on Ivy’s team' },
});

export const OVERFLOW_REWARD_SATS = 300;

export const OVERFLOW_SCRIPT: Script = Object.freeze({
  hatch: {
    slug: 'EXT. GULLMOOR TIP, GATE — MORNING',
    action: 'The hatch. Duncan asleep across the doorstep. Mags inside, doing a crossword in pen.',
    lines: [
      { who: 'rook', text: 'The voicemail. 3 January 2009. It sounded like you.' },
      { who: 'mags', paren: 'not looking up', text: 'Wrong number, love.' },
      { who: 'mags', if: 'pastHonest', text: 'Lots of people sound like me. It’s a common sort of voice.' },
    ],
    choices: [
      { id: 'press', tag: 'Press', text: 'You’re the Founder, Mags. Say it.', go: 'hatchPress', mark: 'pressedMags' },
      { id: 'leave', tag: 'Leave it', text: 'Fine. Keep it. It’s yours to keep.', go: 'hatchLeave', mark: 'leftMags' },
      { id: 'mug', tag: 'Mug', text: 'Thanks for the mug. I use it every day.', go: 'hatchMug', mark: 'thankedMags' },
    ],
    seconds: 12,
    timeout: 'hatchLeave',
  },
  hatchPress: {
    lines: [
      { who: 'mags', paren: 'filling in a word', text: 'Seven down. “Person who isn’t important any more.” Nine letters.' },
      { who: 'rook', text: 'That’s not an answer.' },
      { who: 'mags', text: 'It’s the right one, though.' },
    ],
    next: 'hatchPhone',
  },
  hatchLeave: { lines: [{ who: 'mags', paren: 'a small smile at the crossword', text: 'You’re learning.' }], next: 'hatchPhone' },
  hatchMug: { lines: [{ who: 'mags', text: 'Good. Duncan checks.' }], next: 'hatchPhone' },
  hatchPhone: {
    action: 'Rook’s phone. IVY. She never calls before nine.',
    lines: [
      { who: 'ivy', paren: 'on the phone, very calm, which is worse', text: 'Rook. Last night somebody minted two notes at the Mint. Ninety-two billion coins each.' },
      { who: 'rook', text: 'There aren’t ninety-two billion coins.' },
      { who: 'ivy', text: 'There are now. Come to Mint Hall.' },
    ],
    then: 'toMint',
  },

  mint: {
    slug: 'EXT. MINT HALL STEPS — MORNING',
    action: 'Ivy, on the steps, with a laptop and four very worried guardians.',
    lines: [
      { who: 'ivy', text: 'Every payment gets added up before we sign it. Coins in, coins out, they have to match.' },
      { who: 'ivy', text: 'He sent two numbers so big that the sum ran out of room and wrapped round to something tiny. The check said fine. We signed.' },
      { who: 'rook', text: 'So the maths had a hole in it.' },
      { who: 'ivy', text: 'And the whole city can read the maths. Which is how we’ll fix it. The guardians have to agree on the patch, and on voiding the bad notes. But they were spent first.' },
    ],
    mark: 'clueOverflow',
    choices: [
      { id: 'fix', tag: 'Fix first', text: 'Get the guardians agreeing on the patch. I’ll find the notes.', go: 'mintFix', mark: 'fixFirst' },
      { id: 'chase', tag: 'Chase', text: 'Where were they spent?', go: 'mintChase', mark: 'chaseFirst' },
      { id: 'doubt', tag: 'Doubt', text: 'How do I know this wasn’t you?', go: 'mintDoubt', mark: 'doubtedIvy' },
    ],
    seconds: 14,
    timeout: 'mintChase',
  },
  mintFix: { lines: [{ who: 'ivy', text: 'Already on it. Four of us have read the patch. One more and it goes in.' }], next: 'mintEnd' },
  mintChase: { lines: [{ who: 'ivy', text: 'Saltmarket. Somebody’s been buying breakfast all morning with notes that don’t add up.' }], next: 'mintEnd' },
  mintDoubt: {
    lines: [
      { who: 'ivy', text: 'You don’t. That’s the point. The patch is public. Read it. Every guardian is reading it. Nobody signs because I said so.' },
      { who: 'rook', text: 'Okay. That’s a good answer.' },
    ],
    next: 'mintEnd',
  },
  mintEnd: {
    lines: [{ who: 'ivy', text: 'Check the notes at the market stalls. Three of them took a bad one. And Rook: whoever did this is probably still there, still hungry.' }],
    then: 'verify',
  },

  caught: {
    slug: 'EXT. SALTMARKET MARKET — DAY',
    action: 'OZZY, sixteen, green hoodie, out of breath, sits down on a crate surrounded by shopping he couldn’t carry.',
    lines: [
      { who: 'ozzy', text: 'Okay! Okay. I wasn’t running away. I was running generally.' },
      { who: 'ozzy', text: 'I just wanted to see if it’d work. I typed a really big number and the Mint just… signed it.' },
      { who: 'ozzy', paren: 'holding up a wheel of cheese', text: 'Then I panicked and bought cheese.' },
    ],
    choices: [
      { id: 'report', tag: 'Show Ivy', text: 'Come and show Ivy exactly how you did it.', go: 'caughtReport', mark: 'reportedBug' },
      { id: 'scold', tag: 'Scold', text: 'People’s savings are in that Mint, Ozzy.', go: 'caughtScold', mark: 'scoldedOzzy' },
      { id: 'hire', tag: 'Hire', text: 'You found a hole nobody else did. You should be on Ivy’s team.', go: 'caughtHire', mark: 'recruitedOzzy' },
    ],
    seconds: 12,
    timeout: 'caughtReport',
  },
  caughtReport: { lines: [{ who: 'ozzy', text: 'Really? Not the police? Okay. Yes. I can do that. I wrote it all down, actually.' }], next: 'fixed' },
  caughtScold: {
    lines: [
      { who: 'ozzy', paren: 'small', text: 'I know. I didn’t think. I’ll give the cheese back.' },
      { who: 'rook', text: 'Give Ivy the notes back first. Then the cheese.' },
    ],
    next: 'fixed',
  },
  caughtHire: { lines: [{ who: 'ozzy', paren: 'lighting up', text: 'Is there a hoodie? Like a team hoodie?' }], next: 'fixed' },
  fixed: {
    slug: 'EXT. MINT HALL STEPS — AN HOUR LATER',
    action: 'Ozzy on the steps with Ivy’s laptop, explaining it to five guardians at once. One by one, they nod.',
    lines: [
      { who: 'ivy', text: 'Five of five read the patch and agreed. The bad notes are void. The stalls get paid back from the Mint’s fee pot.' },
      { who: 'ivy', text: 'An hour, from a hole in the maths to everybody fixing it. Nobody had to trust one coder.' },
      { who: 'rook', text: 'They just had to check.' },
    ],
    after: 'Somewhere in Gullmoor, a radio clicks on. Someone is listening to the Mint channel, and smiling.',
    then: 'done',
  },
});

export const OVERFLOW_ACT: StoryAct = Object.freeze({
  id: 'overflow',
  kind: 'act',
  number: 'Season two, act one',
  title: 'The Overflow',
  blurb: 'Inspired by the night a bug minted billions of coins, and how fast everyone agreed to fix it.',
  steps: OVERFLOW_STEPS,
  scenes: Object.freeze({ call: 'hatch', mint: 'mint', caught: 'caught' }),
  objectives: OVERFLOW_OBJECTIVES,
  targets: Object.freeze({ toMint: IVY_SPOT, chase: MARKET_MIDDLE }),
  arrivals: Object.freeze({ toMint: { at: IVY_SPOT, range: 2.5, to: 'mint' } }),
  closed: ['caught', 'done'],
  workStep: 'verify',
  spots: STALLS,
  workReach: STALL_REACH,
  workMs: STALL_MS,
  workGoal: 0,
  workVerb: 'Check the notes at the {}',
  hint: 'Five stalls round Saltmarket; three took a bad note. Split up to be quicker.',
  markers: 'labels',
  night: 0.08,
  catchers: Object.freeze({}),
  carries: true,
  start: OVERFLOW_START,
  script: OVERFLOW_SCRIPT,
  marks: OVERFLOW_MARKS,
  rewardSats: OVERFLOW_REWARD_SATS,
  lesson:
    'Two numbers too big to exist wrapped round and passed the check. It was fixed within the hour because the rules are public: anyone can read the maths, and every guardian checks it before agreeing. Don’t trust one person, or one coder. Verify.',
  next: 'Season two continues. The Mint is fixed; the radio in Gullmoor is still on.',
});
