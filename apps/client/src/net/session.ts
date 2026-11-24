import { Client, type Room } from '@colyseus/sdk';
import { ACADEMY_ROOM } from '@byzantine-council/shared/progression';
import { ROOM_LOOKUP_PATH, ROOM_NAME, RoomLookupSchema, normalizeRoomCode } from '@byzantine-council/shared';
import { CitadelState } from '@byzantine-council/shared/state';
import { BEACH_ROOM, HubState } from '@byzantine-council/shared/hub';
import { CITY_ROOM, CityState } from '@byzantine-council/shared/city';
import type { ServerEndpoint } from '../serverUrl.js';
import { PlayerFacingError } from './errors.js';

// The SDK sets no timeout on matchmaking or the socket handshake.
export const JOIN_TIMEOUT_MS = 15_000;
const LOOKUP_TIMEOUT_MS = 8_000;
// sessionStorage only: the token is a bearer credential for a live seat.
const TOKEN_KEY = 'bc.reconnect';

function openRoom(client: Client, nickname: string) {
  return client.joinOrCreate<CitadelState>(ROOM_NAME, { nickname }, CitadelState);
}
export type GameRoom = Awaited<ReturnType<typeof openRoom>>;

export const tokenStore = {
  save(token: string): void {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      // storage blocked: reloads simply start fresh
    }
  },
  load(): string | null {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  clear(): void {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // storage blocked
    }
  },
};

// Races a join against a timeout; a join that lands after the timeout is left at once.
function withTimeout<R extends { leave(): Promise<unknown> }>(attempt: Promise<R>): Promise<R> {
  let timedOut = false;
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      timedOut = true;
      reject(new PlayerFacingError('The game server isn’t responding. Try again in a moment.'));
    }, JOIN_TIMEOUT_MS);
  });
  attempt.then(
    (room) => {
      window.clearTimeout(timer);
      if (timedOut) void room.leave();
    },
    () => {
      window.clearTimeout(timer);
    },
  );
  return Promise.race([attempt, timeout]);
}

export class Session {
  readonly #client: Client;

  constructor(readonly server: ServerEndpoint) {
    this.#client = new Client(server.endpoint);
  }

  quickMatch(nickname: string): Promise<GameRoom> {
    return withTimeout(openRoom(this.#client, nickname));
  }

  createPrivate(nickname: string): Promise<GameRoom> {
    return withTimeout(this.#client.create<CitadelState>(ROOM_NAME, { nickname, private: true }, CitadelState));
  }

  async joinByCode(rawCode: string, nickname: string): Promise<GameRoom> {
    const roomId = await this.lookup(rawCode);
    return withTimeout(this.#client.joinById<CitadelState>(roomId, { nickname }, CitadelState));
  }

  // A private solo room for the Academy.
  academy(): Promise<Room> {
    return withTimeout(this.#client.create(ACADEMY_ROOM, {}));
  }

  // Beach Town: one public hub room shared by whoever is in town.
  beach(nickname: string) {
    return withTimeout(this.#client.joinOrCreate<HubState>(BEACH_ROOM, { nickname }, HubState));
  }

  // Port Concord: the open city, one region room shared by everyone in it.
  city(nickname: string) {
    return withTimeout(this.#client.joinOrCreate<CityState>(CITY_ROOM, { nickname }, CityState));
  }

  resume(token: string): Promise<GameRoom> {
    return withTimeout(this.#client.reconnect<CitadelState>(token, CitadelState));
  }

  // Resolves a typed code to a room id through the server's rate-limited lookup.
  async lookup(rawCode: string): Promise<string> {
    const code = normalizeRoomCode(rawCode);
    if (code === null) throw new PlayerFacingError('Room codes are 6 letters and numbers, like K7Q-X9M.');
    let res: Response;
    try {
      res = await fetch(`${this.server.httpBase}${ROOM_LOOKUP_PATH}/${code}`, {
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      });
    } catch {
      throw new PlayerFacingError('Can’t reach the game server. Check your connection and try again.');
    }
    if (res.status === 404) throw new PlayerFacingError('No room has that code. Check it and try again.');
    if (res.status === 409) throw new PlayerFacingError('That room is full, or a match is already underway there.');
    if (res.status === 429) throw new PlayerFacingError('Too many attempts. Wait a minute, then try again.');
    if (!res.ok) throw new PlayerFacingError('Couldn’t look up that room. Try again.');
    const parsed = RoomLookupSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new PlayerFacingError('Couldn’t look up that room. Try again.');
    return parsed.data.roomId;
  }
}
