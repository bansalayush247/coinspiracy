import { Client, type Room } from '@colyseus/sdk';
import { ACADEMY_ROOM } from '@byzantine-council/shared/progression';
import { ROOM_LOOKUP_PATH, ROOM_NAME, RoomLookupSchema, normalizeRoomCode, type RoomLookup } from '@byzantine-council/shared';
import { CitadelState } from '@byzantine-council/shared/state';
import { BEACH_ROOM, HubState } from '@byzantine-council/shared/hub';
import { CITY_ROOM, CityState, MISSION_ROOM, MissionState, type ActId } from '@byzantine-council/shared/city';
import type { PlatformNetwork } from '../platform/types.js';
import type { ServerEndpoint } from '../serverUrl.js';
import { t } from '../i18n/index.js';
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
      reject(new PlayerFacingError(t('join.notResponding')));
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
  readonly #signedIn: Promise<void> | null;

  constructor(
    readonly server: ServerEndpoint,
    network: PlatformNetwork | null = null,
  ) {
    this.#client = network?.urlBuilder === undefined ? new Client(server.endpoint) : new Client(server.endpoint, { urlBuilder: network.urlBuilder });
    this.#signedIn =
      network === null
        ? null
        : network.credential.then((credential) => {
            if (credential.kind === 'bearer') this.#client.auth.token = credential.token;
          });
  }

  // Hosts without cookies (Discord) sign in first; joins wait for it so the socket carries the session token.
  #open<R extends { leave(): Promise<unknown> }>(join: () => Promise<R>): Promise<R> {
    return withTimeout(this.#signedIn === null ? join() : this.#signedIn.then(join));
  }

  quickMatch(nickname: string): Promise<GameRoom> {
    return this.#open(() => openRoom(this.#client, nickname));
  }

  // A private council room; `ceremony` marks it as the story's signing ceremony, opened from the end of act three.
  createPrivate(nickname: string, ceremony = false): Promise<GameRoom> {
    return this.#open(() => this.#client.create<CitadelState>(ROOM_NAME, ceremony ? { nickname, private: true, ceremony } : { nickname, private: true }, CitadelState));
  }

  // Joins a council room found by its code; a story crew's code goes to mission() instead.
  joinCouncil(roomId: string, nickname: string): Promise<GameRoom> {
    return this.#open(() => this.#client.joinById<CitadelState>(roomId, { nickname }, CitadelState));
  }

  // A private solo room for the Academy.
  academy(): Promise<Room> {
    return this.#open(() => this.#client.create(ACADEMY_ROOM, {}));
  }

  // Beach Town: one public hub room shared by whoever is in town.
  beach(nickname: string) {
    return this.#open(() => this.#client.joinOrCreate<HubState>(BEACH_ROOM, { nickname }, HubState));
  }

  // Port Concord: the open city, one region room shared by everyone in it.
  city(nickname: string) {
    return this.#open(() => this.#client.joinOrCreate<CityState>(CITY_ROOM, { nickname }, CityState));
  }

  // A story mission: a private night in Port Concord, a fresh one of the given act or a crew joined by room id.
  mission(nickname: string, start: { readonly act?: ActId; readonly roomId?: string }) {
    const { act, roomId } = start;
    return this.#open(() =>
      roomId === undefined
        ? this.#client.create<MissionState>(MISSION_ROOM, act === undefined ? { nickname } : { nickname, act }, MissionState)
        : this.#client.joinById<MissionState>(roomId, { nickname }, MissionState),
    );
  }

  resume(token: string): Promise<GameRoom> {
    return this.#open(() => this.#client.reconnect<CitadelState>(token, CitadelState));
  }

  // Resolves a typed code to a room through the server's rate-limited lookup.
  async lookup(rawCode: string): Promise<RoomLookup> {
    const code = normalizeRoomCode(rawCode);
    if (code === null) throw new PlayerFacingError(t('menu.badCode'));
    let res: Response;
    try {
      res = await fetch(`${this.server.httpBase}${ROOM_LOOKUP_PATH}/${code}`, {
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      });
    } catch {
      throw new PlayerFacingError(t('join.unreachable'));
    }
    if (res.status === 404) throw new PlayerFacingError(t('join.noRoom'));
    if (res.status === 409) throw new PlayerFacingError(t('join.underway'));
    if (res.status === 429) throw new PlayerFacingError(t('join.lookupRateLimited'));
    if (!res.ok) throw new PlayerFacingError(t('join.lookupFailed'));
    const parsed = RoomLookupSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new PlayerFacingError(t('join.lookupFailed'));
    return parsed.data;
  }
}
