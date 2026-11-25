// Side case: The Forgotten Password. Kit's brother Sol died last spring and left Kit a drive holding his savings,
// locked with a password only Sol knew. Three guesses left before it wipes itself. The crew walks to three places
// the brothers shared; at each, a memory of Sol gives away one piece of how he made every password. Then Kit
// gets three tries. Wrong three times and the drive is gone, and that is a lesson too.
import type { Vec2 } from '../map.js';
import type { Mark, Script, ScriptChoice } from './script.js';
import type { StoryAct, StorySpot } from './story.js';

export const PASSWORD_STEPS = ['call', 'memories', 'toFlat', 'guess', 'done'] as const;

export const KIT_FLAT: Vec2 = Object.freeze({ x: 120.5, y: 84.5 });

export const MEMORIES: readonly StorySpot[] = Object.freeze([
  { at: { x: 104.5, y: 98.5 }, label: 'end of the jetty', scene: 'memoryJetty' },
  { at: { x: 54.5, y: 70.5 }, label: 'fish market door', scene: 'memoryMarket' },
  { at: { x: 75, y: 72.5 }, label: 'arcade window', scene: 'memoryArcade' },
]);
export const MEMORY_REACH = 1.5;
export const MEMORY_MS = 1_200;
export const MEMORY_NOTES: readonly string[] = Object.freeze([
  'The end of the jetty. Sol’s initials, carved in the rail.',
  'The fish market’s back door, where Sol had his Saturday job.',
  'The arcade window. Sol’s name is still on the high-score board.',
]);

export const PASSWORD_OBJECTIVES: Readonly<Record<(typeof PASSWORD_STEPS)[number], string>> = Object.freeze({
  call: 'Kit’s flat, Low Tide.',
  memories: 'Visit the three places Kit and Sol shared: the jetty, the fish market, the arcade.',
  toFlat: 'Go back to Kit’s flat.',
  guess: 'Three guesses.',
  done: 'Case closed.',
});

export const PASSWORD_MARKS: Readonly<Record<string, Mark>> = Object.freeze({
  listenedKit: { who: 'kit', text: 'you let him talk about Sol first', honest: true },
  rushedKit: { who: 'kit', text: 'you went straight to the drive' },
  clueBoat: { text: 'Every password Sol made started with the name of their first boat, the Marigold.', clue: true },
  clueYear: { text: 'Sol always ended a password with the year they caught the big one: 2009.', clue: true },
  clueLower: { text: 'Sol never used capital letters. “Capitals are for show-offs.”', clue: true },
  allMemories: { text: 'Kit remembers all three.' },
  unlocked: { who: 'kit', text: 'you got Sol’s password' },
  lockedOut: { who: 'kit', text: 'the drive locked for good' },
});

export const PASSWORD_REWARD_SATS = 200;

// The guesses on offer, and the one Sol actually used.
const GUESSES: readonly { readonly id: string; readonly text: string }[] = [
  { id: 'exact', text: 'marigold2009' },
  { id: 'caps', text: 'Marigold2009' },
  { id: 'boat', text: 'marigold' },
  { id: 'name', text: 'solandkit' },
];
const RIGHT = 'exact';
const WRONG_LINES: Readonly<Record<string, string>> = {
  caps: 'Capitals are for show-offs. He said it every time.',
  boat: 'Just the boat. He always added something.',
  name: 'He’d never. Too obvious. He used to laugh at people who did that.',
};

// One guess node per try left: right opens the drive; wrong says why and moves to the next try, or locks it.
function guessNode(left: number): Script {
  const id = `guess${String(left)}`;
  const nextId = left > 1 ? `guess${String(left - 1)}` : 'lockedOut';
  const choices: ScriptChoice[] = GUESSES.map((g) => ({ id: g.id, tag: `“${g.text}”`, text: `Type ${g.text}`, go: g.id === RIGHT ? 'unlocked' : `${id}${g.id}` }));
  const script: Record<string, Script[string]> = {
    [id]: {
      action: left === 3 ? 'The drive asks for a password. Three tries left.' : `${String(left)} ${left === 1 ? 'try' : 'tries'} left.`,
      lines: left === 3 ? [{ who: 'kit', text: 'Help me. What would Sol type?' }] : [{ who: 'kit', paren: 'quietly', text: left === 1 ? 'Last one. Be sure.' : 'Again.' }],
      choices,
    },
  };
  for (const g of GUESSES) if (g.id !== RIGHT) script[`${id}${g.id}`] = { action: 'WRONG PASSWORD.', lines: [{ who: 'kit', text: WRONG_LINES[g.id] ?? 'No.' }], next: nextId };
  return script;
}

export const PASSWORD_SCRIPT: Script = Object.freeze({
  flat: {
    slug: 'INT. KIT’S FLAT, LOW TIDE — EVENING',
    action: 'Boxes not unpacked since spring. On the table, a small drive with a sticky note in Sol’s writing: “for Kit, when I’m gone. you know the password.”',
    lines: [
      { who: 'kit', text: 'He wrote that like I’d know. I don’t. Sol made up passwords like other people make tea.' },
      { who: 'kit', text: 'It wipes itself after three wrong tries. Everything he saved is on it.' },
    ],
    choices: [
      { id: 'listen', tag: 'Listen', text: 'Tell me about him first.', go: 'flatListen', mark: 'listenedKit' },
      { id: 'drive', tag: 'Drive', text: 'What do you know about how he made passwords?', go: 'flatDrive', mark: 'rushedKit' },
    ],
    seconds: 12,
    timeout: 'flatListen',
  },
  flatListen: {
    lines: [
      { who: 'kit', paren: 'smiling despite himself', text: 'Loud. Terrible at fishing. Great at everything else.' },
      { who: 'kit', text: 'We had three places. The jetty, the fish market, the arcade. He’d have said, go and look.' },
    ],
    next: 'flatEnd',
  },
  flatDrive: {
    lines: [
      { who: 'kit', text: 'He had a system. He’d never tell me it. Said I’d work it out “when it mattered”.' },
      { who: 'kit', text: 'If it’s anywhere, it’s in the places we went. The jetty, the fish market, the arcade.' },
    ],
    next: 'flatEnd',
  },
  flatEnd: { lines: [{ who: 'rook', text: 'Then that’s where we go. All three.' }], then: 'memories' },

  memoryJetty: {
    slug: 'MEMORY. THE JETTY — SUMMER, YEARS AGO',
    action: 'Two boys and a tiny boat with a hand-painted name. SOL, fourteen, is tying knots badly.',
    lines: [
      { who: 'sol', text: 'Every password I ever make is going to start with her name. The Marigold. Best boat in Port Concord.' },
      { who: 'kit', paren: 'remembering, now', text: 'She sank in a puddle. He still called her the best boat.' },
    ],
    mark: 'clueBoat',
    next: 'memoryBack',
  },
  memoryMarket: {
    slug: 'MEMORY. FISH MARKET, BACK DOOR — 2009',
    action: 'Sol, in an apron too big for him, holding up a fish nearly as long as he is.',
    lines: [
      { who: 'sol', text: 'Two thousand and nine, Kit. The year we caught the big one. I’m putting it on the end of everything.' },
      { who: 'kit', paren: 'remembering', text: 'He did. Bank cards. The wifi. His bike lock.' },
    ],
    mark: 'clueYear',
    next: 'memoryBack',
  },
  memoryArcade: {
    slug: 'MEMORY. SALTMARKET ARCADE — A RAINY SATURDAY',
    action: 'Sol, typing his name on the high-score board. In small letters.',
    lines: [
      { who: 'kit', text: 'Use capitals. It looks better.' },
      { who: 'sol', text: 'Capitals are for show-offs. Lowercase, always. Even passwords.' },
    ],
    mark: 'clueLower',
    next: 'memoryBack',
  },
  memoryBack: {
    lines: [{ who: 'kit', paren: 'quietly', text: 'I’d forgotten that.' }],
    next: 'memoryOn',
    jump: { if: 'allMemories', to: 'memoriesDone' },
  },
  memoryOn: { action: 'Back to the present.', lines: [], then: 'memories' },
  memoriesDone: {
    lines: [
      { who: 'kit', text: 'The boat. The year. No capitals.' },
      { who: 'rook', text: 'Back to the flat. Let’s try.' },
    ],
    then: 'toFlat',
  },

  guess: {
    slug: 'INT. KIT’S FLAT — NIGHT',
    action: 'Kit sits at the drive. Rook pulls up a box to sit on.',
    lines: [{ who: 'kit', text: 'The Marigold. Two thousand and nine. Lowercase. Show-offs.' }],
    next: 'guess3',
  },
  ...guessNode(3),
  ...guessNode(2),
  ...guessNode(1),
  unlocked: {
    action: 'The drive opens. One folder of savings. One text file, called “kit.txt”.',
    lines: [
      { who: 'sol', paren: 'the text file', text: 'You got it. Knew you would. Now WRITE IT DOWN somewhere safe, you muppet, and tell someone you trust where. Love, Sol.' },
      { who: 'kit', paren: 'laughing, crying a bit', text: 'He used a capital. For “write it down”.' },
    ],
    mark: 'unlocked',
    next: 'ending',
  },
  lockedOut: {
    action: 'DRIVE WIPED. The light goes out.',
    lines: [
      { who: 'kit', paren: 'after a long time', text: 'It’s alright. It was only money. I got the jetty back, and the fish, and the arcade.' },
      { who: 'kit', text: 'He’d laugh. Then he’d say: should’ve written it down, muppet.' },
    ],
    mark: 'lockedOut',
    next: 'ending',
  },
  ending: {
    lines: [{ who: 'rook', text: 'Whatever you keep, Kit, make a plan someone else can follow. So nobody has to guess.' }],
    then: 'done',
  },
});

export const PASSWORD_ACT: StoryAct = Object.freeze({
  id: 'password',
  kind: 'case',
  number: 'Side case',
  title: 'The Forgotten Password',
  blurb: 'Inspired by fortunes locked behind drives with a few guesses left. Three memories, three tries.',
  steps: PASSWORD_STEPS,
  scenes: Object.freeze({ call: 'flat', guess: 'guess' }),
  objectives: PASSWORD_OBJECTIVES,
  targets: Object.freeze({ toFlat: KIT_FLAT }),
  arrivals: Object.freeze({ toFlat: { at: KIT_FLAT, range: 2.2, to: 'guess' } }),
  closed: ['guess', 'done'],
  workStep: 'memories',
  spots: MEMORIES,
  workReach: MEMORY_REACH,
  workMs: MEMORY_MS,
  workGoal: MEMORIES.length,
  goalLabel: 'Memories',
  workVerb: 'Remember at the {}',
  hint: 'Three places across town: the jetty in Low Tide, the fish market and the arcade in Saltmarket. Split up if you like.',
  markers: 'labels',
  night: 0.35,
  nights: Object.freeze({ guess: 0.5, done: 0.5 }),
  catchers: Object.freeze({}),
  start: KIT_FLAT,
  script: PASSWORD_SCRIPT,
  marks: PASSWORD_MARKS,
  rewardSats: PASSWORD_REWARD_SATS,
  lesson:
    'Sol kept his savings safe from everyone, including the brother he meant them for. A password that lives only in one head dies with it. Keep a recovery plan someone you trust can follow: where the backup is, how to use it, and who to ask.',
  next: 'Case closed. More cases wait in the casebook.',
});
