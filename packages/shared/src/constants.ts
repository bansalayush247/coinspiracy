// Player limits for one match.
export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 9;

// Consensus points that win the match for honest guardians.
export const CONSENSUS_GOAL = 100;

// Largest amount the mint splits into notes (2^20).
export const MAX_NOTE_BITS = 20;
export const MAX_NOTE_AMOUNT = 2 ** MAX_NOTE_BITS;

// Hard cap on one encoded client message.
export const MAX_MESSAGE_BYTES = 1024;

// Movement input sequence numbers; 2^31 inputs at 20 Hz is over three years.
export const MAX_INPUT_SEQ = 2 ** 31 - 1;

// Rooms of the Mint Citadel.
export const ROOMS = [
  'plaza',
  'vault',
  'ledgerArchive',
  'watchtower',
  'signingHall',
  'depositGate',
  'gatewayDock',
] as const;
export type RoomId = (typeof ROOMS)[number];

// Preset quick-chat phrases without parameters.
export const SIMPLE_PHRASES = [
  'whereWereYou',
  'iAgree',
  'showEvidence',
  'fixPartition',
  'skipVote',
] as const;
export type SimplePhrase = (typeof SIMPLE_PHRASES)[number];
