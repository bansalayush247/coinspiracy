// A story mission: a private instance of Port Concord for a crew of up to four, playing one act. The server walks
// the script and the act's steps; the client draws them. Hidden things (where the device is buried) are never in
// this state, only which spots have been worked and what turned up.
import { schema, t, type SchemaType } from '@colyseus/schema';
import { z } from 'zod';
import { NicknameSchema } from '../lobby.js';
import { STORY_ACTS } from './acts.js';
import { CityPlayer } from './state.js';
import { ACT_IDS, CATCHER_IDS } from './story.js';

export const MISSION_ROOM = 'mission';

export const NPC_KINDS = [
  'dani',
  'mags',
  'guard',
  'duncan',
  'ivy',
  'guardian',
  'lookout',
  'teo',
  'brannigan',
  'nonce',
  'choir',
  'sharpe',
  'okafor',
  'pip',
  'juno',
  'crane',
  'stall',
  'mc',
  'penrose',
  'keeper',
  'kit',
  'marco',
  'benny',
  'gull',
  'ozzy',
  'rex',
  'nell',
  'silas',
  'dee',
  'fennick',
  'glass',
  'lumley',
  'shopper',
  'varnish',
  'letter',
] as const;
export type NpcKind = (typeof NPC_KINDS)[number];
// The kinds that carry a torch, drawn as a cone the server uses to catch the crew.
export const TORCH_KINDS: ReadonlySet<NpcKind> = new Set(['guard', 'lookout', 'choir', 'keeper', 'gull']);

export const MissionNpc = schema(
  {
    kind: t.string().default('dani'),
    // Shown over the head; '' uses the character's own name.
    name: t.string().default(''),
    x: t.float64().default(0),
    y: t.float64().default(0),
    // Radians, the way a torch points.
    facing: t.float32().default(0),
    shown: t.boolean().default(true),
    chasing: t.boolean().default(false),
  },
  'MissionNpc',
);
export type MissionNpc = SchemaType<typeof MissionNpc>;

// A place the crew works at: a heap to dig, a guardian to ask.
export const MissionSpot = schema(
  {
    done: t.boolean().default(false),
    note: t.string().default(''),
    // The crew member working it right now, '' when nobody is.
    worker: t.string().default(''),
  },
  'MissionSpot',
);
export type MissionSpot = SchemaType<typeof MissionSpot>;

export const MissionState = schema(
  {
    act: t.string().default('dump'),
    players: t.map(CityPlayer).view(),
    npcs: t.map(MissionNpc),
    spots: t.array(MissionSpot),
    step: t.string().default('call'),
    // The scene node on screen, '' between scenes; seq changes every time a node starts, even the same one again.
    node: t.string().default(''),
    seq: t.uint16().default(0),
    marks: t.array('string'),
    caught: t.uint8().default(0),
    // The crew's invite code, and who breaks tied votes.
    code: t.string().default(''),
    lead: t.string().default(''),
    // Votes on the choice on screen, by crew member; how many have read the scene and are ready to move on.
    votes: t.map('string'),
    ready: t.uint8().default(0),
    // The choice that settled the last choice node, '' when the crew said nothing.
    said: t.string().default(''),
    // Seconds left on the act's clock, such as the turning tide; 0 when nothing is ticking.
    clock: t.uint16().default(0),
  },
  'MissionState',
);
export type MissionState = SchemaType<typeof MissionState>;

export const MISSION_MESSAGES = Object.freeze({
  CAUGHT: 'caught',
  DUNCAN: 'duncan',
  RESULT: 'result',
  NOTE: 'note',
} as const);

// Starting a night picks the act; joining a crew by code takes whatever act the crew is playing.
export const MissionJoinSchema = z.strictObject({ nickname: NicknameSchema, act: z.enum(ACT_IDS).optional() });

const NODE_IDS: ReadonlySet<string> = new Set(Object.values(STORY_ACTS).flatMap((a) => Object.keys(a.script)));
const MAX_SPOTS = Math.max(...Object.values(STORY_ACTS).map((a) => a.spots.length));
const NodeIdSchema = z.string().max(32).refine((id) => NODE_IDS.has(id));
export const AdvancePayloadSchema = z.strictObject({ node: NodeIdSchema });
export const ChoosePayloadSchema = z.strictObject({ node: NodeIdSchema, choice: z.string().min(1).max(16) });
export const WorkPayloadSchema = z.strictObject({ spot: z.number().int().min(0).max(MAX_SPOTS - 1) });

// `name` is set when it was someone else in the crew who got caught.
export const CaughtLineSchema = z.strictObject({ by: z.enum(CATCHER_IDS), count: z.number().int().min(1).max(255), name: z.string().min(1).max(16).optional() });
export type CaughtLine = z.infer<typeof CaughtLineSchema>;

// Told to one crew member only, such as why a spot can't be worked yet.
export const MissionNoteSchema = z.strictObject({ text: z.string().min(1).max(240) });
export type MissionNote = z.infer<typeof MissionNoteSchema>;

export const MISSION_RESULT_REASONS = ['paid', 'replay', 'noProfile', 'error'] as const;
export const MissionResultSchema = z.strictObject({
  reason: z.enum(MISSION_RESULT_REASONS),
  paid: z.number().int().min(0).max(100_000),
  honest: z.boolean(),
});
export type MissionResult = z.infer<typeof MissionResultSchema>;
