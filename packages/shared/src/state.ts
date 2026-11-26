// Synced room state, imported by the server and the browser client from one place.
import { schema, t, type SchemaType } from '@colyseus/schema';
import type { ArenaId } from './arena.js';
import type { CouncilStage } from './meeting.js';
import type { Act } from './pacing.js';
import type { ProposalStatus } from './proposals.js';
import type { Role } from './types.js';
import type { TierId } from './tiers.js';
import type { Side, WinReason } from './win.js';

export const PLAYER_STATUSES = ['active', 'disconnected'] as const;
export type PlayerStatus = (typeof PLAYER_STATUSES)[number];

export const MATCH_PHASES = ['lobby', 'playing', 'ended'] as const;
export type MatchPhase = (typeof MATCH_PHASES)[number];

// StateView tags, one bit per secret; default-tag view fields would reach any view that sees the player.
// OWNER: only the player themself. ROLE: the player, fellow Byzantines, and everyone once a match ends.
export const VIEW_TAGS = Object.freeze({ OWNER: 1, ROLE: 2 } as const);

// Public fields plus tagged secrets; a view only receives the tags it was given (see README security model).
export const PlayerState = schema(
  {
    name: t.string().default(''),
    seat: t.uint8().default(0),
    // float64 so client prediction replays from exactly the server's value.
    x: t.float64().default(0),
    y: t.float64().default(0),
    status: t.string<PlayerStatus>().default('active'),
    // Key rotated out by a council: a spectator until the match ends. Public, since everyone saw the vote.
    out: t.boolean().default(false),
    // Seconds left frozen by a Byzantine; 0 when free. Public: everyone can see a frozen guardian.
    frozen: t.uint8().default(0),
    // A practice bot run by the server. Public, so nobody mistakes it for a person.
    bot: t.boolean().default(false),
    // Worn cosmetics from the guest profile (catalogue ids, '' for none). Robes keep the seat colour; the outfit tints the trim.
    hat: t.string().default(''),
    shades: t.string().default(''),
    outfit: t.string().default(''),
    // Last move seq the server applied; only the owner needs it to reconcile.
    ack: t.uint32().view(VIEW_TAGS.OWNER).optional(),
    role: t.string<Role>().view(VIEW_TAGS.ROLE).optional(),
    // Task bitmasks (see TASK_KINDS); which tasks a player has left is private.
    tasks: t.uint8().view(VIEW_TAGS.OWNER).optional(),
    tasksDone: t.uint8().view(VIEW_TAGS.OWNER).optional(),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

// One line of the end-of-match recap; public, and only filled once the match is over.
export const RecapEntry = schema(
  {
    id: t.string().default(''),
    name: t.string().default(''),
    seat: t.uint8().default(0),
    role: t.string<Role>().default('honest'),
    // Left during the match.
    left: t.boolean().default(false),
  },
  'RecapEntry',
);
export type RecapEntry = SchemaType<typeof RecapEntry>;

// A withdrawal proposal as everyone sees it. Who filed it and whether it is forged stay on the server
// until it closes; then `verdict` tells everyone, so the public signer lists become evidence.
export const ProposalState = schema(
  {
    id: t.string().default(''),
    amount: t.uint32().default(0),
    status: t.string<ProposalStatus>().default('open'),
    secondsLeft: t.uint8().default(0),
    signers: t.array('string'),
    refusers: t.array('string'),
    verdict: t.string<'' | 'legit' | 'forged'>().default(''),
  },
  'ProposalState',
);
export type ProposalState = SchemaType<typeof ProposalState>;

// The current council, if any. Who voted for whom stays hidden until the result.
export const CouncilState = schema(
  {
    stage: t.string<CouncilStage>().default(''),
    number: t.uint8().default(0),
    calledBy: t.string().default(''),
    secondsLeft: t.uint8().default(0),
    // Who has voted so far, without their choice.
    voted: t.array('string'),
    // Filled at the result: voter id to target id or 'skip'.
    ballots: t.map('string'),
    ejected: t.string().default(''),
  },
  'CouncilState',
);
export type CouncilState = SchemaType<typeof CouncilState>;

export const CitadelState = schema(
  {
    phase: t.string<MatchPhase>().default('lobby'),
    // Six-character invite code; every member already knows it.
    code: t.string().default(''),
    isPrivate: t.boolean().default(false),
    // Opened from the end of act three as the story's signing ceremony.
    ceremony: t.boolean().default(false),
    hostId: t.string().default(''),
    players: t.map(PlayerState),
    // Honest task progress, 0-100; full means the honest guardians win.
    consensus: t.uint8().default(0),
    // Hidden Byzantines dealt this match; the count is public, who they are is not.
    byzantines: t.uint8().default(0),
    winner: t.string<Side | ''>().default(''),
    winReason: t.string<WinReason | ''>().default(''),
    // Everyone who played the last match, including those who left; empty until it ends.
    recap: t.array(RecapEntry),
    // Bitcoin chain tip; chainLive is false while it is only an estimate.
    blockHeight: t.uint32().default(0),
    chainLive: t.boolean().default(false),
    // Open proposals plus the few most recently closed ones.
    proposals: t.array(ProposalState),
    // Signatures a proposal needs right now (changes as guardians are rotated out or leave).
    signaturesNeeded: t.uint8().default(0),
    // Legitimate withdrawals that failed; LIVENESS_LIMIT of them ends the match.
    livenessStrikes: t.uint8().default(0),
    council: CouncilState,
    // Seconds left to repair a network partition; 0 when the network is whole.
    partition: t.uint8().default(0),
    // Repair progress while both relays are held, 0-100.
    repair: t.uint8().default(0),
    // Which relays are held right now, as a bitmask over RELAYS.
    relays: t.uint8().default(0),
    // Partitions that ran out the timer this match.
    outages: t.uint8().default(0),
    // The block clock: which act the match is in and how many blocks are left.
    act: t.string<Act | ''>().default(''),
    blocksLeft: t.uint8().default(0),
    // Where the match is played; the host of a private lobby may change it.
    arena: t.string<ArenaId>().default('citadel'),
    // Someone in the room has opened Lightning Reef, so the host may pick it (locks never split friends).
    reefOpen: t.boolean().default(false),
    // The same for Watchtower Peaks.
    peaksOpen: t.boolean().default(false),
    // The rule tier: follows the room's players (or the host's pick) in the lobby, fixed while a match runs.
    tier: t.string<TierId>().default('full'),
  },
  'CitadelState',
);
export type CitadelState = SchemaType<typeof CitadelState>;
