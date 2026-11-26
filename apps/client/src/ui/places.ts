// Place names for the arena being played. Quick chat, prompts and task panels read them here, so the
// reef says "the Tide Ledger" where the Citadel says "the Ledger Archive".
import { CITADEL, type Arena, type RoomId, type TaskKind } from '@byzantine-council/shared';
import { getLocale } from '../i18n/index.js';

let current: Arena = CITADEL;

export function setPlaces(arena: Arena): void {
  current = arena;
}

// With its article, for sentences: "I saw Mara in the Vault." Other languages keep the name and drop the English article.
export function placeName(room: RoomId): string {
  const name = current.roomNames[room];
  return getLocale() === 'en' ? name : name.replace(/^the /, '');
}

// Capitalised and without the article, as on a sign: "Ledger Archive".
export function stationName(kind: TaskKind): string {
  const name = current.roomNames[current.stations[kind].room].replace(/^the /, '');
  return name.charAt(0).toUpperCase() + name.slice(1);
}
