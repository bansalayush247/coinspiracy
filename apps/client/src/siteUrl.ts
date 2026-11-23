// Where the Codex lives, for "learn more" links. Optional: without it the game shows no links.
// Only an https origin (or loopback http for local work) is accepted, never a path or a script URL.
export function resolveSiteUrl(raw: string | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (value === '') return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || (url.pathname !== '/' && url.pathname !== '')) return null;
  return url.origin;
}

// The Codex page behind each way a match can end.
export const CODEX_FOR_REASON: Readonly<Record<string, string>> = {
  consensusReached: 'federations-and-guardians',
  allByzantineRotatedOut: 'byzantine-fault-tolerance',
  forgedProposalPassed: 'one-third-rule',
  federationHalted: 'one-third-rule',
  livenessLost: 'byzantine-fault-tolerance',
  outOfTime: 'block-height-consensus',
};

export const SITE_URL = resolveSiteUrl(import.meta.env.VITE_SITE_URL);
