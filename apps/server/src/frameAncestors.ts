// CSP frame-ancestors from the FRAME_ANCESTORS allowlist: https origins only, optionally with a leading "*." label.

const SOURCE = /^https:\/\/(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(:\d{1,5})?$/;
/** At most this many sources, so a typo cannot turn into an unbounded header. */
export const MAX_FRAME_ANCESTORS = 16;

/** True for a source the allowlist accepts, such as `https://discord.com` or `https://*.discordsays.com`. */
export function isFrameAncestor(source: string): boolean {
  return SOURCE.test(source);
}

/**
 * Parses a comma-separated allowlist. Empty means nobody may frame us.
 * @throws Error naming the first bad entry's position, never its value
 */
export function parseFrameAncestors(raw: string | undefined): readonly string[] {
  const items = (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  if (items.length > MAX_FRAME_ANCESTORS) throw new Error(`at most ${String(MAX_FRAME_ANCESTORS)} frame ancestors`);
  items.forEach((item, i) => {
    if (!isFrameAncestor(item)) throw new Error(`frame ancestor ${String(i + 1)} is not an https origin like https://discord.com`);
  });
  return [...new Set(items)];
}

/** The `frame-ancestors` directive: today's `'none'` when the list is empty. */
export function frameAncestorsDirective(sources: readonly string[]): string {
  return `frame-ancestors ${sources.length === 0 ? "'none'" : sources.join(' ')}`;
}
