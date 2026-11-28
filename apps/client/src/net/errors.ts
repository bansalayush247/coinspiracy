import { CloseCode, ErrorCode } from '@colyseus/sdk';
import { CLOSE_CODES } from '@byzantine-council/shared';
import { t } from '../i18n/index.js';

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
      return t('join.unreachable');
    case CLOSE_CODES.RATE_LIMITED:
      return t('join.rateLimited');
    case CLOSE_CODES.TOO_MANY_CONNECTIONS:
      return t('join.tooMany');
    case CLOSE_CODES.MATCH_IN_PROGRESS:
      return t('join.inProgress');
    case CLOSE_CODES.ISLAND_LOCKED:
      return t('join.islandLocked');
    case ErrorCode.AUTH_FAILED:
      return t('join.badNickname');
    case ErrorCode.MATCHMAKE_INVALID_ROOM_ID:
      return t('join.invalidRoom');
    case ErrorCode.MATCHMAKE_EXPIRED:
      return t('join.expired');
    default:
      return t('join.failed');
  }
}

// Why the room closed, or null for a normal leave.
export function closeMessage(code: number): string | null {
  switch (code) {
    case CloseCode.CONSENTED:
      return null;
    case CLOSE_CODES.IDLE:
      return t('close.idle');
    case CLOSE_CODES.KICKED:
      return t('close.kicked');
    case CLOSE_CODES.ROOM_FAILED:
      return t('close.roomFailed');
    case CLOSE_CODES.RATE_LIMITED:
      return t('close.rateLimited');
    case CloseCode.SERVER_SHUTDOWN:
      return t('close.shutdown');
    case CloseCode.WITH_ERROR:
      return t('close.withError');
    default:
      return t('close.lost');
  }
}

// Join failures after which a saved reconnection token is worthless.
export function tokenIsDead(error: unknown): boolean {
  const code = numericCode(error);
  return code === ErrorCode.MATCHMAKE_INVALID_ROOM_ID || code === ErrorCode.MATCHMAKE_EXPIRED;
}
