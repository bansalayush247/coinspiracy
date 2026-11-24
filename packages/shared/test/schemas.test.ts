import { describe, expect, it, vi } from 'vitest';
import { MAX_INPUT_SEQ, MAX_MESSAGE_BYTES, ROOMS, SIMPLE_PHRASES } from '../src/constants.js';
import {
  CLIENT_MESSAGE_PAYLOADS,
  EntityIdSchema,
  PlayerIdSchema,
  RoomSchema,
  parseClientMessage,
  withinMessageLimit,
  type ClientMessage,
} from '../src/schemas.js';

const INVALID = { ok: false, error: 'invalidMessage' } as const;
const PLAYER = 'Pl4yer_01';
const PROPOSAL = 'prop_7';
const SPEC_TYPES = [
  'move',
  'interact',
  'signProposal',
  'refuseProposal',
  'callCouncil',
  'castVote',
  'quickChat',
  'startMatch',
  'openTask',
  'taskAnswer',
  'closeTask',
  'forgeProposal',
  'auditProposal',
  'partition',
  'freeze',
  'addBot',
  'removeBot',
  'setArena',
] as const;
const SPEC_SIMPLE_PHRASES = [
  'whereWereYou',
  'iAgree',
  'showEvidence',
  'fixPartition',
  'skipVote',
] as const;

interface ValidCase {
  readonly label: string;
  readonly message: ClientMessage;
}

interface RawCase {
  readonly label: string;
  readonly raw: unknown;
}

interface IdCase {
  readonly label: string;
  readonly id: string;
  readonly valid: boolean;
}

interface ExtraKeyCase {
  readonly label: string;
  readonly key: string;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly message: ClientMessage;
}

// JSON.parse keeps '__proto__' and 'constructor' as own keys, like a real frame.
function fromJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('fixture is not a plain object');
  }
  return value as Record<string, unknown>;
}

// Re-parses a message with one extra JSON member in front.
function withJsonMember(message: object, member: string): Readonly<Record<string, unknown>> {
  return asRecord(fromJson(`{${member},${JSON.stringify(message).slice(1)}`));
}

function without(source: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([name]) => name !== key));
}

const VALID_MESSAGES: readonly ValidCase[] = [
  { label: 'move', message: { type: 'move', seq: 1, dx: 0.5, dy: -0.25 } },
  { label: 'interact', message: { type: 'interact', targetId: 'vault-door' } },
  { label: 'signProposal', message: { type: 'signProposal', proposalId: PROPOSAL } },
  { label: 'refuseProposal', message: { type: 'refuseProposal', proposalId: PROPOSAL } },
  { label: 'callCouncil', message: { type: 'callCouncil' } },
  { label: 'forgeProposal', message: { type: 'forgeProposal' } },
  { label: 'partition', message: { type: 'partition' } },
  { label: 'freeze', message: { type: 'freeze', targetId: PLAYER } },
  { label: 'addBot', message: { type: 'addBot' } },
  { label: 'removeBot', message: { type: 'removeBot', targetId: PLAYER } },
  { label: 'setArena', message: { type: 'setArena', arena: 'reef' } },
  { label: 'auditProposal', message: { type: 'auditProposal', proposalId: PROPOSAL } },
  { label: 'castVote for skip', message: { type: 'castVote', target: 'skip' } },
  { label: 'castVote for a player', message: { type: 'castVote', target: PLAYER } },
  ...SPEC_SIMPLE_PHRASES.map(
    (phrase): ValidCase => ({
      label: `quickChat ${phrase}`,
      message: { type: 'quickChat', chat: { phrase } },
    }),
  ),
  {
    label: 'quickChat sawAt',
    message: { type: 'quickChat', chat: { phrase: 'sawAt', playerId: PLAYER, room: 'vault' } },
  },
  {
    label: 'quickChat suspect',
    message: { type: 'quickChat', chat: { phrase: 'suspect', playerId: PLAYER } },
  },
  {
    label: 'quickChat dontSign',
    message: { type: 'quickChat', chat: { phrase: 'dontSign', proposalId: PROPOSAL } },
  },
  { label: 'quickChat signIt', message: { type: 'quickChat', chat: { phrase: 'signIt', proposalId: PROPOSAL } } },
  { label: 'quickChat audited', message: { type: 'quickChat', chat: { phrase: 'audited', proposalId: PROPOSAL, forged: true } } },
  { label: 'quickChat trust', message: { type: 'quickChat', chat: { phrase: 'trust', playerId: PLAYER } } },
  { label: 'quickChat iWasIn', message: { type: 'quickChat', chat: { phrase: 'iWasIn', room: 'watchtower' } } },
  { label: 'startMatch', message: { type: 'startMatch' } },
  { label: 'openTask', message: { type: 'openTask', kind: 'ledger' } },
  { label: 'closeTask', message: { type: 'closeTask' } },
  { label: 'taskAnswer deposit', message: { type: 'taskAnswer', id: 'Tk3_9xQ-ab12', answer: { kind: 'deposit', notes: [8, 4, 1] } } },
  { label: 'taskAnswer ledger', message: { type: 'taskAnswer', id: 'Tk3_9xQ-ab12', answer: { kind: 'ledger', reject: [0, 5] } } },
  { label: 'taskAnswer route', message: { type: 'taskAnswer', id: 'Tk3_9xQ-ab12', answer: { kind: 'route', path: [0, 1, 4, 6, 7] } } },
  { label: 'taskAnswer watchtower', message: { type: 'taskAnswer', id: 'Tk3_9xQ-ab12', answer: { kind: 'watchtower', height: 925_104 } } },
];

describe('message constants', () => {
  it('caps a client message at 1024 bytes', () => {
    expect(MAX_MESSAGE_BYTES).toBe(1024);
  });

  it('defines exactly the spec simple phrases', () => {
    expect(new Set(SIMPLE_PHRASES)).toEqual(new Set(SPEC_SIMPLE_PHRASES));
  });
});

describe('parseClientMessage: valid messages', () => {
  it.each(VALID_MESSAGES)('accepts $label and returns it unchanged', ({ message }) => {
    expect(parseClientMessage(message)).toStrictEqual({ ok: true, value: message });
  });

  it.each(VALID_MESSAGES)('accepts $label parsed from JSON', ({ message }) => {
    expect(parseClientMessage(fromJson(JSON.stringify(message)))).toStrictEqual({
      ok: true,
      value: message,
    });
  });

  it('covers every message type and phrase in the spec', () => {
    expect(new Set(VALID_MESSAGES.map(({ message }) => message.type))).toEqual(new Set(SPEC_TYPES));
    const phrases = VALID_MESSAGES.flatMap(({ message }) =>
      message.type === 'quickChat' ? [message.chat.phrase] : [],
    );
    expect(new Set(phrases)).toEqual(
      new Set([...SPEC_SIMPLE_PHRASES, 'sawAt', 'suspect', 'dontSign', 'signIt', 'audited', 'trust', 'iWasIn']),
    );
  });

  it('parses a frozen message without touching it', () => {
    const chat = Object.freeze({ phrase: 'sawAt', playerId: PLAYER, room: 'vault' } as const);
    const message = Object.freeze({ type: 'quickChat', chat } as const);
    expect(parseClientMessage(message)).toStrictEqual({
      ok: true,
      value: { type: 'quickChat', chat: { phrase: 'sawAt', playerId: PLAYER, room: 'vault' } },
    });
    expect(message).toEqual({ type: 'quickChat', chat: { phrase: 'sawAt', playerId: PLAYER, room: 'vault' } });
  });
});

describe('parseClientMessage: unknown types', () => {
  const UNKNOWN_TYPES = [
    'teleport',
    'spend',
    'chat',
    'admin',
    'Move',
    'MOVE',
    'callcouncil',
    'move ',
    ' move',
    '',
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
    'valueOf',
  ] as const;

  it.each(UNKNOWN_TYPES)('rejects type %j', (type) => {
    expect(parseClientMessage({ type })).toStrictEqual(INVALID);
    expect(parseClientMessage({ type, dx: 0, dy: 0 })).toStrictEqual(INVALID);
  });

  it.each([
    { label: 'a numeric type', raw: { type: 7 } },
    { label: 'a null type', raw: { type: null } },
    { label: 'a boolean type', raw: { type: true } },
    { label: 'an array type', raw: { type: ['callCouncil'] } },
    { label: 'an object type', raw: { type: { name: 'callCouncil' } } },
    { label: 'no type at all', raw: { dx: 0, dy: 0 } },
  ])('rejects $label', ({ raw }) => {
    expect(parseClientMessage(raw)).toStrictEqual(INVALID);
  });
});

describe('parseClientMessage: missing fields', () => {
  const MISSING_FIELD_CASES: readonly RawCase[] = [
    ...VALID_MESSAGES.flatMap(({ label, message }) =>
      Object.keys(message).map((key): RawCase => ({
        label: `${label} without ${key}`,
        raw: without(message, key),
      })),
    ),
    { label: 'sawAt without playerId', raw: { type: 'quickChat', chat: { phrase: 'sawAt', room: 'vault' } } },
    { label: 'sawAt without room', raw: { type: 'quickChat', chat: { phrase: 'sawAt', playerId: PLAYER } } },
    { label: 'suspect without playerId', raw: { type: 'quickChat', chat: { phrase: 'suspect' } } },
    { label: 'dontSign without proposalId', raw: { type: 'quickChat', chat: { phrase: 'dontSign' } } },
    { label: 'chat without phrase', raw: { type: 'quickChat', chat: {} } },
    { label: 'an empty object', raw: {} },
  ];

  it.each(MISSING_FIELD_CASES)('rejects $label', ({ raw }) => {
    expect(parseClientMessage(raw)).toStrictEqual(INVALID);
  });
});

describe('parseClientMessage: extra keys', () => {
  const EXTRA_KEY_CASES: readonly ExtraKeyCase[] = VALID_MESSAGES.flatMap(
    ({ label, message }): ExtraKeyCase[] => [
      { label: `${label} with an extra key`, key: 'extra', raw: { ...message, extra: true }, message },
      {
        label: `${label} with an extra undefined key`,
        key: 'extra',
        raw: { ...message, extra: undefined },
        message,
      },
      {
        label: `${label} with a JSON __proto__ key`,
        key: '__proto__',
        raw: withJsonMember(message, '"__proto__":{"isAdmin":true}'),
        message,
      },
      {
        label: `${label} with a JSON constructor key`,
        key: 'constructor',
        raw: withJsonMember(message, '"constructor":{"prototype":{"isAdmin":true}}'),
        message,
      },
    ],
  );

  // Removing the extra key must make the frame valid, so it alone causes the rejection.
  it.each(EXTRA_KEY_CASES)('rejects $label', ({ key, raw, message }) => {
    expect(Object.hasOwn(raw, key)).toBe(true);
    expect(parseClientMessage(raw)).toStrictEqual(INVALID);
    expect(parseClientMessage(without(raw, key))).toStrictEqual({ ok: true, value: message });
  });

  const sawAt = { phrase: 'sawAt', playerId: PLAYER, room: 'vault' } as const;
  const EXTRA_CHAT_KEY_CASES: readonly ExtraKeyCase[] = [
    {
      label: 'free text beside a preset',
      key: 'text',
      raw: { phrase: 'iAgree', text: 'hi' },
      message: { type: 'quickChat', chat: { phrase: 'iAgree' } },
    },
    {
      label: 'a JSON __proto__ key',
      key: '__proto__',
      raw: withJsonMember({ phrase: 'iAgree' }, '"__proto__":{"isAdmin":true}'),
      message: { type: 'quickChat', chat: { phrase: 'iAgree' } },
    },
    {
      label: 'a JSON constructor key',
      key: 'constructor',
      raw: withJsonMember(sawAt, '"constructor":{"prototype":{"isAdmin":true}}'),
      message: { type: 'quickChat', chat: sawAt },
    },
    {
      label: 'a playerId on dontSign',
      key: 'playerId',
      raw: { phrase: 'dontSign', proposalId: PROPOSAL, playerId: PLAYER },
      message: { type: 'quickChat', chat: { phrase: 'dontSign', proposalId: PROPOSAL } },
    },
  ];

  it.each(EXTRA_CHAT_KEY_CASES)('rejects a chat with $label', ({ key, raw, message }) => {
    expect(Object.hasOwn(raw, key)).toBe(true);
    expect(parseClientMessage({ type: 'quickChat', chat: raw })).toStrictEqual(INVALID);
    expect(parseClientMessage({ type: 'quickChat', chat: without(raw, key) })).toStrictEqual({
      ok: true,
      value: message,
    });
  });

  it('builds __proto__ fixtures as own keys on an ordinary object', () => {
    const raw = fromJson('{"type":"callCouncil","__proto__":{"isAdmin":true}}');
    expect(typeof raw === 'object' && raw !== null && Object.hasOwn(raw, '__proto__')).toBe(true);
    const proto: unknown = Object.getPrototypeOf(raw);
    expect(proto).toBe(Object.prototype);
  });

  it('does not pollute Object.prototype while rejecting those payloads', () => {
    for (const { raw } of EXTRA_KEY_CASES) parseClientMessage(raw);
    expect('isAdmin' in {}).toBe(false);
    expect(Object.getOwnPropertyNames(Object.prototype)).not.toContain('isAdmin');
  });
});

describe('parseClientMessage: wrong field types', () => {
  it.each([
    { label: 'a string dx', raw: { type: 'move', seq: 1, dx: '0.5', dy: 0 } },
    { label: 'a null dy', raw: { type: 'move', seq: 1, dx: 0, dy: null } },
    { label: 'a boolean dx', raw: { type: 'move', seq: 1, dx: true, dy: 0 } },
    { label: 'an array dx', raw: { type: 'move', seq: 1, dx: [0], dy: 0 } },
    { label: 'a bigint dy', raw: { type: 'move', seq: 1, dx: 0, dy: 0n } },
    { label: 'a numeric targetId', raw: { type: 'interact', targetId: 42 } },
    { label: 'an array targetId', raw: { type: 'interact', targetId: ['vault-door'] } },
    { label: 'a null proposalId on sign', raw: { type: 'signProposal', proposalId: null } },
    { label: 'a numeric proposalId on refuse', raw: { type: 'refuseProposal', proposalId: 7 } },
    { label: 'a numeric vote target', raw: { type: 'castVote', target: 12345678 } },
    { label: 'a null vote target', raw: { type: 'castVote', target: null } },
    { label: 'an object vote target', raw: { type: 'castVote', target: { id: PLAYER } } },
    { label: 'an array vote target', raw: { type: 'castVote', target: ['skip'] } },
    { label: 'a bare-string chat', raw: { type: 'quickChat', chat: 'iAgree' } },
    { label: 'a null chat', raw: { type: 'quickChat', chat: null } },
    { label: 'an array chat', raw: { type: 'quickChat', chat: [{ phrase: 'iAgree' }] } },
    { label: 'a numeric phrase', raw: { type: 'quickChat', chat: { phrase: 1 } } },
    { label: 'an array phrase', raw: { type: 'quickChat', chat: { phrase: ['iAgree'] } } },
    {
      label: 'a numeric playerId',
      raw: { type: 'quickChat', chat: { phrase: 'suspect', playerId: 12345678 } },
    },
    {
      label: 'a numeric room',
      raw: { type: 'quickChat', chat: { phrase: 'sawAt', playerId: PLAYER, room: 1 } },
    },
    {
      label: 'a numeric dontSign proposalId',
      raw: { type: 'quickChat', chat: { phrase: 'dontSign', proposalId: 7 } },
    },
  ])('rejects $label', ({ raw }) => {
    expect(parseClientMessage(raw)).toStrictEqual(INVALID);
  });
});

describe('parseClientMessage: move bounds', () => {
  const IN_RANGE: readonly { label: string; value: number }[] = [
    { label: '-1', value: -1 },
    { label: '-0.999999', value: -0.999999 },
    { label: '-0', value: -0 },
    { label: '0', value: 0 },
    { label: 'Number.MIN_VALUE', value: Number.MIN_VALUE },
    { label: '0.5', value: 0.5 },
    { label: 'the largest double below 1', value: 1 - Number.EPSILON / 2 },
    { label: '1', value: 1 },
  ];

  it.each(IN_RANGE)('accepts dx = $label', ({ value }) => {
    const message = { type: 'move', seq: 1, dx: value, dy: 0 };
    expect(parseClientMessage(message)).toStrictEqual({ ok: true, value: message });
  });

  it.each(IN_RANGE)('accepts dy = $label', ({ value }) => {
    const message = { type: 'move', seq: 1, dx: 0, dy: value };
    expect(parseClientMessage(message)).toStrictEqual({ ok: true, value: message });
  });

  it.each([
    { dx: 1, dy: 1 },
    { dx: -1, dy: -1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: 1 },
  ])('accepts the corner dx = $dx, dy = $dy', ({ dx, dy }) => {
    const message = { type: 'move', seq: 1, dx, dy };
    expect(parseClientMessage(message)).toStrictEqual({ ok: true, value: message });
  });

  const OUT_OF_RANGE: readonly { label: string; value: unknown }[] = [
    { label: 'just below -1', value: -1 - Number.EPSILON },
    { label: 'just above 1', value: 1 + Number.EPSILON },
    { label: '-1.000001', value: -1.000001 },
    { label: '1.000001', value: 1.000001 },
    { label: '-2', value: -2 },
    { label: '2', value: 2 },
    { label: 'Number.MAX_VALUE', value: Number.MAX_VALUE },
    { label: '-Number.MAX_VALUE', value: -Number.MAX_VALUE },
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
    { label: '-Infinity', value: Number.NEGATIVE_INFINITY },
    { label: "the string '0'", value: '0' },
    { label: "the string '1'", value: '1' },
    { label: "the string '-1'", value: '-1' },
    { label: "the string '0.5'", value: '0.5' },
    { label: 'the empty string', value: '' },
    { label: "the string 'NaN'", value: 'NaN' },
  ];

  it.each(OUT_OF_RANGE)('rejects dx = $label', ({ value }) => {
    expect(parseClientMessage({ type: 'move', seq: 1, dx: value, dy: 0 })).toStrictEqual(INVALID);
  });

  it.each(OUT_OF_RANGE)('rejects dy = $label', ({ value }) => {
    expect(parseClientMessage({ type: 'move', seq: 1, dx: 0, dy: value })).toStrictEqual(INVALID);
  });

  it('rejects JSON numbers that overflow to Infinity', () => {
    expect(parseClientMessage(fromJson('{"type":"move","seq":1,"dx":1e400,"dy":0}'))).toStrictEqual(INVALID);
    expect(parseClientMessage(fromJson('{"type":"move","seq":1,"dx":0,"dy":-1e400}'))).toStrictEqual(INVALID);
  });

  it('accepts a JSON number that underflows to 0', () => {
    expect(parseClientMessage(fromJson('{"type":"move","seq":1,"dx":1e-400,"dy":0}'))).toStrictEqual({
      ok: true,
      value: { type: 'move', seq: 1, dx: 0, dy: 0 },
    });
  });
});

describe('id formats', () => {
  const BAD_CHARACTER_IDS: readonly { label: string; id: string }[] = [
    { label: 'a space', id: 'abcd efgh' },
    { label: 'a dot', id: 'abcd.efgh' },
    { label: 'an accented letter', id: 'abcdéfgh' },
    { label: 'a Cyrillic homoglyph', id: 'abcdеfgh' },
    { label: 'an emoji', id: 'abcd\u{1F600}fg' },
    { label: "'<script>'", id: '<script>' },
    { label: 'a script tag', id: '<script>alert(1)</script>' },
    { label: 'a trailing newline', id: 'abcdefgh\n' },
    { label: 'a leading newline', id: '\nabcdefgh' },
    { label: 'a trailing CRLF', id: 'abcdefgh\r\n' },
    { label: 'a tab', id: 'abcd\tefgh' },
    { label: 'a NUL character', id: 'abcd\0efgh' },
    { label: 'a slash', id: 'abcd/efgh' },
    { label: 'a backslash', id: 'abcd\\efgh' },
    { label: 'a plus sign', id: 'abcd+efgh' },
    { label: 'base64 padding', id: 'abcdefg=' },
    { label: 'percent-encoding', id: 'abcd%20ef' },
    { label: 'a colon', id: 'user:abcd' },
    { label: 'a double quote', id: 'abcd"efgh' },
    { label: 'fullwidth digits', id: '１２３４５６７８' },
    { label: 'the Kelvin sign', id: 'abcdefgK' },
    { label: 'a combining accent', id: 'abcdefgé' },
    { label: 'a zero-width space', id: 'abcd​efgh' },
    { label: 'a non-breaking space', id: 'abcd efgh' },
    { label: 'a right-to-left override', id: 'abcd‮efgh' },
  ];

  const PLAYER_ID_CASES: readonly IdCase[] = [
    { label: 'of length 0', id: '', valid: false },
    { label: 'of length 7', id: 'a'.repeat(7), valid: false },
    { label: 'of length 8', id: 'a'.repeat(8), valid: true },
    { label: 'of length 32', id: 'a'.repeat(32), valid: true },
    { label: 'of length 33', id: 'a'.repeat(33), valid: false },
    { label: 'of length 1000', id: 'a'.repeat(1000), valid: false },
    { label: 'mixing every character class', id: 'AZaz09_-', valid: true },
    { label: 'with A-Z and a-f', id: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef', valid: true },
    { label: 'with g-z, digits, _ and -', id: 'ghijklmnopqrstuvwxyz0123456789_-', valid: true },
    { label: 'of only dashes', id: '--------', valid: true },
    { label: 'of only underscores', id: '________', valid: true },
    ...BAD_CHARACTER_IDS.map(({ label, id }): IdCase => ({ label: `with ${label}`, id, valid: false })),
  ];

  const ENTITY_ID_CASES: readonly IdCase[] = [
    { label: 'of length 0', id: '', valid: false },
    { label: 'of length 1', id: 'a', valid: true },
    { label: 'of length 32', id: 'a'.repeat(32), valid: true },
    { label: 'of length 33', id: 'a'.repeat(33), valid: false },
    { label: 'of length 1000', id: 'a'.repeat(1000), valid: false },
    { label: 'of a single digit', id: '7', valid: true },
    { label: 'of a single dash', id: '-', valid: true },
    { label: 'of a single underscore', id: '_', valid: true },
    { label: 'with A-Z and a-f', id: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef', valid: true },
    { label: 'with g-z, digits, _ and -', id: 'ghijklmnopqrstuvwxyz0123456789_-', valid: true },
    { label: 'of a lone space', id: ' ', valid: false },
    { label: 'of a lone newline', id: '\n', valid: false },
    { label: 'with a short trailing newline', id: 'p1\n', valid: false },
    { label: 'of a lone dot', id: '.', valid: false },
    ...BAD_CHARACTER_IDS.map(({ label, id }): IdCase => ({ label: `with ${label}`, id, valid: false })),
  ];

  // Every message field that carries a PlayerId.
  const playerIdCarriers = (id: string): readonly unknown[] => [
    { type: 'castVote', target: id },
    { type: 'quickChat', chat: { phrase: 'suspect', playerId: id } },
    { type: 'quickChat', chat: { phrase: 'sawAt', playerId: id, room: 'plaza' } },
  ];

  // Every message field that carries an EntityId.
  const entityIdCarriers = (id: string): readonly unknown[] => [
    { type: 'interact', targetId: id },
    { type: 'signProposal', proposalId: id },
    { type: 'refuseProposal', proposalId: id },
    { type: 'quickChat', chat: { phrase: 'dontSign', proposalId: id } },
  ];

  it.each(PLAYER_ID_CASES)('PlayerId $label: valid = $valid', ({ id, valid }) => {
    expect(PlayerIdSchema.safeParse(id).success).toBe(valid);
    for (const raw of playerIdCarriers(id)) {
      expect(parseClientMessage(raw)).toStrictEqual(valid ? { ok: true, value: raw } : INVALID);
    }
  });

  it.each(ENTITY_ID_CASES)('EntityId $label: valid = $valid', ({ id, valid }) => {
    expect(EntityIdSchema.safeParse(id).success).toBe(valid);
    for (const raw of entityIdCarriers(id)) {
      expect(parseClientMessage(raw)).toStrictEqual(valid ? { ok: true, value: raw } : INVALID);
    }
  });

  it('rejects non-string ids', () => {
    for (const id of [12345678, null, undefined, ['abcdefgh'], { id: 'abcdefgh' }]) {
      expect(PlayerIdSchema.safeParse(id).success).toBe(false);
      expect(EntityIdSchema.safeParse(id).success).toBe(false);
    }
  });
});

describe('parseClientMessage: castVote target', () => {
  it.each([
    { label: "'skip'", target: 'skip', valid: true },
    { label: 'a player id', target: PLAYER, valid: true },
    { label: "'SKIP'", target: 'SKIP', valid: false },
    { label: "'Skip'", target: 'Skip', valid: false },
    { label: "' skip'", target: ' skip', valid: false },
    { label: "'skip '", target: 'skip ', valid: false },
    { label: "'skip' with a trailing newline", target: 'skip\n', valid: false },
    { label: "'skipped'", target: 'skipped', valid: false },
    { label: "'null'", target: 'null', valid: false },
    { label: 'the empty string', target: '', valid: false },
  ])('target $label: valid = $valid', ({ target, valid }) => {
    const message = { type: 'castVote', target };
    expect(parseClientMessage(message)).toStrictEqual(valid ? { ok: true, value: message } : INVALID);
  });

  it('keeps the skip sentinel outside the PlayerId space', () => {
    expect(PlayerIdSchema.safeParse('skip').success).toBe(false);
  });
});

describe('parseClientMessage: quickChat', () => {
  const CHAT_PARAMS = { playerId: PLAYER, room: 'vault', proposalId: PROPOSAL } as const;
  type ChatParam = keyof typeof CHAT_PARAMS;
  const PARAM_SETS: readonly (readonly ChatParam[])[] = [
    [],
    ['playerId'],
    ['room'],
    ['proposalId'],
    ['playerId', 'room'],
    ['playerId', 'proposalId'],
    ['room', 'proposalId'],
    ['playerId', 'room', 'proposalId'],
  ];
  // The only parameter set each phrase accepts, per the spec.
  const REQUIRED_PARAMS: Readonly<Record<string, readonly ChatParam[]>> = {
    whereWereYou: [],
    iAgree: [],
    showEvidence: [],
    fixPartition: [],
    skipVote: [],
    sawAt: ['playerId', 'room'],
    suspect: ['playerId'],
    dontSign: ['proposalId'],
  };
  const CHAT_MATRIX = Object.entries(REQUIRED_PARAMS).flatMap(([phrase, required]) =>
    PARAM_SETS.map((params) => ({
      phrase,
      params: params.length === 0 ? 'no params' : params.join(' + '),
      chat: { phrase, ...Object.fromEntries(params.map((name) => [name, CHAT_PARAMS[name]])) },
      valid: params.length === required.length && params.every((name) => required.includes(name)),
    })),
  );

  it('accepts exactly one parameter set per phrase', () => {
    expect(CHAT_MATRIX).toHaveLength(64);
    expect(CHAT_MATRIX.filter(({ valid }) => valid)).toHaveLength(8);
  });

  it.each(CHAT_MATRIX)('$phrase with $params: valid = $valid', ({ chat, valid }) => {
    const message = { type: 'quickChat', chat };
    expect(parseClientMessage(message)).toStrictEqual(valid ? { ok: true, value: message } : INVALID);
  });

  it.each(ROOMS)('accepts sawAt in the %s room', (room) => {
    const message = { type: 'quickChat', chat: { phrase: 'sawAt', playerId: PLAYER, room } };
    expect(RoomSchema.safeParse(room).success).toBe(true);
    expect(parseClientMessage(message)).toStrictEqual({ ok: true, value: message });
  });

  it.each(['kitchen', 'Plaza', 'VAULT', 'vault ', '', 'constructor', '__proto__', 'toString'])(
    'rejects sawAt in room %j',
    (room) => {
      expect(RoomSchema.safeParse(room).success).toBe(false);
      expect(
        parseClientMessage({ type: 'quickChat', chat: { phrase: 'sawAt', playerId: PLAYER, room } }),
      ).toStrictEqual(INVALID);
    },
  );

  it.each([
    { label: 'an invented phrase', chat: { phrase: 'meet me in the vault' } },
    { label: 'text without a phrase', chat: { text: 'hello' } },
    { label: 'a message field on suspect', chat: { phrase: 'suspect', playerId: PLAYER, message: 'it was them' } },
    { label: 'a lower-cased preset', chat: { phrase: 'iagree' } },
    { label: 'a padded preset', chat: { phrase: 'iAgree ' } },
    { label: 'a prototype method name', chat: { phrase: 'toString' } },
    { label: "'__proto__' as the phrase", chat: { phrase: '__proto__' } },
    { label: "'constructor' as the phrase", chat: { phrase: 'constructor' } },
    { label: 'a null phrase', chat: { phrase: null } },
  ])('rejects $label', ({ chat }) => {
    expect(parseClientMessage({ type: 'quickChat', chat })).toStrictEqual(INVALID);
  });

  it('rejects free text sent in place of a chat', () => {
    expect(parseClientMessage({ type: 'quickChat', text: 'hello' })).toStrictEqual(INVALID);
  });
});

describe('parseClientMessage: non-object input', () => {
  const NON_OBJECTS: readonly RawCase[] = [
    { label: 'null', raw: null },
    { label: 'undefined', raw: undefined },
    { label: 'an empty array', raw: [] },
    { label: 'an array holding a valid message', raw: [{ type: 'callCouncil' }] },
    { label: 'an array carrying a type key', raw: Object.assign([], { type: 'callCouncil' }) },
    { label: 'a string', raw: 'callCouncil' },
    { label: 'an unparsed JSON string', raw: '{"type":"callCouncil"}' },
    { label: 'the empty string', raw: '' },
    { label: '0', raw: 0 },
    { label: '1', raw: 1 },
    { label: 'NaN', raw: Number.NaN },
    { label: 'true', raw: true },
    { label: 'false', raw: false },
    { label: 'a bigint', raw: 1n },
    { label: 'a symbol', raw: Symbol('callCouncil') },
    { label: 'a function', raw: () => ({ type: 'callCouncil' }) },
  ];

  it.each(NON_OBJECTS)('returns invalidMessage for $label', ({ raw }) => {
    expect(parseClientMessage(raw)).toStrictEqual(INVALID);
  });
});

describe('withinMessageLimit', () => {
  const EMOJI = '\u{1F600}';
  // Byte counts are worked out by hand: 1 per ASCII, 2 per é, 3 per €, 4 per emoji.
  const LIMIT_CASES: readonly { label: string; raw: string; bytes: number }[] = [
    { label: 'an empty frame', raw: '', bytes: 0 },
    { label: '1023 ASCII characters', raw: 'a'.repeat(1023), bytes: 1023 },
    { label: '1024 ASCII characters', raw: 'a'.repeat(1024), bytes: 1024 },
    { label: '1025 ASCII characters', raw: 'a'.repeat(1025), bytes: 1025 },
    { label: '1024 NUL characters', raw: '\0'.repeat(1024), bytes: 1024 },
    { label: '512 two-byte characters', raw: 'é'.repeat(512), bytes: 1024 },
    { label: '512 two-byte characters and one ASCII', raw: 'é'.repeat(512) + 'a', bytes: 1025 },
    { label: '341 three-byte characters and one ASCII', raw: '€'.repeat(341) + 'a', bytes: 1024 },
    { label: '342 three-byte characters', raw: '€'.repeat(342), bytes: 1026 },
    { label: 'an emoji ending exactly at byte 1024', raw: 'a'.repeat(1020) + EMOJI, bytes: 1024 },
    { label: 'an emoji straddling byte 1024', raw: 'a'.repeat(1021) + EMOJI, bytes: 1025 },
    { label: '256 emoji', raw: EMOJI.repeat(256), bytes: 1024 },
    { label: '256 emoji and one ASCII', raw: EMOJI.repeat(256) + 'a', bytes: 1025 },
    { label: 'a lone surrogate ending at byte 1024', raw: 'a'.repeat(1021) + '\uD83D', bytes: 1024 },
    { label: 'a lone surrogate ending past byte 1024', raw: 'a'.repeat(1022) + '\uD83D', bytes: 1025 },
    { label: 'a 1 MB frame', raw: 'a'.repeat(1_000_000), bytes: 1_000_000 },
  ];

  it.each(LIMIT_CASES)('handles $label ($bytes bytes)', ({ raw, bytes }) => {
    expect(withinMessageLimit(raw)).toBe(bytes <= 1024);
  });

  it('counts UTF-8 bytes, not UTF-16 code units', () => {
    const straddling = 'a'.repeat(1021) + EMOJI;
    expect(straddling.length).toBe(1023);
    expect(withinMessageLimit(straddling)).toBe(false);
    const euros = '€'.repeat(342);
    expect(euros.length).toBe(342);
    expect(withinMessageLimit(euros)).toBe(false);
  });

  it('accepts every valid message once serialised', () => {
    for (const { message } of VALID_MESSAGES) {
      expect(withinMessageLimit(JSON.stringify(message))).toBe(true);
    }
  });

  it.each([
    { label: 'null', raw: null },
    { label: 'undefined', raw: undefined },
    { label: 'a number', raw: 42 },
    { label: 'a length-1 object', raw: { length: 1 } },
    { label: 'a byte array', raw: new Uint8Array(4) },
  ])('rejects $label, which is not a string frame', ({ raw }) => {
    expect(withinMessageLimit(raw)).toBe(false);
  });

  it('rejects an oversized frame without UTF-8 encoding it', () => {
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    try {
      expect(withinMessageLimit('a'.repeat(1_000_000))).toBe(false);
      expect(withinMessageLimit('a'.repeat(MAX_MESSAGE_BYTES + 1))).toBe(false);
      expect(encode).not.toHaveBeenCalled();
    } finally {
      encode.mockRestore();
    }
  });
});

describe('parseClientMessage: move seq', () => {
  it.each([1, 2, 1_000_000, MAX_INPUT_SEQ])('accepts seq = %s', (seq) => {
    const message = { type: 'move', seq, dx: 1, dy: 0 };
    expect(parseClientMessage(message)).toStrictEqual({ ok: true, value: message });
  });

  it.each([
    { label: '0', seq: 0 },
    { label: '-1', seq: -1 },
    { label: 'a fraction', seq: 1.5 },
    { label: 'one past the cap', seq: MAX_INPUT_SEQ + 1 },
    { label: 'NaN', seq: Number.NaN },
    { label: 'Infinity', seq: Number.POSITIVE_INFINITY },
    { label: 'a numeric string', seq: '7' },
    { label: 'null', seq: null },
  ])('rejects seq = $label', ({ seq }) => {
    expect(parseClientMessage({ type: 'move', seq, dx: 1, dy: 0 })).toStrictEqual(INVALID);
  });

  it('rejects a move without seq', () => {
    expect(parseClientMessage({ type: 'move', dx: 1, dy: 0 })).toStrictEqual(INVALID);
  });
});

describe('CLIENT_MESSAGE_PAYLOADS', () => {
  it('has a validator for every client message type', () => {
    expect(Object.keys(CLIENT_MESSAGE_PAYLOADS).sort()).toStrictEqual([...SPEC_TYPES].sort());
  });

  it('accepts callCouncil with no payload or an empty object, and nothing else', () => {
    const schema = CLIENT_MESSAGE_PAYLOADS.callCouncil;
    expect(schema.safeParse(undefined).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ extra: 1 }).success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
  });

  it('validates a bare move payload with the same bounds as the tagged message', () => {
    expect(CLIENT_MESSAGE_PAYLOADS.move.safeParse({ seq: 3, dx: -1, dy: 1 }).success).toBe(true);
    expect(CLIENT_MESSAGE_PAYLOADS.move.safeParse({ seq: 3, dx: -1.01, dy: 1 }).success).toBe(false);
    expect(CLIENT_MESSAGE_PAYLOADS.move.safeParse({ seq: 3, dx: 0, dy: 0, type: 'move' }).success).toBe(false);
  });
});
