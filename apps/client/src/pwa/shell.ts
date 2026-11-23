// Minimal views of Rolldown's output, so the shell logic is testable without running a build.
export interface ShellChunk {
  readonly type: 'chunk';
  readonly fileName: string;
  readonly isEntry: boolean;
  readonly imports: readonly string[];
  readonly code: string;
  readonly viteMetadata?: { readonly importedCss: ReadonlySet<string>; readonly importedAssets: ReadonlySet<string> } | undefined;
}

export interface ShellAsset {
  readonly type: 'asset';
  readonly fileName: string;
  readonly source: string | Uint8Array;
}

export type ShellFile = ShellChunk | ShellAsset;

export interface AppShell {
  // Entry chunks the page loads directly.
  readonly entries: readonly string[];
  // Everything the page needs at start-up: entries, static imports, their CSS and assets.
  readonly files: readonly string[];
  // Every content-hashed file the build emitted under the assets directory.
  readonly hashed: readonly string[];
}

// Vite's default names: "<name>-<8 hash chars>.<ext>" directly inside the assets directory.
const HASHED_NAME = /-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;

export function isHashedFileName(fileName: string, assetsDir: string): boolean {
  const prefix = `${assetsDir}/`;
  return fileName.startsWith(prefix) && !fileName.slice(prefix.length).includes('/') && HASHED_NAME.test(fileName);
}

function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// The same graph Vite writes to its build manifest, read from the bundle so .vite/manifest.json is never published.
export function shellFromBundle(bundle: Readonly<Record<string, ShellFile>>, assetsDir: string): AppShell {
  const entries: string[] = [];
  for (const file of Object.values(bundle)) if (file.type === 'chunk' && file.isEntry) entries.push(file.fileName);
  const files = new Set<string>();
  const queue = [...entries];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (files.has(next)) continue;
    const file = bundle[next];
    if (file === undefined) throw new Error(`the bundle has no ${next}`);
    files.add(next);
    if (file.type !== 'chunk') continue;
    queue.push(...file.imports);
    for (const css of file.viteMetadata?.importedCss ?? []) files.add(css);
    for (const asset of file.viteMetadata?.importedAssets ?? []) files.add(asset);
  }
  const hashed = Object.keys(bundle).filter((name) => isHashedFileName(name, assetsDir));
  return { entries: entries.sort(byName), files: [...files].sort(byName), hashed: hashed.sort(byName) };
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

// Width and height from the IHDR chunk, which a valid PNG always has first; null for anything else.
export function pngSize(bytes: Uint8Array): { readonly width: number; readonly height: number } | null {
  if (bytes.byteLength < 24 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export function byteLength(content: string | Uint8Array): number {
  return typeof content === 'string' ? new TextEncoder().encode(content).byteLength : content.byteLength;
}

function lengthPrefix(length: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, length);
  return out;
}

// Digest of names and contents, order-independent and unambiguous (length-prefixed).
export async function shellVersion(parts: readonly { readonly name: string; readonly content: string | Uint8Array }[]): Promise<string> {
  const encoder = new TextEncoder();
  const pieces: Uint8Array[] = [];
  for (const part of [...parts].sort((a, b) => byName(a.name, b.name))) {
    const name = encoder.encode(part.name);
    const body = typeof part.content === 'string' ? encoder.encode(part.content) : part.content;
    pieces.push(lengthPrefix(name.byteLength), name, lengthPrefix(body.byteLength), body);
  }
  const joined = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.byteLength, 0));
  let offset = 0;
  for (const piece of pieces) {
    joined.set(piece, offset);
    offset += piece.byteLength;
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', joined));
  return Array.from(digest.subarray(0, 10), (b) => b.toString(16).padStart(2, '0')).join('');
}
