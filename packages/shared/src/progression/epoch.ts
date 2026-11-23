// The Epoch Road: a free ten-tier road that resets every Bitcoin difficulty epoch (2,016 blocks).
import type { RewardId } from '../economy/catalog.js';
import type { FrameId } from './rank.js';

export const EPOCH_BLOCKS = 2016;
export const EPOCH_TIERS = 10;
export const EPOCH_TIER_XP = 200;

export function epochOf(blockHeight: number): number {
  return Number.isSafeInteger(blockHeight) && blockHeight > 0 ? Math.floor(blockHeight / EPOCH_BLOCKS) : 0;
}

export function epochTier(epochXp: number): number {
  return Math.max(0, Math.min(EPOCH_TIERS, Math.floor(epochXp / EPOCH_TIER_XP)));
}

export interface EpochReward {
  readonly sats?: number;
  readonly frame?: FrameId;
  readonly item?: RewardId;
}

// The six epoch caps rotate, so each returns every twelve weeks or so.
export const EPOCH_HATS: readonly RewardId[] = Object.freeze(['epochAmber', 'epochTeal', 'epochViolet', 'epochCoral', 'epochLime', 'epochFrost']);

export function epochHat(epoch: number): RewardId {
  return EPOCH_HATS[((epoch % EPOCH_HATS.length) + EPOCH_HATS.length) % EPOCH_HATS.length] ?? 'epochAmber';
}

// Reward for reaching a tier; tier 2 pays sats instead when the frame is already owned.
export function epochReward(tier: number, epoch: number): EpochReward {
  switch (tier) {
    case 1:
      return { sats: 100 };
    case 2:
      return { frame: 'epoch' };
    case 3:
    case 4:
      return { sats: 150 };
    case 5:
    case 6:
      return { sats: 200 };
    case 7:
    case 8:
      return { sats: 250 };
    case 9:
      return { sats: 300 };
    case 10:
      return { item: epochHat(epoch) };
    default:
      return {};
  }
}
