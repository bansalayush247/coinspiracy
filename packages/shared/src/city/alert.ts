// Season two, act four of "The Cold Key", the end of season two: The Last Alert. The voice on the Mint channel is
// Mags. In the gatehouse she still keeps the Mint's first radio and its alert key: one key whose messages every
// guardian's radio obeys, "stop signing" included. Rex has heard her and wants it. The crew walks Mags across the
// tip at night, past Rex's volunteers, to the old aerial, where she retires the key by reading it out to everyone.
import type { CitadelMap, Vec2 } from '../map.js';
import { findPath } from '../pathfinding.js';
import { GATE_SPOT } from './dump.js';
import { walkPath, type Walker } from './patrol.js';
import { IVY_SPOT } from './ransom.js';
import type { Mark, Script } from './script.js';
import type { StoryAct } from './story.js';

export const ALERT_STEPS = ['call', 'toTip', 'hatch', 'escort', 'aerial', 'done'] as const;

export const HATCH: Vec2 = Object.freeze({ x: GATE_SPOT.x - 1.2, y: GATE_SPOT.y });
export const AERIAL: Vec2 = Object.freeze({ x: 13.5, y: 3.5 });
export const AERIAL_REACH = 1.6;

// Mags follows the nearest of the crew she can hear, a step behind, slower than they walk.
export const MAGS_SPEED = 2;
export const MAGS_HEAR = 8;
export const MAGS_GAP = 1.2;
const MAGS_REPATH = 0.8;

export interface Follower {
  readonly walker: Walker;
  readonly path: readonly Vec2[];
  // Where the path was planned to; a new one is planned once the leader has moved on from it.
  readonly goal: Vec2 | null;
}

export const follower = (at: Vec2): Follower => ({ walker: { x: at.x, y: at.y, facing: 0, leg: 0 }, path: [], goal: null });

export function leaderOf(at: Vec2, crew: readonly Vec2[]): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = MAGS_HEAR;
  for (const c of crew) {
    const d = Math.hypot(c.x - at.x, c.y - at.y);
    if (d <= bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

// Tiles one follow search may open: plenty for a leader within earshot, and a bound when none is reachable.
const MAGS_SEARCH = 4096;

// One step of Mags following whoever is nearest within earshot; she stands still once close, or if nobody is near.
export function follow(f: Follower, crew: readonly Vec2[], dt: number, map: CitadelMap): Follower {
  const w = f.walker;
  const leader = leaderOf(w, crew);
  if (leader === null || Math.hypot(leader.x - w.x, leader.y - w.y) <= MAGS_GAP) return f;
  let { path, goal } = f;
  let walker = w;
  if (goal === null || Math.hypot(goal.x - leader.x, goal.y - leader.y) > MAGS_REPATH || (path.length > 0 && walker.leg >= path.length - 1)) {
    const found = findPath(map, w, leader, { maxExpansions: MAGS_SEARCH });
    // No way through: wait until the leader has moved on instead of searching again every tick.
    if (!found.ok) return { walker: w, path: [], goal: { x: leader.x, y: leader.y } };
    path = [{ x: w.x, y: w.y }, ...found.value];
    goal = { x: leader.x, y: leader.y };
    walker = { ...w, leg: 0 };
  }
  return { walker: walkPath(walker, path, MAGS_SPEED, dt), path, goal };
}

// Rex's volunteers comb the north tip with torches, back and forth.
export const VOLUNTEER_ROUTES: readonly (readonly Vec2[])[] = Object.freeze([
  [
    { x: 30.5, y: 3.5 },
    { x: 30.5, y: 12.5 },
  ],
  [
    { x: 28.5, y: 6.5 },
    { x: 12.5, y: 6.5 },
  ],
  [
    { x: 12.5, y: 9.5 },
    { x: 28.5, y: 9.5 },
  ],
  [
    { x: 21.5, y: 12.5 },
    { x: 21.5, y: 3.5 },
  ],
  [
    { x: 13.5, y: 14.5 },
    { x: 28.5, y: 14.5 },
  ],
  [
    { x: 45.5, y: 15 },
    { x: 33.5, y: 15 },
  ],
]);
export const VOLUNTEER_SPEED = 1.5;
export const MAGS_SPOTTED = 'A torch finds Mags. “Rex’s lot!” She’s back in the hatch quicker than you’d think. Go and fetch her.';
/** What the volunteers walking the yard are called over their heads. */
export const VOLUNTEER_NAME = 'Volunteer';

export const ALERT_OBJECTIVES: Readonly<Record<(typeof ALERT_STEPS)[number], string>> = Object.freeze({
  call: 'The Mint’s watchtower room. Ozzy has traced the voice.',
  toTip: 'Get to the gatehouse at Gullmoor tip before Rex does.',
  hatch: 'The hatch.',
  escort: 'Walk Mags to the old aerial on the north tip. She follows whoever is nearest. Keep her out of the torches.',
  aerial: 'The old aerial.',
  done: 'Season two complete.',
});

export const ALERT_MARKS: Readonly<Record<string, Mark>> = Object.freeze({
  pastHonest: { text: 'you told the plain truth at least once at the tip' },
  pastLeftMags: { who: 'mags', text: 'you let her keep her secret last time' },
  pastPressedMags: { who: 'mags', text: 'you asked her straight out last time' },
  clueAlert: { text: 'The Mint’s first radio had an alert key: anything signed with it, every guardian’s radio obeyed.', clue: true },
  sawRisk: { who: 'ivy', text: 'you said whoever holds that key is the Mint', honest: true },
  defendedVoice: { who: 'ozzy', text: 'you stuck up for the voice on the radio' },
  eyedKey: { who: 'ivy', text: 'you wondered what a key like that would sell for' },
  trustedMags: { who: 'mags', text: 'you said it was her key and her call', honest: true },
  askedWhy: { who: 'mags', text: 'you asked why she kept it' },
  askedForKey: { who: 'mags', text: 'you offered to keep it safe for her' },
  publishedKey: { who: 'mags', text: 'you told her to read out every number', honest: true },
  usedOnce: { who: 'mags', text: 'you asked her to use it just once' },
  beggedKey: { who: 'mags', text: 'you asked for the key at the very end' },
  leftItToMags: { who: 'mags', text: 'you left the last word to her', honest: true },
});

export const ALERT_REWARD_SATS = 600;

export const ALERT_SCRIPT: Script = Object.freeze({
  tower: {
    slug: 'INT. MINT WATCHTOWER ROOM — NIGHT',
    action: 'Ozzy at his six screens. Ivy behind him with two mugs of tea, neither for Rook.',
    lines: [
      { who: 'ozzy', text: 'The voice on the Mint channel. “Told you.” I traced it.' },
      { who: 'ozzy', text: 'Gullmoor. The gatehouse at the tip. On a radio older than my mum.' },
      { who: 'ivy', text: 'The Mint’s first radio. Back then there was one key, the alert key. Anything signed with it, every guardian’s radio obeyed. Stop signing. Switch off. Anything.' },
      { who: 'ivy', text: 'We thought it was lost years ago.' },
      { who: 'ozzy', text: 'And I’m not the only one who traced it. Rex’s volunteers have been asking the way to Gullmoor all evening.' },
    ],
    mark: 'clueAlert',
    choices: [
      { id: 'risk', tag: 'Worry', text: 'One key every radio obeys? Whoever holds it is the Mint.', go: 'towerRisk', mark: 'sawRisk' },
      { id: 'defend', tag: 'Defend', text: 'Two words in fifteen years. Whoever it is, they’re hardly a tyrant.', go: 'towerDefend', mark: 'defendedVoice' },
      { id: 'eye', tag: 'Price', text: 'A key like that would be worth a lot to the right buyer.', go: 'towerEye', mark: 'eyedKey' },
    ],
    seconds: 15,
    timeout: 'towerRisk',
  },
  towerRisk: { lines: [{ who: 'ivy', text: 'Exactly. Which is why it can’t end up with Rex. Or with anyone.' }], next: 'towerGo' },
  towerDefend: { lines: [{ who: 'ozzy', text: 'Two very smug words, though.' }], next: 'towerGo' },
  towerEye: { lines: [{ who: 'ivy', paren: 'putting a mug down, slowly', text: 'That is exactly the sentence I’m worried about, Rook.' }], next: 'towerGo' },
  towerGo: {
    lines: [{ who: 'ivy', text: 'Get to the tip before Rex does. And Rook? Be kind. I think I know who it is.' }],
    then: 'toTip',
  },

  hatch: {
    slug: 'EXT. GULLMOOR TIP, GATE — NIGHT',
    action: 'The hatch is open. Beside the crossword, a radio the size of a fridge, dials glowing. Mags has headphones on. Duncan has one ear up.',
    lines: [
      { who: 'mags', paren: 'not taking the headphones off', text: 'Took you long enough.' },
      { who: 'mags', if: 'pastLeftMags', text: 'You let me keep my secret, last time. I noticed. So I’ll tell you.' },
      { who: 'mags', if: 'pastPressedMags', text: 'You asked me straight out, last time. Fine. Straight out, then.' },
      { who: 'rook', text: 'It was you. On the Mint channel.' },
      { who: 'mags', text: 'Two words in fifteen years. I was provoked.' },
      { who: 'mags', paren: 'holding up a card in a plastic sleeve', text: 'The alert key. Anything I sign with this, every guardian’s radio believes.' },
      { who: 'mags', text: 'Out there, those torches are Rex’s volunteers, looking for the aerial. If he gets this, he tells every guardian to stop signing Mint notes and sign his.' },
      { who: 'mags', text: 'There’s one way to make it useless. Read it out on the big aerial, to everyone. A key everybody knows can’t speak for anybody.' },
      { who: 'mags', text: 'The aerial’s on top of the north tip. My knees aren’t. Walk me there, and keep me out of their torches.' },
    ],
    choices: [
      { id: 'trust', tag: 'Her call', text: 'Your key, your call. Let’s go.', go: 'hatchTrust', mark: 'trustedMags' },
      { id: 'why', tag: 'Why', text: 'Why didn’t you get rid of it years ago?', go: 'hatchWhy', mark: 'askedWhy' },
      { id: 'take', tag: 'Take it', text: 'Give it to me. I’ll keep it safe.', go: 'hatchTake', mark: 'askedForKey' },
    ],
    seconds: 15,
    timeout: 'hatchTrust',
  },
  hatchTrust: { lines: [{ who: 'mags', paren: 'taking the headphones off at last', text: 'Good answer.' }], next: 'hatchGo' },
  hatchWhy: {
    lines: [
      { who: 'mags', text: 'In case. That’s what everyone who keeps a key like this says. In case.' },
      { who: 'mags', text: 'And because a bit of me liked being the one who could. Which is exactly why it has to go.' },
    ],
    next: 'hatchGo',
  },
  hatchTake: { lines: [{ who: 'mags', text: 'Everyone who asks says that, love. That’s the trouble with it.' }], next: 'hatchGo' },
  hatchGo: {
    lines: [{ who: 'mags', paren: 'to the dog', text: 'Duncan. Mind the shop.' }],
    after: 'Duncan puts his ear down. Mags tucks the card into her cardigan and waits by the hatch for someone to lead.',
    then: 'escort',
  },

  aerial: {
    slug: 'EXT. GULLMOOR TIP, THE OLD AERIAL — NIGHT',
    action: 'A rusty aerial on the top of the north tip, wired to a car battery. Mags plugs in a handset. Below, the torches gather: Rex, with his megaphone, and his volunteers.',
    lines: [
      { who: 'rex', paren: 'through the megaphone', text: 'Evening! That’s a lovely old key, madam. Let me look after it for you.' },
      { who: 'mags', text: 'Everybody wants to look after it.' },
      { who: 'mags', paren: 'the handset at her mouth, to Rook', text: 'Last chance to tell me what to do with it.' },
    ],
    choices: [
      { id: 'publish', tag: 'Read it out', text: 'Read it out. Every number. Then it’s nobody’s.', go: 'aerialRead', mark: 'publishedKey' },
      { id: 'once', tag: 'Once', text: 'Use it once first. Tell the guardians to ignore Rex.', go: 'aerialOnce', mark: 'usedOnce' },
      { id: 'beg', tag: 'Give it me', text: 'Give it to me, Mags. Please.', go: 'aerialBeg', mark: 'beggedKey', if: 'askedForKey' },
      { id: 'hers', tag: 'Her call', text: 'It’s yours. You decide.', go: 'aerialHers', mark: 'leftItToMags' },
    ],
    seconds: 15,
    timeout: 'aerialHers',
  },
  aerialOnce: { lines: [{ who: 'mags', text: 'Once. That’s how it starts, every time, with everyone.' }], next: 'aerialRead' },
  aerialBeg: { lines: [{ who: 'mags', paren: 'gently', text: 'No, love.' }], next: 'aerialRead' },
  aerialHers: { lines: [{ who: 'mags', text: 'Then I’ve decided.' }], next: 'aerialRead' },
  aerialRead: {
    lines: [
      { who: 'mags', paren: 'into the handset', text: 'This is the alert key. It is retired. Here it is, every number, so that it means nothing.' },
    ],
    after: 'She reads out sixty-four characters. Every radio in the city crackles. Then, one by one, every guardian switches the alert channel off.',
    next: 'aerialRex',
  },
  aerialRex: {
    lines: [
      { who: 'rex', paren: 'megaphone down', text: 'So I came up a rubbish tip in my good shoes for a number anyone can have.' },
      { who: 'mags', text: 'Now you know how I felt for fifteen years.' },
      { who: 'rex', text: '…Fair.' },
      { who: 'ivy', paren: 'on the phone', text: 'Every guardian has switched off alerts. From tonight, nobody’s voice counts for more than the maths. Not even hers.' },
    ],
    next: 'dawn',
  },
  dawn: {
    slug: 'EXT. GULLMOOR TIP, GATE — DAWN',
    action: 'Gulls. Duncan asleep on Mags’s feet. The crossword, nearly done.',
    lines: [
      { who: 'mags', text: 'Seven down. “Person who isn’t important any more.” Nine letters.' },
      { who: 'rook', if: 'pastPressedMags', text: 'You said that was the right answer, last time.' },
      { who: 'mags', paren: 'writing it in, one letter at a time', text: 'E. X. F. O. U. N. D. E. R.' },
      { who: 'rook', text: 'That’s not a word.' },
      { who: 'mags', text: 'It is now.' },
      { who: 'mags', text: 'Go home, Rook. Nothing to watch here any more. That was always the point.' },
    ],
    then: 'done',
  },
});

export const ALERT_ACT: StoryAct = Object.freeze({
  id: 'alert',
  kind: 'act',
  number: 'Season two, act four',
  title: 'The Last Alert',
  blurb: 'Inspired by the old alert key that could message every node at once, and how it was retired by being made public.',
  steps: ALERT_STEPS,
  scenes: Object.freeze({ call: 'tower', hatch: 'hatch', aerial: 'aerial' }),
  objectives: ALERT_OBJECTIVES,
  targets: Object.freeze({ toTip: GATE_SPOT, escort: AERIAL }),
  arrivals: Object.freeze({ toTip: { at: GATE_SPOT, range: 2.5, to: 'hatch' } }),
  closed: ['aerial', 'done'],
  workStep: 'escort',
  spots: [],
  workReach: 1,
  workMs: 1_000,
  workGoal: 0,
  workVerb: '{}',
  hint: 'Mags follows whoever is nearest, slower than you walk. Torches can’t see through the rubbish mounds: cross when a lane goes dark.',
  markers: 'labels',
  night: 0.7,
  nights: Object.freeze({ call: 0.45, aerial: 0.6, done: 0.25 }),
  catchers: Object.freeze({
    lookout: {
      name: 'A volunteer',
      where: 'the gate',
      lines: [
        'A volunteer in a yellow sash: “Rex says nobody up here but us. Off you pop.” Back to the gate.',
        'The volunteer again: “Do you want a leaflet? Have a leaflet. Now off to the gate.”',
        'Volunteer: “Third time! I’m putting you down as a maybe.”',
      ],
    },
  }),
  carries: true,
  start: IVY_SPOT,
  script: ALERT_SCRIPT,
  marks: ALERT_MARKS,
  rewardSats: ALERT_REWARD_SATS,
  lesson:
    'Early on, the software carried an alert key: one key whose messages every node showed, and that could once even pause them. Whoever held it, or stole it, could speak for everyone. So it was retired, and later published on purpose: once everyone knows a key, a message signed with it proves nothing. The safest key is one nobody needs.',
  next: 'Season two is over. Nobody’s voice counts for more than the maths, which was always the point.',
});
