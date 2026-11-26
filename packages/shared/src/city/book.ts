// Season three, act four, the finale: Glass's lawyer works on the guardians one by one, and the crew reads every letter out.
import { z } from 'zod';
import { threshold } from '../federation.js';
import type { Vec2 } from '../map.js';
import { GUARDIANS } from './ransom.js';
import type { Mark, Script } from './script.js';
import type { StoryAct, StorySpot } from './story.js';
import raw from './tuning/book.json' with { type: 'json' };

const PointSchema = z.strictObject({ x: z.number(), y: z.number() });

/** The shape of `tuning/book.json`: every place and number in The Little Book a designer can change without touching code. */
export const BookTuningSchema = z.strictObject({
  hallSteps: PointSchema,
  table: PointSchema,
  tableReach: z.number().positive(),
  takeReach: z.number().positive(),
  takeMs: z.int().positive(),
  varnish: z.strictObject({
    route: z.array(z.strictObject({ x: z.number(), y: z.number(), guardian: z.int().min(0).optional() })).min(2),
    speed: z.number().positive(),
    pitchSeconds: z.number().positive(),
  }),
  aloneSeconds: z.number().positive(),
  voteSeconds: z.int().positive().max(600),
  voteSeats: z.array(PointSchema),
  glassArrives: PointSchema,
  night: z.number().min(0).max(1),
  rewardSats: z.int().min(0),
});
/** The Little Book's tuning, as checked by `BookTuningSchema`. */
export type BookTuning = z.infer<typeof BookTuningSchema>;

/** Every way a tuning file can be wrong that its shape alone can't catch: guardians who don't exist, or are never visited. */
export function bookTuningProblems(t: BookTuning): string[] {
  const problems: string[] = [];
  const visited = new Set(t.varnish.route.flatMap((p) => (p.guardian === undefined ? [] : [p.guardian])));
  for (const g of visited) if (g >= GUARDIANS.length) problems.push(`no guardian ${String(g)}`);
  if (visited.size !== GUARDIANS.length) problems.push('Mr Varnish must call on every guardian');
  if (t.voteSeats.length !== GUARDIANS.length) problems.push('one vote seat per guardian');
  return problems;
}

/** The Little Book's tuning, checked once at load so a bad edit fails loudly instead of playing wrong. */
export const BOOK_TUNING: BookTuning = Object.freeze(
  BookTuningSchema.superRefine((t, ctx) => {
    for (const message of bookTuningProblems(t)) ctx.addIssue({ code: 'custom', message });
  }).parse(raw),
);

/** The act's steps, in order. */
export const BOOK_STEPS = ['call', 'letters', 'vote', 'done'] as const;

/** Where the crew starts, on the Mint Hall steps. */
export const BOOK_START: Vec2 = Object.freeze(BOOK_TUNING.hallSteps);
/** The table on the steps, where every letter is read out to all five guardians. */
export const READING_TABLE: Vec2 = Object.freeze(BOOK_TUNING.table);
/** How close to the table a crew member carrying a letter must come to read it out. */
export const TABLE_REACH = BOOK_TUNING.tableReach;
/** How close to a guardian a crew member must stand to take their letter. */
export const TAKE_REACH = BOOK_TUNING.takeReach;
/** How long taking a letter off a guardian takes, in milliseconds. */
export const TAKE_MS = BOOK_TUNING.takeMs;
/** How long a guardian can be alone with an unread letter before it gets to them, in seconds. */
export const ALONE_S = BOOK_TUNING.aloneSeconds;
/** How long until the vote is called at the hall clock, in seconds. */
export const VOTE_S = BOOK_TUNING.voteSeconds;
/** Where each guardian stands for the vote, round the table, in guardian order. */
export const VOTE_SEATS: readonly Vec2[] = Object.freeze(BOOK_TUNING.voteSeats.map((p) => Object.freeze(p)));
/** Where Perpetua Glass comes up the steps at the end. */
export const GLASS_ARRIVES: Vec2 = Object.freeze(BOOK_TUNING.glassArrives);

/** The five guardians round Mint Hall from season one, each a post Mr Varnish calls at with a letter. */
export const BOOK_POSTS: readonly StorySpot[] = Object.freeze(GUARDIANS.map((g) => Object.freeze({ at: g.at, label: g.label })));
/** How many guardians must agree to change the Mint's rules: the federation's threshold, four of five. */
export const MOTION_NEEDED = threshold(BOOK_POSTS.length);

const V = BOOK_TUNING.varnish;
/** Mr Varnish's round of Mint Hall, a loop that ends where it starts. */
export const VARNISH_ROUTE: readonly Vec2[] = Object.freeze(V.route.map((p) => Object.freeze({ x: p.x, y: p.y })));
/** Mr Varnish's walking speed, in tiles a second. */
export const VARNISH_SPEED = V.speed;
/** How long he stands charming each guardian before handing over a letter, in seconds. */
export const PITCH_S = V.pitchSeconds;

interface Stretch {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly start: number;
  readonly end: number;
  // The guardian he is pitching to, or -1 while walking.
  readonly guardian: number;
}

const STRETCHES: readonly Stretch[] = (() => {
  const out: Stretch[] = [];
  let t = 0;
  V.route.forEach((p, i) => {
    if (p.guardian !== undefined) {
      out.push({ from: p, to: p, start: t, end: t + PITCH_S, guardian: p.guardian });
      t += PITCH_S;
    }
    const q = V.route[(i + 1) % V.route.length] ?? p;
    const walk = Math.hypot(q.x - p.x, q.y - p.y) / VARNISH_SPEED;
    out.push({ from: p, to: q, start: t, end: t + walk, guardian: -1 });
    t += walk;
  });
  return out;
})();

/** One whole round of Mint Hall, walking and pitching, in seconds. */
export const VARNISH_ROUND_S = STRETCHES.at(-1)?.end ?? 1;
/** When in each round he hands each letter over, in seconds from the start of the round. */
export const HANDS: readonly { readonly at: number; readonly guardian: number }[] = Object.freeze(
  STRETCHES.filter((s) => s.guardian >= 0).map((s) => Object.freeze({ at: s.end, guardian: s.guardian })),
);

/** Where Mr Varnish is `t` seconds into his rounds, which way he faces, and who he is pitching to (-1 for nobody). */
export function varnishAt(t: number): { readonly x: number; readonly y: number; readonly facing: number; readonly pitching: number } {
  const u = ((t % VARNISH_ROUND_S) + VARNISH_ROUND_S) % VARNISH_ROUND_S;
  const s = STRETCHES.find((x) => u < x.end) ?? STRETCHES.at(-1);
  if (s === undefined) return { x: 0, y: 0, facing: 0, pitching: -1 };
  if (s.guardian >= 0) {
    const g = BOOK_POSTS[s.guardian]?.at ?? s.from;
    return { x: s.from.x, y: s.from.y, facing: Math.atan2(g.y - s.from.y, g.x - s.from.x), pitching: s.guardian };
  }
  const f = s.end === s.start ? 1 : Math.min(1, (u - s.start) / (s.end - s.start));
  return { x: s.from.x + (s.to.x - s.from.x) * f, y: s.from.y + (s.to.y - s.from.y) * f, facing: Math.atan2(s.to.y - s.from.y, s.to.x - s.from.x), pitching: -1 };
}

/** Every letter handed over after `t0` and up to `t1` seconds into his rounds, in the order he hands them. */
export function handedBetween(t0: number, t1: number): { readonly at: number; readonly guardian: number }[] {
  const out: { at: number; guardian: number }[] = [];
  if (!(t1 > t0)) return out;
  for (let k = Math.floor(t0 / VARNISH_ROUND_S); k * VARNISH_ROUND_S <= t1; k++) {
    for (const h of HANDS) {
      const at = k * VARNISH_ROUND_S + h.at;
      if (at > t0 && at <= t1) out.push({ at, guardian: h.guardian });
    }
  }
  return out;
}

/** A guardian's post: whether they hold an unread letter, and how long they've held it, in seconds. */
export interface Post {
  readonly letter: boolean;
  readonly age: number;
}

const NO_LETTER: Post = Object.freeze({ letter: false, age: 0 });

/** Every post with no letter, as at the start of a round. */
export const freshPosts = (): readonly Post[] => BOOK_POSTS.map(() => NO_LETTER);

/** Whether a guardian has been alone with an unread letter long enough for it to get to them. */
export const isAlone = (p: Post): boolean => p.letter && p.age >= ALONE_S;

/** How many guardians are alone with a letter right now. */
export const aloneCount = (posts: readonly Post[]): number => posts.filter(isAlone).length;

/** Whether enough guardians are alone at once for Mr Varnish to call the vote early: the federation's threshold. */
export const motionCarries = (posts: readonly Post[]): boolean => aloneCount(posts) >= MOTION_NEEDED;

/** The posts from `t0` to `t1` seconds into the round: letters age, he hands out new ones, and some guardians are newly alone. */
export function postsAfter(posts: readonly Post[], t0: number, t1: number): { posts: readonly Post[]; handed: number[]; alone: number[] } {
  const dt = Math.max(0, t1 - t0);
  const next = posts.map((p) => (p.letter ? { letter: true, age: p.age + dt } : p));
  const handed: number[] = [];
  for (const h of handedBetween(t0, t1)) {
    if (next[h.guardian]?.letter !== false) continue;
    next[h.guardian] = { letter: true, age: t1 - h.at };
    handed.push(h.guardian);
  }
  const alone = next.flatMap((p, i) => (isAlone(p) && !isAlone(posts[i] ?? NO_LETTER) ? [i] : []));
  return { posts: next, handed, alone };
}

/** Takes a guardian's letter off them, or null when they have none. */
export function takeLetter(posts: readonly Post[], guardian: number): { posts: readonly Post[]; age: number } | null {
  const p = posts[guardian];
  if (p?.letter !== true) return null;
  return { posts: posts.map((q, i) => (i === guardian ? NO_LETTER : q)), age: p.age };
}

/** Told to the crew whenever a guardian is newly alone with a letter, with how many are. */
export const BOOK_ALONE = (name: string, alone: number): string =>
  `${name} has been alone with a letter too long. Alone now: ${String(alone)}. Mr Varnish needs ${String(MOTION_NEEDED)}.`;
/** Told to the crew the first time a letter is read out at the table. */
export const BOOK_READ = 'Read out at the table: “You are the last guardian still holding out.” Every guardian got the same letter, word for word.';
/** Told to the crew when four guardians are alone at once and Mr Varnish calls the vote early. */
export const BOOK_RECALLED = 'Four guardians alone with a letter. Mr Varnish calls the vote early; Ivy calls a point of order. Every letter is read out, and the hall clock starts again.';
/** Told to someone who tries to take a second letter. */
export const BOOK_HANDS_FULL = 'One letter at a time. Read that one out at the table first.';
/** What each guardian says as they hand their letter over, in guardian order. */
export const POST_NOTES: readonly string[] = Object.freeze([
  'Osei hands it over. “It says I’m the last one holding out. Odd. I don’t feel last.” Take it to the table.',
  'Pike hands it over, checking your face first. “It says everyone else has agreed.” Take it to the table.',
  'Hollis hands it over. “Lovely paper. It says I’m the only one being difficult.” Take it to the table.',
  'Marta hands it over, folded small. “It says I’m on my own.” Take it to the table.',
  'Wren hands it over without a word, which for Wren is a lot of words. Take it to the table.',
]);

/** The line on the story bar for each step. */
export const BOOK_OBJECTIVES: Readonly<Record<(typeof BOOK_STEPS)[number], string>> = Object.freeze({
  call: 'The Mint Hall steps. A letter has come.',
  letters: 'Take every letter Mr Varnish hands a guardian to the table on the steps. Four alone at once and he calls the vote.',
  vote: 'The vote, on the Mint Hall steps.',
  done: 'Season three complete.',
});

/** What the characters remember and the clues the crew picks up. */
export const BOOK_MARKS: Readonly<Record<string, Mark>> = Object.freeze({
  clueThreshold: { text: 'Changing the Mint’s rules takes four of its five guardians. One guardian on their own can’t start a book.', clue: true },
  clueTogether: { text: 'Every guardian got the same letter, each told they were the last holdout. Read out together, it falls apart.', clue: true },
  clueNoNames: { text: 'The guardians signed blind envelopes. There were never any names to write in a book.', clue: true },
  pastRefusedBook: { who: 'glass', text: 'you told her no guardian would keep her book, last time' },
  pastAskedBook: { who: 'glass', text: 'you asked what would go in her book, last time' },
  pastOlive: { who: 'glass', text: 'you offered her an olive, last time' },
  pastPolite: { who: 'glass', text: 'you wished her good morning, last time' },
  readTogether: { who: 'ivy', text: 'you said every letter gets read out together', honest: true },
  toreLetters: { who: 'ivy', text: 'you wanted to tear the letters up unread' },
  askedOffer: { who: 'ivy', text: 'you asked what Glass was offering them' },
  handsNone: { text: 'not one guardian was alone with a letter when the vote came' },
  handsSome: { text: 'a guardian or two still held an unread letter when the vote came' },
  thankedGuardians: { who: 'marta', text: 'you thanked all five guardians out loud', honest: true },
  mockedVarnish: { who: 'varnish', text: 'you told him to buy a smaller book' },
  askedFour: { who: 'ivy', text: 'you asked what would have happened if she got four' },
  kindGlass: { who: 'glass', text: 'you told her to spend a Mint note one day', honest: true },
  gloatedFinal: { who: 'glass', text: 'you asked if safe still meant seen' },
  askedFuture: { who: 'glass', text: 'you asked what Glasshouse would do next' },
});

/** Play sats paid for the first finish. */
export const BOOK_REWARD_SATS = BOOK_TUNING.rewardSats;

/** The act's scenes. */
export const BOOK_SCRIPT: Script = Object.freeze({
  letter: {
    slug: 'EXT. MINT HALL STEPS — MORNING',
    action: 'A letter on thick white paper that smells faintly of glass cleaner. Round the hall, five guardians pretend not to read it over Ivy’s shoulder.',
    lines: [
      { who: 'ivy', paren: 'reading', text: 'Dear Guardians. One small, sensible rule: keep a little book. Who took notes out, how much, and when. Warmest, Perpetua Glass.' },
      { who: 'ivy', text: 'P.S. My counsel, Mr Varnish, will call on each of you personally.' },
      { who: 'rook', if: 'pastRefusedBook', text: 'I told her no guardian would keep her book.' },
      { who: 'ivy', if: 'pastRefusedBook', text: 'You did. Today we find out if you were right.' },
      { who: 'rook', if: 'pastAskedBook', text: 'I asked her what would go in it. Everything, it turns out.' },
      { who: 'rook', if: 'pastOlive', text: 'I gave her an olive. I feel like that should count for something.' },
      { who: 'ivy', text: 'Changing the Mint’s rules takes four of the five of us. Varnish knows that, so he won’t ask us together.' },
      { who: 'ivy', text: 'He’ll take us one at a time, and tell each of us we’re the last one holding out. Alone with a letter like that, people start to wonder.' },
      { who: 'varnish', paren: 'tipping his hat from the bottom of the steps', text: 'Tobias Varnish, of Varnish, Varnish and Pane. A lovely morning for a sensible rule.' },
      { who: 'ivy', paren: 'quietly', text: 'Bring me every letter he hands out. We read them here, at the table, to all five of us.' },
    ],
    mark: 'clueThreshold',
    choices: [
      { id: 'together', tag: 'Plan', text: 'Every letter comes to the table, and we read them out together.', go: 'letterTogether', mark: 'readTogether' },
      { id: 'tear', tag: 'Tear', text: 'Can’t we just tear them up before anyone reads them?', go: 'letterTear', mark: 'toreLetters' },
      { id: 'offer', tag: 'Ask', text: 'What’s she offering them, exactly?', go: 'letterOffer', mark: 'askedOffer' },
    ],
    seconds: 15,
    timeout: 'letterTogether',
  },
  letterTogether: { lines: [{ who: 'ivy', text: 'Exactly. A secret like that only works on someone alone. Out loud, on the steps, it’s just a letter.' }], next: 'letterGo' },
  letterTear: { lines: [{ who: 'ivy', text: 'Then each of us wonders what the others’ said. Don’t hide them. Read them out.' }], next: 'letterGo' },
  letterOffer: { lines: [{ who: 'ivy', text: 'Lunch, mostly. A lawyer’s idea of lunch. And a lot of words like “sensible”.' }], next: 'letterGo' },
  letterGo: {
    lines: [
      { who: 'ivy', text: 'There he goes. Whoever he stops beside gets a letter. Take it off them and bring it here.' },
      { who: 'ivy', text: 'If four of us are left alone with one at once, he’ll call the vote early. One, two, even three, he can have.' },
    ],
    then: 'letters',
  },

  vote: {
    slug: 'EXT. MINT HALL STEPS — NOON',
    action: 'The hall clock strikes twelve. Five guardians round a table covered in identical letters. Mr Varnish clears his throat.',
    lines: [
      { who: 'varnish', text: 'The motion: that the guardians of the Concord Mint keep a little book. Names, amounts and times. All those in favour?' },
      { who: 'ivy', if: 'handsNone', paren: 'after a long moment', text: 'Not one hand.' },
      { who: 'ivy', if: 'handsSome', paren: 'counting', text: 'One hand, half up. Then down again, once its letter is read out. That’s none of five.' },
      { who: 'wren', text: 'A book of what? I signed envelopes. I have never seen a name in my life.' },
      { who: 'marta', text: 'Each of us got a letter saying we were the last one holding out. So we were all the last one holding out.' },
      { who: 'varnish', paren: 'checking his notes', text: 'My client was given to understand that four of you would agree.' },
      { who: 'ivy', text: 'Four of us would have to break our own promise, out loud, on these steps. And we’d still have nothing to write down.' },
    ],
    mark: 'clueNoNames',
    choices: [
      { id: 'thank', tag: 'Thank', text: 'Thank you. All five of you, for reading them out loud.', go: 'voteThank', mark: 'thankedGuardians' },
      { id: 'mock', tag: 'Tease', text: 'Mr Varnish, you might want a smaller book.', go: 'voteMock', mark: 'mockedVarnish' },
      { id: 'four', tag: 'Ask', text: 'What if she had got four of them, though?', go: 'voteFour', mark: 'askedFour' },
    ],
    seconds: 15,
    timeout: 'voteThank',
  },
  voteThank: { lines: [{ who: 'marta', text: 'Thank you for carrying them. A letter is heavier when you’re on your own with it.' }], next: 'farewell' },
  voteMock: { lines: [{ who: 'varnish', text: 'A notebook, perhaps. A very small, very empty notebook.' }], next: 'farewell' },
  voteFour: {
    lines: [{ who: 'ivy', text: 'That’s why there are five of us, not one. To get four, she’d have to fool nearly all of us at once. One at a time doesn’t add up.' }],
    next: 'farewell',
  },

  farewell: {
    action: 'A white car at the bottom of the steps. Perpetua Glass climbs them alone and reads the top letter on the table.',
    lines: [
      { who: 'glass', text: 'Five guardians, five letters, and not one of them alone long enough to say yes.' },
      { who: 'glass', text: 'I’d like to blame my lawyer. I can’t. It was the arithmetic.' },
      { who: 'varnish', text: 'My invoice, madam.' },
      { who: 'glass', text: 'Later, Tobias.' },
      { who: 'glass', if: 'pastOlive', paren: 'to Rook', text: 'You gave me an olive once. I’ve brought you the jar. It seemed only fair.' },
      { who: 'glass', if: 'pastRefusedBook', paren: 'to Rook', text: 'You told me no guardian would keep my book. I do hate being told things that turn out true.' },
      { who: 'glass', if: 'pastPolite', paren: 'to Rook', text: 'And you’ve been polite to me all season. It’s very annoying.' },
      { who: 'glass', text: 'Safe means seen. I still believe it, darling. I just can’t see any of you.' },
    ],
    choices: [
      { id: 'kind', tag: 'Kind', text: 'No hard feelings. Spend a Mint note one day. Nobody will know it was you.', go: 'farewellKind', mark: 'kindGlass' },
      { id: 'gloat', tag: 'Gloat', text: 'So does safe still mean seen?', go: 'farewellGloat', mark: 'gloatedFinal' },
      { id: 'next', tag: 'Ask', text: 'What will Glasshouse do now?', go: 'farewellNext', mark: 'askedFuture' },
    ],
    seconds: 15,
    timeout: 'farewellKind',
  },
  farewellKind: { lines: [{ who: 'glass', paren: 'very nearly smiling', text: 'Nobody would know. That’s rather the point, isn’t it?' }], next: 'closing' },
  farewellGloat: { lines: [{ who: 'glass', text: 'It means I need better glasses. Good afternoon, Rook.' }], next: 'closing' },
  farewellNext: {
    lines: [{ who: 'glass', text: 'What Glasshouse always does: look for a window nobody thought to put curtains on. Not here, though. Not any more.' }],
    next: 'closing',
  },
  closing: {
    slug: 'EXT. MINT HALL STEPS — AFTERNOON',
    action: 'The white car drives away. Ivy stacks the letters into the shoebox the envelopes came in.',
    lines: [
      { who: 'rook', text: 'She asked nicely. She had a lawyer. She wrote to every one of you.' },
      { who: 'ivy', text: 'And it didn’t matter. You can’t hand over names you never had, and no one of us can change the rules alone.' },
      { who: 'ivy', paren: 'putting the lid on', text: 'Privacy isn’t a wall, Rook. It’s a lot of people agreeing not to look, built so nobody has to be brave on their own.' },
    ],
    after: 'END OF SEASON THREE.',
    then: 'done',
  },
});

/** Season three, act four, the end of season three, as the mission room and the client play it. */
export const BOOK_ACT: StoryAct = Object.freeze({
  id: 'book',
  kind: 'act',
  number: 'Season three, act four',
  title: 'The Little Book',
  blurb: 'Inspired by how a federation’s threshold of guardians shrugs off pressure on any one of them, and blind signing leaves nothing to hand over.',
  steps: BOOK_STEPS,
  scenes: Object.freeze({ call: 'letter', vote: 'vote' }),
  objectives: BOOK_OBJECTIVES,
  targets: Object.freeze({ letters: READING_TABLE }),
  arrivals: Object.freeze({}),
  closed: ['vote', 'done'],
  workStep: 'letters',
  spots: BOOK_POSTS,
  workReach: TAKE_REACH,
  workMs: TAKE_MS,
  workGoal: 0,
  clockLabel: 'The vote is called in',
  workVerb: 'Take {}’s letter',
  hint: 'Whoever Mr Varnish stops beside gets a letter. Take it (one at a time) to the table. A red letter means that guardian is alone with it; four red at once and he calls the vote.',
  markers: 'none',
  night: BOOK_TUNING.night,
  catchers: Object.freeze({}),
  carries: true,
  start: BOOK_START,
  script: BOOK_SCRIPT,
  marks: BOOK_MARKS,
  rewardSats: BOOK_REWARD_SATS,
  lesson:
    'A federation keeps you private in two ways at once. With blind signatures the guardians never see whose note is whose, so there are no names to hand over, however nicely anyone asks. And the rules only change if enough guardians agree, past the threshold: four of five here. Pressure on one guardian, or two, or three, can’t start a book. It works best when guardians talk in the open, so none of them is ever the last one holding out alone.',
  next: 'Season three is over. Coming in season four: a gateway opens across the harbour, and the Mint learns to pay the world outside Port Concord.',
});
