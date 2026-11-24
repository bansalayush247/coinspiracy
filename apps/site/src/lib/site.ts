// Site-wide constants and URL helpers.

export const SITE_NAME = 'Byzantine Council';
export const THEME_COLOR = '#2a1a33';
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 9;

// Absolute URL for a site path; paths must start with "/".
export function absoluteUrl(site: URL | string, path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error(`site path must start with a single /: ${path}`);
  return new URL(path, site).href;
}

export function ogImagePath(slug: string): string {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`invalid OG slug: ${slug}`);
  return `/og/${slug}.png`;
}

// The Play link as an absolute URL (it may be configured as a same-origin path).
export function absolutePlayUrl(site: URL | string, playUrl: string): string {
  return playUrl.startsWith('/') ? absoluteUrl(site, playUrl) : playUrl;
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
