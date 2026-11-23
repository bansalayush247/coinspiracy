// Matchmaking name of the citadel room on the server.
export const ROOM_NAME = 'citadel';

// App close codes; Colyseus reserves 4000-4010, and ws allows reasons up to 123 bytes.
export const CLOSE_CODES = Object.freeze({
  RATE_LIMITED: 4101,
  IDLE: 4102,
  KICKED: 4103,
  ORIGIN_REJECTED: 4104,
  TOO_MANY_CONNECTIONS: 4105,
  ROOM_FAILED: 4106,
  // Refused at connect: the room is mid-match.
  MATCH_IN_PROGRESS: 4107,
} as const);
export type CloseCode = (typeof CLOSE_CODES)[keyof typeof CLOSE_CODES];

// Server kicks never get a reconnection window.
export function isKickCode(code: number): boolean {
  return Object.values(CLOSE_CODES).some((c) => c === code);
}

// Messages the server sends to one client; payloads are in schemas.ts.
export const SERVER_MESSAGES = Object.freeze({
  TASK_OPENED: 'taskOpened',
  TASK_RESULT: 'taskResult',
  TASK_REFUSED: 'taskRefused',
  TASK_CLOSED: 'taskClosed',
  // To the forger and fellow Byzantines: which open proposal is a forgery.
  FORGED: 'forged',
  AUDIT: 'audit',
  CEREMONY_REFUSED: 'ceremonyRefused',
  // Broadcast to the room during councils.
  CHAT: 'chat',
  COUNCIL_REFUSED: 'councilRefused',
  SABOTAGE_REFUSED: 'sabotageRefused',
  // To the Byzantines: when their next partition and freeze are ready.
  SABOTAGE_READY: 'sabotageReady',
  // To one player after a match: their XP, rank, seals, quests and sats (see progression AwardSchema).
  MATCH_REWARDS: 'matchRewards',
  // To the host: a practice bot could not be added or removed.
  BOTS_REFUSED: 'botsRefused',
} as const);
