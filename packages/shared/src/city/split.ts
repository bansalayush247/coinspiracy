// Season two, act two of "The Cold Key": The Split. The guardians can't agree on an upgrade. Rex Bigsby's
// campaign wants bigger notes, more of them, faster; Ivy says that would make running a guardian too dear for
// ordinary people, and then only the rich would check the maths. Guardians can't force rules on anyone: the
// people who take the Mint's notes decide which notes they'll take. The crew wins Council Hill's shopkeepers round
// while Rex walks his rounds talking them back. Five at once settles it, and Rex forks off with his own coin.
import type { Vec2 } from '../map.js';
import { IVY_SPOT } from './ransom.js';
import type { Mark, Script } from './script.js';
import type { StoryAct, StorySpot } from './story.js';

export const SPLIT_STEPS = ['call', 'toHall', 'hall', 'canvass', 'count', 'done'] as const;

export const HALL_STEPS: Vec2 = Object.freeze({ x: 72.8, y: 38.5 });

// Shopkeepers who take the Mint's notes, each standing outside their shop.
export const SHOPKEEPERS: readonly StorySpot[] = Object.freeze([
  { at: { x: 54.5, y: 41.5 }, label: 'the baker' },
  { at: { x: 60.5, y: 42.5 }, label: 'the florist' },
  { at: { x: 68.5, y: 41.5 }, label: 'the barber' },
  { at: { x: 74.5, y: 42.5 }, label: 'the café owner' },
  { at: { x: 70.5, y: 54.5 }, label: 'the cobbler' },
  { at: { x: 58.5, y: 54.5 }, label: 'the bookseller' },
]);
export const SIGNALS_NEEDED = 5;
export const SHOP_REACH = 1.4;
export const SHOP_MS = 2_000;
export const WON_NOTES: readonly string[] = Object.freeze([
  'The baker: “Small notes, then. My nephew runs a guardian on an old laptop. I’d like him to keep doing that.”',
  'The florist: “If my notes are checked by a hundred little guardians, I trust them more than by three big ones.”',
  'The barber: “Bigger notes, fewer people checking? No. I like a second opinion.”',
  'The café owner: “I’ll take the Mint’s notes as they are. Faster’s nice. Honest is nicer.”',
  'The cobbler: “Mend it slowly and properly. Same as shoes.”',
  'The bookseller: “I read the patch. I read Rex’s leaflet too. The patch was shorter.”',
]);

// Rex heads for whichever won shopkeeper nobody is standing with, nearest first, and talks them back round;
// with nobody to talk round, he goes back to the City Hall steps.
export const REX_SPEED = 2.4;
// Close enough to talk someone round, and how close a crew member must stand to stop him.
export const REX_REACH = 1.3;
export const GUARD_RANGE = 2.5;
// A shopkeeper just won round stays firm this long before Rex can talk them back.
export const WON_FIRM_MS = 22_000;

export function rexTarget(rex: Vec2, won: readonly boolean[], guarded: readonly boolean[]): number {
  let best = -1;
  let bestD = Infinity;
  SHOPKEEPERS.forEach((s, i) => {
    if (won[i] !== true || guarded[i] === true) return;
    const d = Math.hypot(s.at.x - rex.x, s.at.y - rex.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}
export const REX_NOTE = (label: string): string => `Rex talked ${label} round: “Bigger notes, love! Faster!” Win them back.`;

export const SPLIT_OBJECTIVES: Readonly<Record<(typeof SPLIT_STEPS)[number], string>> = Object.freeze({
  call: 'Mint Hall. Ivy has bad news, calmly.',
  toHall: 'Go to the City Hall steps on Council Hill.',
  hall: 'City Hall steps.',
  canvass: 'Win the shopkeepers round. Rex talks back anyone left on their own. Five at once settles it.',
  count: 'The count.',
  done: 'Season two, act two complete.',
});

export const SPLIT_MARKS: Readonly<Record<string, Mark>> = Object.freeze({
  pastHonest: { text: 'you told the plain truth at least once at the tip' },
  clueRules: { text: 'Guardians can’t force rules on anyone. The people who take the notes decide which notes they’ll take.', clue: true },
  heardBoth: { who: 'rex', text: 'you heard him out properly', honest: true },
  heckledRex: { who: 'rex', text: 'you heckled him off his own box' },
  tempted: { who: 'rex', text: 'you liked the sound of faster' },
  wishedRex: { who: 'rex', text: 'you wished him luck with his fork', honest: true },
  warnedRex: { who: 'rex', text: 'you told him nobody would follow' },
  joinedRexFork: { who: 'rex', text: 'you took a few of his new coins, just in case' },
});

export const SPLIT_REWARD_SATS = 350;

export const SPLIT_SCRIPT: Script = Object.freeze({
  radio: {
    slug: 'EXT. MINT HALL STEPS — DAY',
    action: 'Ivy, two guardians arguing behind her, a leaflet in her hand. BIGGER NOTES! FASTER PAYMENTS! VOTE REX!',
    lines: [
      { who: 'ivy', text: 'After the overflow, everyone wants an upgrade. They just don’t want the same one.' },
      { who: 'ivy', text: 'Rex Bigsby wants notes ten times the size. More payments, faster. Sounds lovely.' },
      { who: 'ivy', text: 'But checking giant notes takes a giant computer. Then only the rich run guardians, and only the rich check the maths.' },
      { who: 'rook', text: 'So the guardians vote.' },
      { who: 'ivy', text: 'No. Guardians can’t force new rules on anyone. The people who take our notes decide which notes they’ll take. Rex is on the City Hall steps right now, telling them.' },
    ],
    mark: 'clueRules',
    then: 'toHall',
  },

  hall: {
    slug: 'EXT. CITY HALL STEPS, COUNCIL HILL — DAY',
    action: 'REX BIGSBY, a big smile and a bigger megaphone, on a crate. A small crowd, mostly there for the free badges.',
    lines: [
      { who: 'rex', text: 'Friends! Why wait for your payment? Why settle for small notes? Bigger is better! That’s just maths!' },
      { who: 'rex', paren: 'spotting Rook', text: 'And here’s Ivy’s friend, come to tell you that slow is good. Go on, then.' },
    ],
    choices: [
      { id: 'hear', tag: 'Hear him', text: 'Go on, Rex. Tell me what happens to the little guardians.', go: 'hallHear', mark: 'heardBoth' },
      { id: 'heckle', tag: 'Heckle', text: 'Bigger notes, fewer checkers, more Rexes. No thanks.', go: 'hallHeckle', mark: 'heckledRex' },
      { id: 'tempted', tag: 'Tempted', text: 'Faster does sound good, to be fair.', go: 'hallTempted', mark: 'tempted' },
    ],
    seconds: 12,
    timeout: 'hallHear',
  },
  hallHear: {
    lines: [
      { who: 'rex', paren: 'honestly, for a second', text: 'They’d need better computers. Some would stop. The big ones would carry on.' },
      { who: 'rook', text: 'So fewer people checking.' },
      { who: 'rex', paren: 'the smile back', text: 'Fewer, faster, fabulous. Let the people decide!' },
    ],
    next: 'hallEnd',
  },
  hallHeckle: { lines: [{ who: 'rex', text: 'Ooh, a slogan! Let’s see whose slogan wins, then.' }], next: 'hallEnd' },
  hallTempted: {
    lines: [
      { who: 'rex', text: 'See? Even Ivy’s friend!' },
      { who: 'rook', text: 'I said it sounds good. I didn’t say I’d run the guardian for it.' },
    ],
    next: 'hallEnd',
  },
  hallEnd: {
    lines: [
      { who: 'rex', paren: 'jumping off the crate', text: 'Let the people decide! I’ll be doing my rounds. With the megaphone.' },
      { who: 'rook', paren: 'to the crew', text: 'The shopkeepers who take Mint notes. Talk to them, and stay with them. Rex will try to talk them back.' },
    ],
    then: 'canvass',
  },

  count: {
    slug: 'EXT. CITY HALL STEPS — EVENING',
    action: 'Ivy on the steps with a list. Rex beside her, megaphone down for once.',
    lines: [
      { who: 'ivy', text: 'The shops have spoken. They’ll take the Mint’s notes as they are. Small, checkable, boring.' },
      { who: 'rex', paren: 'surprisingly cheerful', text: 'Then I’ll fork. My own Mint, my own big notes. Anyone who wants them can have them. Nobody gets forced.' },
      { who: 'ivy', text: 'That’s how it should work. Everybody keeps what they had. Then they choose.' },
    ],
    choices: [
      { id: 'luck', tag: 'Good luck', text: 'Good luck, Rex. Honestly.', go: 'countLuck', mark: 'wishedRex' },
      { id: 'warn', tag: 'Warn', text: 'Nobody will follow you.', go: 'countWarn', mark: 'warnedRex' },
      { id: 'hedge', tag: 'Hedge', text: 'I’ll take a few of your coins. Just in case.', go: 'countHedge', mark: 'joinedRexFork' },
    ],
    seconds: 12,
    timeout: 'countLuck',
  },
  countLuck: { lines: [{ who: 'rex', paren: 'shaking Rook’s hand', text: 'Thanks. Somebody had to try it. Now we find out.' }], next: 'countEnd' },
  countWarn: {
    lines: [
      { who: 'rex', text: 'Some will. That’s the beauty of it. Nobody has to ask your permission. Or Ivy’s.' },
      { who: 'ivy', text: 'He’s right, you know.' },
    ],
    next: 'countEnd',
  },
  countHedge: { lines: [{ who: 'rex', paren: 'delighted', text: 'One of the people! Here, have a badge as well.' }], next: 'countEnd' },
  countEnd: {
    action: 'Rex walks off down the hill with a handful of followers and the megaphone. Somewhere a radio crackles: the Mint channel.',
    lines: [
      { who: 'founder', paren: 'on the radio, very faint, a voice that might be anyone’s', text: 'Told you. They can keep it honest without me.' },
      { who: 'rook', paren: 'turning towards Gullmoor', text: 'Mags.' },
    ],
    then: 'done',
  },
});

export const SPLIT_ACT: StoryAct = Object.freeze({
  id: 'split',
  kind: 'act',
  number: 'Season two, act two',
  title: 'The Split',
  blurb: 'Inspired by the years the city argued over an upgrade, and the fork that let both sides go their own way.',
  steps: SPLIT_STEPS,
  scenes: Object.freeze({ call: 'radio', hall: 'hall', count: 'count' }),
  objectives: SPLIT_OBJECTIVES,
  targets: Object.freeze({ toHall: HALL_STEPS }),
  arrivals: Object.freeze({ toHall: { at: HALL_STEPS, range: 2.5, to: 'hall' } }),
  closed: ['count', 'done'],
  workStep: 'canvass',
  spots: SHOPKEEPERS,
  workReach: SHOP_REACH,
  workMs: SHOP_MS,
  workGoal: SIGNALS_NEEDED,
  goalLabel: 'With us',
  workVerb: 'Talk to {}',
  hint: 'Six shopkeepers round Council Hill; five at once settles it. Rex talks back anyone left alone for long. Split up.',
  markers: 'badges',
  badge: 'With us',
  night: 0.1,
  nights: Object.freeze({ count: 0.35, done: 0.35 }),
  catchers: Object.freeze({}),
  carries: true,
  start: IVY_SPOT,
  script: SPLIT_SCRIPT,
  marks: SPLIT_MARKS,
  rewardSats: SPLIT_REWARD_SATS,
  lesson:
    'An upgrade only works if the people using the money agree to it. Guardians can’t force new rules on anyone, and nobody can stop a group that disagrees from forking off with their own coin. That’s how a federation changes its mind without a fight: everyone checks, then everyone chooses.',
  next: 'Season two continues. Mags has some explaining to do.',
});
