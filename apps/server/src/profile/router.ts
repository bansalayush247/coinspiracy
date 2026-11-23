// Guest profile API. JSON only, bounded bodies, zod at the edge, per-network and per-profile limits.
// Responses never include the profile id, which lives only in the HTTP-only cookie.
import { Router, json, type NextFunction, type Request, type Response } from 'express';
import { cryptoRandom } from '@byzantine-council/shared';
import { ItemIdSchema, LookSchema, NoteSelectionSchema, ShopIdSchema, balanceOf, checkLook, checkPurchase, payWithNotes, type Look } from '@byzantine-council/shared/economy';
import { z } from 'zod';
import { RerollPayloadSchema, SelectFramePayloadSchema, SelectTitlePayloadSchema, rerollQuest, selectFrame, selectTitle, toProgressView, type TitleId } from '@byzantine-council/shared/progression';
import { ipKey, requestIp } from '../clientIp.js';
import { log } from '../logger.js';
import { FixedWindowLimiter } from '../rateLimit.js';
import { newProfileId, readCookie, setCookieHeader, signCookie, verifyCookie, type SessionKeys } from './session.js';
import { loadProfile, type ProfileData, type ProfileStore } from './store.js';

export interface ProfileRouterOptions {
  readonly store: ProfileStore;
  readonly keys: SessionKeys;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly now?: () => number;
}

export interface ProfileRouter {
  readonly router: Router;
  stop(): void;
}

interface Located {
  readonly id: string;
}

export function profileSummary(data: ProfileData, nowMs: number) {
  return {
    balance: balanceOf(data.wallet),
    notes: [...data.wallet],
    look: data.look,
    owned: [...data.owned],
    progress: toProgressView(data.progress, nowMs),
  };
}

export function createProfileRouter(options: ProfileRouterOptions): ProfileRouter {
  const now = options.now ?? Date.now;
  const router = Router();
  // New guests per network per hour, and requests per network and per profile per minute.
  const newGuests = new FixedWindowLimiter(20, 3_600_000);
  const perNetwork = new FixedWindowLimiter(120, 60_000);
  const perProfile = new FixedWindowLimiter(60, 60_000);
  const body = json({ limit: '1kb', strict: true, type: 'application/json' });

  const limited = (req: Request, res: Response, next: NextFunction): void => {
    if (!perNetwork.take(ipKey(requestIp(req)))) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    next();
  };

  // Cookie-authenticated writes must come from our own pages: an allowed Origin and a JSON body.
  const writeGuard = (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (origin === undefined || !options.allowedOrigins.has(origin)) {
      res.status(403).json({ error: 'origin_not_allowed' });
      return;
    }
    if ((req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      res.status(415).json({ error: 'json_required' });
      return;
    }
    next();
  };

  // The signed-in guest, renewing their cookie when it is old or signed with the previous key.
  const session = (req: Request, res: Response): Located | null => {
    const value = readCookie(req.headers.cookie);
    const s = value === null ? null : verifyCookie(options.keys, value, now());
    if (s === null) return null;
    if (!perProfile.take(s.id)) {
      res.status(429).json({ error: 'rate_limited' });
      return { id: '' };
    }
    if (s.renew) res.setHeader('Set-Cookie', setCookieHeader(options.keys, signCookie(options.keys, s.id, now())));
    return { id: s.id };
  };

  const fail = (res: Response, error: unknown): void => {
    log.error('profile request failed', error);
    if (!res.headersSent) res.status(500).json({ error: 'server_error' });
  };

  router.post('/api/session', limited, writeGuard, (req, res) => {
    const existing = session(req, res);
    if (existing?.id === '') return;
    let id = existing?.id ?? null;
    if (id === null) {
      if (!newGuests.take(ipKey(requestIp(req)))) {
        res.status(429).json({ error: 'rate_limited' });
        return;
      }
      id = newProfileId();
      res.setHeader('Set-Cookie', setCookieHeader(options.keys, signCookie(options.keys, id, now())));
    }
    loadProfile(options.store, id, now())
      .then((data) => res.json(profileSummary(data, now())))
      .catch((error: unknown) => {
        fail(res, error);
      });
  });

  router.get('/api/profile', limited, (req, res) => {
    const s = session(req, res);
    if (s?.id === '') return;
    if (s === null) {
      res.status(401).json({ error: 'no_session' });
      return;
    }
    loadProfile(options.store, s.id, now())
      .then((data) => res.json(profileSummary(data, now())))
      .catch((error: unknown) => {
        fail(res, error);
      });
  });

  // One write route per progression choice; the shared rules decide whether it is allowed.
  const choice = <P>(path: string, parse: (raw: unknown) => P | null, apply: (data: ProfileData, payload: P) => ProfileData | null): void => {
    router.post(path, limited, writeGuard, body, (req, res) => {
      const s = session(req, res);
      if (s?.id === '') return;
      if (s === null) {
        res.status(401).json({ error: 'no_session' });
        return;
      }
      const payload = parse(req.body);
      if (payload === null) {
        res.status(400).json({ error: 'bad_request' });
        return;
      }
      options.store
        .change(s.id, null, now(), (data) => {
          const next = apply(data, payload);
          return next === null ? null : { data: next, result: next };
        })
        .then((out) => {
          if (out.ok) res.json(profileSummary(out.result, now()));
          else res.status(409).json({ error: 'not_allowed' });
        })
        .catch((error: unknown) => {
          fail(res, error);
        });
    });
  };

  choice(
    '/api/progress/title',
    (raw) => {
      const r = SelectTitlePayloadSchema.safeParse(raw);
      return r.success ? (r.data.title as TitleId | null) : null;
    },
    (data, title) => {
      const progress = selectTitle(data.progress, title);
      return progress === null ? null : { ...data, progress };
    },
  );
  choice(
    '/api/progress/frame',
    (raw) => {
      const r = SelectFramePayloadSchema.safeParse(raw);
      return r.success ? (r.data.frame) : null;
    },
    (data, frame) => {
      const progress = selectFrame(data.progress, frame);
      return progress === null ? null : { ...data, progress };
    },
  );
  choice(
    '/api/progress/reroll',
    (raw) => {
      const r = RerollPayloadSchema.safeParse(raw);
      return r.success ? r.data.quest : null;
    },
    (data, quest) => {
      const progress = rerollQuest(data.progress, quest, cryptoRandom, now());
      return progress === null ? null : { ...data, progress };
    },
  );

  // The wardrobe: wear only items this guest owns (or the free defaults).
  const WearPayloadSchema = z.strictObject({ look: LookSchema });
  choice(
    '/api/look',
    (raw): Look | null => {
      const r = WearPayloadSchema.safeParse(raw);
      return r.success ? (r.data.look) : null;
    },
    (data, look) => {
      const checked = checkLook(look, new Set(data.owned));
      return checked.ok ? { ...data, look: checked.value } : null;
    },
  );

  // Shops: pay with the notes you choose; overpaying by a whole note is refused, and change is reissued.
  const BuyPayloadSchema = z.strictObject({ item: ItemIdSchema, shop: ShopIdSchema, notes: NoteSelectionSchema });
  choice(
    '/api/shop/buy',
    (raw) => {
      const r = BuyPayloadSchema.safeParse(raw);
      return r.success ? r.data : null;
    },
    (data, buy) => {
      const quote = checkPurchase(buy.item, buy.shop, new Set(data.owned));
      if (!quote.ok) return null;
      const paid = payWithNotes(data.wallet, buy.notes, quote.value.price);
      if (!paid.ok) return null;
      // Food is eaten on the spot; cosmetics join the wardrobe.
      const owned = quote.value.item.category === 'food' ? data.owned : [...data.owned, quote.value.item.id];
      return { ...data, wallet: paid.value.wallet, owned };
    },
  );

  return {
    router,
    stop() {
      newGuests.stop();
      perNetwork.stop();
      perProfile.stop();
    },
  };
}
