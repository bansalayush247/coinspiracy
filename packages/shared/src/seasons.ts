// Seasonal events from the block height and the UTC date. Pure and deterministic; cosmetic only.
import { z } from 'zod';

// Bitcoin schedule.
export const HALVING_INTERVAL = 210_000;
export const RETARGET_INTERVAL = 2_016;
export const INITIAL_SUBSIDY_SATS = 5_000_000_000;
export const SATS_PER_BITCOIN = 100_000_000;
// 50 bitcoin in sats needs 33 bits, so the 33rd halving takes the subsidy to zero.
export const LAST_HALVING_EPOCH = 33;

// Event windows in blocks; a block is about ten minutes.
export const HALVING_COUNTDOWN_BLOCKS = 4_032;
export const HALVING_CELEBRATION_BLOCKS = 1_008;
export const RETARGET_CELEBRATION_BLOCKS = 144;

// Input bounds: the Watchtower height cap and the last instant a Date can hold.
export const MAX_SEASON_HEIGHT = 100_000_000;
export const MAX_SEASON_TIME_MS = 8_640_000_000_000_000;

// Priority order, highest first: `featured` is the first active one.
export const SEASONAL_EVENT_IDS = ['halving', 'genesisDay', 'whitepaperDay', 'pizzaDay', 'halvingCountdown', 'retarget'] as const;
export type SeasonalEventId = (typeof SEASONAL_EVENT_IDS)[number];
export const SeasonalEventIdSchema = z.enum(SEASONAL_EVENT_IDS);

export const SEASONAL_DECORATIONS = [
  'confetti',
  'bunting',
  'halfCoinBanners',
  'lanterns',
  'blockGarlands',
  'stars',
  'paperCranes',
  'scrollBanners',
  'pizzaFlags',
  'countdownBoard',
  'difficultyDial',
] as const;
export type SeasonalDecoration = (typeof SEASONAL_DECORATIONS)[number];

// Same "category:value" form as the economy catalogue, so it can add these hats later.
export const SEASONAL_HAT_IDS = [
  'hat:halving-party',
  'hat:genesis-cap',
  'hat:paper-boat',
  'hat:pizza-chef',
  'hat:countdown-cap',
  'hat:retarget-visor',
] as const;
export type SeasonalHatId = (typeof SEASONAL_HAT_IDS)[number];

export interface SeasonTheme {
  readonly decorations: readonly SeasonalDecoration[];
  readonly hat: SeasonalHatId;
  // Banner colours as #RRGGBB: main, then accent.
  readonly colors: readonly [string, string];
}

export interface SeasonalEventInfo {
  readonly id: SeasonalEventId;
  readonly title: string;
  // One short sentence that teaches the idea behind the event.
  readonly blurb: string;
  readonly theme: SeasonTheme;
}

function info(id: SeasonalEventId, title: string, blurb: string, theme: SeasonTheme): SeasonalEventInfo {
  const colors = Object.freeze<[string, string]>([theme.colors[0], theme.colors[1]]);
  return Object.freeze({ id, title, blurb, theme: Object.freeze({ decorations: Object.freeze([...theme.decorations]), hat: theme.hat, colors }) });
}

export const SEASONAL_EVENTS: Readonly<Record<SeasonalEventId, SeasonalEventInfo>> = Object.freeze({
  halving: info(
    'halving',
    'Halving Party',
    'Every 210,000 blocks the reward for a new block halves, so new bitcoin arrives more slowly.',
    { decorations: ['confetti', 'bunting', 'halfCoinBanners'], hat: 'hat:halving-party', colors: ['#F4A340', '#FFE08A'] },
  ),
  genesisDay: info(
    'genesisDay',
    'Genesis Day',
    'On 3 January 2009 the very first Bitcoin block was made.',
    { decorations: ['lanterns', 'blockGarlands', 'stars'], hat: 'hat:genesis-cap', colors: ['#1B2A41', '#F2C14E'] },
  ),
  whitepaperDay: info(
    'whitepaperDay',
    'Whitepaper Day',
    'On 31 October 2008 the Bitcoin whitepaper was shared with the world.',
    { decorations: ['paperCranes', 'scrollBanners'], hat: 'hat:paper-boat', colors: ['#F5F1E6', '#5B7DB1'] },
  ),
  pizzaDay: info(
    'pizzaDay',
    'Pizza Day',
    'On 22 May 2010, 10,000 bitcoin bought two pizzas, one of the first things ever bought with bitcoin.',
    { decorations: ['pizzaFlags', 'bunting'], hat: 'hat:pizza-chef', colors: ['#E4572E', '#F3D34A'] },
  ),
  halvingCountdown: info(
    'halvingCountdown',
    'Halving Countdown',
    'The block reward halves soon. Count down the last blocks with the federation.',
    { decorations: ['countdownBoard'], hat: 'hat:countdown-cap', colors: ['#2E4057', '#F4A340'] },
  ),
  retarget: info(
    'retarget',
    'Difficulty Retarget',
    'Every 2,016 blocks the network retunes its difficulty so blocks keep coming about every ten minutes.',
    { decorations: ['difficultyDial'], hat: 'hat:retarget-visor', colors: ['#3A6EA5', '#9AD1D4'] },
  ),
});

export interface ChainCalendar {
  readonly height: number;
  // Halving epoch: 0 before block 210,000, 1 before 420,000, and so on.
  readonly epoch: number;
  readonly subsidySats: number;
  readonly nextHalvingHeight: number;
  readonly blocksToHalving: number;
  // Index of the 2,016-block difficulty period.
  readonly retargetPeriod: number;
  readonly nextRetargetHeight: number;
  readonly blocksToRetarget: number;
}

export interface UtcDay {
  readonly year: number;
  // 1-12.
  readonly month: number;
  readonly day: number;
}

interface ActiveBase<I extends SeasonalEventId> {
  readonly id: I;
  readonly info: SeasonalEventInfo;
}
export type ActiveHalving = ActiveBase<'halving'> & {
  readonly halvingHeight: number;
  readonly epoch: number;
  readonly subsidySats: number;
  // First height after the celebration.
  readonly endsAtHeight: number;
};
export type ActiveHalvingCountdown = ActiveBase<'halvingCountdown'> & {
  readonly halvingHeight: number;
  readonly blocksLeft: number;
  readonly endsAtHeight: number;
};
export type ActiveRetarget = ActiveBase<'retarget'> & {
  readonly retargetHeight: number;
  readonly period: number;
  readonly endsAtHeight: number;
};
export type AnniversaryId = 'genesisDay' | 'whitepaperDay' | 'pizzaDay';
type Anniversary<I extends AnniversaryId> = ActiveBase<I> & {
  readonly years: number;
  // First UTC millisecond after the day.
  readonly endsAtMs: number;
};
export type ActiveAnniversary = Anniversary<'genesisDay'> | Anniversary<'whitepaperDay'> | Anniversary<'pizzaDay'>;
export type ActiveSeasonalEvent = ActiveHalving | ActiveHalvingCountdown | ActiveRetarget | ActiveAnniversary;

export interface Season {
  readonly calendar: ChainCalendar;
  readonly day: UtcDay;
  // Every event running now, in priority order.
  readonly active: readonly ActiveSeasonalEvent[];
  readonly featured: ActiveSeasonalEvent | null;
}

const ANNIVERSARIES: readonly { readonly id: AnniversaryId; readonly month: number; readonly day: number; readonly since: number }[] = Object.freeze([
  Object.freeze({ id: 'genesisDay', month: 1, day: 3, since: 2009 }),
  Object.freeze({ id: 'whitepaperDay', month: 10, day: 31, since: 2008 }),
  Object.freeze({ id: 'pizzaDay', month: 5, day: 22, since: 2010 }),
]);

// Fails closed like assertTick: heights are safe integers within the Watchtower range.
export function assertSeasonHeight(height: number): void {
  if (!Number.isSafeInteger(height) || height < 0 || height > MAX_SEASON_HEIGHT) {
    throw new RangeError(`height must be an integer from 0 to ${String(MAX_SEASON_HEIGHT)}, got ${String(height)}`);
  }
}

export function assertSeasonTime(nowMs: number): void {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > MAX_SEASON_TIME_MS) {
    throw new RangeError(`time must be an integer ms timestamp from 0 to ${String(MAX_SEASON_TIME_MS)}, got ${String(nowMs)}`);
  }
}

// Block subsidy in sats for a halving epoch, as Bitcoin computes it (a right shift of 50 BTC).
export function subsidyForEpoch(epoch: number): number {
  if (!Number.isSafeInteger(epoch) || epoch < 0) throw new RangeError(`epoch must be a non-negative integer, got ${String(epoch)}`);
  return epoch >= LAST_HALVING_EPOCH ? 0 : Math.floor(INITIAL_SUBSIDY_SATS / 2 ** epoch);
}

export function chainCalendar(height: number): ChainCalendar {
  assertSeasonHeight(height);
  const epoch = Math.floor(height / HALVING_INTERVAL);
  const nextHalvingHeight = (epoch + 1) * HALVING_INTERVAL;
  const retargetPeriod = Math.floor(height / RETARGET_INTERVAL);
  const nextRetargetHeight = (retargetPeriod + 1) * RETARGET_INTERVAL;
  return Object.freeze({
    height,
    epoch,
    subsidySats: subsidyForEpoch(epoch),
    nextHalvingHeight,
    blocksToHalving: nextHalvingHeight - height,
    retargetPeriod,
    nextRetargetHeight,
    blocksToRetarget: nextRetargetHeight - height,
  });
}

export function utcDay(nowMs: number): UtcDay {
  assertSeasonTime(nowMs);
  const date = new Date(nowMs);
  return Object.freeze({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}

function blockEvents(c: ChainCalendar): ActiveSeasonalEvent[] {
  const events: ActiveSeasonalEvent[] = [];
  const halvingHeight = c.epoch * HALVING_INTERVAL;
  // A halving only counts while there was still a subsidy to halve.
  if (c.epoch >= 1 && c.epoch <= LAST_HALVING_EPOCH && c.height - halvingHeight < HALVING_CELEBRATION_BLOCKS) {
    events.push(
      Object.freeze({
        id: 'halving',
        info: SEASONAL_EVENTS.halving,
        halvingHeight,
        epoch: c.epoch,
        subsidySats: c.subsidySats,
        endsAtHeight: halvingHeight + HALVING_CELEBRATION_BLOCKS,
      }),
    );
  }
  if (c.epoch + 1 <= LAST_HALVING_EPOCH && c.blocksToHalving <= HALVING_COUNTDOWN_BLOCKS) {
    events.push(
      Object.freeze({
        id: 'halvingCountdown',
        info: SEASONAL_EVENTS.halvingCountdown,
        halvingHeight: c.nextHalvingHeight,
        blocksLeft: c.blocksToHalving,
        endsAtHeight: c.nextHalvingHeight,
      }),
    );
  }
  const retargetHeight = c.retargetPeriod * RETARGET_INTERVAL;
  if (c.retargetPeriod >= 1 && c.height - retargetHeight < RETARGET_CELEBRATION_BLOCKS) {
    events.push(
      Object.freeze({
        id: 'retarget',
        info: SEASONAL_EVENTS.retarget,
        retargetHeight,
        period: c.retargetPeriod,
        endsAtHeight: retargetHeight + RETARGET_CELEBRATION_BLOCKS,
      }),
    );
  }
  return events;
}

// Anniversaries run for the whole UTC day, from the first one after the original date.
function dateEvents(day: UtcDay): ActiveSeasonalEvent[] {
  const events: ActiveSeasonalEvent[] = [];
  for (const a of ANNIVERSARIES) {
    const years = day.year - a.since;
    if (a.month !== day.month || a.day !== day.day || years < 1) continue;
    events.push(Object.freeze({ id: a.id, info: SEASONAL_EVENTS[a.id], years, endsAtMs: Date.UTC(day.year, day.month - 1, day.day + 1) }));
  }
  return events;
}

const PRIORITY = new Map<SeasonalEventId, number>(SEASONAL_EVENT_IDS.map((id, i) => [id, i]));

function rank(event: ActiveSeasonalEvent): number {
  return PRIORITY.get(event.id) ?? SEASONAL_EVENT_IDS.length;
}

export function seasonAt(height: number, nowMs: number): Season {
  const calendar = chainCalendar(height);
  const day = utcDay(nowMs);
  const active = [...blockEvents(calendar), ...dateEvents(day)].sort((a, b) => rank(a) - rank(b));
  return Object.freeze({ calendar, day, active: Object.freeze(active), featured: active[0] ?? null });
}

// Thousands separators without the host locale, so every client prints the same text.
export function groupDigits(n: number): string {
  if (!Number.isSafeInteger(n)) throw new RangeError(`not a safe integer: ${String(n)}`);
  const sign = n < 0 ? '-' : '';
  return sign + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Sats as a bitcoin amount with no trailing zeros, e.g. 312,500,000 -> "3.125".
export function formatBitcoin(sats: number): string {
  if (!Number.isSafeInteger(sats) || sats < 0) throw new RangeError(`sats must be a non-negative integer, got ${String(sats)}`);
  const whole = Math.floor(sats / SATS_PER_BITCOIN);
  const fraction = String(sats % SATS_PER_BITCOIN).padStart(8, '0').replace(/0+$/, '');
  return fraction === '' ? groupDigits(whole) : `${groupDigits(whole)}.${fraction}`;
}

function plural(n: number, word: string): string {
  return `${groupDigits(n)} ${word}${n === 1 ? '' : 's'}`;
}

// One short line for a banner or the HUD.
export function headline(event: ActiveSeasonalEvent): string {
  switch (event.id) {
    case 'halving':
      return event.subsidySats > 0
        ? `Halving! The block reward is now ${formatBitcoin(event.subsidySats)} bitcoin.`
        : 'The last halving! From now on blocks pay only fees.';
    case 'halvingCountdown':
      return `Halving in ${plural(event.blocksLeft, 'block')}.`;
    case 'retarget':
      return `Difficulty retarget at block ${groupDigits(event.retargetHeight)}.`;
    case 'genesisDay':
      return `Bitcoin turns ${String(event.years)} today.`;
    case 'whitepaperDay':
      return `The Bitcoin whitepaper turns ${String(event.years)} today.`;
    case 'pizzaDay':
      return `Pizza Day: ${plural(event.years, 'year')} since two pizzas cost 10,000 bitcoin.`;
  }
}

// GET this path on the game server for the season banner.
export const SEASON_PATH = '/api/season';
const HexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export const SeasonBannerSchema = z.strictObject({
  id: SeasonalEventIdSchema,
  title: z.string().min(1).max(60),
  headline: z.string().min(1).max(120),
  blurb: z.string().min(1).max(200),
  colors: z.tuple([HexColor, HexColor]),
});
export type SeasonBanner = z.infer<typeof SeasonBannerSchema>;
export const SeasonReplySchema = z.strictObject({
  height: z.number().int().min(0).max(MAX_SEASON_HEIGHT),
  // False while the height is an estimate from the clock.
  live: z.boolean(),
  featured: SeasonBannerSchema.nullable(),
});
export type SeasonReply = z.infer<typeof SeasonReplySchema>;

// What the menu shows: the featured event, if any, at this height and time.
export function seasonReply(height: number, live: boolean, nowMs: number): SeasonReply {
  const event = seasonAt(height, nowMs).featured;
  return {
    height,
    live,
    featured:
      event === null
        ? null
        : { id: event.id, title: event.info.title, headline: headline(event), blurb: event.info.blurb, colors: [event.info.theme.colors[0], event.info.theme.colors[1]] },
  };
}
