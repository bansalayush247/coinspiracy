// JSON-lines logger. Never pass IP addresses, nicknames or reconnection tokens as fields.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;
type Level = Exclude<keyof typeof LEVELS, 'silent'>;
type Fields = Readonly<Record<string, string | number | boolean | null | undefined>>;

function threshold(): number {
  const raw = process.env['LOG_LEVEL'];
  return raw !== undefined && raw in LEVELS ? LEVELS[raw as keyof typeof LEVELS] : LEVELS.info;
}

const minLevel = threshold();

function describe(error: unknown): Fields {
  if (error instanceof Error) return { error: error.message, stack: error.stack };
  return { error: String(error) };
}

function write(level: Level, msg: string, fields: Fields = {}): void {
  if (LEVELS[level] < minLevel) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const log = {
  debug: (msg: string, fields?: Fields): void => {
    write('debug', msg, fields);
  },
  info: (msg: string, fields?: Fields): void => {
    write('info', msg, fields);
  },
  warn: (msg: string, fields?: Fields): void => {
    write('warn', msg, fields);
  },
  error: (msg: string, error?: unknown, fields?: Fields): void => {
    write('error', msg, { ...fields, ...(error === undefined ? {} : describe(error)) });
  },
};
