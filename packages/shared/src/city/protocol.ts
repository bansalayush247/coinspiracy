// Port Concord messages. Movement reuses the match's move payload; emotes reuse Beach Town's.
import { z } from 'zod';
import { NicknameSchema } from '../lobby.js';

export const CITY_ROOM = 'city';
// One region server's capacity; more regions come with handoff at their edges.
export const CITY_MAX_PLAYERS = 60;

export const CityJoinSchema = z.strictObject({ nickname: NicknameSchema });

export const CITY_MESSAGES = Object.freeze({
  EMOTE: 'emote',
} as const);
