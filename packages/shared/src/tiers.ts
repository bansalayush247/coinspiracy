// Rule tiers for the council match: tasks and councils always, the rest as the islands that teach it open.
import { z } from 'zod';
import { ISLANDS, islandOpenFor } from './progression/world.js';
import type { ClientMessageType } from './schemas.js';
import type { WinReason } from './win.js';
import raw from './tuning/tiers.json' with { type: 'json' };

/** Tier ids, from the fewest rules to all of them. Stored nowhere, but order matters: later tiers add rules. */
export const TIER_IDS = ['apprentice', 'journeyman', 'full'] as const;
/** One rule tier. */
export type TierId = (typeof TIER_IDS)[number];
/** A tier id on the wire (lobby state, the host's pick). */
export const TierIdSchema = z.enum(TIER_IDS);

/**
 * What a tier can switch on, on top of tasks and councils:
 * - `ceremonies`: withdrawals appear, guardians sign or refuse them, audits, and failed withdrawals cost liveness;
 * - `forging`: Byzantines file forged withdrawals;
 * - `partition`: Byzantines cut the network;
 * - `freeze`: Byzantines disconnect a guardian next to them.
 */
export const TIER_FEATURES = ['ceremonies', 'forging', 'partition', 'freeze'] as const;
/** One switchable rule. */
export type TierFeature = (typeof TIER_FEATURES)[number];

const ISLAND_ID = /^[a-z][a-zA-Z0-9]{0,31}$/;

/** One row of `tuning/tiers.json`; a player qualifies once `unlockIsland` is open to them (null for the entry tier). */
export const TierRulesSchema = z.strictObject({
  id: TierIdSchema,
  unlockIsland: z.string().regex(ISLAND_ID).nullable(),
  ceremonies: z.boolean(),
  forging: z.boolean(),
  partition: z.boolean(),
  freeze: z.boolean(),
});
/** The rules one tier plays with. */
export type TierRules = z.infer<typeof TierRulesSchema>;

/**
 * The shape of `tuning/tiers.json`, with the invariants that keep every tier coherent: tiers in `TIER_IDS` order,
 * rules only ever added going up, forging only with ceremonies (a forgery is a withdrawal to sign), and every rule
 * in the last tier. `fallback` is the tier when nobody's progress is known (profiles off); `ceremonyRoomMin` is the
 * floor of a story signing-ceremony room, which must keep its ceremonies.
 */
export const TierTableSchema = z
  .strictObject({
    tiers: z.array(TierRulesSchema).length(TIER_IDS.length),
    fallback: TierIdSchema,
    ceremonyRoomMin: TierIdSchema,
  })
  .superRefine((table, ctx) => {
    const issue = (message: string): void => {
      ctx.addIssue({ code: 'custom', message });
    };
    table.tiers.forEach((tier, i) => {
      if (tier.id !== TIER_IDS[i]) issue(`tier ${String(i)} must be ${String(TIER_IDS[i])}`);
      if ((i === 0) !== (tier.unlockIsland === null)) issue(`only the first tier has no unlock island (${tier.id})`);
      if (tier.unlockIsland !== null && !ISLANDS.some((island) => island.id === tier.unlockIsland)) issue(`unknown island for ${tier.id}`);
      if (tier.forging && !tier.ceremonies) issue(`${tier.id} forges without ceremonies`);
      const previous = table.tiers[i - 1];
      if (previous !== undefined && TIER_FEATURES.some((f) => previous[f] && !tier[f])) issue(`${tier.id} drops a rule ${previous.id} has`);
    });
    const last = table.tiers.at(-1);
    if (last !== undefined && TIER_FEATURES.some((f) => !last[f])) issue('the last tier must have every rule');
    if (table.tiers.find((t) => t.id === table.ceremonyRoomMin)?.ceremonies !== true) issue('ceremonyRoomMin must have signing ceremonies');
  });
/** The whole tier table. */
export type TierTable = z.infer<typeof TierTableSchema>;

/** Validates a tier table and freezes it deeply; throws on any broken invariant. */
export function parseTierTable(input: unknown): TierTable {
  const table = TierTableSchema.parse(input);
  return Object.freeze({ ...table, tiers: Object.freeze(table.tiers.map((t) => Object.freeze({ ...t }))) as TierTable['tiers'] });
}

/** The tier table from `tuning/tiers.json`, checked once at load so a bad edit fails loudly instead of playing wrong. */
export const TIER_TABLE: TierTable = parseTierTable(raw);

function index(id: TierId): number {
  return TIER_IDS.indexOf(id);
}

function higher(a: TierId, b: TierId): TierId {
  return index(a) >= index(b) ? a : b;
}

/** The rules of one tier. */
export function tierRules(id: TierId, table: TierTable = TIER_TABLE): TierRules {
  const rules = table.tiers[index(id)];
  if (rules === undefined) throw new RangeError('unknown tier');
  return rules;
}

/** Whether a tier plays with one switchable rule. */
export function tierAllows(id: TierId, feature: TierFeature, table: TierTable = TIER_TABLE): boolean {
  return tierRules(id, table)[feature];
}

/** Client messages that only some tiers accept, and the rule each one needs. Every other message is in every tier. */
export const TIER_GATED_MESSAGES: Readonly<Partial<Record<ClientMessageType, TierFeature>>> = Object.freeze({
  signProposal: 'ceremonies',
  refuseProposal: 'ceremonies',
  auditProposal: 'ceremonies',
  forgeProposal: 'forging',
  partition: 'partition',
  freeze: 'freeze',
});

/** Whether a match in this tier accepts a client message at all; the server checks this before anything else. */
export function messageAllowed(id: TierId, type: ClientMessageType, table: TierTable = TIER_TABLE): boolean {
  const feature = TIER_GATED_MESSAGES[type];
  return feature === undefined || tierAllows(id, feature, table);
}

/** The highest tier a player has learned: the last one whose island is open to them by rank or Academy stars. */
export function playerTier(xp: number, academy: readonly number[], table: TierTable = TIER_TABLE): TierId {
  let best: TierId = TIER_IDS[0];
  for (const tier of table.tiers) if (tier.unlockIsland === null || islandOpenFor(tier.unlockIsland, xp, academy)) best = tier.id;
  return best;
}

/**
 * Quick match: the lowest tier any seated person has learned, so nobody meets a rule they have not unlocked.
 * Players whose progress is unknown (no profile) and practice bots pass null and do not count; with nobody
 * known, the table's fallback.
 */
export function autoTier(players: readonly (TierId | null)[], table: TierTable = TIER_TABLE): TierId {
  let lowest: TierId | null = null;
  for (const tier of players) if (tier !== null && (lowest === null || index(tier) < index(lowest))) lowest = tier;
  return lowest ?? table.fallback;
}

/** Whether the host of a private lobby may pick this tier; a story signing ceremony keeps its ceremonies. */
export function tierPickable(id: TierId, ceremonyRoom: boolean, table: TierTable = TIER_TABLE): boolean {
  return !ceremonyRoom || index(id) >= index(table.ceremonyRoomMin);
}

/** What a room needs to settle its tier. */
export interface RoomTierInput {
  /** Each seated player's own tier; null for bots and players without a known profile. */
  readonly players: readonly (TierId | null)[];
  /** The host's pick in a private lobby, or null to follow the quick-match rule. */
  readonly picked: TierId | null;
  /** Opened as the story's signing ceremony. */
  readonly ceremonyRoom: boolean;
}

/** The tier a room plays: the host's pick when there is one, else the quick-match rule, never below a ceremony room's floor. */
export function roomTier(input: RoomTierInput, table: TierTable = TIER_TABLE): TierId {
  const base = input.picked ?? autoTier(input.players, table);
  return input.ceremonyRoom ? higher(base, table.ceremonyRoomMin) : base;
}

/** Every way a match in this tier can end. Each side keeps at least two in every tier (see tiers.test.ts). */
export function tierWinReasons(id: TierId, table: TierTable = TIER_TABLE): readonly WinReason[] {
  const rules = tierRules(id, table);
  const reasons: WinReason[] = ['consensusReached', 'allByzantineRotatedOut', 'federationHalted', 'outOfTime'];
  if (rules.forging) reasons.push('forgedProposalPassed');
  if (rules.ceremonies || rules.partition) reasons.push('livenessLost');
  return Object.freeze(reasons);
}
