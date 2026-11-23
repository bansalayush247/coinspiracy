import { CloseCode, ErrorCode } from '@colyseus/sdk';
import { CLOSE_CODES } from '@byzantine-council/shared';

// Raised by the app itself; its message is already written for players.
export class PlayerFacingError extends Error {}

function numericCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = error.code;
  return typeof code === 'number' ? code : undefined;
}

// What went wrong when joining, in plain words. Server text is never shown as-is.
export function joinErrorMessage(error: unknown): string {
  if (error instanceof PlayerFacingError) return error.message;
  const code = numericCode(error);
  switch (code) {
    case undefined:
      return 'Can’t reach the game server. Check your connection and try again.';
    case CLOSE_CODES.RATE_LIMITED:
      return 'Too many attempts from your network. Wait a moment, then try again.';
    case CLOSE_CODES.TOO_MANY_CONNECTIONS:
      return 'Too many players from your network are already connected.';
    case CLOSE_CODES.MATCH_IN_PROGRESS:
      return 'A match just started in that room. Join when it’s back in the lobby.';
    case ErrorCode.AUTH_FAILED:
      return 'That nickname isn’t allowed. Use 2–16 letters, numbers, spaces, _ or -.';
    case ErrorCode.MATCHMAKE_INVALID_ROOM_ID:
      return 'That room is full or has closed.';
    case ErrorCode.MATCHMAKE_EXPIRED:
      return 'Your seat in that room expired. Join again.';
    default:
      return 'Couldn’t join the room. Try again.';
  }
}

// Why the room closed, or null for a normal leave.
export function closeMessage(code: number): string | null {
  switch (code) {
    case CloseCode.CONSENTED:
      return null;
    case CLOSE_CODES.IDLE:
      return 'You were removed for being idle too long.';
    case CLOSE_CODES.KICKED:
      return 'You were removed from the room.';
    case CLOSE_CODES.ROOM_FAILED:
      return 'The room hit a problem and closed. Join a new one.';
    case CLOSE_CODES.RATE_LIMITED:
      return 'Disconnected for sending too much. Join again.';
    case CloseCode.SERVER_SHUTDOWN:
      return 'The server is restarting. Join again in a moment.';
    case CloseCode.WITH_ERROR:
      return 'Disconnected. This room may be open in another tab.';
    default:
      return 'Lost the connection to the room.';
  }
}

// Join failures after which a saved reconnection token is worthless.
export function tokenIsDead(error: unknown): boolean {
  const code = numericCode(error);
  return code === ErrorCode.MATCHMAKE_INVALID_ROOM_ID || code === ErrorCode.MATCHMAKE_EXPIRED;
}
