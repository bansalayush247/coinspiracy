// Season three, act three of "The Cold Key": The Clock. Perpetua Glass can't read the Mint's notes, so Mr Fennick
// sits at the Saltmarket gate with a stopwatch, matching who leaves the Mint and when against who spends, and how
// much. Ivy's answer is the crowd: standard notes like everybody's, and walk to market among the shoppers who pour out
// of Mint Hall when its clock strikes. Alone, you're a time in his notebook; in the crowd, you're one of nine.
import { z } from 'zod';
import type { Vec2 } from '../map.js';
import type { Mark, Script } from './script.js';
import type { StoryAct } from './story.js';
import raw from './tuning/clock.json' with { type: 'json' };
import { VAULT_DOOR } from './vault.js';

const PointSchema = z.strictObject({ x: z.number(), y: z.number() });

/** The shape of `tuning/clock.json`: every place and number in The Clock a designer can change without touching code. */
export const ClockTuningSchema = z.strictObject({
  hallSteps: PointSchema,
  crowd: z.strictObject({
    route: z.array(PointSchema).min(2),
    size: z.int().min(1).max(16),
    speed: z.number().positive(),
    gatherSeconds: z.number().positive(),
    lingerSeconds: z.number().positive(),
    spread: z.number().min(0),
    sway: z.number().min(0).max(1.5),
  }),
  watch: z.strictObject({
    fennick: PointSchema,
    at: PointSchema,
    range: z.number().positive(),
    coverCount: z.int().min(1),
    coverRange: z.number().positive(),
  }),
  oliveShop: PointSchema,
  shopReach: z.number().positive(),
  night: z.number().min(0).max(1),
  rewardSats: z.int().min(0),
});
/** The Clock's tuning, as checked by `ClockTuningSchema`. */
export type ClockTuning = z.infer<typeof ClockTuningSchema>;

/** The Clock's tuning, checked once at load so a bad edit fails loudly instead of playing wrong. */
export const CLOCK_TUNING: ClockTuning = Object.freeze(
  ClockTuningSchema.refine((t) => t.watch.coverCount <= t.crowd.size, 'more cover needed than the crowd has').parse(raw),
);

/** The act's steps, in order. */
export const CLOCK_STEPS = ['call', 'blend', 'market', 'done'] as const;

/** Where the crew starts, on the Mint Hall steps. */
export const CLOCK_START: Vec2 = Object.freeze(CLOCK_TUNING.hallSteps);
/** The Mint's front door, where the crowd gathers and anyone clocked is sent back to. */
export const MINT_DOOR: Vec2 = VAULT_DOOR;
/** The olive shop in the Saltmarket, where the crowd goes shopping. */
export const OLIVE_SHOP: Vec2 = Object.freeze(CLOCK_TUNING.oliveShop);
/** How close to the olive shop counts as there. */
export const OLIVE_REACH = CLOCK_TUNING.shopReach;

const C = CLOCK_TUNING.crowd;
/** The way the crowd walks from Mint Hall to the olive shop. */
export const CROWD_ROUTE: readonly Vec2[] = Object.freeze(C.route.map((p) => Object.freeze(p)));
/** How many shoppers come out at each chime. */
export const CROWD_SIZE = C.size;
/** How long the crowd gathers at the door before the chime, in seconds. */
export const GATHER_S = C.gatherSeconds;
const LEGS = CROWD_ROUTE.slice(1).map((p, i) => Math.hypot(p.x - (CROWD_ROUTE[i]?.x ?? p.x), p.y - (CROWD_ROUTE[i]?.y ?? p.y)));
/** The length of the crowd's walk, in tiles. */
export const CROWD_ROUTE_LENGTH = LEGS.reduce((a, b) => a + b, 0);
/** How long the crowd takes from the door to the shop, in seconds: until its front reaches the end of the route. */
export const WALK_S = Math.max(0, CROWD_ROUTE_LENGTH - C.spread) / C.speed;
/** One whole round: gathering, walking, and shopping, in seconds. */
export const CROWD_CYCLE_S = GATHER_S + WALK_S + C.lingerSeconds;

const W = CLOCK_TUNING.watch;
/** Where Mr Fennick sits with his stopwatch. */
export const FENNICK_SEAT: Vec2 = Object.freeze(W.fennick);
/** The middle of the ring he watches, at the Saltmarket gate. */
export const WATCH_AT: Vec2 = Object.freeze(W.at);
/** How far from the gate he watches, in tiles. */
export const WATCH_RANGE = W.range;
/** How many shoppers must be close to someone for him not to notice them. */
export const COVER_COUNT = W.coverCount;
/** How close a shopper must be to count as cover, in tiles. */
export const COVER_RANGE = W.coverRange;

/** Where the crowd is at a moment of its round, and how long until it next leaves. */
export interface Crowd {
  readonly phase: 'gather' | 'walk' | 'linger';
  readonly members: readonly { readonly x: number; readonly y: number; readonly facing: number }[];
  /** Seconds until the next chime sends a crowd out. */
  readonly leaveIn: number;
}

// The point `s` tiles along the route, and which way the route runs there.
function along(s: number): { x: number; y: number; dir: number } {
  let left = Math.max(0, Math.min(CROWD_ROUTE_LENGTH, s));
  for (let i = 0; i < LEGS.length; i++) {
    const a = CROWD_ROUTE[i] ?? MINT_DOOR;
    const b = CROWD_ROUTE[i + 1] ?? a;
    const l = LEGS[i] ?? 0;
    const dir = Math.atan2(b.y - a.y, b.x - a.x);
    if (left <= l || i === LEGS.length - 1) {
      const f = l === 0 ? 0 : Math.min(1, left / l);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, dir };
    }
    left -= l;
  }
  return { x: MINT_DOOR.x, y: MINT_DOOR.y, dir: 0 };
}

/** The crowd `t` seconds into the act's clock: gathered at the door, walking in a loose bunch, or shopping. */
export function crowdAt(t: number): Crowd {
  const u = ((t % CROWD_CYCLE_S) + CROWD_CYCLE_S) % CROWD_CYCLE_S;
  const phase = u < GATHER_S ? 'gather' : u < GATHER_S + WALK_S ? 'walk' : 'linger';
  const walked = Math.min(C.speed * Math.max(0, u - GATHER_S), Math.max(0, CROWD_ROUTE_LENGTH - C.spread));
  const members = Array.from({ length: C.size }, (_, i) => {
    const ahead = C.size === 1 ? 0 : (C.spread * (C.size - 1 - i)) / (C.size - 1);
    const p = along(ahead + walked);
    const side = (((i * 5) % 3) - 1) * C.sway;
    return { x: p.x - Math.sin(p.dir) * side, y: p.y + Math.cos(p.dir) * side, facing: p.dir };
  });
  return { phase, members, leaveIn: u < GATHER_S ? GATHER_S - u : CROWD_CYCLE_S - u + GATHER_S };
}

/** Whether Mr Fennick clocks someone at `who`: inside his ring with too few shoppers around them. */
export function clocked(crowd: Crowd, who: Vec2): boolean {
  if (Math.hypot(who.x - WATCH_AT.x, who.y - WATCH_AT.y) > WATCH_RANGE) return false;
  return crowd.members.filter((m) => Math.hypot(m.x - who.x, m.y - who.y) <= COVER_RANGE).length < COVER_COUNT;
}

/** Told to the crew when Mr Fennick clocks one of them. */
export const CLOCK_CLOCKED = 'Mr Fennick clicks his stopwatch and writes something down. You stood out. Back to the Mint door, and wait for the crowd.';

/** The line on the story bar for each step. */
export const CLOCK_OBJECTIVES: Readonly<Record<(typeof CLOCK_STEPS)[number], string>> = Object.freeze({
  call: 'The Mint Hall steps.',
  blend: 'Get to the olive shop in the Saltmarket inside the crowd. Mr Fennick watches the gate.',
  market: 'The olive shop, Saltmarket.',
  done: 'Season three, act three complete.',
});

/** What the characters remember and the clues the crew picks up. */
export const CLOCK_MARKS: Readonly<Record<string, Mark>> = Object.freeze({
  clueAmounts: { text: 'Odd amounts are fingerprints. Spend the standard notes everybody carries: sixteen and one, not seventeen.', clue: true },
  clueCrowd: { text: 'When the hall clock strikes, a crowd leaves the Mint and goes shopping. Walk with them, not alone.', clue: true },
  pastPolite: { who: 'glass', text: 'you wished her good morning, last time' },
  pastGloated: { who: 'glass', text: 'you asked how her receipts were doing, last time' },
  waitedChime: { who: 'ivy', text: 'you said you’d wait for the chime', honest: true },
  boastedFast: { who: 'ivy', text: 'you said you’d outrun his stopwatch' },
  luckySeventeen: { who: 'ivy', text: 'you wanted to pay seventeen, for luck' },
  refusedBook: { who: 'glass', text: 'you told her no guardian would keep her book', honest: true },
  askedBook: { who: 'glass', text: 'you asked what would go in the book' },
  joinedQueue: { who: 'glass', text: 'you offered her an olive' },
});

/** Play sats paid for the first finish. */
export const CLOCK_REWARD_SATS = CLOCK_TUNING.rewardSats;

/** The act's scenes. */
export const CLOCK_SCRIPT: Script = Object.freeze({
  clock: {
    slug: 'EXT. MINT HALL STEPS — LATE MORNING',
    action: 'The hall clock says five to eleven. Ivy counts Mint notes into Rook’s hand.',
    lines: [
      { who: 'rook', text: 'Mrs Okafor owes the olive shop seventeen. I’ll pay it for her.' },
      { who: 'ivy', text: 'Not seventeen. Sixteen and one. The same notes everybody carries. An odd amount is a fingerprint.' },
      { who: 'ivy', paren: 'nodding down the hill', text: 'And not now. Fennick is sat at the Saltmarket gate with a stopwatch and a notebook.' },
      { who: 'ivy', text: 'Leave here alone, turn up at the market a minute later, and he writes you down. The note doesn’t tell him. The clock does.' },
      { who: 'ivy', text: 'When the hall clock strikes, half the street comes out of this door with their notes and goes shopping. Go with them.' },
    ],
    mark: 'clueAmounts',
    choices: [
      { id: 'wait', tag: 'Wait', text: 'We wait for the chime and walk with everyone.', go: 'clockWait', mark: 'waitedChime' },
      { id: 'fast', tag: 'Boast', text: 'I’m quick. I’ll be past him before he looks up.', go: 'clockFast', mark: 'boastedFast' },
      { id: 'odd', tag: 'Ask', text: 'What’s wrong with seventeen? It’s my lucky number.', go: 'clockOdd', mark: 'luckySeventeen' },
    ],
    seconds: 15,
    timeout: 'clockWait',
  },
  clockWait: { lines: [{ who: 'ivy', text: 'Good. Stay in the middle of them, and don’t run ahead.' }], next: 'clockGo' },
  clockFast: { lines: [{ who: 'ivy', text: 'He doesn’t need to look up. He only needs to see one person where there should be nine.' }], next: 'clockGo' },
  clockOdd: { lines: [{ who: 'ivy', text: 'It’s Fennick’s lucky number too. Nobody else in Port Concord pays seventeen today.' }], next: 'clockGo' },
  clockGo: {
    lines: [{ who: 'ivy', text: 'There’s the chime. Go.' }],
    mark: 'clueCrowd',
    then: 'blend',
  },

  market: {
    slug: 'EXT. SALTMARKET, THE OLIVE SHOP — ELEVEN O’CLOCK',
    action: 'Nine shoppers at the olive counter, all paying in the same notes. Mr Fennick at a café table, stopwatch in one hand, notebook in the other. Perpetua Glass beside him, in white, not eating.',
    lines: [
      { who: 'fennick', paren: 'reading his notebook', text: 'Eleven o’clock. Nine out of the Mint. Nine at the olives. Sixteen and one, sixteen and one, sixteen and one…' },
      { who: 'glass', text: 'And which of the nine is Rook?' },
      { who: 'fennick', text: 'All of them, madam, as far as my notebook knows.' },
      { who: 'glass', if: 'pastGloated', paren: 'to Rook', text: 'You asked how my receipts were doing. Now you know.' },
      { who: 'glass', if: 'pastPolite', paren: 'to Rook', text: 'Good morning again, Rook. You’re very hard to find in a queue.' },
      { who: 'glass', text: 'So I’ll stop watching the street. Your Mint has guardians. I only need them to keep a little book. Names, amounts, times.' },
    ],
    choices: [
      { id: 'no', tag: 'Refuse', text: 'They won’t. A guardian that keeps your book isn’t a guardian.', go: 'marketNo', mark: 'refusedBook' },
      { id: 'ask', tag: 'Ask', text: 'What would you even put in it?', go: 'marketAsk', mark: 'askedBook' },
      { id: 'olive', tag: 'Olive?', text: 'Olive?', go: 'marketOlive', mark: 'joinedQueue' },
    ],
    seconds: 15,
    timeout: 'marketNo',
  },
  marketNo: { lines: [{ who: 'glass', text: 'We’ll see. Guardians are people, darling. People like a nice letter.' }], next: 'marketIvy' },
  marketAsk: { lines: [{ who: 'glass', text: 'Everything you just worked so hard to hide. Politely.' }], next: 'marketIvy' },
  marketOlive: { lines: [{ who: 'glass', paren: 'taking one, despite herself', text: 'Thank you. I’ll still win.' }], next: 'marketIvy' },
  marketIvy: {
    lines: [
      { who: 'ivy', paren: 'on the phone', text: 'She’s writing to the guardians. A polite letter, a lawyer, and a list of everyone who’d like that book.' },
      { who: 'rook', text: 'Can she make them keep it?' },
      { who: 'ivy', text: 'Not one guardian on their own. That’s the point of having several. Tomorrow we find out if they hold together.' },
    ],
    then: 'done',
  },
});

/** Season three, act three, as the mission room and the client play it. */
export const CLOCK_ACT: StoryAct = Object.freeze({
  id: 'clock',
  kind: 'act',
  number: 'Season three, act three',
  title: 'The Clock',
  blurb: 'Inspired by timing and amount analysis, which can join a withdrawal to a spend even when the notes themselves are blind.',
  steps: CLOCK_STEPS,
  scenes: Object.freeze({ call: 'clock', market: 'market' }),
  objectives: CLOCK_OBJECTIVES,
  targets: Object.freeze({ blend: OLIVE_SHOP }),
  arrivals: Object.freeze({ blend: { at: OLIVE_SHOP, range: OLIVE_REACH, to: 'market' } }),
  closed: ['market', 'done'],
  workStep: 'blend',
  spots: [],
  workReach: 0,
  workMs: 0,
  workGoal: 0,
  clockLabel: 'Next crowd leaves in',
  workVerb: '',
  hint: 'Wait at the Mint door for the chime, then walk inside the crowd. Alone inside Fennick’s ring, you get clocked.',
  markers: 'labels',
  night: CLOCK_TUNING.night,
  watch: Object.freeze({ npc: 'fennick', at: WATCH_AT, range: WATCH_RANGE }),
  catchers: Object.freeze({
    stopwatch: {
      name: 'Mr Fennick’s stopwatch',
      where: 'the Mint door',
      lines: [
        CLOCK_CLOCKED,
        'Click. Mr Fennick: “Eleven-oh-two. One person. Lovely.” Back to the Mint door.',
        'Click. Mr Fennick doesn’t even look up. Back to the door, and wait for the crowd this time.',
      ],
    },
  }),
  carries: true,
  start: CLOCK_START,
  script: CLOCK_SCRIPT,
  marks: CLOCK_MARKS,
  rewardSats: CLOCK_REWARD_SATS,
  lesson:
    'Blind notes can’t be traced, but timing and amounts still leak. Take out an unusual amount and spend the same amount a minute later, and anyone watching both doors can join them up. Ecash hides you best in a crowd: use the standard notes everybody uses, and spend when plenty of other people are spending, not straight after you withdraw. The crowd you hide in is called the anonymity set; the bigger it is, the safer you are.',
  next: 'Season three ends next: Glasshouse asks the guardians to keep a little book.',
});

