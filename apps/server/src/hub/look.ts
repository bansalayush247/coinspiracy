// What a guardian wears in Beach Town and Port Concord, copied from their profile onto the synced player.
import { isCosmeticId, type Look } from '@byzantine-council/shared/economy';

/** The synced fields a guardian's look is shown with; '' means nothing in that slot. */
export interface Dressable {
  hat: string;
  shades: string;
  outfit: string;
  hair: string;
  dye: string;
  beard: string;
  board: string;
}

/** The least time between two look refreshes for one guardian; a refresh asked for sooner waits until then. */
export const LOOK_GAP_MS = 2_000;

const worn = (id: string | null): string => (id !== null && isCosmeticId(id) ? id : '');

/** Puts a profile's look on a synced player, changing only the fields that differ. */
export function dress(player: Dressable, look: Look): void {
  const next: Dressable = { hat: worn(look.hat), shades: worn(look.shades), outfit: worn(look.outfit), hair: worn(look.hair), dye: worn(look.dye), beard: worn(look.beard), board: worn(look.board) };
  for (const key of Object.keys(next) as (keyof Dressable)[]) if (player[key] !== next[key]) player[key] = next[key];
}
