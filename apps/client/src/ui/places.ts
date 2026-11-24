// Place names for the arena being played. Quick chat, prompts and task panels read them here, so the
// reef says "the Tide Ledger" where the Citadel says "the Ledger Archive".
import { CITADEL, type Arena, type RoomId, type TaskKind } from '@byzantine-council/shared';

let current: Arena = CITADEL;

export function setPlaces(arena: Arena): void {
  current = arena;
}

// With its article, for sentences: "I saw Mara in the Vault."
export function placeName(room: RoomId): string {
  return current.roomNames[room];
}

// Capitalised and without the article, as on a sign: "Ledger Archive".
export function stationName(kind: TaskKind): string {
  const name = current.roomNames[current.stations[kind].room].replace(/^the /, '');
  return name.charAt(0).toUpperCase() + name.slice(1);
}
