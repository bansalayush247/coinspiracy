// Side case: Pizza Night. Benny, a programmer on Signet Row, has offered ten thousand coins on the community board
// for two large pizzas, delivered. Nobody takes him seriously but Marco. The crew gathers toppings round
// Saltmarket, then runs two hot pizzas across town past the gulls. Ten years later, those ten thousand coins would
// buy the street. Nobody regrets anything, much.
import type { Vec2 } from '../map.js';
import type { Mark, Script } from './script.js';
import type { StoryAct, StorySpot } from './story.js';

export const PIZZA_STEPS = ['call', 'toppings', 'toMarco', 'oven', 'deliver', 'benny', 'done'] as const;

export const MARCO_DOOR: Vec2 = Object.freeze({ x: 58.5, y: 66.5 });
export const BENNY_DOOR: Vec2 = Object.freeze({ x: 112.5, y: 64.5 });

export const TOPPINGS: readonly (StorySpot & { readonly note: string })[] = Object.freeze([
  { at: { x: 60.5, y: 69.5 }, label: 'tomato stall', note: 'Tomatoes, the good ones. The stallholder winks.' },
  { at: { x: 54.5, y: 70.5 }, label: 'fish market', refuses: true, note: 'Out of anchovies. Forever, apparently. “Don’t ask.”' },
  { at: { x: 71.5, y: 66.5 }, label: 'olive shop', note: 'A jar of olives and a lecture on olives.' },
  { at: { x: 76.5, y: 85.5 }, label: 'cheese stall', note: 'Mozzarella, wrapped in paper like a present.' },
  { at: { x: 53.5, y: 86.8 }, label: 'basil stall', note: 'A bunch of basil that smells like summer.' },
]);
export const TOPPINGS_NEEDED = 3;
export const TOPPING_REACH = 1.3;
export const TOPPING_MS = 1_200;

// Gulls circling over the road east: out along the road, back over the lane beside it. Pass while a gull is on its
// way back; one that spots the pizzas swoops, and back you go to the last corner to regroup.
export const GULLS: readonly { readonly route: readonly Vec2[]; readonly speed: number; readonly back: Vec2 }[] = Object.freeze([
  {
    route: [
      { x: 67, y: 62.6 },
      { x: 84, y: 62.6 },
      { x: 84, y: 60.5 },
      { x: 67, y: 60.5 },
    ],
    speed: 2,
    back: { x: 60.5, y: 60.5 },
  },
  {
    route: [
      { x: 88, y: 63.4 },
      { x: 99.5, y: 63.4 },
      { x: 99.5, y: 60.5 },
      { x: 88, y: 60.5 },
    ],
    speed: 2.2,
    back: { x: 86.5, y: 57.5 },
  },
  {
    route: [
      { x: 104, y: 62.6 },
      { x: 113.5, y: 62.6 },
      { x: 113.5, y: 60.5 },
      { x: 104, y: 60.5 },
    ],
    speed: 2,
    back: { x: 102.5, y: 55.5 },
  },
]);

export const PIZZA_OBJECTIVES: Readonly<Record<(typeof PIZZA_STEPS)[number], string>> = Object.freeze({
  call: 'Marco’s pizzeria, Saltmarket.',
  toppings: 'Gather three toppings from the Saltmarket stalls.',
  toMarco: 'Bring the toppings back to Marco’s.',
  oven: 'Marco’s oven.',
  deliver: 'Deliver two hot pizzas to Benny on Signet Row. Mind the gulls.',
  benny: 'Benny’s door.',
  done: 'Case closed.',
});

export const PIZZA_MARKS: Readonly<Record<string, Mark>> = Object.freeze({
  believedBenny: { who: 'marco', text: 'you said a deal’s a deal', honest: true },
  laughedBenny: { who: 'marco', text: 'you laughed at the notice' },
  tookCoins: { who: 'benny', text: 'you took the ten thousand coins' },
  askedCash: { who: 'benny', text: 'you asked for cash instead' },
  onTheHouse: { who: 'benny', text: 'you said it was on the house', honest: true },
});

export const PIZZA_REWARD_SATS = 150;

export const PIZZA_SCRIPT: Script = Object.freeze({
  notice: {
    slug: 'INT. MARCO’S PIZZERIA, SALTMARKET — EVENING',
    action: 'Flour everywhere. MARCO, sixty, holds up a printed notice from the community board.',
    lines: [
      { who: 'marco', text: '“Will pay ten thousand coins for two large pizzas, delivered. Signet Row. — Benny.”' },
      { who: 'marco', text: 'Ten thousand of those internet coins. For two pizzas. My nephew says they’re worth nothing.' },
      { who: 'marco', text: 'But he asked nicely. And nobody else will do it.' },
    ],
    choices: [
      { id: 'deal', tag: 'Deal', text: 'A deal’s a deal. If he wants pizza, he gets pizza.', go: 'noticeDeal', mark: 'believedBenny' },
      { id: 'laugh', tag: 'Laugh', text: 'Ten thousand of anything for two pizzas? He’s having you on.', go: 'noticeLaugh', mark: 'laughedBenny' },
    ],
    seconds: 12,
    timeout: 'noticeEnd',
  },
  noticeDeal: { lines: [{ who: 'marco', text: 'That’s what I said! My nephew said I was soft.' }], next: 'noticeEnd' },
  noticeLaugh: { lines: [{ who: 'marco', text: 'Maybe. But a pizza is a pizza, and a promise is a promise.' }], next: 'noticeEnd' },
  noticeEnd: {
    lines: [
      { who: 'marco', text: 'I need three toppings from the market. Tomatoes, cheese, whatever’s good. Not anchovies. Nobody has anchovies.' },
      { who: 'rook', text: 'Three toppings. Back in a minute.' },
    ],
    then: 'toppings',
  },

  oven: {
    slug: 'INT. MARCO’S PIZZERIA — LATER',
    action: 'Two large pizzas slide out of the oven, perfect. Marco boxes them like newborns.',
    lines: [
      { who: 'marco', text: 'Signet Row. Straight up the road and across the river. Fast, before they’re cold.' },
      { who: 'marco', paren: 'grave', text: 'And the gulls. The gulls know what a pizza box is.' },
    ],
    then: 'deliver',
  },

  benny: {
    slug: 'EXT. SIGNET ROW — NIGHT',
    action: 'BENNY, in a hoodie, opens the door before they knock. He looks at the boxes like they’re a moon landing.',
    lines: [
      { who: 'benny', text: 'You came. Nobody believed I’d actually pay.' },
      { who: 'benny', paren: 'tapping his phone', text: 'Ten thousand coins. Sent. To Marco. Thank you. Really.' },
    ],
    choices: [
      { id: 'coins', tag: 'Coins', text: 'Pleasure doing business.', go: 'bennyCoins', mark: 'tookCoins' },
      { id: 'cash', tag: 'Cash', text: 'Couldn’t you pay in normal money?', go: 'bennyCash', mark: 'askedCash' },
      { id: 'free', tag: 'Free', text: 'Keep your coins. It’s on the house.', go: 'bennyFree', mark: 'onTheHouse' },
    ],
    seconds: 12,
    timeout: 'bennyCoins',
  },
  bennyCoins: { lines: [{ who: 'benny', text: 'Somebody had to buy the first pizza. Otherwise they’re just numbers on a screen.' }], next: 'later' },
  bennyCash: {
    lines: [
      { who: 'benny', text: 'That’s the point. If nobody ever swaps them for anything real, they never are money.' },
      { who: 'benny', text: 'Tonight, ten thousand of them are worth two pizzas. That’s a price. The first one.' },
    ],
    next: 'later',
  },
  bennyFree: {
    lines: [
      { who: 'benny', paren: 'shaking his head, smiling', text: 'Too late. Already sent. And I want it to count: the first time these coins bought anything.' },
    ],
    next: 'later',
  },
  later: {
    slug: 'INT. MARCO’S PIZZERIA — TEN YEARS LATER',
    action: 'A framed receipt above the oven: 2 LARGE PIZZAS · 10,000 COINS. Marco’s nephew stares at it every time he comes in.',
    lines: [
      { who: 'marco', text: 'Those coins would buy this whole street now. I spent most of them on a new oven. Worth it.' },
      { who: 'benny', paren: 'at the counter, as always', text: 'Best pizza I ever bought. Most expensive too.' },
      { who: 'rook', text: 'Money’s only worth what people will swap for it. Somebody has to go first.' },
    ],
    then: 'done',
  },
});

export const PIZZA_ACT: StoryAct = Object.freeze({
  id: 'pizza',
  kind: 'case',
  number: 'Side case',
  title: 'Pizza Night',
  blurb: 'Inspired by the ten thousand bitcoin once paid for two pizzas. A delivery run, and the gulls.',
  steps: PIZZA_STEPS,
  scenes: Object.freeze({ call: 'notice', oven: 'oven', benny: 'benny' }),
  objectives: PIZZA_OBJECTIVES,
  targets: Object.freeze({ toMarco: MARCO_DOOR, deliver: BENNY_DOOR }),
  arrivals: Object.freeze({ toMarco: { at: MARCO_DOOR, range: 2, to: 'oven' }, deliver: { at: BENNY_DOOR, range: 2, to: 'benny' } }),
  closed: ['benny', 'done'],
  workStep: 'toppings',
  spots: TOPPINGS,
  workReach: TOPPING_REACH,
  workMs: TOPPING_MS,
  workGoal: TOPPINGS_NEEDED,
  goalLabel: 'Toppings',
  workVerb: 'Buy from the {}',
  hint: 'Stalls all round Saltmarket. Three toppings will do. Split up to be quicker.',
  markers: 'labels',
  night: 0.3,
  nights: Object.freeze({ deliver: 0.45, benny: 0.5, done: 0.2 }),
  catchers: Object.freeze({
    gull: {
      name: 'A gull',
      where: 'the last corner',
      lines: [
        'A gull drops out of the sky and gets a beak under the lid. You back off to the last corner to regroup.',
        'Another gull. It looks you in the eye while it does it. Back to the last corner.',
        'The gulls are organised now. They have a leader. Back to the last corner.',
      ],
    },
  }),
  start: MARCO_DOOR,
  script: PIZZA_SCRIPT,
  marks: PIZZA_MARKS,
  rewardSats: PIZZA_REWARD_SATS,
  lesson:
    'Money is only worth what people will swap for it. The first trade sets the first price: ten thousand coins for two pizzas looked silly, and later looked priceless. Prices move; what stays true is that something becomes money when people agree to use it.',
  next: 'Case closed. More cases wait in the casebook.',
});
