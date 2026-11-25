// Story scenes as data: each node says some lines, then offers choices (sometimes on a clock) or moves on by
// itself. Characters remember choices as marks, and later lines can depend on them. The server walks the
// script; the client only renders it, so a scene can never be skipped past a choice.

export const SPEAKERS = [
  'rook',
  'dani',
  'mags',
  'pell',
  'voice',
  'teo',
  'ivy',
  'brannigan',
  'lookout',
  'nonce',
  'watchman',
  'quint',
  'sharpe',
  'choir',
  'founder',
  'okafor',
  'pip',
  'juno',
  'crane',
  'stall',
  'mc',
  'penrose',
  'keeper',
  'kit',
  'sol',
  'marco',
  'benny',
] as const;
export type Speaker = (typeof SPEAKERS)[number];

export const SPEAKER_NAMES: Readonly<Record<Speaker, string>> = Object.freeze({
  rook: 'Rook',
  dani: 'Dani',
  mags: 'Mags',
  pell: 'Mr Pell',
  voice: 'Voice on Teo’s phone',
  teo: 'Teo',
  ivy: 'Ivy',
  brannigan: 'Det. Brannigan',
  lookout: 'Lookout',
  nonce: 'Nonce',
  watchman: 'Gus',
  quint: 'Ellis Quint',
  sharpe: 'Dr Sharpe',
  choir: 'The Choir',
  founder: 'Voicemail, 2009',
  okafor: 'Mrs Okafor',
  pip: 'Pip',
  juno: 'Juno',
  crane: 'Mr Crane',
  stall: 'Stallholder',
  mc: 'MC Mempool',
  penrose: 'Ms Penrose',
  keeper: 'Mrs Bellweather',
  kit: 'Kit',
  sol: 'Sol',
  marco: 'Marco',
  benny: 'Benny',
});

// Things characters remember (who) and clues the player picks up (clue), set by choices and scenes.
export interface Mark {
  readonly who?: Speaker;
  readonly text: string;
  readonly clue?: boolean;
  readonly honest?: boolean;
}

export interface ScriptLine {
  readonly who: Speaker;
  readonly text: string;
  readonly paren?: string;
  // Shown only when the mark is set (if) or not set (unless).
  readonly if?: string;
  readonly unless?: string;
}

export interface ScriptChoice {
  readonly id: string;
  readonly tag: string;
  readonly text: string;
  readonly go: string;
  readonly mark?: string;
  // Offered only when the crew holds the mark (if) or doesn't (unless).
  readonly if?: string;
  readonly unless?: string;
}

export interface ScriptNode {
  readonly slug?: string;
  readonly action?: string;
  readonly lines: readonly ScriptLine[];
  readonly after?: string;
  readonly mark?: string;
  readonly choices?: readonly ScriptChoice[];
  // Seconds to answer; when they run out the scene goes to `timeout`, because silence is an answer too.
  readonly seconds?: number;
  readonly timeout?: string;
  readonly next?: string;
  // Goes to `to` instead of `next` when the crew holds the mark `if`.
  readonly jump?: { readonly if: string; readonly to: string };
  // Ends the scene and hands play back to the mission at this step.
  readonly then?: string;
}

// Where a node that moves on by itself goes next, given what the crew holds.
export const nextOf = (node: ScriptNode, marks: ReadonlySet<string>): string | undefined => (node.jump !== undefined && marks.has(node.jump.if) ? node.jump.to : node.next);

export type Script = Readonly<Record<string, ScriptNode>>;

const PER_LINE_MS = 700;
const PER_CHAR_MS = 34;
const PER_ACTION_MS = 900;
const MAX_READ_MS = 30_000;

export const shown = (line: { readonly if?: string; readonly unless?: string }, marks: ReadonlySet<string>): boolean =>
  (line.if === undefined || marks.has(line.if)) && (line.unless === undefined || !marks.has(line.unless));

export function visibleLines(node: ScriptNode, marks: ReadonlySet<string>): readonly ScriptLine[] {
  return node.lines.filter((l) => shown(l, marks));
}

export function visibleChoices(node: ScriptNode, marks: ReadonlySet<string>): readonly ScriptChoice[] {
  return (node.choices ?? []).filter((c) => shown(c, marks));
}

// How long a node takes to read at a comfortable pace; the server waits this long before moving on by itself.
export function readMs(node: ScriptNode, marks: ReadonlySet<string>): number {
  let ms = 0;
  for (const line of visibleLines(node, marks)) ms += PER_LINE_MS + line.text.length * PER_CHAR_MS;
  for (const text of [node.slug, node.action, node.after]) if (text !== undefined) ms += PER_ACTION_MS + text.length * (PER_CHAR_MS / 3);
  return Math.min(MAX_READ_MS, Math.round(ms));
}

// Every target exists, every node is reachable from a start, and every node either waits for a choice or moves on.
export function scriptProblems(script: Script, starts: readonly string[], steps: readonly string[]): string[] {
  const problems: string[] = [];
  const ids = new Set(Object.keys(script));
  for (const [id, node] of Object.entries(script)) {
    const exits = [node.next, node.jump?.to, node.timeout, ...(node.choices ?? []).map((c) => c.go)].filter((x): x is string => x !== undefined);
    for (const to of exits) if (!ids.has(to)) problems.push(`${id} -> missing ${to}`);
    const hasChoices = (node.choices?.length ?? 0) > 0;
    const ways = [hasChoices, node.next !== undefined, node.then !== undefined].filter(Boolean).length;
    if (ways !== 1) problems.push(`${id} must have exactly one of choices, next or then`);
    if (node.seconds !== undefined && (!hasChoices || node.timeout === undefined)) problems.push(`${id} has a clock without choices and a timeout`);
    if (node.timeout !== undefined && node.seconds === undefined) problems.push(`${id} has a timeout without a clock`);
    if (node.jump !== undefined && node.next === undefined) problems.push(`${id} jumps without a next`);
    if (node.then !== undefined && !steps.includes(node.then)) problems.push(`${id} hands back to unknown step ${node.then}`);
    if (node.lines.length === 0 && node.action === undefined) problems.push(`${id} says nothing`);
    const choiceIds = (node.choices ?? []).map((c) => c.id);
    if (new Set(choiceIds).size !== choiceIds.length) problems.push(`${id} repeats a choice id`);
  }
  const seen = new Set<string>();
  const queue = [...starts];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const node = script[id];
    if (node === undefined) {
      problems.push(`start ${id} is missing`);
      continue;
    }
    for (const to of [node.next, node.jump?.to, node.timeout, ...(node.choices ?? []).map((c) => c.go)]) if (to !== undefined) queue.push(to);
  }
  for (const id of ids) if (!seen.has(id)) problems.push(`${id} is unreachable`);
  return problems;
}
