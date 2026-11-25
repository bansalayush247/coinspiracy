// Side case: Borrowed Number. Pip, who runs the Saltmarket arcade, lost his phone signal at lunch and his
// exchange savings by teatime: the login codes went by text, to whoever now had his number. Someone talked a
// phone shop into moving it. The crew finds out how little that took (a birthday, an address, a pet's name, all in
// plain sight), then walks into Kestrel Mobile, where the clerk isn't a clerk.
import type { Vec2 } from '../map.js';
import type { Mark, Script } from './script.js';
import type { StoryAct, StorySpot } from './story.js';

export const NUMBER_STEPS = ['call', 'gather', 'toShop', 'shop', 'done'] as const;

export const NUMBER_START: Vec2 = Object.freeze({ x: 74.5, y: 69.5 });
export const PIP_SPOT: Vec2 = Object.freeze({ x: 74.5, y: 71.2 });
export const SHOP_DOOR: Vec2 = Object.freeze({ x: 60.5, y: 77.5 });

// Pip's details, wherever anyone could read them.
export const DETAILS: readonly (StorySpot & { readonly mark: string; readonly note: string })[] = Object.freeze([
  {
    at: { x: 79.5, y: 75.5 },
    label: 'high-score board',
    mark: 'clueBirthday',
    note: 'The arcade’s high-score board: “PIP · 14 MAY · BIRTHDAY HIGH SCORE!!” Birthday found.',
  },
  {
    at: { x: 66.5, y: 72.5 },
    label: 'lost-cat poster',
    mark: 'cluePet',
    note: 'A faded poster on a lamp post: “LOST: ROCKET, my first ever cat. Call Pip.” First pet found.',
  },
  {
    at: { x: 71.5, y: 71.5 },
    label: 'parcel',
    mark: 'clueAddress',
    note: 'A parcel on the step, left in plain sight: “Pip, 12 Quay Lane, Port Concord.” Address found.',
  },
]);
export const DETAIL_REACH = 1.4;
export const DETAIL_MS = 1_500;

export const NUMBER_OBJECTIVES: Readonly<Record<(typeof NUMBER_STEPS)[number], string>> = Object.freeze({
  call: 'Pip’s arcade, Saltmarket.',
  gather: 'Find what the shop would ask for: Pip’s birthday, his address, his first pet. They’re all out in the open.',
  toShop: 'Go to Kestrel Mobile, across the river.',
  shop: 'Kestrel Mobile.',
  done: 'Case closed.',
});

export const NUMBER_MARKS: Readonly<Record<string, Mark>> = Object.freeze({
  calmedPip: { who: 'pip', text: 'you calmed him down first', honest: true },
  blamedPip: { who: 'pip', text: 'you asked why he kept savings on an exchange' },
  clueText: { text: 'The exchange sent Pip’s login codes by text message. Whoever has his number gets the codes.', clue: true },
  clueBirthday: { text: 'Pip’s birthday is on the arcade’s high-score board.', clue: true },
  cluePet: { text: 'Pip’s first pet’s name is on a lost-cat poster.', clue: true },
  clueAddress: { text: 'Pip’s address is on a parcel on his step.', clue: true },
  posedAsPip: { who: 'juno', text: 'you pretended to be Pip, and it worked' },
  truthJuno: { who: 'juno', text: 'you told her the truth', honest: true },
  watchedShop: { who: 'juno', text: 'you waited and watched' },
});

export const NUMBER_REWARD_SATS = 150;

export const NUMBER_SCRIPT: Script = Object.freeze({
  pip: {
    slug: 'EXT. SALTMARKET ARCADE — AFTERNOON',
    action: 'Bleeps from inside. PIP, forties, in an arcade apron, holds up his phone. NO SERVICE.',
    lines: [
      { who: 'pip', text: 'Lunchtime, my phone just died. No signal. I thought, it’s the phone, it’s old, it’s fine.' },
      { who: 'pip', text: 'Teatime, my exchange account: empty. Every login said a code was sent to my phone.' },
      { who: 'pip', text: 'My phone that doesn’t work. My number’s somewhere else, Rook.' },
    ],
    choices: [
      { id: 'calm', tag: 'Calm', text: 'Breathe. Sit down. We’ll find who has it.', go: 'pipCalm', mark: 'calmedPip' },
      { id: 'blame', tag: 'Blame', text: 'You kept your savings on an exchange? With text codes?', go: 'pipBlame', mark: 'blamedPip' },
      { id: 'how', tag: 'How', text: 'How does someone take a phone number?', go: 'pipHow' },
    ],
    seconds: 12,
    timeout: 'pipHow',
  },
  pipCalm: { lines: [{ who: 'pip', paren: 'sitting on a pinball machine', text: 'Okay. Okay. Breathing. Ask me anything.' }], next: 'pipHow' },
  pipBlame: {
    lines: [
      { who: 'pip', text: 'Everyone does! The app said it was secure!' },
      { who: 'rook', text: 'Sorry. Not helpful. Go on.' },
    ],
    next: 'pipHow',
  },
  pipHow: {
    lines: [
      { who: 'rook', text: 'Someone walked into a phone shop and said they were you. Lost phone, new SIM, please move my number.' },
      { who: 'rook', text: 'The shop asks a few questions first. Birthday. Address. First pet. Get them right and the number is theirs.' },
      { who: 'pip', text: 'Nobody knows those things about me!' },
      { who: 'rook', paren: 'looking round the street', text: 'Let’s find out.' },
    ],
    mark: 'clueText',
    then: 'gather',
  },

  shop: {
    slug: 'INT. KESTREL MOBILE — EVENING',
    action: 'A phone shop the size of a lift. Behind the counter, JUNO, chewing gum, name badge on upside down.',
    lines: [
      { who: 'juno', text: 'Welcome to Kestrel Mobile, where your number is our number. How can I help?' },
      { who: 'rook', paren: 'to self', text: 'Three details. All in plain sight. That’s all it took.' },
    ],
    choices: [
      { id: 'pose', tag: 'Pose', text: 'I’m Pip. Lost my phone. Birthday 14 May, 12 Quay Lane, first pet Rocket.', go: 'shopPose', mark: 'posedAsPip' },
      { id: 'truth', tag: 'Truth', text: 'My friend’s number was moved from this shop today. Someone pretended to be him.', go: 'shopTruth', mark: 'truthJuno' },
      { id: 'watch', tag: 'Watch', text: 'Just browsing. Rook picks up a phone case and waits.', go: 'shopWatch', mark: 'watchedShop' },
    ],
    seconds: 14,
    timeout: 'shopWatch',
  },
  shopPose: {
    lines: [
      { who: 'juno', text: 'Fourteenth of May. Quay Lane. Rocket. All correct!' },
      { who: 'juno', paren: 'flipping her badge the right way up. It says DETECTIVE.', text: 'And that’s twice today. Hands on the counter, “Pip”.' },
      { who: 'rook', text: 'Wait. I’m not him. I’m showing you how easy it is. Somebody did exactly this at lunch.' },
      { who: 'juno', text: 'I know. I watched him do it. I just needed to see who he was working with.' },
    ],
    next: 'crane',
  },
  shopTruth: {
    action: 'Juno stops chewing.',
    lines: [
      { who: 'juno', paren: 'quietly', text: 'I know. I was standing right here.' },
      { who: 'juno', paren: 'turning her badge the right way up. It says DETECTIVE.', text: 'I’m not a clerk. Six numbers moved from this shop in a month. I’m waiting for the one who lets them.' },
    ],
    next: 'crane',
  },
  shopWatch: {
    lines: [
      { who: 'juno', paren: 'not looking up', text: 'You’ve held that case for a minute. It’s a sock, by the way. A phone sock.' },
      { who: 'juno', text: 'Here about Pip? Me too. Badge is upside down on purpose. Stay quiet.' },
    ],
    next: 'crane',
  },
  crane: {
    action: 'The back door swings open. MR CRANE, the manager, in a tie with phones on it.',
    lines: [
      { who: 'crane', text: 'Juno, is this another “lost my phone” gent? I’ll take him. I always take those.' },
      { who: 'crane', paren: 'tapping the counter', text: 'Birthday, address, pet. Lovely. And the little gift card, as usual?' },
      { who: 'juno', text: 'As usual, Mr Crane?' },
      { who: 'crane', paren: 'realising, slowly', text: 'That badge is the right way up.' },
    ],
    next: 'craneEnd',
  },
  craneEnd: {
    action: 'Later, outside. Pip, with a new SIM and a borrowed laptop.',
    lines: [
      { who: 'juno', text: 'Crane moved numbers for anyone with three details and a gift card. The exchange has frozen the thief’s withdrawal. Pip gets his coins back.' },
      { who: 'pip', text: 'So what do I do now? Change my birthday?' },
      { who: 'rook', text: 'Take your phone number off your money. Use an app that makes the codes on your own device, or a key you plug in. And keep your savings where no shop clerk can reach them.' },
      { who: 'pip', paren: 'pulling the lost-cat poster down', text: 'Rocket would have wanted this.' },
    ],
    then: 'done',
  },
});

export const NUMBER_ACT: StoryAct = Object.freeze({
  id: 'number',
  kind: 'case',
  number: 'Side case',
  title: 'Borrowed Number',
  blurb: 'Inspired by phone numbers hijacked to break into accounts. Find out how little it takes.',
  steps: NUMBER_STEPS,
  scenes: Object.freeze({ call: 'pip', shop: 'shop' }),
  objectives: NUMBER_OBJECTIVES,
  targets: Object.freeze({ toShop: SHOP_DOOR }),
  arrivals: Object.freeze({ toShop: { at: SHOP_DOOR, range: 2.2, to: 'shop' } }),
  closed: ['shop', 'done'],
  workStep: 'gather',
  spots: DETAILS,
  workReach: DETAIL_REACH,
  workMs: DETAIL_MS,
  workGoal: DETAILS.length,
  goalLabel: 'Details found',
  workVerb: 'Read the {}',
  hint: 'Three details, somewhere round the arcade and the river. Split up to be quicker.',
  markers: 'labels',
  night: 0.12,
  nights: Object.freeze({ toShop: 0.3, shop: 0.3, done: 0.3 }),
  catchers: Object.freeze({}),
  start: NUMBER_START,
  script: NUMBER_SCRIPT,
  marks: NUMBER_MARKS,
  rewardSats: NUMBER_REWARD_SATS,
  lesson:
    'A phone number protects nothing. Anyone who can pass a phone shop’s three questions can move it, and every text code goes with it. Birthdays, addresses and pets’ names are easy to find. Use an authenticator app or a hardware key for anything holding money.',
  next: 'Case closed. More cases wait in the casebook.',
});
