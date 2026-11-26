// Every player-facing string about rule tiers, looked up in the current language.
import type { TierId, TierRefused } from '@byzantine-council/shared';
import { t } from '../i18n/index.js';

/** A tier's name, for the lobby badge and the host's picker. */
export function tierName(tier: TierId): string {
  return t(`tier.name.${tier}`);
}

/** What a tier plays with, shown under the picker and as the badge's tooltip. */
export function tierSummary(tier: TierId): string {
  return t(`tier.summary.${tier}`);
}

/** The toast for a refused tier pick. */
export function tierRefusal(reason: TierRefused['reason']): string {
  return t(`tier.refused.${reason}`);
}
