import { CloseCode, ErrorCode } from '@colyseus/sdk';
import { describe, expect, it } from 'vitest';
import { CLOSE_CODES } from '@byzantine-council/shared';
import { PlayerFacingError, closeMessage, joinErrorMessage, tokenIsDead } from '../src/net/errors.js';
import { codeFromHash, inviteLink } from '../src/net/invite.js';

describe('joinErrorMessage', () => {
  it('explains network failures, which carry no numeric code', () => {
    expect(joinErrorMessage({ code: 'ECONNREFUSED' })).toMatch(/Can’t reach/);
    expect(joinErrorMessage(new TypeError('Failed to fetch'))).toMatch(/Can’t reach/);
  });

  it('maps server codes to plain words', () => {
    expect(joinErrorMessage({ code: CLOSE_CODES.RATE_LIMITED })).toMatch(/Too many attempts/);
    expect(joinErrorMessage({ code: ErrorCode.AUTH_FAILED })).toMatch(/nickname/);
    expect(joinErrorMessage({ code: ErrorCode.MATCHMAKE_INVALID_ROOM_ID })).toMatch(/full or has closed/);
  });

  it('never shows raw server text', () => {
    expect(joinErrorMessage({ code: ErrorCode.APPLICATION_ERROR, message: '<b>stack trace</b>' })).toBe('Couldn’t join the room. Try again.');
  });

  it('passes through messages the app wrote itself', () => {
    expect(joinErrorMessage(new PlayerFacingError('No room has that code.'))).toBe('No room has that code.');
  });
});

describe('closeMessage', () => {
  it('stays quiet for a normal leave and explains every app close code', () => {
    expect(closeMessage(CloseCode.CONSENTED)).toBeNull();
    for (const code of Object.values(CLOSE_CODES)) expect(closeMessage(code)).toEqual(expect.any(String));
    expect(closeMessage(CLOSE_CODES.IDLE)).toMatch(/idle/);
    expect(closeMessage(1006)).toMatch(/Lost the connection/);
  });
});

describe('tokenIsDead', () => {
  it('discards the saved seat only when the server says it is gone', () => {
    expect(tokenIsDead({ code: ErrorCode.MATCHMAKE_EXPIRED })).toBe(true);
    expect(tokenIsDead({ code: ErrorCode.MATCHMAKE_INVALID_ROOM_ID })).toBe(true);
    expect(tokenIsDead({ code: 'ECONNREFUSED' })).toBe(false);
    expect(tokenIsDead(new Error('Failed to fetch'))).toBe(false);
  });
});

describe('invite links', () => {
  it('puts the code in the fragment and drops any query', () => {
    expect(inviteLink('https://play.example.com/?utm=x#old', 'K7QX9M')).toBe('https://play.example.com/#join=K7QX9M');
  });

  it('reads codes back, tolerating case and dashes, and rejects junk', () => {
    expect(codeFromHash('#join=k7q-x9m')).toBe('K7QX9M');
    expect(codeFromHash('#join=K7QX9M&x=1')).toBe('K7QX9M');
    expect(codeFromHash('#join=<script>')).toBeNull();
    expect(codeFromHash('')).toBeNull();
    expect(codeFromHash('#other=K7QX9M')).toBeNull();
  });
});
