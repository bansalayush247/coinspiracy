// The page CSP comes from public/_headers; HTML gets the same policy as a <meta> fallback.
import { headersFor, headerValue, parseHeadersFile } from './headers.js';

// Directives a <meta> CSP may not carry (browsers ignore or reject them there).
const HEADER_ONLY_DIRECTIVES = new Set(['frame-ancestors', 'report-uri', 'report-to', 'sandbox']);

export function cspDirectives(csp: string): string[] {
  return csp
    .split(';')
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter((part) => part !== '');
}

export function cspFromHeadersFile(text: string): string {
  const csp = headerValue(headersFor(parseHeadersFile(text), '/*'), 'Content-Security-Policy');
  if (csp === undefined) throw new Error('_headers /* rule has no Content-Security-Policy');
  return csp;
}

export function metaCsp(csp: string): string {
  return cspDirectives(csp)
    .filter((directive) => !HEADER_ONLY_DIRECTIVES.has(directive.split(' ')[0] ?? ''))
    .join('; ');
}

// Problems that would make the policy unsafe or unusable; empty when it is strict.
export function cspProblems(csp: string): string[] {
  const problems: string[] = [];
  const directives = new Map(
    cspDirectives(csp).map((d) => {
      const [name = '', ...sources] = d.split(' ');
      return [name.toLowerCase(), sources] as const;
    }),
  );
  const fallback = directives.get('default-src');
  if (fallback?.join(' ') !== "'none'") problems.push("default-src must be 'none'");
  for (const [name, sources] of directives) {
    for (const source of sources) {
      const s = source.toLowerCase();
      if (s.startsWith("'unsafe-") || s === "'wasm-unsafe-eval'") problems.push(`${name} allows ${source}`);
      if (s === '*' || s === 'data:' || s === 'blob:' || s === 'http:' || s === 'https:') problems.push(`${name} allows ${source}`);
      if (/^(https?:)?\/\//.test(s) || /\.[a-z]{2,}(:\d+)?$/.test(s)) problems.push(`${name} allows a third-party host ${source}`);
    }
  }
  for (const required of ['script-src', 'style-src', 'img-src', 'base-uri', 'form-action', 'frame-ancestors']) {
    if (!directives.has(required)) problems.push(`missing ${required}`);
  }
  if (directives.get('frame-ancestors')?.join(' ') !== "'none'") problems.push("frame-ancestors must be 'none'");
  if (directives.get('base-uri')?.join(' ') !== "'none'") problems.push("base-uri must be 'none'");
  return problems;
}
