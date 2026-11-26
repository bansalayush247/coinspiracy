import type { HostKind } from './types.js';

/** Portal pages whose iframes count as a portal when the build does not say so. Subdomains match too. */
export const DEFAULT_PORTAL_REFERRERS: readonly string[] = ['crazygames.com', 'poki.com'];
/** The query flag a portal page can add to the game URL: `?bc_host=portal`. */
export const PORTAL_QUERY_FLAG = 'bc_host';

const LAUNCH_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const DOMAIN = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Everything detection reads, so it stays a pure function. */
export interface HostInput {
  /** `location.search`. */
  readonly search: string;
  /** `document.referrer`: the embedding page, as far as its referrer policy reveals it. */
  readonly referrer: string;
  /** True inside an iframe (`window.top !== window.self`). */
  readonly framed: boolean;
  /** `VITE_PLATFORM` from the build: `portal` for portal builds. */
  readonly buildPlatform: string | undefined;
  readonly portalReferrers: readonly string[];
}

/** Parses `VITE_PORTAL_REFERRERS` (comma-separated domains); unset or empty keeps the defaults, bad entries are dropped. */
export function portalReferrers(raw: string | undefined): readonly string[] {
  const items = (raw ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => DOMAIN.test(item));
  return items.length === 0 ? DEFAULT_PORTAL_REFERRERS : items;
}

function referrerAllowed(referrer: string, allowlist: readonly string[]): boolean {
  let host: string;
  try {
    const url = new URL(referrer);
    if (url.protocol !== 'https:') return false;
    host = url.hostname;
  } catch {
    return false;
  }
  return allowlist.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Decides the host. Discord launches carry `frame_id` and `instance_id` and always run framed; a portal is
 * named by the build, by `?bc_host=portal` in a frame, or by a framed referrer on the allowlist; anything else is the web.
 */
export function detectHost(input: HostInput): HostKind {
  const query = new URLSearchParams(input.search);
  const frameId = query.get('frame_id');
  const instanceId = query.get('instance_id');
  if (input.framed && frameId !== null && instanceId !== null && LAUNCH_ID.test(frameId) && LAUNCH_ID.test(instanceId)) return 'discord';
  if (input.buildPlatform === 'portal') return 'portal';
  if (input.framed && query.get(PORTAL_QUERY_FLAG) === 'portal') return 'portal';
  if (input.framed && referrerAllowed(input.referrer, input.portalReferrers)) return 'portal';
  return 'web';
}
