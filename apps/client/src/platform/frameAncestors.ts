// Build-time twin of the server's FRAME_ANCESTORS parser (apps/server/src/frameAncestors.ts); keep the rules identical.

const SOURCE = /^https:\/\/(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(:\d{1,5})?$/;
/** At most this many sources. */
export const MAX_FRAME_ANCESTORS = 16;

/**
 * Parses the comma-separated FRAME_ANCESTORS allowlist: https origins, optionally with a leading `*.` label.
 * Empty means nobody may frame the page.
 * @throws Error naming the first bad entry's position
 */
export function parseFrameAncestors(raw: string | undefined): readonly string[] {
  const items = (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  if (items.length > MAX_FRAME_ANCESTORS) throw new Error(`FRAME_ANCESTORS: at most ${String(MAX_FRAME_ANCESTORS)} entries`);
  items.forEach((item, i) => {
    if (!SOURCE.test(item)) throw new Error(`FRAME_ANCESTORS: entry ${String(i + 1)} is not an https origin like https://discord.com`);
  });
  return [...new Set(items)];
}

/** The `frame-ancestors` directive: `'none'` when the list is empty. */
export function frameAncestorsDirective(sources: readonly string[]): string {
  return `frame-ancestors ${sources.length === 0 ? "'none'" : sources.join(' ')}`;
}
