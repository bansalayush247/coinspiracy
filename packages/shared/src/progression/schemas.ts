// Zod schemas for stored progress and everything progression sends over the wire. Strict and bounded.
import { z } from 'zod';
import { RewardIdSchema } from '../economy/catalog.js';
import { DrillAnswerSchema, DrillChallengeSchema } from '../drills.js';
import { TaskIdSchema } from '../schemas.js';
import { ACADEMY_LEVELS, ACADEMY_MAX_STARS } from './academy.js';
import { XP_REASONS } from './award.js';
import { COUNTER_IDS, COUNTER_MAX } from './counters.js';
import { EPOCH_TIERS } from './epoch.js';
import { MAX_QUESTS, QUEST_IDS } from './quests.js';
import { FRAME_IDS, MAX_RANK } from './rank.js';
import { SEAL_IDS } from './seals.js';
import { TITLE_IDS } from './progress.js';

const Int = (max: number) => z.number().int().min(0).max(max);
const Day = z.number().int().min(-1).max(10_000_000);
const XpTotal = Int(Number.MAX_SAFE_INTEGER);

export const TitleIdSchema = z.enum(TITLE_IDS as unknown as [string, ...string[]]);
export const FrameIdSchema = z.enum(FRAME_IDS);
export const SealIdSchema = z.enum(SEAL_IDS as unknown as [string, ...string[]]);
export const QuestIdSchema = z.enum(QUEST_IDS as unknown as [string, ...string[]]);

const QuestSchema = z.strictObject({ id: QuestIdSchema, progress: Int(1000) });
const EpochSchema = z.strictObject({ index: Int(10_000_000), xp: Int(1_000_000), tier: Int(EPOCH_TIERS) });

// A finished story chapter: what the characters remember. Mark names stay plain strings so renaming one never breaks a load.
const StoryRecordSchema = z.strictObject({
  done: z.boolean(),
  honest: z.boolean(),
  marks: z.array(z.string().regex(/^[a-zA-Z]{1,24}$/)).max(32),
});

// Stored progress; checked on every load and save.
export const ProgressSchema = z.strictObject({
  v: z.literal(1),
  xp: XpTotal,
  // Keys are checked on the raw object: zod's records silently drop keys such as '__proto__'.
  counters: z
    .unknown()
    .refine((c) => typeof c === 'object' && c !== null && !Array.isArray(c) && Object.keys(c).every((k) => (COUNTER_IDS as readonly string[]).includes(k)))
    .pipe(z.partialRecord(z.enum(COUNTER_IDS), Int(COUNTER_MAX))),
  seals: z.array(SealIdSchema).max(SEAL_IDS.length).refine((s) => new Set(s).size === s.length),
  quests: z.array(QuestSchema).max(MAX_QUESTS).refine((q) => new Set(q.map((x) => x.id)).size === q.length),
  offerDay: Day,
  rerollDay: Day,
  epoch: EpochSchema,
  day: z.strictObject({ index: Day, matchXp: Int(1_000_000), practiceXp: Int(1_000_000), firstBonus: z.boolean(), courier: Int(1000).optional(), vault: Int(1_000_000).optional() }),
  lastEpochPlayed: z.number().int().min(-1).max(10_000_000),
  // Profiles saved before newer levels existed are padded with zeros, so adding levels never breaks a load.
  academy: z
    .array(Int(ACADEMY_MAX_STARS))
    .min(1)
    .max(ACADEMY_LEVELS.length)
    .transform((stars) => [...stars, ...Array<number>(ACADEMY_LEVELS.length - stars.length).fill(0)]),
  epochFrame: z.boolean(),
  title: TitleIdSchema.nullable(),
  frame: FrameIdSchema.nullable(),
  story: z.strictObject({ dump: StoryRecordSchema.optional(), ransom: StoryRecordSchema.optional(), insider: StoryRecordSchema.optional(), founder: StoryRecordSchema.optional(), ceremony: StoryRecordSchema.optional() }).optional(),
});

const XpLineSchema = z.strictObject({ reason: z.enum(XP_REASONS), xp: Int(10_000) });

// The server's targeted message to one player after a match or an Academy level.
export const AwardSchema = z.strictObject({
  eligible: z.boolean(),
  ineligible: z.enum(['left', 'afk', 'idle']).optional(),
  practice: z.boolean(),
  lines: z.array(XpLineSchema).max(16),
  xpBefore: XpTotal,
  xpAfter: XpTotal,
  rankBefore: z.number().int().min(1).max(MAX_RANK),
  rankAfter: z.number().int().min(1).max(MAX_RANK),
  sats: Int(10_000_000),
  items: z.array(RewardIdSchema).max(32),
  frames: z.array(FrameIdSchema).max(FRAME_IDS.length),
  titles: z.array(TitleIdSchema).max(TITLE_IDS.length),
  seals: z.array(SealIdSchema).max(SEAL_IDS.length),
  questsDone: z.array(z.strictObject({ id: QuestIdSchema, xp: Int(10_000), sats: Int(100_000) })).max(MAX_QUESTS),
  quests: z.array(QuestSchema).max(MAX_QUESTS),
  epoch: z.strictObject({ index: Int(10_000_000), xpBefore: Int(1_000_000), xpAfter: Int(1_000_000), tierBefore: Int(EPOCH_TIERS), tierAfter: Int(EPOCH_TIERS) }),
});

export type AwardMessage = z.infer<typeof AwardSchema>;

export const ProgressViewSchema = z.strictObject({
  xp: XpTotal,
  rank: z.number().int().min(1).max(MAX_RANK),
  into: Int(1_000_000),
  forNext: Int(1_000_000),
  stars: Int(999),
  rankUpSats: Int(100_000),
  next: z.strictObject({ rank: z.number().int().min(2).max(MAX_RANK), frame: FrameIdSchema.optional(), item: RewardIdSchema.optional() }).nullable(),
  title: TitleIdSchema,
  chosenTitle: TitleIdSchema.nullable(),
  frame: FrameIdSchema.nullable(),
  titles: z.array(TitleIdSchema).max(TITLE_IDS.length),
  frames: z.array(FrameIdSchema).max(FRAME_IDS.length),
  seals: z.array(z.strictObject({ id: SealIdSchema, visible: z.boolean(), done: z.boolean(), progress: Int(COUNTER_MAX) })).max(SEAL_IDS.length),
  quests: z.array(z.strictObject({ id: QuestIdSchema, text: z.string().max(120), progress: Int(1000), target: Int(1000), xp: Int(10_000), sats: Int(100_000) })).max(MAX_QUESTS),
  questSlots: Int(MAX_QUESTS),
  canReroll: z.boolean(),
  epoch: z.strictObject({
    index: Int(10_000_000),
    xp: Int(1_000_000),
    tier: Int(EPOCH_TIERS),
    tiers: Int(EPOCH_TIERS),
    tierXp: Int(100_000),
    hat: RewardIdSchema,
    rewards: z.array(z.strictObject({ tier: Int(EPOCH_TIERS), sats: Int(100_000).optional(), frame: FrameIdSchema.optional(), item: RewardIdSchema.optional() })).max(EPOCH_TIERS),
  }),
  academy: z.array(z.strictObject({ level: z.number().int().min(1).max(99), stars: Int(ACADEMY_MAX_STARS), open: z.boolean() })).max(ACADEMY_LEVELS.length),
});

export const SelectTitlePayloadSchema = z.strictObject({ title: TitleIdSchema.nullable() });
export const SelectFramePayloadSchema = z.strictObject({ frame: FrameIdSchema.nullable() });
export const RerollPayloadSchema = z.strictObject({ quest: QuestIdSchema });

// Academy room messages, both directions.
export const ACADEMY_ROOM = 'academy';
export const ACADEMY_MESSAGES = Object.freeze({ DRILL: 'drill', RESULT: 'drillResult', DONE: 'levelDone', REFUSED: 'academyRefused' } as const);
export const AcademyJoinSchema = z.strictObject({}).optional();
export const AcademyStartSchema = z.strictObject({ level: z.number().int().min(1).max(99) });
export const AcademyAnswerSchema = z.strictObject({ id: TaskIdSchema, answer: DrillAnswerSchema });
export const AcademyDrillSchema = z.strictObject({ id: TaskIdSchema, level: z.number().int().min(1).max(99), index: Int(20), total: z.number().int().min(1).max(20), challenge: DrillChallengeSchema });
export const AcademyResultSchema = z.strictObject({ id: TaskIdSchema, ok: z.boolean(), retryInMs: Int(60_000).optional() });
export const AcademyDoneSchema = z.strictObject({
  level: z.number().int().min(1).max(99),
  stars: z.number().int().min(1).max(ACADEMY_MAX_STARS),
  mistakes: Int(1000),
  timeMs: Int(3_600_000),
  parMs: Int(3_600_000),
  // Null when the player has no profile, so nothing was saved.
  award: AwardSchema.nullable(),
});
export const ACADEMY_REFUSALS = ['unknownLevel', 'locked', 'busy', 'timedOut'] as const;
export const AcademyRefusedSchema = z.strictObject({ reason: z.enum(ACADEMY_REFUSALS) });
export type AcademyDrill = z.infer<typeof AcademyDrillSchema>;
export type AcademyResult = z.infer<typeof AcademyResultSchema>;
export type AcademyDone = z.infer<typeof AcademyDoneSchema>;
export type AcademyRefused = z.infer<typeof AcademyRefusedSchema>;
