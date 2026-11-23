/* eslint-disable no-restricted-imports -- build-time Node code: vite.config.ts loads it, the browser bundle never does */
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type HtmlTagDescriptor, type Plugin, type ResolvedConfig } from 'vite';
import { z } from 'zod';
import { resolveServerEndpoint } from '../serverUrl.js';
import { byteLength, pngSize, shellFromBundle, shellVersion } from './shell.js';
import { SW_LIMITS, isSwConfig, type SwConfig } from './swConfig.js';

export const SW_FILE = 'sw.js';
export const MANIFEST_PATH = '/manifest.webmanifest';
export const APPLE_TOUCH_ICON = '/icons/apple-touch-icon.png';
const APPLE_TOUCH_SIZE = 180;
const FAVICON = '/favicon.svg';
const PAGE = 'index.html';
// Paths that belong to the game server or the proxy, never to the worker.
export const SERVER_PATHS = ['/api', '/matchmake', '/colyseus', '/healthz'] as const;
const DEFAULT_ENTRY = fileURLToPath(new URL('./sw.ts', import.meta.url));

const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const DISPLAY = ['fullscreen', 'standalone', 'minimal-ui', 'browser'] as const;
const Icon = z
  .object({
    src: z.string().regex(/^\/icons\/[a-z0-9-]{1,40}\.png$/),
    sizes: z.string().regex(/^[1-9]\d{1,3}x[1-9]\d{1,3}$/),
    type: z.literal('image/png'),
    purpose: z.enum(['any', 'maskable', 'monochrome']),
  })
  .strict();

export const ManifestSchema = z
  .object({
    id: z.literal('/'),
    name: z.string().min(1).max(45),
    // Launchers truncate longer names.
    short_name: z.string().min(1).max(12),
    description: z.string().min(1).max(300),
    lang: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
    dir: z.enum(['ltr', 'rtl', 'auto']),
    start_url: z.literal('/'),
    scope: z.literal('/'),
    display: z.enum(DISPLAY),
    display_override: z.array(z.enum([...DISPLAY, 'window-controls-overlay'])).max(5),
    orientation: z.enum(['any', 'natural', 'landscape', 'portrait']),
    theme_color: color,
    background_color: color,
    categories: z.array(z.string().min(1).max(32)).max(8),
    prefer_related_applications: z.literal(false),
    icons: z.array(Icon).min(1).max(8),
  })
  .strict()
  .refine(
    (m) => ['192x192/any', '512x512/any', '512x512/maskable'].every((need) => m.icons.some((i) => `${i.sizes}/${i.purpose}` === need)),
    'icons need 192 and 512 "any" and a 512 "maskable"',
  );

export type WebManifest = z.infer<typeof ManifestSchema>;

// Every server path the worker must leave alone, including a same-origin VITE_SERVER_URL path.
export function bypassPaths(serverUrl: unknown): string[] {
  const paths = new Set<string>(SERVER_PATHS);
  if (typeof serverUrl === 'string') {
    try {
      const endpoint = resolveServerEndpoint(serverUrl, true);
      const own = new URL(endpoint.httpBase, 'http://same-origin.invalid').pathname.replace(/\/+$/, '');
      if (own !== '') paths.add(own);
    } catch {
      // vite.config.ts already refuses a bad VITE_SERVER_URL.
    }
  }
  return [...paths];
}

async function readPublic(publicDir: string, urlPath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(publicDir, ...urlPath.split('/').filter((s) => s !== ''))));
}

export interface PublicFile {
  readonly path: string;
  readonly content: Uint8Array;
}

// The manifest, its icons, the Apple touch icon and the favicon, each checked before it ships.
export async function readPublicShell(publicDir: string): Promise<{ manifest: WebManifest; files: PublicFile[] }> {
  const manifestBytes = await readPublic(publicDir, MANIFEST_PATH);
  const manifest = ManifestSchema.parse(JSON.parse(new TextDecoder().decode(manifestBytes)));
  const files: PublicFile[] = [{ path: MANIFEST_PATH, content: manifestBytes }];
  const pngs = [...manifest.icons.map((i) => ({ src: i.src, sizes: i.sizes })), { src: APPLE_TOUCH_ICON, sizes: `${String(APPLE_TOUCH_SIZE)}x${String(APPLE_TOUCH_SIZE)}` }];
  for (const png of pngs) {
    if (files.some((f) => f.path === png.src)) continue;
    const bytes = await readPublic(publicDir, png.src);
    const size = pngSize(bytes);
    if (size === null || `${String(size.width)}x${String(size.height)}` !== png.sizes) throw new Error(`${png.src} must be a ${png.sizes} PNG`);
    files.push({ path: png.src, content: bytes });
  }
  files.push({ path: FAVICON, content: await readPublic(publicDir, FAVICON) });
  return { manifest, files };
}

export interface WorkerBuild {
  readonly root: string;
  readonly entry: string;
  readonly target: ResolvedConfig['build']['target'];
  readonly config: SwConfig;
}

// A nested Vite build: one minified IIFE with the config inlined, so sw.js never imports anything.
export async function buildWorker(job: WorkerBuild): Promise<string> {
  const result = await build({
    configFile: false,
    envDir: false,
    root: job.root,
    publicDir: false,
    logLevel: 'warn',
    mode: 'production',
    define: { __BC_SW_CONFIG__: JSON.stringify(job.config) },
    build: {
      write: false,
      emptyOutDir: false,
      copyPublicDir: false,
      sourcemap: false,
      minify: true,
      modulePreload: false,
      reportCompressedSize: false,
      target: job.target,
      rolldownOptions: { input: job.entry, output: { format: 'iife', entryFileNames: SW_FILE } },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((o) => ('output' in o ? o.output : []));
  const chunk = outputs[0];
  if (outputs.length !== 1 || chunk?.type !== 'chunk' || chunk.fileName !== SW_FILE) throw new Error('the service worker must build to one self-contained file');
  return chunk.code;
}

export interface PwaOptions {
  // Service worker source; defaults to src/pwa/sw.ts.
  readonly swEntry?: string;
}

// Adds the manifest and Apple touch icon links to index.html only, so no page source needs editing.
function pwaHtml(): Plugin {
  return {
    name: 'byzantine-council-pwa-html',
    transformIndexHtml(html, ctx): HtmlTagDescriptor[] {
      if (ctx.path !== `/${PAGE}` || html.includes('rel="manifest"')) return [];
      return [
        { tag: 'link', attrs: { rel: 'manifest', href: MANIFEST_PATH }, injectTo: 'head' },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: APPLE_TOUCH_ICON }, injectTo: 'head' },
      ];
    },
  };
}

function message(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  return error instanceof Error ? error.message : String(error);
}

// Runs after Vite's own output plugins, so the page, chunks and CSS are all in the bundle.
function pwaServiceWorker(options: PwaOptions): Plugin {
  let resolved: ResolvedConfig | undefined;
  return {
    name: 'byzantine-council-pwa-sw',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      resolved = config;
    },
    async generateBundle(_output, bundle) {
      const config = resolved;
      if (config === undefined) return;
      const page = bundle[PAGE];
      if (page === undefined) {
        this.warn(`no ${PAGE} in this build, so no service worker`);
        return;
      }
      if (page.type !== 'asset' || typeof page.source !== 'string') this.error(`${PAGE} is not an HTML asset`);
      const html = page.source;
      if (config.base !== '/') this.error('the service worker and manifest need base "/"');
      if (config.publicDir === '') this.error('the manifest and icons live in the public directory, which is disabled');
      let job: WorkerBuild;
      try {
        if (await access(path.join(config.publicDir, SW_FILE)).then(() => true, () => false)) throw new Error(`public/${SW_FILE} would overwrite the service worker`);
        const shell = shellFromBundle(bundle, config.build.assetsDir);
        for (const entry of shell.entries) if (!html.includes(`/${entry}`)) throw new Error(`${PAGE} does not load ${entry}`);
        const { files: publicFiles } = await readPublicShell(config.publicDir);
        const built = shell.files.map((name) => {
          const file = bundle[name];
          if (file === undefined) throw new Error(`the bundle has no ${name}`);
          return { name: `/${name}`, content: file.type === 'chunk' ? file.code : file.source };
        });
        const parts = [{ name: '/', content: html }, ...built, ...publicFiles.map((f) => ({ name: f.path, content: f.content }))];
        const bytes = parts.reduce((sum, part) => sum + byteLength(part.content), 0);
        if (parts.length > SW_LIMITS.maxShellFiles) throw new Error(`the app shell has ${String(parts.length)} files (limit ${String(SW_LIMITS.maxShellFiles)})`);
        if (bytes > SW_LIMITS.maxShellBytes) throw new Error(`the app shell is ${String(bytes)} bytes (limit ${String(SW_LIMITS.maxShellBytes)})`);
        if (shell.hashed.length > SW_LIMITS.maxHashedFiles) throw new Error(`the build has ${String(shell.hashed.length)} hashed files (limit ${String(SW_LIMITS.maxHashedFiles)})`);
        const swConfig: SwConfig = {
          version: await shellVersion(parts),
          html: '/',
          htmlScripts: shell.entries.map((entry) => `/${entry}`),
          navigation: ['/', `/${PAGE}`],
          shell: parts.map((part) => part.name),
          hashed: shell.hashed.map((name) => `/${name}`),
          bypass: bypassPaths(config.env['VITE_SERVER_URL']),
        };
        if (!isSwConfig(swConfig)) throw new Error('the generated service worker config is invalid');
        job = { root: config.root, entry: options.swEntry ?? DEFAULT_ENTRY, target: config.build.target, config: swConfig };
      } catch (error) {
        this.error(`PWA: ${message(error)}`);
      }
      this.emitFile({ type: 'asset', fileName: SW_FILE, source: await buildWorker(job) });
    },
  };
}

// The manifest links for index.html and the service worker build; add once to vite.config.ts plugins.
export function pwa(options: PwaOptions = {}): Plugin[] {
  return [pwaHtml(), pwaServiceWorker(options)];
}
