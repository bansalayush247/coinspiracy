// Every playable act of "The Cold Key", by id.
import { DUMP_ACT } from './dump.js';
import { FOUNDER_ACT } from './founder.js';
import { INSIDER_ACT } from './insider.js';
import { RANSOM_ACT } from './ransom.js';
import type { ActId, StoryAct } from './story.js';

export const STORY_ACTS: Readonly<Record<ActId, StoryAct>> = Object.freeze({ dump: DUMP_ACT, ransom: RANSOM_ACT, insider: INSIDER_ACT, founder: FOUNDER_ACT });

export const isActId = (id: unknown): id is ActId => typeof id === 'string' && Object.hasOwn(STORY_ACTS, id);

export const actOf = (id: string): StoryAct => (isActId(id) ? STORY_ACTS[id] : DUMP_ACT);
