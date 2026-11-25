// Every playable story by id: the acts of "The Cold Key", season by season, then the side cases.
import { COINS_ACT } from './coins.js';
import { DEADMAN_ACT } from './deadman.js';
import { DUMP_ACT } from './dump.js';
import { FOUNDER_ACT } from './founder.js';
import { INSIDER_ACT } from './insider.js';
import { NUMBER_ACT } from './number.js';
import { OVERFLOW_ACT } from './overflow.js';
import { PASSWORD_ACT } from './password.js';
import { PIZZA_ACT } from './pizza.js';
import { POPCORN_ACT } from './popcorn.js';
import { SPLIT_ACT } from './split.js';
import { RANSOM_ACT } from './ransom.js';
import type { ActId, StoryAct } from './story.js';

export const STORY_ACTS: Readonly<Record<ActId, StoryAct>> = Object.freeze({
  dump: DUMP_ACT,
  ransom: RANSOM_ACT,
  insider: INSIDER_ACT,
  founder: FOUNDER_ACT,
  overflow: OVERFLOW_ACT,
  split: SPLIT_ACT,
  popcorn: POPCORN_ACT,
  number: NUMBER_ACT,
  coins: COINS_ACT,
  deadman: DEADMAN_ACT,
  password: PASSWORD_ACT,
  pizza: PIZZA_ACT,
});

export const isActId = (id: unknown): id is ActId => typeof id === 'string' && Object.hasOwn(STORY_ACTS, id);

export const actOf = (id: string): StoryAct => (isActId(id) ? STORY_ACTS[id] : DUMP_ACT);

export const SIDE_CASES: readonly StoryAct[] = Object.freeze(Object.values(STORY_ACTS).filter((a) => a.kind === 'case'));
