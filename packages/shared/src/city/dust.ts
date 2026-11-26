// Season three, act one of "The Cold Key": The Dust. Everyone in Low Tide wakes up with one free coin from "a
// friend". It is dust: spend it together with your own coins and the sender can join the dots to your whole wallet.
// The crew warns the street to freeze it, then tails the man who collects the corner shop's receipts, unseen,
// all the way to Glasshouse on Signet Row, where Perpetua Glass explains that safe means seen.
import { z } from 'zod';
import type { Vec2 } from '../map.js';
import { isClearSegment } from '../pathfinding.js';
import { CITY_MAP } from './map.js';
import { walkPath, type Walker } from './patrol.js';
import { POPCORN_START } from './popcorn.js';
import type { Mark, Script } from './script.js';
import type { StoryAct, StorySpot } from './story.js';
import raw from './tuning/dust.json' with { type: 'json' };

const PointSchema = z.strictObject({ x: z.number(), y: z.number() });

/** The shape of `tuning/dust.json`: every place and number in The Dust a designer can change without touching code. */
export const DustTuningSchema = z.strictObject({
  deeShop: PointSchema,
  glasshouseDoor: PointSchema,
  doors: z.array(z.strictObject({ at: PointSchema, label: z.string().min(1).max(40) })).min(1).max(12),
  doorsNeeded: z.int().min(1),
  adeyemiDoor: z.int().min(0),
  doorReach: z.number().positive(),
  doorMs: z.int().positive(),
  courierCorners: z.array(PointSchema).min(2),
  courierSpeed: z.number().positive(),
  glanceSeconds: z.number().positive(),
  glanceRange: z.number().positive(),
  glanceHalfAngle: z.number().positive().max(Math.PI),
  tailLose: z.number().positive(),
  loseSeconds: z.number().positive(),
  night: z.number().min(0).max(1),
  rewardSats: z.int().min(0),
});
/** The Dust's tuning, as checked by `DustTuningSchema`. */
export type DustTuning = z.infer<typeof DustTuningSchema>;

/** The Dust's tuning, checked once at load so a bad edit fails loudly instead of playing wrong. */
export const DUST_TUNING: DustTuning = Object.freeze(
  DustTuningSchema.refine((t) => t.doorsNeeded <= t.doors.length && t.adeyemiDoor < t.doors.length, 'door counts out of range').parse(raw),
);

/** The act's steps, in order. */
export const DUST_STEPS = ['call', 'warn', 'toShop', 'shop', 'tail', 'office', 'done'] as const;

/** Dee's corner shop, where the tail starts and every lost tail starts again. */
export const DEE_SHOP: Vec2 = Object.freeze(DUST_TUNING.deeShop);
/** Glasshouse's door on Signet Row, where the courier takes the receipts. */
export const GLASSHOUSE_DOOR: Vec2 = Object.freeze(DUST_TUNING.glasshouseDoor);

/** The doors on Mrs Okafor's street; `DOORS_NEEDED` of them warned is enough for the word to spread. */
export const DOORS: readonly StorySpot[] = Object.freeze(DUST_TUNING.doors.map((d) => Object.freeze({ at: Object.freeze(d.at), label: d.label })));
/** How many doors must be knocked before the shop. */
export const DOORS_NEEDED = DUST_TUNING.doorsNeeded;
/** Mr Adeyemi's door: he has already spent his, and saw who took the receipts. */
export const ADEYEMI = DUST_TUNING.adeyemiDoor;
/** What each door says once knocked, in door order. */
export const DOOR_NOTES: readonly string[] = Object.freeze([
  'Number 3: “Freeze it? Like peas?” Close enough. She freezes it.',
  'Number 7, Mr Adeyemi: “Too late for mine. I spent it with my own coins at Dee’s corner shop. A man in a grey coat took the till receipts away in a bag.”',
  'Number 9: a teenager. “Already froze it. I watch Ozzy’s streams.”',
  'Number 12: twins, arguing about whether to frame it. Neither of them spends it.',
  'Number 15: “One coin? I thought I’d won a prize.” Not any more. Frozen.',
]);
/** How close to a door a crew member must stand to knock. */
export const DOOR_REACH = DUST_TUNING.doorReach;
/** How long a knock and a word on the doorstep take, in milliseconds. */
export const DOOR_MS = DUST_TUNING.doorMs;

/** Mr Fennick's way from Dee's shop to Glasshouse. He stops at each corner after the first and looks back. */
export const COURIER_ROUTE: readonly Vec2[] = Object.freeze([DEE_SHOP, ...DUST_TUNING.courierCorners.map((c) => Object.freeze(c)), GLASSHOUSE_DOOR]);
/** Mr Fennick's walking speed, in tiles a second (slower than the crew). */
export const COURIER_SPEED = DUST_TUNING.courierSpeed;
/** How long each look back lasts, in seconds. */
export const GLANCE_S = DUST_TUNING.glanceSeconds;
/** How far he can see when he looks back, in tiles. */
export const GLANCE_RANGE = DUST_TUNING.glanceRange;
/** Half the width of his look back, in radians. */
export const GLANCE_HALF_ANGLE = DUST_TUNING.glanceHalfAngle;
/** Further than this from him for longer than `LOSE_S` and he is gone. */
export const TAIL_LOSE = DUST_TUNING.tailLose;
/** How long the crew can be further than `TAIL_LOSE` before he is gone, in seconds. */
export const LOSE_S = DUST_TUNING.loseSeconds;

/** Mr Fennick on his round: where he is, and whether he is looking back. */
export interface Courier {
  readonly walker: Walker;
  /** Seconds left looking back over his shoulder. */
  readonly glance: number;
}

/** Mr Fennick at Dee's door, about to set off. */
export const courierAtStart = (): Courier => ({ walker: { x: DEE_SHOP.x, y: DEE_SHOP.y, facing: 0, leg: 0 }, glance: 0 });

/** Whether he has reached Glasshouse. */
export const courierArrived = (c: Courier): boolean => c.walker.leg >= COURIER_ROUTE.length - 1;

/** One step of Mr Fennick's walk: on to the next corner, where (after the first) he turns to look back the way he came. */
export function courierStep(c: Courier, dt: number): Courier {
  if (c.glance > 0) return { ...c, glance: Math.max(0, c.glance - dt) };
  if (courierArrived(c)) return c;
  const before = c.walker.leg;
  const walker = walkPath(c.walker, COURIER_ROUTE, COURIER_SPEED, dt);
  if (walker.leg === before || walker.leg < 2 || courierArrived({ walker, glance: 0 })) return { walker, glance: 0 };
  const from = COURIER_ROUTE[walker.leg - 1] ?? walker;
  const corner = COURIER_ROUTE[walker.leg] ?? walker;
  return { walker: { ...walker, x: corner.x, y: corner.y, facing: Math.atan2(from.y - corner.y, from.x - corner.x) }, glance: GLANCE_S };
}

/** Whether Mr Fennick, mid-glance, can see `who`: in his cone, in range, with nothing in the way. */
export function courierSees(c: Courier, who: Vec2): boolean {
  if (c.glance <= 0) return false;
  const dx = who.x - c.walker.x;
  const dy = who.y - c.walker.y;
  const dist = Math.hypot(dx, dy);
  if (dist > GLANCE_RANGE) return false;
  let off = Math.atan2(dy, dx) - c.walker.facing;
  off = Math.atan2(Math.sin(off), Math.cos(off));
  return Math.abs(off) <= GLANCE_HALF_ANGLE && isClearSegment(CITY_MAP, c.walker, who);
}

/** Told to whoever Mr Fennick catches looking. */
export const DUST_SPOTTED = 'Mr Fennick looks round, right at you, and tips his hat. He’ll take the long way now. Back to Dee’s.';
/** Told to the crew when they fall too far behind. */
export const DUST_LOST = 'You’ve lost him. Dee says he always comes back past the shop. Back to Dee’s.';

/** The line on the story bar for each step. */
export const DUST_OBJECTIVES: Readonly<Record<(typeof DUST_STEPS)[number], string>> = Object.freeze({
  call: 'Mrs Okafor’s doorstep, Low Tide.',
  warn: 'Knock on doors down the street. Tell three neighbours to freeze their free coin.',
  toShop: 'Get to Dee’s corner shop at the bottom of Low Tide.',
  shop: 'Dee’s corner shop.',
  tail: 'Follow the man in the grey coat. Hang back: he looks round at every corner.',
  office: 'Glasshouse, Signet Row.',
  done: 'Season three, act one complete.',
});

/** What the characters remember and the clues the crew picks up. */
export const DUST_MARKS: Readonly<Record<string, Mark>> = Object.freeze({
  clueDust: { text: 'Dust: a crumb sent to everyone. Spend it with your own coins and the sender can see they’re all yours.', clue: true },
  reassured: { who: 'okafor', text: 'you told her nobody had taken anything', honest: true },
  jokedDust: { who: 'okafor', text: 'you told her to spend it on biscuits' },
  askedWho: { who: 'okafor', text: 'you asked who’d want to follow her pocket money' },
  clueGreyCoat: { text: 'A man in a grey coat collects the till receipts from Dee’s corner shop.', clue: true },
  quietTail: { who: 'dee', text: 'you kept your head down and followed him', honest: true },
  askedFennick: { who: 'fennick', text: 'you asked him where he was taking them' },
  grabbedBag: { who: 'dee', text: 'you tried to grab his bag in her shop' },
  defendedPrivacy: { who: 'glass', text: 'you said private isn’t guilty', honest: true },
  askedClients: { who: 'glass', text: 'you asked who pays her' },
  askedJob: { who: 'glass', text: 'you asked if Glasshouse was hiring' },
});

/** Play sats paid for the first finish. */
export const DUST_REWARD_SATS = DUST_TUNING.rewardSats;

/** The act's scenes. */
export const DUST_SCRIPT: Script = Object.freeze({
  dust: {
    slug: 'EXT. LOW TIDE, MRS OKAFOR’S DOORSTEP — MORNING',
    action: 'Mrs Okafor in a dressing gown, holding her phone at arm’s length as if it might bite.',
    lines: [
      { who: 'okafor', text: 'A coin. From “a friend”. One single coin. I haven’t got a friend who’d send me one coin.' },
      { who: 'okafor', text: 'Half the street got one. Mr Adeyemi has already spent his.' },
      { who: 'rook', paren: 'on the phone', text: 'Ivy?' },
      { who: 'ivy', paren: 'on the phone', text: 'It’s dust. Someone sends a crumb to everybody. Spend it together with your own coins and the payment shows they all belong to you.' },
      { who: 'ivy', text: 'Then they’ve got your whole wallet on a string. Tell people to freeze it, not spend it. And find out who’s collecting.' },
    ],
    mark: 'clueDust',
    choices: [
      { id: 'kind', tag: 'Reassure', text: 'Nobody’s taken anything, Mrs Okafor. We’ll sort it.', go: 'dustKind', mark: 'reassured' },
      { id: 'joke', tag: 'Joke', text: 'Free money’s free money. Spend it on biscuits.', go: 'dustJoke', mark: 'jokedDust' },
      { id: 'who', tag: 'Ask', text: 'Who would want to follow a pensioner’s pocket money?', go: 'dustWho', mark: 'askedWho' },
    ],
    seconds: 15,
    timeout: 'dustKind',
  },
  dustKind: { lines: [{ who: 'okafor', text: 'You’re a good one, Rook. Mostly.' }], next: 'dustGo' },
  dustJoke: { lines: [{ who: 'okafor', text: 'Ivy just said not to, dear. I was listening.' }], next: 'dustGo' },
  dustWho: { lines: [{ who: 'ivy', text: 'Somebody who wants to follow everyone’s.' }], next: 'dustGo' },
  dustGo: {
    lines: [{ who: 'okafor', text: 'Start with the neighbours. They’ll open the door for you. They won’t for a phone.' }],
    then: 'warn',
  },

  shop: {
    slug: 'INT. DEE’S CORNER SHOP — MORNING',
    action: 'Newspapers, a cat asleep on the till, and Dee counting single coins into a jar marked FREE MONEY?',
    lines: [
      { who: 'dee', text: 'Seven of these this morning. Every one paid with a one-coin crumb on top.' },
      { who: 'dee', if: 'clueGreyCoat', text: 'The receipts? Collected. Bloke in a grey coat. Every morning this week.' },
      { who: 'dee', paren: 'nodding at the door', text: 'Him. Leaving.' },
      { who: 'fennick', paren: 'a bag of receipts under his arm, tipping his hat', text: 'Morning.' },
    ],
    choices: [
      { id: 'follow', tag: 'Follow', text: 'Don’t look at him. I’ll follow.', go: 'shopFollow', mark: 'quietTail' },
      { id: 'ask', tag: 'Ask him', text: 'Oi! Where are you taking those receipts?', go: 'shopAsk', mark: 'askedFennick' },
      { id: 'grab', tag: 'Grab', text: 'Grab the bag.', go: 'shopGrab', mark: 'grabbedBag' },
    ],
    seconds: 12,
    timeout: 'shopFollow',
  },
  shopFollow: { lines: [{ who: 'dee', paren: 'not looking up', text: 'He looks round at every corner. Hang back.' }], next: 'shopGo' },
  shopAsk: { lines: [{ who: 'fennick', text: 'To be read, sir. That’s what receipts are for.' }], next: 'shopGo' },
  shopGrab: { lines: [{ who: 'dee', text: 'Not in my shop you don’t.' }], after: 'The cat hisses. Mr Fennick is already out of the door.', next: 'shopGo' },
  shopGo: {
    lines: [{ who: 'dee', text: 'He walks slow and he looks back a lot. Stay out of his eyeline, and don’t lose him.' }],
    then: 'tail',
  },

  office: {
    slug: 'EXT. SIGNET ROW, GLASSHOUSE — DAY',
    action: 'A glass tower with every floor lit. Mr Fennick hands the bag through a hatch. A woman in white steps out, as if she was expecting Rook.',
    lines: [
      { who: 'glass', text: 'You must be Rook. Perpetua Glass. Glasshouse. We make payments safe.' },
      { who: 'glass', text: 'Safe means seen. Every coin, every crumb, joined up. Honest people have nothing to hide.' },
      { who: 'rook', text: 'Mrs Okafor’s pension isn’t hiding. It’s private.' },
      { who: 'glass', text: 'Same thing, darling, with better manners.' },
    ],
    choices: [
      { id: 'privacy', tag: 'Privacy', text: 'Private isn’t guilty. Everyone shuts the bathroom door.', go: 'officePrivacy', mark: 'defendedPrivacy' },
      { id: 'clients', tag: 'Clients', text: 'Who pays you to watch Low Tide?', go: 'officeClients', mark: 'askedClients' },
      { id: 'job', tag: 'Job', text: 'Is Glasshouse hiring?', go: 'officeJob', mark: 'askedJob' },
    ],
    seconds: 15,
    timeout: 'officePrivacy',
  },
  officePrivacy: { lines: [{ who: 'glass', text: 'Sweet. My clients disagree.' }], next: 'officeIvy' },
  officeClients: { lines: [{ who: 'glass', text: 'Anyone who’d like to know who pays whom. It’s a very long list.' }], next: 'officeIvy' },
  officeJob: { lines: [{ who: 'glass', paren: 'handing over a glass business card', text: 'For you? Always. Call me.' }], next: 'officeIvy' },
  officeIvy: {
    lines: [
      { who: 'ivy', paren: 'on the phone', text: 'She can follow coins on a string. She can’t follow the Mint’s notes. We sign them without ever seeing them.' },
      { who: 'rook', text: 'How do you sign something you can’t see?' },
      { who: 'ivy', text: 'Come to Mint Hall tomorrow. Bring an envelope.' },
    ],
    then: 'done',
  },
});

/** Season three, act one, as the mission room and the client play it. */
export const DUST_ACT: StoryAct = Object.freeze({
  id: 'dust',
  kind: 'act',
  number: 'Season three, act one',
  title: 'The Dust',
  blurb: 'Inspired by dusting attacks: tiny payments sent to thousands of wallets to see which coins get spent together.',
  steps: DUST_STEPS,
  scenes: Object.freeze({ call: 'dust', shop: 'shop', office: 'office' }),
  objectives: DUST_OBJECTIVES,
  targets: Object.freeze({ toShop: DEE_SHOP, tail: GLASSHOUSE_DOOR }),
  arrivals: Object.freeze({ toShop: { at: DEE_SHOP, range: 2.2, to: 'shop' } }),
  closed: ['office', 'done'],
  workStep: 'warn',
  spots: DOORS,
  workReach: DOOR_REACH,
  workMs: DOOR_MS,
  workGoal: DOORS_NEEDED,
  goalLabel: 'Neighbours warned',
  workVerb: 'Knock at {}',
  hint: 'Three neighbours will do: the word spreads. Somebody may have seen who’s collecting.',
  markers: 'labels',
  night: DUST_TUNING.night,
  catchers: Object.freeze({
    courier: {
      name: 'Mr Fennick',
      where: 'Dee’s shop',
      lines: [
        DUST_SPOTTED,
        'Mr Fennick again, over his shoulder: “Still here?” He’ll start the round again from Dee’s.',
        'Mr Fennick: “Third time. I’m starting to feel popular.” Back to Dee’s.',
      ],
    },
  }),
  carries: true,
  start: POPCORN_START,
  script: DUST_SCRIPT,
  marks: DUST_MARKS,
  rewardSats: DUST_REWARD_SATS,
  lesson:
    'Spending coins together tells anyone reading the ledger that they belong to the same person. A dusting attack sends tiny amounts to thousands of wallets and waits for them to be spent alongside their owners’ own coins. Don’t spend coins you didn’t expect. Ecash goes further: the Mint signs notes without seeing them, so there is no string to pull.',
  next: 'Season three continues: Ivy shows how the Mint signs a note it never sees.',
});
