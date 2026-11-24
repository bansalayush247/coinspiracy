// The solo Academy: one player, one level at a time. The server generates every drill and checks
// every answer with the same timing rules as match tasks; stars and rewards are decided here.
import { randomBytes } from 'node:crypto';
import { ErrorCode, Room, ServerError, validate, type AuthContext, type Client } from '@colyseus/core';
import { CLOSE_CODES, NoPayloadSchema, checkDrill, cryptoRandom, generateDrill, isTaskKind, type DrillAnswer, type DrillChallenge, type DrillKind } from '@byzantine-council/shared';
import {
  ACADEMY_DRILL_EXPIRE_MS,
  ACADEMY_LEVEL_LIMIT_MS,
  ACADEMY_MESSAGES,
  ACADEMY_RETRY_MS,
  AcademyAnswerSchema,
  AcademyJoinSchema,
  AcademyStartSchema,
  academyLevel,
  academyLevelOpen,
  starsFor,
  type AcademyDone,
  type AcademyDrill,
  type AcademyRefused,
  type AcademyResult,
  type Award,
} from '@byzantine-council/shared/progression';
import { ipKey } from '../clientIp.js';
import { log } from '../logger.js';
import { roomPolicy } from '../policy.js';
import { holdSeat } from '../scaling/index.js';
import { awardAcademy } from '../profile/rewards.js';
import { profileIdFromCookieHeader } from '../profile/session.js';
import { loadProfile } from '../profile/store.js';

interface Auth {
  readonly ipKey: string;
  readonly profileId: string | null;
}
type AcademyClient = Client<{ auth: Auth }>;

interface Run {
  readonly id: string;
  readonly level: number;
  readonly drills: readonly DrillKind[];
  readonly startedAt: number;
  index: number;
  mistakes: number;
  drill: { readonly id: string; readonly kind: DrillKind; readonly challenge: DrillChallenge; readonly openedAt: number } | null;
  // No answers are taken until this time after a wrong one.
  lockedUntil: number;
}

function clock(): number {
  return performance.now();
}

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = cryptoRandom.int(i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export class AcademyRoom extends Room<{ client: AcademyClient }> {
  override maxClients = 1;
  override maxMessagesPerSecond = 10;
  override seatReservationTimeout = 8;
  #run: Run | null = null;
  #busy = false;

  override messages = {
    start: validate(AcademyStartSchema, (client: AcademyClient, payload: { level: number }) => {
      void this.#start(client, payload.level);
    }),
    answer: validate(AcademyAnswerSchema, (client: AcademyClient, payload: { id: string; answer: DrillAnswer }) => {
      void this.#answer(client, payload.id, payload.answer);
    }),
    quit: validate(NoPayloadSchema, () => {
      this.#run = null;
    }),
  };

  static override async onAuth(_token: string, options: unknown, context: AuthContext): Promise<true> {
    const key = ipKey(context.ip);
    const policy = roomPolicy();
    if (!(await policy.matchmake.take(key)) || !(await policy.reservations.take(key))) {
      throw new ServerError(CLOSE_CODES.RATE_LIMITED, 'Too many attempts. Wait a moment and try again.');
    }
    if (!AcademyJoinSchema.safeParse(options).success) throw new ServerError(ErrorCode.AUTH_FAILED, 'Invalid options.');
    return true;
  }

  override async onCreate(): Promise<void> {
    // Solo rooms are never offered to anyone else.
    await this.setPrivate(true);
    // A forgotten tab cannot hold a room open for ever.
    this.clock.setTimeout(() => {
      void this.disconnect();
    }, 30 * 60_000);
  }

  override async onAuth(client: AcademyClient, _options: unknown, context: AuthContext): Promise<Auth> {
    const key = ipKey(context.ip);
    const { ipSlots, profiles } = roomPolicy();
    // Academy rooms count against the same per-network seat cap as matches.
    if (!(await holdSeat(ipSlots, key, client.ref))) throw new ServerError(CLOSE_CODES.TOO_MANY_CONNECTIONS, 'Too many players from your network.');
    const profileId = profiles === null ? null : profileIdFromCookieHeader(profiles.keys, context.headers.get('cookie'), Date.now());
    return { ipKey: key, profileId };
  }

  #refuse(client: AcademyClient, reason: AcademyRefused['reason']): void {
    client.send(ACADEMY_MESSAGES.REFUSED, { reason } satisfies AcademyRefused);
  }

  async #start(client: AcademyClient, level: number): Promise<void> {
    if (this.#busy) return;
    const def = academyLevel(level);
    if (def === undefined) {
      this.#refuse(client, 'unknownLevel');
      return;
    }
    // With a profile, a level opens with its island, then once the island's level before it is cleared.
    const { profiles } = roomPolicy();
    const profileId = client.auth?.profileId ?? null;
    if (profiles !== null && profileId !== null && level > 1) {
      this.#busy = true;
      try {
        const data = await loadProfile(profiles.store, profileId, Date.now());
        if (!academyLevelOpen(level, data.progress.xp, data.progress.academy)) {
          this.#refuse(client, 'locked');
          return;
        }
      } finally {
        this.#busy = false;
      }
    }
    const drills = level === 5 ? shuffled(def.drills) : [...def.drills];
    this.#run = { id: randomBytes(9).toString('base64url'), level, drills, startedAt: clock(), index: 0, mistakes: 0, drill: null, lockedUntil: 0 };
    this.#nextDrill(client);
  }

  #nextDrill(client: AcademyClient): void {
    const run = this.#run;
    if (run === null) return;
    const kind = run.drills[run.index];
    if (kind === undefined) return;
    const challenge = generateDrill(kind, cryptoRandom, { tipHeight: roomPolicy().chain.current().height });
    run.drill = { id: randomBytes(9).toString('base64url'), kind, challenge, openedAt: clock() };
    client.send(ACADEMY_MESSAGES.DRILL, { id: run.drill.id, level: run.level, index: run.index, total: run.drills.length, challenge } satisfies AcademyDrill);
  }

  async #answer(client: AcademyClient, id: string, answer: DrillAnswer): Promise<void> {
    const run = this.#run;
    const drill = run?.drill ?? null;
    if (run === null || drill === null || drill.id !== id || answer.kind !== drill.kind) return;
    const now = clock();
    if (now - run.startedAt > ACADEMY_LEVEL_LIMIT_MS) {
      this.#run = null;
      this.#refuse(client, 'timedOut');
      return;
    }
    // Too fast for a person, or still locked out after a mistake: ignored, like match tasks.
    const policy = roomPolicy();
    const minMs = isTaskKind(drill.kind) ? policy.taskTiming.minSolveMs[drill.kind] : policy.islandDrillMinMs[drill.kind];
    if (now < drill.openedAt + minMs || now < run.lockedUntil) return;
    if (now > drill.openedAt + ACADEMY_DRILL_EXPIRE_MS || !checkDrill(drill.challenge, answer)) {
      run.mistakes += 1;
      run.lockedUntil = now + ACADEMY_RETRY_MS;
      run.drill = null;
      client.send(ACADEMY_MESSAGES.RESULT, { id, ok: false, retryInMs: ACADEMY_RETRY_MS } satisfies AcademyResult);
      // A fresh drill of the same kind after the lockout, so guessing the same one again is impossible.
      this.clock.setTimeout(() => {
        if (this.#run === run) this.#nextDrill(client);
      }, ACADEMY_RETRY_MS);
      return;
    }
    client.send(ACADEMY_MESSAGES.RESULT, { id, ok: true } satisfies AcademyResult);
    run.drill = null;
    run.index += 1;
    if (run.index < run.drills.length) {
      this.#nextDrill(client);
      return;
    }
    this.#run = null;
    const def = academyLevel(run.level);
    const timeMs = Math.round(now - run.startedAt);
    const parMs = def?.parMs ?? 0;
    const stars = starsFor(run.mistakes, timeMs, parMs);
    const { profiles } = roomPolicy();
    const profileId = client.auth?.profileId ?? null;
    let award: Award | null = null;
    if (profiles !== null && profileId !== null) {
      try {
        award = await awardAcademy(profiles.store, profileId, run.id, run.level, stars, Date.now(), roomPolicy().chain.current().height);
      } catch (error) {
        log.error('academy award failed', error);
      }
    }
    client.send(ACADEMY_MESSAGES.DONE, { level: run.level, stars, mistakes: run.mistakes, timeMs: Math.min(timeMs, 3_600_000), parMs, award } satisfies Omit<AcademyDone, 'award'> & { award: Award | null });
  }
}
