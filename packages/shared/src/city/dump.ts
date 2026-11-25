// Act one of "The Cold Key": The Dump. Rook needs the wallet Dani binned in 2013, digs for it at Gullmoor tip at
// night, finds it crushed, and learns the device was never the treasure: Dani kept the twelve words on paper.
import { isClearSegment } from '../pathfinding.js';
import type { Vec2 } from '../map.js';
import { CITY_BUILDINGS, CITY_MAP } from './map.js';
import type { Mark, Script } from './script.js';
import type { StoryAct } from './story.js';

export const DUMP_STEPS = ['call', 'toDani', 'dani', 'toTip', 'mags', 'dig', 'found', 'done'] as const;
export type DumpStep = (typeof DUMP_STEPS)[number];

// Where each step's scene starts.
export const DUMP_SCENES: Readonly<Partial<Record<DumpStep, string>>> = Object.freeze({ call: 'pell', dani: 'dani', mags: 'mags', found: 'crushed' });

export const DUMP_OBJECTIVES: Readonly<Record<DumpStep, string>> = Object.freeze({
  call: 'Mr Pell is on the phone.',
  toDani: 'Find Dani at St Brigid’s Hospital. She’s on nights.',
  dani: 'Talk to Dani.',
  toTip: 'Get to Gullmoor tip. Mags runs the gatehouse.',
  mags: 'Get past Mags.',
  dig: 'Dig the right heap. Stay out of Ivor’s torch, and away from Duncan.',
  found: 'Dawn at the tip.',
  done: 'Act one complete.',
});

const frontOf = (kind: string): Vec2 => {
  const b = CITY_BUILDINGS.find((x) => x.kind === kind);
  if (b === undefined) throw new Error(`no ${kind} in the city`);
  return Object.freeze({ x: (b.box.c0 + b.box.c1 + 1) / 2, y: b.box.r1 + 2 });
};

export const DUMP_START: Vec2 = Object.freeze({ x: 39.5, y: 79.5 });
export const DANI_SPOT: Vec2 = frontOf('hospital');
export const GATE_SPOT: Vec2 = frontOf('gatehouse');
export const KENNEL: Vec2 = Object.freeze({ x: GATE_SPOT.x - 3, y: GATE_SPOT.y });
export const ARRIVE_RANGE = 2.5;

// Heaps filed by year and season. The winter 2013 heap by the old skip was dug already, so it is always empty.
export interface Heap {
  readonly tile: readonly [number, number];
  readonly label: string;
  readonly winter: boolean;
  readonly bySkip: boolean;
}

export const HEAPS: readonly Heap[] = Object.freeze(
  (
    [
      [[26, 27], '2015'],
      [[26, 24], '2014'],
      [[23, 27], '2011'],
      [[26, 18], '2012'],
      [[20, 27], '2013 · spring'],
      [[17, 24], '2013 · summer'],
      [[23, 21], '2013 · autumn'],
      [[20, 24], '2013 · winter', 'skip'],
      [[14, 21], '2013 · winter'],
      [[11, 24], '2013 · winter'],
    ] as const
  ).map(([tile, label, skip]) => Object.freeze({ tile, label, winter: label.endsWith('winter'), bySkip: skip === 'skip' })),
);

export const heapCentre = (h: Heap): Vec2 => ({ x: h.tile[0] + 0.5, y: h.tile[1] + 0.5 });

// Heaps that can hold the device: winter 2013, not the one already dug.
export const DEVICE_HEAPS: readonly number[] = Object.freeze(HEAPS.flatMap((h, i) => (h.winter && !h.bySkip ? [i] : [])));

export const DIG_REACH = 1.5;
export const DIG_MS = 1_800;
// Moving further than this from where you started digging stops the dig.
export const DIG_WOBBLE = 0.35;

export const canDig = (who: Vec2, heap: Heap): boolean => Math.hypot(who.x - heap.tile[0] - 0.5, who.y - heap.tile[1] - 0.5) <= DIG_REACH;

// What wrong heaps turn up, in order. The first wrong winter heap holds Rook's guitar, binned the same day.
export const JUNK: readonly string[] = Object.freeze([
  'A toaster with a love letter inside. Not yours.',
  'Forty-one left shoes. Not one right one.',
  'A 2013 calendar with every Friday circled in red.',
  'A trophy: WORLD’S OKAYEST DAD.',
  'Half a rowing machine and a whole regret.',
  'A box of mixtapes labelled FOR HER (DO NOT SEND).',
  'A garden gnome holding a smaller garden gnome.',
  'A fax machine. Still warm, somehow.',
]);
export const GUITAR = 'Your old guitar, strings curled like question marks. Dani wasn’t lying.';
export const SKIP_HEAP = 'Turned over already. Somebody beat you to it and found a toaster.';

// Ivor's rounds through the tip. The torch is a cone in front of him that mounds block.
export const PATROL: readonly Vec2[] = Object.freeze([
  { x: 13.5, y: 19.5 },
  { x: 27.5, y: 19.5 },
  { x: 27.5, y: 25.5 },
  { x: 21.5, y: 25.5 },
  { x: 21.5, y: 22.5 },
  { x: 12.5, y: 22.5 },
]);
export const PATROL_SPEED = 1.6;
export const TORCH_RANGE = 4;
export const TORCH_HALF_ANGLE = 0.6;

export const DUNCAN_SPEED_SCALE = 0.8;
export const DUNCAN_SMELL = 6;
export const DUNCAN_CATCH = 0.6;
// Duncan hears digging: after this many wrong heaps he is let off the chain anyway.
export const DUNCAN_WRONG_HEAPS = 2;
export const CAUGHT_MS = 1_500;

// Whether a guard at `guard` facing `facing` (radians) lights up `who`.
export function inTorch(guard: Vec2, facing: number, who: Vec2): boolean {
  const dx = who.x - guard.x;
  const dy = who.y - guard.y;
  const dist = Math.hypot(dx, dy);
  if (dist > TORCH_RANGE) return false;
  if (dist < 0.5) return true;
  let off = Math.atan2(dy, dx) - facing;
  off = Math.atan2(Math.sin(off), Math.cos(off));
  return Math.abs(off) <= TORCH_HALF_ANGLE && isClearSegment(CITY_MAP, guard, who);
}

// The yard Duncan guards; he gives up the chase outside it.
export const TIP_YARD = Object.freeze({ c0: 9, r0: 16, c1: 33, r1: 30 });
export const inYard = (p: Vec2): boolean => p.x >= TIP_YARD.c0 && p.x <= TIP_YARD.c1 + 1 && p.y >= TIP_YARD.r0 && p.y <= TIP_YARD.r1 + 1;

export const DUMP_MARKS: Readonly<Record<string, Mark>> = Object.freeze({
  promisedPell: { who: 'pell', text: 'you promised him every coin' },
  charmedDani: { who: 'dani', text: 'you tried to charm her' },
  honestDani: { who: 'dani', text: 'you were honest, at least', honest: true },
  liedDani: { who: 'dani', text: 'you lied to her face' },
  angryDani: { who: 'dani', text: 'you blew up at her' },
  quietDani: { who: 'dani', text: 'you let her fill the silence' },
  charmedMags: { who: 'mags', text: 'you liked her mug' },
  bluffedMags: { who: 'mags', text: 'you tried to bluff her' },
  paidMags: { who: 'mags', text: 'you paid double without asking' },
  honestMags: { who: 'mags', text: 'you told her the truth', honest: true },
  clueWinter: { text: 'Dani binned it the week of the big snow: winter 2013.', clue: true },
  clueSkip: { text: 'The winter 2013 heap by the old skip was already dug. Nothing in it.', clue: true },
  keptDevice: { who: 'rook', text: 'you kept the broken wallet' },
  askedOnce: { who: 'dani', text: 'you didn’t ask nicely the first time' },
  apologised: { who: 'dani', text: 'you said sorry', honest: true },
});

export const isHonest = (marks: Iterable<string>): boolean => [...marks].some((m) => DUMP_MARKS[m]?.honest === true);

export const DUMP_REWARD_SATS = 250;

export const DUMP_SCRIPT: Script = Object.freeze({
  pell: {
    slug: 'INT. ROOK’S FLAT, LOW TIDE — NIGHT',
    action: 'A phone buzzes on a pizza box. Caller: MR PELL. Rook answers on the fourth ring, which is three too many.',
    lines: [
      { who: 'pell', text: 'Rook. I do hope I’m not interrupting anything expensive.' },
      { who: 'pell', text: 'Forty thousand by Friday. My nephews have offered to help you with your furniture. They’re terribly keen on furniture.' },
    ],
    choices: [
      { id: 'joke', tag: 'Joke', text: 'I’m not panicking, I’m budgeting.', go: 'pellJoke' },
      { id: 'promise', tag: 'Promise', text: 'You’ll have it. Every coin.', go: 'pellPromise', mark: 'promisedPell' },
      { id: 'silent', tag: 'Silence', text: '(say nothing)', go: 'pellSilence' },
    ],
    seconds: 9,
    timeout: 'pellSilence',
  },
  pellJoke: { lines: [{ who: 'pell', text: 'Then budget for a sofa. You’ll want somewhere soft to land.' }], next: 'pellEnd' },
  pellPromise: { lines: [{ who: 'pell', text: 'Promises are lovely. Money is lovelier. I’ll remember you said “every”.' }], next: 'pellEnd' },
  pellSilence: { lines: [{ who: 'pell', text: 'Silence. How restful. Do keep it up until Friday.' }], next: 'pellEnd' },
  pellEnd: {
    action: 'The line goes dead. On the fridge, the one thing Rook owns that ever went up in value: a photo of Dani, frowning at a blinking gadget.',
    lines: [{ who: 'rook', text: 'Eleven years. She’ll still have it. She keeps everything.' }],
    then: 'toDani',
  },

  dani: {
    slug: 'EXT. ST BRIGID’S HOSPITAL, AMBULANCE BAY — NIGHT',
    action: 'Rain hammers the canopy. DANI VALE, paramedic, restocks a trauma bag. She doesn’t look up.',
    lines: [{ who: 'dani', text: 'Eleven years, Rook. No texts, no calls, and you turn up at my work smelling like the harbour.' }],
    choices: [
      { id: 'charm', tag: 'Charm', text: 'You kept count. That’s sweet.', go: 'daniCharm', mark: 'charmedDani' },
      { id: 'straight', tag: 'Straight', text: 'I need the black USB thing. The one with the buttons.', go: 'daniStraight', mark: 'honestDani' },
      { id: 'lie', tag: 'Lie', text: 'I just wanted to see you.', go: 'daniLie', mark: 'liedDani' },
    ],
  },
  daniCharm: {
    lines: [
      { who: 'dani', text: 'I count everything. Doses. Pulses. Mistakes.' },
      { who: 'dani', paren: 'beat', text: 'You’re the big one.' },
    ],
    next: 'reveal',
  },
  daniLie: {
    lines: [
      { who: 'dani', paren: 'zips the bag, slowly', text: 'You have never once in your life “just wanted to see” anyone.' },
      { who: 'dani', text: 'What do you need?' },
    ],
    next: 'reveal',
  },
  daniStraight: {
    lines: [
      { who: 'dani', text: 'Wow. Not even a “how are you”.' },
      { who: 'rook', text: 'How are you?' },
      { who: 'dani', text: 'Tired. Go on.' },
    ],
    next: 'reveal',
  },
  reveal: {
    lines: [
      { who: 'dani', text: 'The little gadget? Your “magic internet money”?' },
      { who: 'dani', paren: 'laughs, short', text: 'I threw it out. Bin bag. Same day I threw out your guitar.' },
      { who: 'rook', text: 'You threw out my what?' },
      { who: 'dani', text: 'It looked like a nine-volt battery and it blinked at me. I was angry. It blinked.' },
    ],
    choices: [
      { id: 'calm', tag: 'Calm', text: 'Okay. Okay. Which bin? Which day?', go: 'daniCalm' },
      { id: 'anger', tag: 'Anger', text: 'That thing is worth more than this hospital.', go: 'daniAnger', mark: 'angryDani' },
      { id: 'silent', tag: 'Silence', text: '(say nothing)', go: 'daniSilence' },
    ],
    seconds: 8,
    timeout: 'daniSilence',
  },
  daniCalm: {
    lines: [
      { who: 'dani', text: 'Tuesday. The week of the big snow. Bins went Wednesday, so: Gullmoor tip.' },
      { who: 'dani', paren: 'narrows her eyes', text: 'Why are you being calm? You’re never calm. How much is on it?' },
      { who: 'rook', text: 'Enough.' },
    ],
    mark: 'clueWinter',
    next: 'hook',
  },
  daniAnger: {
    lines: [
      { who: 'dani', paren: 'cold', text: 'Then you should have kept it somewhere better than my sock drawer.' },
      { who: 'rook', text: 'Dani—' },
      { who: 'dani', paren: 'already walking', text: 'Gullmoor tip. Wednesday collection. Good luck, genius.' },
    ],
    next: 'hook',
  },
  daniSilence: {
    lines: [
      { who: 'dani', paren: 'the silence gets to her', text: '…Oh no. How much?' },
      { who: 'rook', text: 'Enough.' },
      { who: 'dani', text: 'Enough to pay Pell?' },
    ],
    action: 'Rook stares. She knows about Pell.',
    after: 'Dani: “It went out with the Christmas tree, the week of the big snow. Gullmoor. Don’t ask me how I remember.”',
    mark: 'quietDani',
    next: 'daniWinter',
  },
  daniWinter: { lines: [{ who: 'rook', paren: 'to self', text: 'Winter 2013. Gullmoor.' }], mark: 'clueWinter', next: 'hook' },
  hook: {
    lines: [{ who: 'dani', text: 'There’s something you should know about that night—' }],
    action: 'Her radio crackles: CARDIAC ARREST, SALTMARKET PIER. She’s already running. Over her shoulder:',
    after: 'Dani: “Later. Don’t do anything stupid.”',
    then: 'toTip',
  },

  mags: {
    slug: 'EXT. GULLMOOR TIP, GATEHOUSE — NIGHT',
    action: 'Rain on corrugated iron. MAGS OKAFOR leans out of the hatch with a mug that says WORLD’S OKAYEST BOSS.',
    lines: [
      { who: 'mags', text: 'Gullmoor’s closed. Unless you’re a seagull. You a seagull?' },
      { who: 'rook', text: 'I’m looking for something I lost in 2013.' },
      { who: 'mags', text: 'Love, everybody here lost something in 2013. That’s what a tip is. A museum of regret with worse parking.' },
      { who: 'mags', text: 'A shovel’s extra. Not getting chased by Duncan is extra-extra.' },
      { who: 'rook', text: 'Who’s Duncan?' },
      { who: 'mags', paren: 'already closing the hatch', text: 'Duncan doesn’t take bribes. Duncan has principles.' },
    ],
    choices: [
      { id: 'charm', tag: 'Charm', text: 'Love the mug. Okayest is underrated.', go: 'magsCharm', mark: 'charmedMags' },
      { id: 'bluff', tag: 'Bluff', text: 'Council inspection. I’ll need full access.', go: 'magsBluff', mark: 'bluffedMags' },
      { id: 'pay', tag: 'Pay', text: 'Here’s double. For the shovel, and for not asking.', go: 'magsPay', mark: 'paidMags' },
      { id: 'truth', tag: 'Truth', text: 'My ex binned my bitcoin in 2013 and a loan shark wants paying by Friday.', go: 'magsTruth', mark: 'honestMags' },
    ],
    seconds: 12,
    timeout: 'magsSilence',
  },
  magsCharm: {
    lines: [
      { who: 'mags', text: 'Flattery. Haven’t had that since the nineties.' },
      { who: 'mags', paren: 'slides a shovel through the hatch', text: 'Torch is on the house, because you said “underrated”.' },
    ],
    next: 'magsRules',
  },
  magsBluff: {
    lines: [
      { who: 'mags', text: 'Council. Course you are.' },
      { who: 'mags', paren: 'doesn’t blink', text: 'Inspect away. I’ll let Duncan show you round.' },
    ],
    action: 'Somewhere behind the gatehouse, a chain rattles loose.',
    next: 'magsRules',
  },
  magsPay: {
    lines: [
      { who: 'mags', paren: 'counts it without looking down', text: 'Double. Lovely.' },
      { who: 'mags', text: 'Funny thing. You’re the fourth this year digging the winter of ’13. The others did the heap by the old skip. Found a toaster.' },
    ],
    action: 'She watches your face while she says it.',
    mark: 'clueSkip',
    next: 'magsWinter',
  },
  magsWinter: { lines: [{ who: 'rook', paren: 'to self', text: 'Winter 2013. Not the one by the skip.' }], mark: 'clueWinter', next: 'magsRules' },
  magsTruth: {
    lines: [
      { who: 'mags', paren: 'a long look', text: 'Honest. Haven’t seen that since 2013 either.' },
      { who: 'mags', text: 'Shovel’s free. And love? If it went out in the snow, the winters are at the back. Always are.' },
    ],
    next: 'magsRules',
  },
  magsSilence: {
    lines: [{ who: 'mags', text: 'Seagull it is.' }],
    action: 'The hatch slams. Then opens. A shovel clatters out onto the wet concrete.',
    next: 'magsRules',
  },
  magsRules: {
    lines: [
      { who: 'mags', text: 'Rules. The heaps are filed by year and season, like a library that smells of nappies.' },
      { who: 'mags', text: 'Stay out of the torch. Ivor does the rounds, and Ivor does not do paperwork.' },
      { who: 'mags', if: 'bluffedMags', text: 'And say hello to Duncan. He’s already said hello to you.' },
    ],
    then: 'dig',
  },

  crushed: {
    slug: 'EXT. GULLMOOR TIP, WINTER 2013 HEAP — NIGHT',
    action: 'Under a frozen Christmas tree: a small black device. Flat as a coaster. A crack runs through the screen. It does not blink.',
    lines: [{ who: 'rook', text: 'Come on. Come on. Eleven years and you couldn’t hold on one more night?' }],
    choices: [
      { id: 'keep', tag: 'Keep', text: 'Pocket it anyway.', go: 'crushedKeep', mark: 'keptDevice' },
      { id: 'throw', tag: 'Throw', text: 'Lob it at the nearest seagull.', go: 'crushedThrow' },
    ],
    seconds: 7,
    timeout: 'crushedSilence',
  },
  crushedKeep: { lines: [], action: 'Rook wraps it in a sock, as if it might still be warm.', next: 'slip' },
  crushedThrow: { lines: [], action: 'It sails. A gull takes it personally.', next: 'slip' },
  crushedSilence: { lines: [], action: 'Rook sits on the heap in the rain. For a while nobody says anything, not even the gulls.', next: 'slip' },
  slip: {
    action: 'Headlights at the fence. DANI, still in uniform, picks her way across the mud with a torch of her own.',
    lines: [
      { who: 'dani', text: 'I said don’t do anything stupid.' },
      { who: 'rook', text: 'You said later. It’s later.' },
      { who: 'dani', text: 'That night, you wrote twelve words on the back of a pizza receipt, wrote IMPORTANT on it, and told me to guard it with my life.' },
      { who: 'dani', text: 'Then you left.' },
    ],
    after: 'She holds up a folded, grease-spotted slip. IMPORTANT, in Rook’s own handwriting. “I threw out the gadget, Rook. I kept the paper.”',
    next: 'ask',
  },
  ask: {
    lines: [
      { who: 'dani', unless: 'askedOnce', text: 'Ask me nicely.' },
      { who: 'dani', if: 'askedOnce', text: 'Again. Nicely.' },
    ],
    choices: [
      { id: 'nice', tag: 'Nicely', text: 'Please, Dani. And I’m sorry. For all of it.', go: 'given', mark: 'apologised' },
      { id: 'demand', tag: 'Demand', text: 'That’s mine. Hand it over.', go: 'askDemand', mark: 'askedOnce' },
      { id: 'joke', tag: 'Joke', text: 'Pretty please, with forty grand on top?', go: 'askJoke', mark: 'askedOnce' },
    ],
    seconds: 10,
    timeout: 'askSilence',
  },
  askDemand: { lines: [{ who: 'dani', text: 'Legally, it’s a pizza receipt in my pocket.' }], next: 'ask' },
  askJoke: { lines: [{ who: 'dani', paren: 'almost smiles', text: 'Closer. Not there.' }], next: 'ask' },
  askSilence: { lines: [{ who: 'dani', text: 'I waited eleven years. I can wait eleven more seconds.' }], mark: 'askedOnce', next: 'ask' },
  given: {
    action: 'She hands it over. Their fingers touch for exactly as long as it takes.',
    lines: [
      { who: 'dani', if: 'apologised', text: 'Eleven years late. It still counts.' },
      { who: 'dani', text: 'Twelve words. Don’t photograph them. Don’t type them into anything. Don’t read them out in a pub.' },
      { who: 'dani', text: 'The gadget was never the treasure, Rook. It was just a box for these.' },
      { who: 'dani', if: 'liedDani', text: 'And next time you lie to my face, do it somewhere with better lighting.' },
    ],
    next: 'selfie',
  },
  selfie: {
    slug: 'EXT. GULLMOOR TIP — DAWN',
    action: 'Mist on the mounds. Duncan, it turns out, loves a selfie. Rook takes one: mud, grin, dog, and no paper in the shot.',
    lines: [
      { who: 'rook', text: 'Teo is going to lose his mind.' },
      { who: 'rook', paren: 'the phone rings before the tick turns blue. Caller: TEO', text: 'Did you see it? Tell me you saw the—' },
      { who: 'voice', paren: 'warm, unhurried', text: 'Hello, Rook. Teodor can’t come to the phone just now. He’s warm, he’s fed, and he’d very much like you to keep your evening free.' },
      { who: 'voice', text: 'We’ll talk about those twelve words.' },
    ],
    after: 'The line goes quiet. Behind the gatehouse, Mags turns off a radio she wasn’t listening to.',
    then: 'done',
  },
});

export const DUMP_ACT: StoryAct = Object.freeze({
  id: 'dump',
  kind: 'act',
  number: 'Act one',
  title: 'The Dump',
  blurb: 'Inspired by a drive of bitcoin thrown out and buried in a landfill.',
  steps: DUMP_STEPS,
  scenes: DUMP_SCENES,
  objectives: DUMP_OBJECTIVES,
  targets: Object.freeze({ toDani: DANI_SPOT, toTip: GATE_SPOT }),
  arrivals: Object.freeze({ toDani: { at: DANI_SPOT, range: ARRIVE_RANGE, to: 'dani' }, toTip: { at: GATE_SPOT, range: ARRIVE_RANGE, to: 'mags' } }),
  closed: ['found', 'done'],
  workStep: 'dig',
  spots: HEAPS.map((h) => Object.freeze({ at: heapCentre(h), label: h.label })),
  workReach: DIG_REACH,
  workMs: DIG_MS,
  workGoal: 0,
  workVerb: 'Dig the {} heap',
  markers: 'heaps',
  hint: 'Find the right heap. Signs show the year and season.',
  night: 0.55,
  nights: Object.freeze({ found: 0.3, done: 0.3 }),
  catchers: Object.freeze({
    guard: {
      name: 'Ivor',
      where: 'the gate',
      lines: ['Ivor: “Oi! Gate! Now! And wipe your feet.”', 'Ivor: “You again. I’m writing this down. I’m not, but I could.”', 'Ivor: “Third time. Mags says you’re ‘persistent’. I say you’re paperwork.”'],
    },
    duncan: {
      name: 'Duncan',
      where: 'the gate',
      lines: [
        'Duncan sits on you. Mags walks you back to the gate, tutting.',
        'Duncan licks your whole face, then escorts you out. He has principles.',
        'Duncan brings you back to the gate by the sleeve. Mags: “He likes you. That’s worse.”',
      ],
    },
  }),
  start: DUMP_START,
  script: DUMP_SCRIPT,
  marks: DUMP_MARKS,
  rewardSats: DUMP_REWARD_SATS,
  lesson: 'The device was never the treasure. The twelve words were. Write your seed words on paper, keep them somewhere safe, and never photograph or type them.',
  next: 'Next: act two, The Ransom Call.',
});
