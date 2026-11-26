import * as city from '@byzantine-council/shared/city';

// Fields that always hold words a player reads, even a single word.
const PROSE = new Set(['text', 'tag', 'title', 'label', 'name', 'badge', 'number', 'where', 'paren', 'slug', 'action', 'after', 'blurb', 'hint', 'lesson', 'finale', 'note', 'goalLabel', 'clockLabel', 'workVerb', 'prose']);
// Fields that hold ids, step names or speakers, never shown.
const IDS = new Set(['id', 'go', 'then', 'if', 'unless', 'mark', 'who', 'timeout', 'kind', 'markers', 'steps', 'workStep', 'closed', 'to', 'npc', 'by', 'jump', 'scene', 'scenes', 'watch']);
// Records whose values are all read by players, whatever their keys.
const READ_RECORDS = new Set(['objectives', 'catchers', 'marks']);
// Exports that are not story: the open city's names, room names and the join schema.
const NOT_STORY = new Set(['CITY_DISTRICTS', 'TOUGH_NAMES', 'MissionJoinSchema', 'CITY_ROOM', 'MISSION_ROOM', 'SPEAKERS', 'ACT_IDS', 'CATCHER_IDS']);

/** Every line the story can show a player, by the export it comes from, each listed once. */
export function storyStrings(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const all = new Set<string>();
  const seen = new WeakSet<object>();
  const walk = (source: string, v: unknown, key: string, inNode: boolean): void => {
    if (typeof v === 'string') {
      if (IDS.has(key) || (key === 'next' && inNode) || all.has(v)) return;
      if (!PROSE.has(key) && !/\s/.test(v)) return;
      all.add(v);
      const list = out.get(source) ?? [];
      list.push(v);
      out.set(source, list);
      return;
    }
    if (v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) walk(source, x, key, inNode);
      return;
    }
    const node = Array.isArray((v as { lines?: unknown }).lines);
    for (const [k, x] of Object.entries(v)) walk(source, x, key === 'record' ? 'prose' : READ_RECORDS.has(k) ? 'record' : k, node);
  };
  for (const [name, v] of Object.entries(city)) {
    if (NOT_STORY.has(name) || typeof v === 'function') continue;
    walk(name, v, typeof v === 'string' || name.endsWith('_NAMES') || name.endsWith('_TEMPLATES') ? (typeof v === 'string' ? 'prose' : 'record') : 'export', false);
  }
  return out;
}
