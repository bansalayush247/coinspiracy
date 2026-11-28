// Port Concord messages. Movement reuses the match's move payload; emotes reuse Beach Town's.
import { z } from 'zod';
import { NicknameSchema } from '../lobby.js';
import { FerryArriveSchema } from './ferry.js';

export const CITY_ROOM = 'city';
// One region server's capacity; more regions come with handoff at their edges.
export const CITY_MAX_PLAYERS = 60;

/** Joining by nickname; `arrive: 'ferry'` lands the guardian at the ferry dock, and nothing else about it comes from the client. */
export const CityJoinSchema = z.strictObject({ nickname: NicknameSchema, arrive: FerryArriveSchema.optional() });

export const CITY_MESSAGES = Object.freeze({
  EMOTE: 'emote',
  JUMP: 'jump',
  PUNCH: 'punch',
  VAULT: 'vault',
  DOOR: 'door',
} as const);

export const DOOR_REASONS = ['in', 'out', 'notAtDoor', 'full', 'tooSoon', 'inCar', 'down', 'fighting'] as const;
/** Why a door did or did not open. */
export type DoorReason = (typeof DOOR_REASONS)[number];

/** The outcome of going through a door: in or out, or why not. */
export const DoorResultSchema = z.strictObject({
  ok: z.boolean(),
  inside: z.number().int().min(0).max(65_535),
  reason: z.enum(DOOR_REASONS),
});
export type DoorResult = z.infer<typeof DoorResultSchema>;

export const DEPOSIT_REASONS = ['paid', 'empty', 'notAtVault', 'dailyLimit', 'walletFull', 'noProfile', 'busy', 'error'] as const;
export type DepositReason = (typeof DEPOSIT_REASONS)[number];

// The outcome of a deposit: what went into the wallet, what stayed in the pocket, and today's running total.
export const DepositResultSchema = z.strictObject({
  paid: z.number().int().min(0).max(1_000_000),
  kept: z.number().int().min(0).max(1_000_000),
  reason: z.enum(DEPOSIT_REASONS),
  today: z.number().int().min(0).max(1_000_000),
  limit: z.number().int().min(0).max(1_000_000),
});
export type DepositResult = z.infer<typeof DepositResultSchema>;

// A punch the viewer can see: who swung, who it landed on (null for a miss), and whether it knocked them out.
export const PunchLineSchema = z.strictObject({
  from: z.string().min(1).max(32),
  to: z.string().min(1).max(32).nullable(),
  knockedOut: z.boolean(),
});
export type PunchLine = z.infer<typeof PunchLineSchema>;

// Where the driver points the car: the same world-space direction as walking, no sequence numbers.
/** A driver's input: a direction to head for (the touch stick), or pedal and wheel (the keyboard). */
export const DrivePayloadSchema = z.union([
  z.strictObject({ dx: z.number().min(-1).max(1), dy: z.number().min(-1).max(1) }),
  z.strictObject({ throttle: z.number().min(-1).max(1), steer: z.number().min(-1).max(1) }),
]);
export type DrivePayload = z.infer<typeof DrivePayloadSchema>;
