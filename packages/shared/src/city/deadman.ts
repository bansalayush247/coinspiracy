// Side case: The Dead Man's Vault. Gideon Vance, who ran the QuayEx exchange, was lost at sea the week before an
// audit, and only he could open its vault. His lawyer has his plan: the vault key cut into five shares, any three
// of which open it, engraved on the plaques of five benches he gave the chapel graveyard. Two plaques have been
// stolen for scrap, which is exactly why the plan needed only three. The vault opens. It is empty. So was the coffin.
import type { Vec2 } from '../map.js';
import type { Mark, Script } from './script.js';
import type { StoryAct, StorySpot } from './story.js';

export const DEADMAN_STEPS = ['call', 'shares', 'toVault', 'vault', 'done'] as const;

export const DEADMAN_START: Vec2 = Object.freeze({ x: 100.5, y: 38.5 });
export const LYCHGATE: Vec2 = Object.freeze({ x: 102.5, y: 38.5 });
export const QUAYEX_DOOR: Vec2 = Object.freeze({ x: 97, y: 70.5 });

export const BENCHES: readonly (StorySpot & { readonly note: string })[] = Object.freeze([
  { at: { x: 106.5, y: 35.5 }, label: 'oak bench', note: 'Share one of five, engraved small under “In memory of nobody yet. — G.V.”' },
  { at: { x: 112.5, y: 34.5 }, label: 'rose bench', refuses: true, note: 'The plaque’s gone. Four screw holes and a scrap dealer’s sticker.' },
  { at: { x: 109.5, y: 39.5 }, label: 'angel', note: 'Share three of five, on the angel’s plinth, under a lot of moss.' },
  { at: { x: 106.5, y: 42.5 }, label: 'yew bench', refuses: true, note: 'No plaque. Somebody’s carved “DAVE WOZ ERE” where it was.' },
  { at: { x: 112.5, y: 43.5 }, label: 'sea bench', note: 'Share five of five. “For the sea, which keeps what it takes.” Subtle, Gideon.' },
]);
export const SHARES_NEEDED = 3;
export const BENCH_REACH = 1.3;
export const BENCH_MS = 2_000;

// Mrs Bellweather does her rounds of the graveyard with a lantern.
export const KEEPER_ROUTE: readonly Vec2[] = Object.freeze([
  { x: 105.6, y: 33.8 },
  { x: 114.5, y: 33.8 },
  { x: 114.5, y: 44.6 },
  { x: 105.6, y: 44.6 },
]);
export const KEEPER_SPEED = 1.6;

export const DEADMAN_OBJECTIVES: Readonly<Record<(typeof DEADMAN_STEPS)[number], string>> = Object.freeze({
  call: 'The chapel, the Heights. A funeral with no one in the coffin. Probably.',
  shares: 'Find three key shares on the graveyard benches. Stay out of Mrs Bellweather’s lantern.',
  toVault: 'Take the shares to the QuayEx tower on Signet Row.',
  vault: 'The QuayEx vault.',
  done: 'Case closed.',
});

export const DEADMAN_MARKS: Readonly<Record<string, Mark>> = Object.freeze({
  sorryPenrose: { who: 'penrose', text: 'you were kind to her at the funeral', honest: true },
  doubtedPenrose: { who: 'penrose', text: 'you said his death was convenient' },
  askedBenches: { who: 'penrose', text: 'you asked why benches' },
  clueThreshold: { text: 'Any three of the five shares open the vault. Two can be lost and the plan still works.', clue: true },
  checkedBooks: { who: 'brannigan', text: 'you checked the books before anything else', honest: true },
  searchedVault: { who: 'brannigan', text: 'you went looking for a hidden door' },
  calledCustomers: { who: 'penrose', text: 'you wanted the customers told first', honest: true },
});

export const DEADMAN_REWARD_SATS = 200;

export const DEADMAN_SCRIPT: Script = Object.freeze({
  funeral: {
    slug: 'EXT. THE HEIGHTS CHAPEL — DUSK',
    action: 'A small funeral. A very light coffin. MS PENROSE, Gideon Vance’s lawyer, holds an envelope like it might bite.',
    lines: [
      { who: 'penrose', text: 'Gideon ran QuayEx for nine years. Lost at sea, they say, the week before the auditors came.' },
      { who: 'penrose', text: 'Only he could open the exchange’s vault. Forty thousand customers are waiting outside it.' },
    ],
    choices: [
      { id: 'sorry', tag: 'Sorry', text: 'I’m sorry. This must be a lot to carry.', go: 'funeralSorry', mark: 'sorryPenrose' },
      { id: 'doubt', tag: 'Doubt', text: 'Lost at sea. A week before the audit. Convenient.', go: 'funeralDoubt', mark: 'doubtedPenrose' },
      { id: 'benches', tag: 'Plan', text: 'He must have left a plan.', go: 'funeralPlan', mark: 'askedBenches' },
    ],
    seconds: 12,
    timeout: 'funeralPlan',
  },
  funeralSorry: { lines: [{ who: 'penrose', paren: 'surprised', text: 'Thank you. Nobody else has said that. They’ve all asked about the money.' }], next: 'funeralPlan' },
  funeralDoubt: { lines: [{ who: 'penrose', text: 'I said the same to the coroner. He told me to wear black and stop talking.' }], next: 'funeralPlan' },
  funeralPlan: {
    lines: [
      { who: 'penrose', text: 'He did leave a plan, to his credit. The vault key, cut into five shares. Any three of them open it.' },
      { who: 'penrose', text: 'He gave the chapel five benches. Each plaque has a share engraved on it.' },
      { who: 'rook', text: 'Three of five. So two can go missing and it still opens.' },
      { who: 'penrose', paren: 'nodding at the graveyard, where a lantern bobs', text: 'Mrs Bellweather does her rounds at dusk. She does not approve of people reading benches.' },
    ],
    mark: 'clueThreshold',
    then: 'shares',
  },

  vault: {
    slug: 'INT. QUAYEX TOWER, BASEMENT — NIGHT',
    action: 'Three shares, typed in. A long beep. The vault door swings open on a room the size of a garage. It is completely empty.',
    lines: [
      { who: 'penrose', text: 'No. No, the statements said… every month, the statements said it was all here.' },
      { who: 'brannigan', paren: 'arriving, looking round', text: 'Statements say what the person writing them wants.' },
    ],
    choices: [
      { id: 'books', tag: 'Books', text: 'Pull up what QuayEx said it held, and when it was last true.', go: 'vaultBooks', mark: 'checkedBooks' },
      { id: 'search', tag: 'Search', text: 'There has to be a hidden door. Check the walls.', go: 'vaultSearch', mark: 'searchedVault' },
      { id: 'tell', tag: 'Tell', text: 'The customers need to hear this from us, tonight.', go: 'vaultTell', mark: 'calledCustomers' },
    ],
    seconds: 12,
    timeout: 'vaultBooks',
  },
  vaultBooks: {
    lines: [
      { who: 'penrose', paren: 'scrolling, going pale', text: 'Four years. For four years the vault held less than the customers were owed. Nobody ever checked.' },
      { who: 'rook', text: 'Nobody could. He never had to prove it.' },
    ],
    next: 'coffin',
  },
  vaultSearch: {
    lines: [
      { who: 'rook', paren: 'knocking on every wall', text: 'Wall. Wall. Wall. Very solid wall.' },
      { who: 'brannigan', text: 'The hidden door’s in the statements, Rook. The coins left years ago.' },
    ],
    next: 'coffin',
  },
  vaultTell: {
    lines: [
      { who: 'penrose', text: 'You’re right. They’ve been told it’s fine every month for four years. They deserve one true sentence.' },
      { who: 'brannigan', text: 'Make it a short one.' },
    ],
    next: 'coffin',
  },
  coffin: {
    action: 'Brannigan’s phone buzzes. He listens for a long time.',
    lines: [
      { who: 'brannigan', text: 'That was the chapel. The coffin came open when they moved it. Sandbags.' },
      { who: 'brannigan', text: 'And a postcard. Palm trees. “Wish you were here. Actually, don’t. — G.”' },
      { who: 'penrose', text: 'He planned his own key so carefully. Three of five. He just never planned to keep the coins in it.' },
    ],
    then: 'done',
  },
});

export const DEADMAN_ACT: StoryAct = Object.freeze({
  id: 'deadman',
  kind: 'case',
  number: 'Side case',
  title: 'The Dead Man’s Vault',
  blurb: 'Inspired by an exchange boss who died, leaving vaults nobody could open. Crack it. Then look inside.',
  steps: DEADMAN_STEPS,
  scenes: Object.freeze({ call: 'funeral', vault: 'vault' }),
  objectives: DEADMAN_OBJECTIVES,
  targets: Object.freeze({ toVault: QUAYEX_DOOR }),
  arrivals: Object.freeze({ toVault: { at: QUAYEX_DOOR, range: 2.2, to: 'vault' } }),
  closed: ['vault', 'done'],
  workStep: 'shares',
  spots: BENCHES,
  workReach: BENCH_REACH,
  workMs: BENCH_MS,
  workGoal: SHARES_NEEDED,
  goalLabel: 'Key shares',
  workVerb: 'Read the {}',
  hint: 'Five benches, three shares needed. Two plaques may be gone; any three shares will do. Watch for the lantern.',
  markers: 'labels',
  night: 0.45,
  nights: Object.freeze({ call: 0.3, vault: 0.35, done: 0.35 }),
  catchers: Object.freeze({
    keeper: {
      name: 'Mrs Bellweather',
      where: 'the lychgate',
      lines: [
        'Mrs Bellweather: “Benches are for sitting, not reading.” She walks you to the lychgate.',
        'Mrs Bellweather: “You again. I’ve buried better liars than you.” Back to the lychgate.',
        'Mrs Bellweather: “Third time. I’m starting a list. You’re the whole list.”',
      ],
    },
  }),
  start: DEADMAN_START,
  script: DEADMAN_SCRIPT,
  marks: DEADMAN_MARKS,
  rewardSats: DEADMAN_REWARD_SATS,
  lesson:
    'Gideon’s key plan was good: three of five shares meant two could be lost and the vault still opened. His exchange was the problem. It never had to prove it held what it owed. Ask any custodian for proof of reserves, and keep an inheritance plan that someone you trust can follow.',
  next: 'Case closed. More cases wait in the casebook.',
});
