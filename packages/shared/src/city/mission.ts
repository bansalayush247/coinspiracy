// A story mission: a private instance of Port Concord. The server walks the script and the mission steps; the
// client draws them. Where the device is buried is never in this state, only which heaps have been dug.
import { schema, t, type SchemaType } from '@colyseus/schema';
import { z } from 'zod';
import { CityPlayer } from './state.js';
import { DUMP_SCRIPT, HEAPS } from './dump.js';

export const MISSION_ROOM = 'mission';

export const NPC_KINDS = ['dani', 'mags', 'guard', 'duncan'] as const;
export type NpcKind = (typeof NPC_KINDS)[number];

export const MissionNpc = schema(
  {
    kind: t.string().default('dani'),
    x: t.float64().default(0),
    y: t.float64().default(0),
    // Radians, the way the guard's torch points.
    facing: t.float32().default(0),
    shown: t.boolean().default(true),
    chasing: t.boolean().default(false),
  },
  'MissionNpc',
);
export type MissionNpc = SchemaType<typeof MissionNpc>;

export const MissionHeap = schema(
  {
    dug: t.boolean().default(false),
    found: t.string().default(''),
  },
  'MissionHeap',
);
export type MissionHeap = SchemaType<typeof MissionHeap>;

export const MissionState = schema(
  {
    players: t.map(CityPlayer).view(),
    npcs: t.map(MissionNpc),
    heaps: t.array(MissionHeap),
    step: t.string().default('call'),
    // The scene node on screen, '' between scenes; seq changes every time a node starts, even the same one again.
    node: t.string().default(''),
    seq: t.uint16().default(0),
    marks: t.array('string'),
    digging: t.int8().default(-1),
    caught: t.uint8().default(0),
  },
  'MissionState',
);
export type MissionState = SchemaType<typeof MissionState>;

export const MISSION_MESSAGES = Object.freeze({
  CAUGHT: 'caught',
  DUNCAN: 'duncan',
  RESULT: 'result',
} as const);

const NodeIdSchema = z.string().refine((id) => Object.hasOwn(DUMP_SCRIPT, id));
export const AdvancePayloadSchema = z.strictObject({ node: NodeIdSchema });
export const ChoosePayloadSchema = z.strictObject({ node: NodeIdSchema, choice: z.string().min(1).max(16) });
export const DigPayloadSchema = z.strictObject({ heap: z.number().int().min(0).max(HEAPS.length - 1) });

export const CaughtLineSchema = z.strictObject({ by: z.enum(['guard', 'duncan']), count: z.number().int().min(1).max(255) });
export type CaughtLine = z.infer<typeof CaughtLineSchema>;

export const MISSION_RESULT_REASONS = ['paid', 'replay', 'noProfile', 'error'] as const;
export const MissionResultSchema = z.strictObject({
  reason: z.enum(MISSION_RESULT_REASONS),
  paid: z.number().int().min(0).max(100_000),
  honest: z.boolean(),
});
export type MissionResult = z.infer<typeof MissionResultSchema>;
