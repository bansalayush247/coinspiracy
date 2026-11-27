// Story scenes as data: each node says some lines, then offers choices (sometimes on a clock) or moves on by
// itself. Characters remember choices as marks, and later lines can depend on them. The server walks the
// script; the client only renders it, so a scene can never be skipped past a choice.
import type { Face } from './faces.js';

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
  'ozzy',
  'rex',
  'nell',
  'silas',
  'clerk',
  'dee',
  'fennick',
  'glass',
  'lumley',
  'varnish',
  'wren',
  'marta',
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
  ozzy: 'Ozzy',
  rex: 'Rex Bigsby',
  nell: 'Nell',
  silas: 'Silas',
  clerk: 'Harbour clerk',
  dee: 'Dee',
  fennick: 'Mr Fennick',
  glass: 'Perpetua Glass',
  lumley: 'Lumley',
  varnish: 'Mr Varnish',
  wren: 'Wren',
  marta: 'Marta',
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
  // The portrait's face for this line, when the stage direction alone would pick the wrong one.
  readonly face?: Face;
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

/** How long scenes give their readers: a comfortable reading pace, and how much longer the crew waits for a slow one. */
export const STORY_PACING = Object.freeze({ perLineMs: 700, perCharMs: 34, perActionMs: 900, maxReadMs: 30_000, patienceFactor: 3, patienceExtraMs: 5_000, maxPatienceMs: 90_000 });

export const shown = (line: { readonly if?: string; readonly unless?: string }, marks: ReadonlySet<string>): boolean =>
  (line.if === undefined || marks.has(line.if)) && (line.unless === undefined || !marks.has(line.unless));

export function visibleLines(node: ScriptNode, marks: ReadonlySet<string>): readonly ScriptLine[] {
  return node.lines.filter((l) => shown(l, marks));
}

export function visibleChoices(node: ScriptNode, marks: ReadonlySet<string>): readonly ScriptChoice[] {
  return (node.choices ?? []).filter((c) => shown(c, marks));
}

// How long a node takes to read at a comfortable pace, the yardstick for how long the crew waits.
export function readMs(node: ScriptNode, marks: ReadonlySet<string>): number {
  let ms = 0;
  const p = STORY_PACING;
  for (const line of visibleLines(node, marks)) ms += p.perLineMs + line.text.length * p.perCharMs;
  for (const text of [node.slug, node.action, node.after]) if (text !== undefined) ms += p.perActionMs + text.length * (p.perCharMs / 3);
  return Math.min(p.maxReadMs, Math.round(ms));
}

/** How long the crew waits for its slowest reader before a node moves on, or its choice clock starts, without them. */
export function patienceMs(node: ScriptNode, marks: ReadonlySet<string>): number {
  const p = STORY_PACING;
  return Math.min(p.maxPatienceMs, readMs(node, marks) * p.patienceFactor + p.patienceExtraMs);
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
