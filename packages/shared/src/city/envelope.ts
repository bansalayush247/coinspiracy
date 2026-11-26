// Season three, act two of "The Cold Key": The Envelope. Ivy shows how the Mint signs a note it never sees: write
// your own serial, seal it in an envelope lined with carbon paper, and the guardians sign the outside. Glasshouse's
// photographer sweeps the Mint Hall steps with a camera, so the crew writes only when it's turned away. Then the
// note is spent at Dee's, and Perpetua Glass finds its receipt joins up to nothing at all.
import { z } from 'zod';
import type { Vec2 } from '../map.js';
import { isClearSegment } from '../pathfinding.js';
import { DEE_SHOP } from './dust.js';
import { CITY_MAP } from './map.js';
import type { Mark, Script } from './script.js';
import type { StoryAct, StorySpot } from './story.js';
import raw from './tuning/envelope.json' with { type: 'json' };
import { VAULT_DOOR } from './vault.js';

const PointSchema = z.strictObject({ x: z.number(), y: z.number() });

/** The shape of `tuning/envelope.json`: every place and number in The Envelope a designer can change without touching code. */
export const EnvelopeTuningSchema = z.strictObject({
  hallSteps: PointSchema,
  desks: z.array(z.strictObject({ at: PointSchema, label: z.string().min(1).max(40) })).min(1).max(8),
  envelopesNeeded: z.int().min(1),
  deskReach: z.number().positive(),
  writeMs: z.int().positive(),
  camera: z.strictObject({
    at: PointSchema,
    lookFrom: PointSchema,
    lookTo: PointSchema,
    turnSpeed: z.number().positive(),
    pauseSeconds: z.number().min(0),
    range: z.number().positive(),
    halfAngle: z.number().positive().max(Math.PI / 2),
  }),
  night: z.number().min(0).max(1),
  rewardSats: z.int().min(0),
});
/** The Envelope's tuning, as checked by `EnvelopeTuningSchema`. */
export type EnvelopeTuning = z.infer<typeof EnvelopeTuningSchema>;

/** The Envelope's tuning, checked once at load so a bad edit fails loudly instead of playing wrong. */
export const ENVELOPE_TUNING: EnvelopeTuning = Object.freeze(
  EnvelopeTuningSchema.refine((t) => t.envelopesNeeded <= t.desks.length, 'more envelopes needed than desks').parse(raw),
);

/** The act's steps, in order. */
export const ENVELOPE_STEPS = ['call', 'seal', 'counter', 'toShop', 'till', 'done'] as const;

/** Where the crew starts: the east end of the Mint Hall steps. */
export const HALL_STEPS_EAST: Vec2 = Object.freeze(ENVELOPE_TUNING.hallSteps);
/** The Mint's counter, at the hall's front door, where Ivy stands. */
export const COUNTER: Vec2 = VAULT_DOOR;

/** The writing desks on the steps; each seals one envelope. */
export const DESKS: readonly StorySpot[] = Object.freeze(ENVELOPE_TUNING.desks.map((d) => Object.freeze({ at: Object.freeze(d.at), label: d.label })));
/** How many envelopes must be sealed before the counter. */
export const ENVELOPES_NEEDED = ENVELOPE_TUNING.envelopesNeeded;
/** How close to a desk a crew member must stand to write. */
export const DESK_REACH = ENVELOPE_TUNING.deskReach;
/** How long writing a serial and sealing the envelope takes, in milliseconds. */
export const WRITE_MS = ENVELOPE_TUNING.writeMs;
/** What each desk says once its envelope is sealed, in desk order. */
export const DESK_NOTES: readonly string[] = Object.freeze([
  'Sealed at the pillar desk. The serial is inside, the carbon paper on top, and nobody saw a digit.',
  'Sealed at the middle desk. Ivy taps it: “Feel that? Nothing. That’s what the Mint sees.”',
  'Sealed at the steps desk. Lumley’s camera got a lovely picture of a plain brown envelope.',
]);

const CAM = ENVELOPE_TUNING.camera;
/** Where Lumley's camera stands, across the street outside City Hall. */
export const CAMERA_AT: Vec2 = Object.freeze(CAM.at);
/** How far the camera can read a serial, in tiles. */
export const CAMERA_RANGE = CAM.range;
/** Half the width of what the camera sees, in radians. */
export const CAMERA_HALF_ANGLE = CAM.halfAngle;

const FROM = Math.atan2(CAM.lookFrom.y - CAM.at.y, CAM.lookFrom.x - CAM.at.x);
const TO = Math.atan2(CAM.lookTo.y - CAM.at.y, CAM.lookTo.x - CAM.at.x);
const SPAN = Math.atan2(Math.sin(TO - FROM), Math.cos(TO - FROM));
const LEG_S = Math.abs(SPAN) / CAM.turnSpeed;
/** One full sweep, there and back with a pause at each end, in seconds. */
export const SWEEP_S = 2 * (LEG_S + CAM.pauseSeconds);

/** Which way the camera points `t` seconds into its sweep: it starts at one end, pauses, turns, pauses, and turns back. */
export function cameraFacing(t: number): number {
  const u = ((t % SWEEP_S) + SWEEP_S) % SWEEP_S;
  const pause = CAM.pauseSeconds;
  if (u < pause) return FROM;
  if (u < pause + LEG_S) return FROM + (SPAN * (u - pause)) / LEG_S;
  if (u < 2 * pause + LEG_S) return FROM + SPAN;
  return FROM + SPAN - (SPAN * (u - 2 * pause - LEG_S)) / LEG_S;
}

/** Whether the camera, pointing `facing`, can read what someone at `who` is writing. */
export function cameraSees(facing: number, who: Vec2): boolean {
  const dx = who.x - CAMERA_AT.x;
  const dy = who.y - CAMERA_AT.y;
  if (Math.hypot(dx, dy) > CAMERA_RANGE) return false;
  let off = Math.atan2(dy, dx) - facing;
  off = Math.atan2(Math.sin(off), Math.cos(off));
  return Math.abs(off) <= CAMERA_HALF_ANGLE && isClearSegment(CITY_MAP, CAMERA_AT, who);
}

/** Told to the crew when the camera catches someone writing. */
export const ENVELOPE_SNAPPED = 'Click. Lumley has a photo of your serial. That envelope is no good now: tear it up and write a fresh one.';

/** The line on the story bar for each step. */
export const ENVELOPE_OBJECTIVES: Readonly<Record<(typeof ENVELOPE_STEPS)[number], string>> = Object.freeze({
  call: 'The Mint Hall steps.',
  seal: 'Write a serial and seal an envelope at each desk. Not while the camera is on you.',
  counter: 'The Mint’s counter.',
  toShop: 'Spend the note at Dee’s corner shop in Low Tide.',
  till: 'Dee’s corner shop.',
  done: 'Season three, act two complete.',
});

/** What the characters remember and the clues the crew picks up. */
export const ENVELOPE_MARKS: Readonly<Record<string, Mark>> = Object.freeze({
  clueEnvelope: { text: 'The envelope: write your own serial, seal it with carbon paper, and the Mint signs the outside without seeing it.', clue: true },
  pastDefendedPrivacy: { who: 'glass', text: 'you told her private isn’t guilty, last time' },
  pastAskedJob: { who: 'glass', text: 'you asked her for a job, last time' },
  timedCamera: { who: 'ivy', text: 'you said you’d write when the camera looked away', honest: true },
  wavedCamera: { who: 'lumley', text: 'you waved at his camera' },
  askedWhyBlind: { who: 'ivy', text: 'you asked why the Mint doesn’t just look' },
  clueCarbon: { text: 'The signature comes through the carbon onto the note. The Mint can check it later, but never saw the serial.', clue: true },
  spendForOkafor: { who: 'dee', text: 'you paid Mrs Okafor’s paper bill with it', honest: true },
  keptNote: { who: 'ivy', text: 'you kept the first note for luck' },
  showedCamera: { who: 'ivy', text: 'you nearly held the open note up to Lumley’s camera' },
  politeGlass: { who: 'glass', text: 'you wished her a good morning and meant it', honest: true },
  gloatedGlass: { who: 'glass', text: 'you asked how her receipts were doing' },
  askedGlassNext: { who: 'glass', text: 'you asked what she would try next' },
});

/** Play sats paid for the first finish. */
export const ENVELOPE_REWARD_SATS = ENVELOPE_TUNING.rewardSats;

/** The act's scenes. */
export const ENVELOPE_SCRIPT: Script = Object.freeze({
  steps: {
    slug: 'EXT. MINT HALL STEPS — MORNING',
    action: 'Ivy with a shoebox of brown envelopes. Across the street, outside City Hall, a man in white behind a camera on a tripod.',
    lines: [
      { who: 'ivy', text: 'Blank notes. You write the serial yourself, any number you like. Nobody sees it, not even me.' },
      { who: 'ivy', paren: 'holding up an envelope', text: 'Then it goes in one of these. Lined with carbon paper. We sign the outside, and the signature presses through onto your note.' },
      { who: 'rook', text: 'So you sign it without reading it.' },
      { who: 'ivy', text: 'And when you spend it, we know our signature, but not whose envelope it was.' },
      { who: 'lumley', paren: 'waving from behind the camera', text: 'Morning! Glasshouse community photography. Pay me no mind.' },
      { who: 'glass', if: 'pastDefendedPrivacy', paren: 'on Lumley’s phone, on speaker', text: 'Private isn’t guilty, Rook? Let’s see how private.' },
      { who: 'glass', if: 'pastAskedJob', paren: 'on Lumley’s phone, on speaker', text: 'Still thinking about that job, darling? Lumley’s is going spare.' },
      { who: 'ivy', text: 'He can photograph envelopes all day. Just don’t let him see you write.' },
    ],
    mark: 'clueEnvelope',
    choices: [
      { id: 'time', tag: 'Plan', text: 'His camera turns. We write when it’s pointing the other way.', go: 'stepsTime', mark: 'timedCamera' },
      { id: 'wave', tag: 'Wave', text: 'Wave at the camera.', go: 'stepsWave', mark: 'wavedCamera' },
      { id: 'why', tag: 'Ask', text: 'Why doesn’t the Mint just look? You’re the good guys.', go: 'stepsWhy', mark: 'askedWhyBlind' },
    ],
    seconds: 15,
    timeout: 'stepsTime',
  },
  stepsTime: { lines: [{ who: 'ivy', text: 'Exactly. Three envelopes, one at each desk.' }], next: 'stepsGo' },
  stepsWave: { lines: [{ who: 'lumley', text: 'Lovely! Hold that!' }], after: 'Click.', next: 'stepsGo' },
  stepsWhy: { lines: [{ who: 'ivy', text: 'Because good guys get replaced, hacked or asked nicely by people like her. Better that we can’t see.' }], next: 'stepsGo' },
  stepsGo: {
    lines: [{ who: 'ivy', text: 'Write fast and seal it. If his camera reads a serial, that note is his, not yours.' }],
    then: 'seal',
  },

  counter: {
    slug: 'INT. MINT HALL, THE COUNTER — MORNING',
    action: 'Three sealed envelopes on the counter. Three guardians sign each one across the flap, in turn, and none of them opens one.',
    lines: [
      { who: 'ivy', text: 'Three signatures between us. Open one.' },
      { who: 'rook', paren: 'sliding a note out', text: 'It’s signed. On the note. And you never saw the number.' },
      { who: 'ivy', text: 'The carbon did the work. Anyone can check that signature now, us included. Nobody can say which envelope it came out of.' },
    ],
    mark: 'clueCarbon',
    choices: [
      { id: 'okafor', tag: 'Spend', text: 'Mrs Okafor’s paper bill at Dee’s. Let’s pay it with this.', go: 'counterOkafor', mark: 'spendForOkafor' },
      { id: 'keep', tag: 'Keep', text: 'I’m keeping the first one. For luck.', go: 'counterKeep', mark: 'keptNote' },
      { id: 'show', tag: 'Show', text: 'Hold it up to Lumley’s camera. Let him have a look.', go: 'counterShow', mark: 'showedCamera' },
    ],
    seconds: 15,
    timeout: 'counterOkafor',
  },
  counterOkafor: { lines: [{ who: 'ivy', text: 'Good. Dee’s is where Fennick collects. Let’s see what his receipt says.' }], next: 'counterGo' },
  counterKeep: { lines: [{ who: 'ivy', text: 'Keep one, spend another. Dee’s is where Fennick collects.' }], next: 'counterGo' },
  counterShow: {
    lines: [{ who: 'ivy', paren: 'putting her hand over it', text: 'Don’t. Once he’s seen the serial, he can follow it wherever it’s spent. The envelope only helps if you keep the number to yourself.' }],
    next: 'counterGo',
  },
  counterGo: { lines: [{ who: 'ivy', text: 'Go and spend it. Low Tide, Dee’s corner shop.' }], then: 'toShop' },

  till: {
    slug: 'INT. DEE’S CORNER SHOP — DAY',
    action: 'Rook pays with a Mint note. Mr Fennick collects the till receipts as usual. Perpetua Glass reads them on the spot.',
    lines: [
      { who: 'dee', text: 'One Mint note. Signature checks. Thanks, love.' },
      { who: 'glass', paren: 'reading the receipt', text: 'One note. Serial four-four-one-seven. Signed by the Mint this morning.' },
      { who: 'glass', text: 'Fennick, which envelope did it come out of?' },
      { who: 'fennick', text: 'They were all brown, madam.' },
      { who: 'glass', paren: 'folding the receipt very small', text: 'Lumley photographed every envelope that went into that hall. Not one of them has a number on it.' },
    ],
    choices: [
      { id: 'polite', tag: 'Polite', text: 'Morning, Ms Glass. Nice to see you out from behind the glass.', go: 'tillPolite', mark: 'politeGlass' },
      { id: 'gloat', tag: 'Gloat', text: 'How are the receipts doing?', go: 'tillGloat', mark: 'gloatedGlass' },
      { id: 'next', tag: 'Ask', text: 'So what will you try next?', go: 'tillNext', mark: 'askedGlassNext' },
    ],
    seconds: 15,
    timeout: 'tillPolite',
  },
  tillPolite: { lines: [{ who: 'glass', text: 'Good morning, Rook. Enjoy it.' }], next: 'tillIvy' },
  tillGloat: { lines: [{ who: 'glass', text: 'Thinner than yesterday. I’ll survive.' }], next: 'tillIvy' },
  tillNext: { lines: [{ who: 'glass', text: 'If I can’t read the notes, darling, I’ll read the clock.' }], next: 'tillIvy' },
  tillIvy: {
    lines: [
      { who: 'ivy', paren: 'on the phone', text: 'She means it. The notes don’t talk. But if you take out exactly seventeen at nine, and someone spends exactly seventeen at one minute past…' },
      { who: 'rook', text: 'Then the number doesn’t matter. The timing gives it away.' },
      { who: 'ivy', text: 'Tomorrow. I’ll show you how to blend in.' },
    ],
    then: 'done',
  },
});

/** Season three, act two, as the mission room and the client play it. */
export const ENVELOPE_ACT: StoryAct = Object.freeze({
  id: 'envelope',
  kind: 'act',
  number: 'Season three, act two',
  title: 'The Envelope',
  blurb: 'Inspired by blind signatures, first explained with a carbon-paper envelope in 1982, and the ecash mints built on them.',
  steps: ENVELOPE_STEPS,
  scenes: Object.freeze({ call: 'steps', counter: 'counter', till: 'till' }),
  objectives: ENVELOPE_OBJECTIVES,
  targets: Object.freeze({ toShop: DEE_SHOP }),
  arrivals: Object.freeze({ toShop: { at: DEE_SHOP, range: 2.2, to: 'till' } }),
  closed: ['till', 'done'],
  workStep: 'seal',
  spots: DESKS,
  workReach: DESK_REACH,
  workMs: WRITE_MS,
  workGoal: ENVELOPES_NEEDED,
  goalLabel: 'Envelopes sealed',
  workVerb: 'Write and seal at {}',
  hint: 'Watch which way the camera points. Write while it’s turned away; standing in its view is fine, writing isn’t.',
  markers: 'labels',
  night: ENVELOPE_TUNING.night,
  catchers: Object.freeze({
    camera: {
      name: 'Lumley’s camera',
      where: 'the hall steps',
      lines: [
        ENVELOPE_SNAPPED,
        'Click. Lumley: “Got that one too!” Another envelope torn up. Watch the lens.',
        'Click. Lumley gives a thumbs up. Ivy doesn’t. Fresh envelope, and wait for the turn.',
      ],
    },
  }),
  carries: true,
  start: HALL_STEPS_EAST,
  script: ENVELOPE_SCRIPT,
  marks: ENVELOPE_MARKS,
  rewardSats: ENVELOPE_REWARD_SATS,
  lesson:
    'A blind signature lets the Mint sign a note without seeing it. You hide the serial (the envelope), the Mint signs, and you unhide it: the signature still checks. When the note is spent, the Mint knows its own signature but can’t tell which envelope it came from, so the spend can’t be joined to you. In a federation, guardians sign together the same way. What can still give you away is when and how much.',
  next: 'Season three continues: Glasshouse stops reading notes and starts watching the clock.',
});
