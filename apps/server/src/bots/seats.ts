// One-shot seat tickets for bot reservations. The bot manager issues one for each seat it reserves
// server-side; CitadelRoom.onAuth claims it to exempt that seat from per-network limits. Nothing
// a client sends can create a ticket, so the exemption cannot be reached from outside.
import { isIPv4 } from 'node:net';

// Outlives the 8 s seat reservation window with a little slack.
export const BOT_TICKET_TTL_MS = 10_000;
// Bounds memory even if joins keep failing before their tickets are claimed.
export const MAX_BOT_TICKETS = 256;
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

interface Ticket {
  readonly roomId: string;
  readonly expiresAt: number;
}

// Bots dial the server on loopback; a proxied client always carries its real address.
export function isLoopbackAddress(ip: unknown): boolean {
  if (typeof ip !== 'string') return false;
  const v = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return v === '::1' || (isIPv4(v) && v.startsWith('127.'));
}

export class BotSeatTickets {
  readonly #tickets = new Map<string, Ticket>();

  constructor(
    readonly ttlMs = BOT_TICKET_TTL_MS,
    readonly max = MAX_BOT_TICKETS,
    readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.#tickets.size;
  }

  // False when the id is malformed or the store is full of live tickets.
  issue(sessionId: string, roomId: string): boolean {
    if (!SESSION_ID.test(sessionId) || !SESSION_ID.test(roomId)) return false;
    if (this.#tickets.size >= this.max) this.sweep();
    if (this.#tickets.size >= this.max) return false;
    this.#tickets.set(sessionId, { roomId, expiresAt: this.now() + this.ttlMs });
    return true;
  }

  // True once for a live ticket of this room, presented from loopback; any attempt burns the ticket.
  claim(sessionId: unknown, roomId: unknown, ip: unknown): boolean {
    if (typeof sessionId !== 'string' || typeof roomId !== 'string') return false;
    const ticket = this.#tickets.get(sessionId);
    if (ticket === undefined) return false;
    this.#tickets.delete(sessionId);
    return ticket.roomId === roomId && ticket.expiresAt > this.now() && isLoopbackAddress(ip);
  }

  revoke(sessionId: string): void {
    this.#tickets.delete(sessionId);
  }

  sweep(): void {
    const now = this.now();
    for (const [id, ticket] of this.#tickets) if (ticket.expiresAt <= now) this.#tickets.delete(id);
  }
}

// Process-wide store shared by the bot manager and every room.
const processTickets = new BotSeatTickets();

export function botSeatTickets(): BotSeatTickets {
  return processTickets;
}

// For CitadelRoom.onAuth: true only for a seat the bot manager reserved (see docs/lanes/bots.md).
export function claimBotSeat(sessionId: unknown, roomId: unknown, ip: unknown): boolean {
  return processTickets.claim(sessionId, roomId, ip);
}
