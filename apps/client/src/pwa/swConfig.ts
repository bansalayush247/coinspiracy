// What the service worker knows about one build; the Vite plugin injects it into sw.js.
export interface SwConfig {
  // Digest of the shell's contents; it names this build's caches.
  readonly version: string;
  // Cache key of the page served to navigations.
  readonly html: string;
  // Entry scripts the cached page must reference.
  readonly htmlScripts: readonly string[];
  // Navigation paths answered network-first with the cached page as fallback.
  readonly navigation: readonly string[];
  // Paths precached at install, the page included.
  readonly shell: readonly string[];
  // Content-hashed build files; immutable, so served cache-first.
  readonly hashed: readonly string[];
  // Path prefixes the worker never touches.
  readonly bypass: readonly string[];
}

export const SW_LIMITS = {
  maxShellFiles: 64,
  maxShellBytes: 12 * 1024 * 1024,
  maxHashedFiles: 512,
  maxBypass: 16,
  maxPathLength: 256,
} as const;

const VERSION = /^[0-9a-f]{16,64}$/;
// Absolute, plain paths: no dot segments, no "//", no query or fragment.
const PATH = /^(\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)*\/?$/;

export function isSafePath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && value.length <= SW_LIMITS.maxPathLength && PATH.test(value);
}

function pathList(value: unknown, max: number): value is readonly string[] {
  return Array.isArray(value) && value.length <= max && value.every(isSafePath) && new Set(value).size === value.length;
}

// Fails closed: the worker refuses to start on anything unexpected.
export function isSwConfig(value: unknown): value is SwConfig {
  if (typeof value !== 'object' || value === null) return false;
  const { version, html, htmlScripts, navigation, shell, hashed, bypass } = value as Record<string, unknown>;
  return (
    typeof version === 'string' &&
    VERSION.test(version) &&
    isSafePath(html) &&
    pathList(htmlScripts, SW_LIMITS.maxShellFiles) &&
    pathList(navigation, 8) &&
    pathList(shell, SW_LIMITS.maxShellFiles) &&
    pathList(hashed, SW_LIMITS.maxHashedFiles) &&
    pathList(bypass, SW_LIMITS.maxBypass) &&
    shell.includes(html) &&
    navigation.includes(html) &&
    htmlScripts.every((script) => shell.includes(script)) &&
    bypass.every((prefix) => prefix !== '/')
  );
}
