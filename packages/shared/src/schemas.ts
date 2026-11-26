import { z } from 'zod';
import { MAX_INPUT_SEQ, MAX_MESSAGE_BYTES, ROOMS, SIMPLE_PHRASES } from './constants.js';
import { ArenaIdSchema } from './arena.js';
import { TaskAnswerSchema, TaskChallengeSchema } from './minigames.js';
import { err, ok, type Result } from './result.js';
import { TASK_KINDS } from './tasks.js';
import { TierIdSchema } from './tiers.js';

// Opaque server ids; the 8-char minimum keeps them clear of 'skip'.
export const PlayerIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,32}$/);
export const EntityIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
export const RoomSchema = z.enum(ROOMS);

// Quick chat only; free text never reaches public rooms.
export const ChatSchema = z.discriminatedUnion('phrase', [
  z.strictObject({ phrase: z.enum(SIMPLE_PHRASES) }),
  z.strictObject({ phrase: z.literal('sawAt'), playerId: PlayerIdSchema, room: RoomSchema }),
  z.strictObject({ phrase: z.literal('suspect'), playerId: PlayerIdSchema }),
  z.strictObject({ phrase: z.literal('dontSign'), proposalId: EntityIdSchema }),
  z.strictObject({ phrase: z.literal('signIt'), proposalId: EntityIdSchema }),
  // A claim, not a fact: Byzantines may lie about what an audit showed.
  z.strictObject({ phrase: z.literal('audited'), proposalId: EntityIdSchema, forged: z.boolean() }),
  z.strictObject({ phrase: z.literal('trust'), playerId: PlayerIdSchema }),
  z.strictObject({ phrase: z.literal('iWasIn'), room: RoomSchema }),
]);

// Payload of each client-to-server message type, used as Room.onMessage validators.
// One move is one server tick of input; seq lets the client reconcile its prediction.
export const MovePayloadSchema = z.strictObject({
  seq: z.number().int().min(1).max(MAX_INPUT_SEQ),
  dx: z.number().min(-1).max(1),
  dy: z.number().min(-1).max(1),
});
export const InteractPayloadSchema = z.strictObject({ targetId: EntityIdSchema });
export const ProposalPayloadSchema = z.strictObject({ proposalId: EntityIdSchema });
export const EmptyPayloadSchema = z.strictObject({});
// room.send(type) with no payload delivers undefined, which must not disconnect the sender.
export const NoPayloadSchema = EmptyPayloadSchema.optional();
export const CastVotePayloadSchema = z.strictObject({
  target: z.union([z.literal('skip'), PlayerIdSchema]),
});
export const QuickChatPayloadSchema = z.strictObject({ chat: ChatSchema });
export const FreezePayloadSchema = z.strictObject({ targetId: PlayerIdSchema });
export const RemoveBotPayloadSchema = z.strictObject({ targetId: PlayerIdSchema });
// The host of a private lobby picks where the match is played.
export const SetArenaPayloadSchema = z.strictObject({ arena: ArenaIdSchema });
/** The host of a private lobby picks the rule tier (see tiers.ts). */
export const SetTierPayloadSchema = z.strictObject({ tier: TierIdSchema });
export const TaskKindSchema = z.enum(TASK_KINDS);
// Server-issued per challenge, so an answer can only ever apply to the challenge it was for.
export const TaskIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,24}$/);
export const OpenTaskPayloadSchema = z.strictObject({ kind: TaskKindSchema });
export const TaskAnswerPayloadSchema = z.strictObject({ id: TaskIdSchema, answer: TaskAnswerSchema });

export const CLIENT_MESSAGE_PAYLOADS = {
  move: MovePayloadSchema,
  interact: InteractPayloadSchema,
  signProposal: ProposalPayloadSchema,
  refuseProposal: ProposalPayloadSchema,
  callCouncil: NoPayloadSchema,
  castVote: CastVotePayloadSchema,
  quickChat: QuickChatPayloadSchema,
  startMatch: NoPayloadSchema,
  openTask: OpenTaskPayloadSchema,
  taskAnswer: TaskAnswerPayloadSchema,
  closeTask: NoPayloadSchema,
  forgeProposal: NoPayloadSchema,
  auditProposal: ProposalPayloadSchema,
  partition: NoPayloadSchema,
  freeze: FreezePayloadSchema,
  addBot: NoPayloadSchema,
  removeBot: RemoveBotPayloadSchema,
  setArena: SetArenaPayloadSchema,
  setTier: SetTierPayloadSchema,
} as const;
export type ClientMessageType = keyof typeof CLIENT_MESSAGE_PAYLOADS;
export type MovePayload = z.infer<typeof MovePayloadSchema>;
export type OpenTaskPayload = z.infer<typeof OpenTaskPayloadSchema>;
export type TaskAnswerPayload = z.infer<typeof TaskAnswerPayloadSchema>;

// Every intent a client may send as one tagged value; the server decides outcomes.
export const ClientMessageSchema = z.discriminatedUnion('type', [
  MovePayloadSchema.extend({ type: z.literal('move') }),
  InteractPayloadSchema.extend({ type: z.literal('interact') }),
  ProposalPayloadSchema.extend({ type: z.literal('signProposal') }),
  ProposalPayloadSchema.extend({ type: z.literal('refuseProposal') }),
  EmptyPayloadSchema.extend({ type: z.literal('callCouncil') }),
  CastVotePayloadSchema.extend({ type: z.literal('castVote') }),
  QuickChatPayloadSchema.extend({ type: z.literal('quickChat') }),
  EmptyPayloadSchema.extend({ type: z.literal('startMatch') }),
  OpenTaskPayloadSchema.extend({ type: z.literal('openTask') }),
  TaskAnswerPayloadSchema.extend({ type: z.literal('taskAnswer') }),
  EmptyPayloadSchema.extend({ type: z.literal('closeTask') }),
  EmptyPayloadSchema.extend({ type: z.literal('forgeProposal') }),
  ProposalPayloadSchema.extend({ type: z.literal('auditProposal') }),
  EmptyPayloadSchema.extend({ type: z.literal('partition') }),
  FreezePayloadSchema.extend({ type: z.literal('freeze') }),
  EmptyPayloadSchema.extend({ type: z.literal('addBot') }),
  RemoveBotPayloadSchema.extend({ type: z.literal('removeBot') }),
  SetArenaPayloadSchema.extend({ type: z.literal('setArena') }),
  SetTierPayloadSchema.extend({ type: z.literal('setTier') }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ChatMessage = z.infer<typeof ChatSchema>;

// Server-to-client messages; the client validates them too before rendering anything.
// Longest wait a retry hint may carry; the server clamps to it so the client never drops the message.
export const MAX_TASK_RETRY_MS = 60_000;
const RetryInMs = z.number().int().min(0).max(MAX_TASK_RETRY_MS);
export const TaskOpenedSchema = z.strictObject({ id: TaskIdSchema, challenge: TaskChallengeSchema });
export const TaskResultSchema = z.strictObject({
  id: TaskIdSchema,
  ok: z.boolean(),
  // Set on a wrong answer: how long until the station opens again.
  retryInMs: RetryInMs.optional(),
});
export const TASK_REFUSALS = ['outOfRange', 'retryLater', 'busy', 'unavailable'] as const;
export const TaskRefusedSchema = z.strictObject({
  reason: z.enum(TASK_REFUSALS),
  retryInMs: RetryInMs.optional(),
});
export const TASK_CLOSE_REASONS = ['moved', 'expired', 'ended', 'council', 'frozen'] as const;
export const TaskClosedSchema = z.strictObject({ reason: z.enum(TASK_CLOSE_REASONS) });
export const ForgedSchema = z.strictObject({ proposalId: EntityIdSchema });
// An audit starts, is cancelled by walking away, or ends with the proposal's truth (private to the auditor).
export const AuditSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('started'), proposalId: EntityIdSchema, ms: z.number().int().min(0).max(MAX_TASK_RETRY_MS) }),
  z.strictObject({ status: z.literal('cancelled'), proposalId: EntityIdSchema }),
  z.strictObject({ status: z.literal('done'), proposalId: EntityIdSchema, forged: z.boolean() }),
]);
/** Ceremony refusals; `offTier` means this match's rule tier has no signing ceremonies (or no forgeries). */
export const CEREMONY_REFUSALS = ['notOpen', 'alreadyResponded', 'cannotAct', 'notHere', 'cooldown', 'busy', 'tooMany', 'notYet', 'audited', 'partitioned', 'offTier'] as const;
export const CeremonyRefusedSchema = z.strictObject({
  reason: z.enum(CEREMONY_REFUSALS),
  retryInMs: RetryInMs.optional(),
});
// A quick-chat line as everyone receives it, stamped by the server with the sender.
export const ChatLineSchema = z.strictObject({ from: PlayerIdSchema, chat: ChatSchema });
export const COUNCIL_REFUSALS = ['notHere', 'notYet', 'cooldown', 'usedUp', 'cannotAct', 'votingClosed', 'alreadyVoted', 'selfVote', 'invalidTarget', 'chatLimit'] as const;
export const CouncilRefusedSchema = z.strictObject({
  reason: z.enum(COUNCIL_REFUSALS),
  retryInMs: RetryInMs.optional(),
});
/** Sabotage refusals; `offTier` means this match's rule tier has no such sabotage. */
export const SABOTAGE_REFUSALS = ['cannotAct', 'notYet', 'cooldown', 'active', 'notHere', 'invalidTarget', 'offTier'] as const;
export const SabotageRefusedSchema = z.strictObject({
  reason: z.enum(SABOTAGE_REFUSALS),
  retryInMs: RetryInMs.optional(),
});
export type SabotageRefused = z.infer<typeof SabotageRefusedSchema>;
// Milliseconds until each Byzantine action is ready again, sent to that Byzantine only.
export const SabotageReadySchema = z.strictObject({
  partitionInMs: z.number().int().min(0).max(600_000),
  freezeInMs: z.number().int().min(0).max(600_000),
});
export type SabotageReady = z.infer<typeof SabotageReadySchema>;
// To the host when a practice bot could not be added or removed.
export const BOT_REFUSALS = ['disabled', 'notHost', 'notLobby', 'roomFull', 'busy', 'limit', 'failed', 'notABot'] as const;
export const BotsRefusedSchema = z.strictObject({ reason: z.enum(BOT_REFUSALS) });
// To the host when the arena could not change: only a private lobby's host may pick, and only an
// arena someone in the room has opened.
export const ARENA_REFUSALS = ['notHost', 'notLobby', 'notPrivate', 'locked'] as const;
export const ArenaRefusedSchema = z.strictObject({ reason: z.enum(ARENA_REFUSALS) });
export type ArenaRefused = z.infer<typeof ArenaRefusedSchema>;
/** Why the host's tier pick was refused: only a private lobby's host may pick, and a signing-ceremony room keeps its ceremonies. */
export const TIER_REFUSALS = ['notHost', 'notLobby', 'notPrivate', 'locked'] as const;
/** Sent to the host when the rule tier could not change. */
export const TierRefusedSchema = z.strictObject({ reason: z.enum(TIER_REFUSALS) });
/** A refused tier pick. */
export type TierRefused = z.infer<typeof TierRefusedSchema>;
export type BotsRefused = z.infer<typeof BotsRefusedSchema>;
export type ChatLine = z.infer<typeof ChatLineSchema>;
export type CouncilRefused = z.infer<typeof CouncilRefusedSchema>;
export type Forged = z.infer<typeof ForgedSchema>;
export type Audit = z.infer<typeof AuditSchema>;
export type CeremonyRefused = z.infer<typeof CeremonyRefusedSchema>;
export type TaskOpened = z.infer<typeof TaskOpenedSchema>;
export type TaskResult = z.infer<typeof TaskResultSchema>;
export type TaskRefused = z.infer<typeof TaskRefusedSchema>;
export type TaskClosed = z.infer<typeof TaskClosedSchema>;

const encoder = new TextEncoder();

// Size gate before JSON.parse; UTF-8 is never shorter than UTF-16, so long frames fail fast.
export function withinMessageLimit(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return false;
  return encoder.encode(raw).byteLength <= MAX_MESSAGE_BYTES;
}

export function parseClientMessage(raw: unknown): Result<ClientMessage, 'invalidMessage'> {
  const parsed = ClientMessageSchema.safeParse(raw);
  return parsed.success ? ok(parsed.data) : err('invalidMessage');
}
