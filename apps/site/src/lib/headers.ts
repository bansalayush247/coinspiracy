// Parser for the static-host `_headers` format: a path pattern line, then indented `Name: value` lines.

export interface HeaderRule {
  readonly pattern: string;
  readonly headers: readonly (readonly [string, string])[];
}

const MAX_RULES = 64;
const MAX_HEADERS_PER_RULE = 32;
const MAX_VALUE_LENGTH = 4096;
const HEADER_NAME = /^[A-Za-z0-9-]+$/;
const PATTERN = /^\/[A-Za-z0-9\-._~/*]*$/;

export class HeadersFileError extends Error {
  constructor(line: number, message: string) {
    super(`_headers line ${String(line)}: ${message}`);
    this.name = 'HeadersFileError';
  }
}

export function parseHeadersFile(text: string): HeaderRule[] {
  const rules: { pattern: string; headers: [string, string][] }[] = [];
  const lines = text.split('\n');
  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '' || line.trimStart().startsWith('#')) return;
    if (!/^\s/.test(line)) {
      const pattern = line.trim();
      if (!PATTERN.test(pattern)) throw new HeadersFileError(lineNo, 'path pattern must start with / and use plain characters');
      if (rules.length >= MAX_RULES) throw new HeadersFileError(lineNo, 'too many rules');
      rules.push({ pattern, headers: [] });
      return;
    }
    const rule = rules.at(-1);
    if (rule === undefined) throw new HeadersFileError(lineNo, 'header before any path pattern');
    const colon = line.indexOf(':');
    if (colon < 0) throw new HeadersFileError(lineNo, 'expected Name: value');
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!HEADER_NAME.test(name)) throw new HeadersFileError(lineNo, 'invalid header name');
    if (value === '' || value.length > MAX_VALUE_LENGTH) throw new HeadersFileError(lineNo, 'empty or oversized value');
    if (rule.headers.length >= MAX_HEADERS_PER_RULE) throw new HeadersFileError(lineNo, 'too many headers in one rule');
    rule.headers.push([name, value]);
  });
  return rules;
}

// Headers of the rule whose pattern is exactly `pattern` (e.g. "/*").
export function headersFor(rules: readonly HeaderRule[], pattern: string): Record<string, string> {
  const rule = rules.find((r) => r.pattern === pattern);
  if (rule === undefined) throw new Error(`_headers has no ${pattern} rule`);
  return Object.fromEntries(rule.headers);
}

// Case-insensitive lookup.
export function headerValue(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === wanted) return value;
  return undefined;
}

// Whether a `_headers` pattern ("/*", "/og/*", "/x.png") matches a URL path.
export function patternMatches(pattern: string, path: string): boolean {
  if (pattern.endsWith('/*')) return path.startsWith(pattern.slice(0, -1));
  return pattern === path;
}
