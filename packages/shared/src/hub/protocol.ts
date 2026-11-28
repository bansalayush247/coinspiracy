// Beach Town messages. Movement reuses the match's move payload.
import { z } from 'zod';
import { BeachShopIdSchema } from '../economy/catalog.js';
import { NicknameSchema } from '../lobby.js';
import { FerryArriveSchema } from '../city/ferry.js';

export const BEACH_ROOM = 'beach';
export const BEACH_MAX_PLAYERS = 16;

/** Joining by nickname; `arrive: 'ferry'` lands the guardian at the ferry dock, and nothing else about it comes from the client. */
export const BeachJoinSchema = z.strictObject({ nickname: NicknameSchema, arrive: FerryArriveSchema.optional() });

export const TakeJobPayloadSchema = z.strictObject({ shop: BeachShopIdSchema });

// Friendly emotes only: no free text in the hub.
export const EMOTES = ['wave', 'cheer', 'dance', 'heart', 'laugh', 'shaka'] as const;
export type Emote = (typeof EMOTES)[number];
export const EMOTE_GLYPHS: Readonly<Record<Emote, string>> = { wave: '👋', cheer: '🎉', dance: '💃', heart: '❤️', laugh: '😄', shaka: '🤙' };
export const EMOTE_GAP_MS = 1500;
export const EmotePayloadSchema = z.strictObject({ emote: z.enum(EMOTES) });
export const EmoteLineSchema = z.strictObject({ from: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), emote: z.enum(EMOTES) });
/** Shortest gap between two jumps by one guardian: a jump is only for show, so it is paced like an emote. */
export const JUMP_GAP_MS = 600;
/** Someone jumped, sent to whoever can see them. */
export const JumpLineSchema = z.strictObject({ from: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) });

export const BEACH_MESSAGES = Object.freeze({
  JOB: 'courierJob',
  DONE: 'courierDone',
  REFUSED: 'courierRefused',
  EMOTE: 'emote',
  JUMP: 'jump',
} as const);

const JobId = z.string().regex(/^[A-Za-z0-9_-]{8,24}$/);
export const CourierJobSchema = z.strictObject({ id: JobId, from: BeachShopIdSchema, to: BeachShopIdSchema, reward: z.number().int().min(1).max(100) });
export type CourierJob = z.infer<typeof CourierJobSchema>;
export const CourierDoneSchema = z.strictObject({
  id: JobId,
  // Sats added to the wallet; 0 when not paid.
  paid: z.number().int().min(0).max(100),
  reason: z.enum(['paid', 'noProfile', 'dailyLimit', 'walletFull', 'error']),
  deliveredToday: z.number().int().min(0).max(1000),
  // Courier seals this delivery completed.
  seals: z.array(z.string().regex(/^[A-Za-z0-9]{1,32}$/)).max(8),
});
export type CourierDone = z.infer<typeof CourierDoneSchema>;
export const COURIER_REFUSALS = ['notHere', 'busy', 'noJob', 'wrongShop', 'tooFast'] as const;
export const CourierRefusedSchema = z.strictObject({ reason: z.enum(COURIER_REFUSALS) });
export type CourierRefused = z.infer<typeof CourierRefusedSchema>;
