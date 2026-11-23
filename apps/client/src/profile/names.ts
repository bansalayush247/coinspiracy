// Plain-language names for everything progression can show.
import { getItem, rewardItem, type RewardId } from '@byzantine-council/shared/economy';
import { FRAME_NAMES, SEALS, TITLE_NAMES, type FrameId, type TitleId, type XpReason } from '@byzantine-council/shared/progression';

export const XP_REASON_TEXT: Readonly<Record<XpReason, string>> = {
  finished: 'Finished the match',
  won: 'Your side won',
  tasks: 'Tasks completed',
  signedReal: 'Signed real withdrawals',
  refusedForgery: 'Refused forged withdrawals',
  votedByzantine: 'Voted for a Byzantine',
  repairedPartition: 'Repaired the network',
  gatheredSignatures: 'Fooled honest signers',
  misdirection: 'An honest key was rotated out',
  partitionRanOut: 'Your partition held',
  firstOfDay: 'First match today',
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
