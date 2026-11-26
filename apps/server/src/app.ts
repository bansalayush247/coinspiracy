import { createServer, type Server as HttpServer } from 'node:http';
import { defineRoom, defineServer, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { MAX_MESSAGE_BYTES, ROOM_LOOKUP_PATH, ROOM_NAME, normalizeRoomCode, type RoomLookup } from '@byzantine-council/shared';
import { ACADEMY_ROOM } from '@byzantine-council/shared/progression';
import { SEASON_PATH, seasonReply } from '@byzantine-council/shared/seasons';
import { AcademyRoom } from './academy/AcademyRoom.js';
import { DEFAULT_MAX_BOTS_PER_PROCESS, installBotManager, loopbackEndpoint, shutdownBotManager, type BotProfile } from './bots/index.js';
import { CitadelRoom } from './CitadelRoom.js';
import { BeachRoom } from './hub/BeachRoom.js';
import { BEACH_ROOM } from '@byzantine-council/shared/hub';
import { CITY_ROOM, MISSION_ROOM } from '@byzantine-council/shared/city';
import { CityRoom } from './city/CityRoom.js';
import { MissionRoom } from './city/MissionRoom.js';
import { ipKey, requestIp, type ClientIpPolicy } from './clientIp.js';
import type { DiscordConfig } from './discord/config.js';
import type { FetchLike } from './discord/oauth.js';
import { createDiscordRouter, type DiscordRouter } from './discord/router.js';
import { installHttpGate, type HttpGate } from './httpGate.js';
import { log } from './logger.js';
import { configureRoomPolicy, roomPolicy, type RoomPolicyOptions } from './policy.js';
import { applyBearerSession } from './profile/bearer.js';
import { createProfileRouter, type ProfileRouter } from './profile/router.js';
import { roomIdForCode } from './roomCodes.js';
import { createScaling } from './scaling/index.js';
import { createFeedbackRouter, type FeedbackRouter, type FeedbackSink } from './feedback.js';

export interface GameServerOptions extends RoomPolicyOptions {
  readonly allowedOrigins: ReadonlySet<string>;
  readonly ipPolicy: ClientIpPolicy;
  // false in tests: Colyseus otherwise hooks SIGINT/SIGTERM and uncaughtException and exits.
  readonly gracefullyShutdown: boolean;
  readonly pingIntervalMs?: number;
  readonly codeLookupsPerMinute?: number;
  // Practice bots the host can add to a lobby; off when omitted.
  readonly bots?: { readonly profile?: BotProfile; readonly maxPerProcess?: number };
  /** Origins allowed to frame server responses (FRAME_ANCESTORS); absent keeps `'none'`. */
  readonly frameAncestors?: readonly string[];
  /** Discord Activity sign-in; absent or `off` means the token route does not exist. Needs `profiles`. */
  readonly discord?: { readonly config: DiscordConfig; readonly fetch?: FetchLike; readonly perNetworkPerMinute?: number };
  /** Where playtest feedback goes; absent means the feedback route does not exist. */
  readonly feedback?: { readonly sink: FeedbackSink; readonly perNetworkPer10Min?: number };
}

// Colyseus answers every OPTIONS itself and merges these into every HTTP response.
// Both overrides are needed: the defaults carry ACAO '*' and reflect any Origin with credentials.
// The SDK fetches with credentials: 'include', so allowed origins also get Allow-Credentials;
// the only cookie is the HTTP-only guest session from /api/session, and foreign origins get no CORS headers at all.
export function restrictCors(allowedOrigins: ReadonlySet<string>): void {
  const controller = matchMaker.controller as { DEFAULT_CORS_HEADERS: Record<string, string> };
  controller.DEFAULT_CORS_HEADERS = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  matchMaker.controller.getCorsHeaders = (headers: Headers) => {
    const origin = headers.get('origin');
    return origin !== null && allowedOrigins.has(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' }
      : {};
  };
}

export function createGameServer(options: GameServerOptions) {
  const httpServer: HttpServer = createServer();
  // Local to this process unless the caller passes Redis-backed scaling (started before listen()).
  const scaling = options.scaling ?? createScaling();
  configureRoomPolicy({ ...options, scaling });
  const lookups = scaling.rateLimiter('lookups', options.codeLookupsPerMinute ?? 30, 60_000);
  const seasons = scaling.rateLimiter('season', 60, 60_000);

  const transport = new WebSocketTransport({
    server: httpServer,
    // ws closes oversized frames with 1009 before Colyseus decodes them.
    maxPayload: MAX_MESSAGE_BYTES,
    pingInterval: options.pingIntervalMs ?? 3000,
    pingMaxRetries: 2,
    // Browsers apply no CORS to WebSockets, so the Origin allowlist is enforced here.
    beforeUpgrade: (request) => {
      const origin = request.headers.get('origin');
      if (origin === null || !options.allowedOrigins.has(origin)) return new Response(null, { status: 403 });
      return undefined;
    },
  });

  restrictCors(options.allowedOrigins);
  const profileApi: ProfileRouter | null =
    options.profiles == null ? null : createProfileRouter({ store: options.profiles.store, keys: options.profiles.keys, allowedOrigins: options.allowedOrigins });
  const discordApi: DiscordRouter | null =
    options.profiles == null || options.discord === undefined
      ? null
      : createDiscordRouter({
          config: options.discord.config,
          keys: options.profiles.keys,
          allowedOrigins: options.allowedOrigins,
          perNetwork: scaling.rateLimiter('discord', options.discord.perNetworkPerMinute ?? 20, 60_000),
          overall: scaling.rateLimiter('discordAll', 600, 60_000),
          ...(options.discord.fetch === undefined ? {} : { fetch: options.discord.fetch }),
        });
  const feedbackApi: FeedbackRouter | null =
    options.feedback === undefined
      ? null
      : createFeedbackRouter({
          sink: options.feedback.sink,
          allowedOrigins: options.allowedOrigins,
          perNetwork: scaling.rateLimiter('feedback', options.feedback.perNetworkPer10Min ?? 6, 600_000),
          overall: scaling.rateLimiter('feedbackAll', 600, 3_600_000),
        });
  const sessionKeys = options.profiles?.keys ?? null;

  const server = defineServer({
    rooms: { [ROOM_NAME]: defineRoom(CitadelRoom), [ACADEMY_ROOM]: defineRoom(AcademyRoom), [BEACH_ROOM]: defineRoom(BeachRoom), [CITY_ROOM]: defineRoom(CityRoom), [MISSION_ROOM]: defineRoom(MissionRoom) },
    transport,
    presence: scaling.presence,
    driver: scaling.driver,
    ...(scaling.publicAddress === undefined ? {} : { publicAddress: scaling.publicAddress }),
    greet: false,
    gracefullyShutdown: options.gracefullyShutdown,
    express: (app) => {
      app.disable('x-powered-by');
      // Own "/" so Colyseus does not answer it with its version string.
      app.get('/', (_req, res) => {
        res.type('text/plain').send('Byzantine Council game server');
      });
      app.get('/healthz', (_req, res) => {
        res.json({ ok: true });
      });
      if (profileApi !== null) app.use(profileApi.router);
      if (discordApi !== null) app.use(discordApi.router);
      if (feedbackApi !== null) app.use(feedbackApi.router);
      // The featured seasonal event for the menu banner; the same for everyone, so caches may keep it a minute.
      app.get(SEASON_PATH, async (req, res) => {
        if (!(await seasons.take(ipKey(requestIp(req))))) {
          res.status(429).json({ error: 'rate_limited' });
          return;
        }
        const tip = roomPolicy().chain.current();
        res.set('Cache-Control', 'public, max-age=60').json(seasonReply(tip.height, tip.live, Date.now()));
      });
      app.get(`${ROOM_LOOKUP_PATH}/:code`, async (req, res) => {
        if (!(await lookups.take(ipKey(requestIp(req))))) {
          res.status(429).json({ error: 'rate_limited' });
          return;
        }
        const code = normalizeRoomCode(req.params.code);
        if (code === null) {
          res.status(400).json({ error: 'bad_code' });
          return;
        }
        const roomId = await roomIdForCode(matchMaker.presence, code);
        const listing = roomId === null ? undefined : await matchMaker.getRoomById(roomId);
        if (listing === undefined) {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        // Locked means full or mid-match; either way there is no seat to offer.
        if (listing.locked) {
          res.status(409).json({ error: 'room_unavailable' });
          return;
        }
        const reply: RoomLookup = { kind: listing.name === MISSION_ROOM ? 'story' : 'council', roomId: listing.roomId, players: listing.clients, maxPlayers: listing.maxClients };
        res.json(reply);
      });
    },
  });

  // Single slot: a later onShutdown() call replaces this one.
  server.onShutdown(() => {
    void shutdownBotManager();
    lookups.stop();
    seasons.stop();
    profileApi?.stop();
    discordApi?.stop();
    feedbackApi?.stop();
    roomPolicy().chain.stop();
    void roomPolicy().ipSlots.stop();
    // Colyseus has closed presence and the driver by now; this stops the lane's own timers and connection.
    void scaling.stop();
    log.info('server shut down');
  });

  // After listen(): Colyseus installs its own 'request' listener inside listen().
  let gate: HttpGate | null = null;
  const listen = async (port: number, host: string): Promise<void> => {
    await server.listen(port, host);
    roomPolicy().chain.start();
    gate = installHttpGate(httpServer, {
      ipPolicy: options.ipPolicy,
      allowedOrigins: options.allowedOrigins,
      maxMatchmakeBodyBytes: 2048,
      // Each seat needs one socket, plus headroom for a reconnect overlapping the old socket.
      maxSocketsPerIp: 2 * (options.maxSeatsPerIp ?? 16),
      ...(options.frameAncestors === undefined ? {} : { frameAncestors: options.frameAncestors }),
      ...(sessionKeys === null
        ? {}
        : {
            normalizeCredentials: (req, upgrade) => {
              applyBearerSession(sessionKeys, req, Date.now(), upgrade);
            },
          }),
    });
    if (options.bots !== undefined) startBots(port, host);
  };

  // Bots are SDK clients dialling this process on loopback with an allowed Origin, so every room rule applies to them.
  const startBots = (port: number, host: string): void => {
    const bots = options.bots;
    const endpoint = loopbackEndpoint(host, port);
    const origin = [...options.allowedOrigins][0];
    if (bots === undefined || endpoint === null || origin === undefined) {
      log.warn('practice bots are off: the server is not reachable on loopback');
      return;
    }
    // Bots share loopback's per-network socket budget, so stay under it.
    const cap = Math.min(bots.maxPerProcess ?? DEFAULT_MAX_BOTS_PER_PROCESS, options.maxSeatsPerIp ?? 16);
    installBotManager({
      endpoint,
      origin,
      social: true,
      maxBotsPerProcess: cap,
      taskTiming: roomPolicy().taskTiming,
      ...(bots.profile === undefined ? {} : { profile: bots.profile }),
    });
    log.info('practice bots on', { maxBots: cap });
  };
  const openSockets = (key: string): number => gate?.openSockets(key) ?? 0;

  return { server, httpServer, listen, openSockets };
}
