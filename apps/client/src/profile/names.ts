// Plain-language names for everything progression can show.
import { getItem, rewardItem, type RewardId } from '@byzantine-council/shared/economy';
import { FRAME_NAMES, SEALS, TITLE_NAMES, type FrameId, type TitleId, type XpReason } from '@byzantine-council/shared/progression';
import type { PlainKey } from '../i18n/index.js';

export const XP_REASON_TEXT: Readonly<Record<XpReason, PlainKey>> = {
  finished: 'xp.finished',
  won: 'xp.won',
  tasks: 'xp.tasks',
  signedReal: 'xp.signedReal',
  refusedForgery: 'xp.refusedForgery',
  votedByzantine: 'xp.votedByzantine',
  repairedPartition: 'xp.repairedPartition',
  gatheredSignatures: 'xp.gatheredSignatures',
  misdirection: 'xp.misdirection',
  partitionRanOut: 'xp.partitionRanOut',
  firstOfDay: 'xp.firstOfDay',
};

export function itemName(reward: string): string {
  try {
    return getItem(rewardItem(reward as RewardId))?.name ?? reward;
  } catch {
    return reward;
  }
}

export function sealName(id: string): string {
  return SEALS.find((s) => s.id === id)?.name ?? id;
}

export function titleName(id: string): string {
  return Object.hasOwn(TITLE_NAMES, id) ? TITLE_NAMES[id as TitleId] : id;
}

export function frameName(id: string): string {
  return Object.hasOwn(FRAME_NAMES, id) ? FRAME_NAMES[id as FrameId] : id;
}
