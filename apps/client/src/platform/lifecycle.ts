/** Reasons the game can be silenced at once; output resumes only when none remain. */
export type HoldReason = 'hidden' | 'portal';

/** Reference-counted audio holds. */
export interface Holds {
  set(reason: HoldReason, on: boolean): void;
  readonly held: boolean;
}

/** Calls `apply` only when the combined state changes. */
export function createHolds(apply: (held: boolean) => void): Holds {
  const active = new Set<HoldReason>();
  return {
    set(reason, on) {
      const before = active.size > 0;
      if (on) active.add(reason);
      else active.delete(reason);
      const after = active.size > 0;
      if (before !== after) apply(after);
    },
    get held() {
      return active.size > 0;
    },
  };
}

/** The slice of `document` the page-visibility hold reads. */
export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
}

/** Pauses and mutes while the page is hidden (a minimised Activity, a backgrounded portal tab). */
export function holdWhileHidden(doc: VisibilitySource, holds: Holds): void {
  const sync = (): void => {
    holds.set('hidden', doc.hidden);
  };
  doc.addEventListener('visibilitychange', sync);
  sync();
}

/** The absolute http(s) URL of a link to another origin, or null for same-origin and non-web links. */
export function externalUrl(href: string, pageOrigin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, pageOrigin);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return url.origin === pageOrigin ? null : url.href;
}

/** What the link policy needs from a click: the nearest link's href. */
export interface LinkClick {
  readonly target: unknown;
  preventDefault(): void;
}

function linkHref(target: unknown): string | null {
  const closest = (target as { closest?: unknown } | null)?.closest;
  if (typeof closest !== 'function') return null;
  const link: unknown = (closest as (selector: string) => unknown).call(target, 'a[href]');
  const href = (link as { getAttribute?: unknown } | null)?.getAttribute;
  return typeof href === 'function' ? ((href as (name: string) => string | null).call(link, 'href') ?? null) : null;
}

/**
 * Captures clicks on links to other sites, which cannot navigate inside an Activity or a portal frame, and hands them
 * to `open` (Discord's `openExternalLink`) or drops them (portals).
 */
export function installLinkPolicy(root: { addEventListener(type: 'click', listener: (e: LinkClick) => void, options: { capture: true }): void }, pageOrigin: string, open: ((url: string) => void) | null): void {
  root.addEventListener(
    'click',
    (e) => {
      const href = linkHref(e.target);
      const url = href === null ? null : externalUrl(href, pageOrigin);
      if (url === null) return;
      e.preventDefault();
      open?.(url);
    },
    { capture: true },
  );
}
