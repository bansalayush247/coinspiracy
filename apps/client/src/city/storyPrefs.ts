// How a player likes story scenes read: text speed, auto mode and the talking beeps. Shared by the story panel and
// the Settings menu, and saved in this browser only.
import { isTextSpeed, type TextSpeed } from './readingPace.js';

/** A player's story reading preferences. */
export interface StoryPrefs {
  readonly speed: TextSpeed;
  readonly auto: boolean;
  readonly voice: boolean;
}

const STORAGE_KEY = 'bc.story';
const DEFAULTS: StoryPrefs = Object.freeze({ speed: 'normal', auto: false, voice: true });

function load(): StoryPrefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const v = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    return { speed: isTextSpeed(v['speed']) ? v['speed'] : DEFAULTS.speed, auto: v['auto'] === true, voice: v['voice'] !== false };
  } catch {
    return DEFAULTS;
  }
}

/** The saved story preferences, with a way to change them and hear about changes. */
export class StoryPrefsStore {
  #prefs: StoryPrefs = load();
  readonly #listeners = new Set<() => void>();

  get value(): StoryPrefs {
    return this.#prefs;
  }

  /** Changes some preferences, saves them, and tells every listener. */
  update(patch: Partial<StoryPrefs>): void {
    this.#prefs = { ...this.#prefs, ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#prefs));
    } catch {
      // Storage blocked: the setting lasts for this visit only.
    }
    for (const fn of this.#listeners) fn();
  }

  /** Calls `fn` after every change; returns a function that stops it. */
  onChange(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }
}

/** The one store the panel and the Settings menu share. */
export const storyPrefs = new StoryPrefsStore();
