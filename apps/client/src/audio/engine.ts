// Sound effects, character talking beeps, and ambient weather are synthesized in the browser;
// background music streams lazily on demand from the pre-generated tracks in ./tracks/.

export type Mood = 'menu' | 'calm' | 'proposals' | 'final' | 'council' | 'academy' | 'victory' | 'defeat' | 'beach' | 'story' | 'silent';
/** Non-silent music moods mapped to individual soundtrack files. */
export type TrackMood = Exclude<Mood, 'silent'>;
/** Music themes shown to players, with adaptive scene selection first. */
export const MUSIC_CHOICES = ['dynamic', 'menu', 'calm', 'proposals', 'final', 'council', 'beach', 'academy', 'story'] as const;
/** Player preference for scene music selection. */
export type MusicChoice = (typeof MUSIC_CHOICES)[number];
/** Available generated soundtrack styles, plus automatic locale-aware selection. */
export const MUSIC_STYLES = ['auto', 'western', 'indian', 'hindi'] as const;
/** Player preference for soundtrack style. */
export type MusicStyle = (typeof MUSIC_STYLES)[number];
/** Concrete generated soundtrack folder. */
export type ConcreteMusicStyle = Exclude<MusicStyle, 'auto'>;

/** Named sound effects synthesized on demand. */
export type Sfx =
  | 'click'
  | 'step'
  | 'taskDone'
  | 'taskFail'
  | 'sign'
  | 'refuse'
  | 'council'
  | 'partition'
  | 'repair'
  | 'freeze'
  | 'thaw'
  | 'coin'
  | 'firework'
  | 'chirp'
  | 'rankUp'
  | 'dissolve'
  | 'gull'
  | 'thunder'
  | 'stepWood'
  | 'stepSand'
  | 'punch'
  | 'whiff'
  | 'knockout'
  | 'templeBell'
  | 'mandirBell';

/** Player audio preferences stored under localStorage key `bc.audio`. */
export interface AudioSettings {
  muted: boolean;
  music: number;
  sfx: number;
  musicChoice: MusicChoice;
  musicStyle: MusicStyle;
}

/** Central timing, gain, and buffer tuning for track playback and Web Audio synthesis. */
export const AUDIO_CONFIG = Object.freeze({
  storageKey: 'bc.audio',
  defaultSettings: Object.freeze<AudioSettings>({
    muted: false,
    music: 0.55,
    sfx: 0.8,
    musicChoice: 'dynamic',
    musicStyle: 'auto',
  }),
  masterGain: 0.9,
  musicBusGain: 0.68,
  ambBusScale: 0.7,
  busRampTcS: 0.1,
  fastRampTcS: 0.05,
  trackFadeInTcS: 0.8,
  trackFadeOutTcS: 0.65,
  trackStartOffsetS: 0.02,
  trackStopDelayS: 2.5,
  trackDisconnectMs: 2800,
  dialogueDuckGain: 0.35,
  dialogueDuckTcS: 0.35,
  dialogueUnduckTcS: 0.45,
  maxCachedBuffers: 3,
  talkGain: 0.075,
  talkLengthS: 0.065,
  talkMinGapS: 0.045,
  talkLowpassRatio: 7,
  phoneBandHz: 1400,
  tapeWobbleRatio: 0.04,
});

/** One syllable of a story character's talking voice. */
export interface TalkSyllable {
  readonly hz: number;
  readonly wave: OscillatorType;
  readonly level: number;
  readonly breathy: boolean;
  readonly through: 'phone' | 'tape' | undefined;
}

type TrackLoader = () => Promise<{ readonly default: string }>;

/** Lazy dynamic-import map for every generated soundtrack style and scene mood. */
export const TRACK_LOADERS: Readonly<Record<ConcreteMusicStyle, Readonly<Record<TrackMood, TrackLoader>>>> = {
  western: {
    menu: () => import('./tracks/western/menu.mp3'),
    calm: () => import('./tracks/western/calm.mp3'),
    proposals: () => import('./tracks/western/proposals.mp3'),
    final: () => import('./tracks/western/final.mp3'),
    council: () => import('./tracks/western/council.mp3'),
    story: () => import('./tracks/western/story.mp3'),
    beach: () => import('./tracks/western/beach.mp3'),
    academy: () => import('./tracks/western/academy.mp3'),
    victory: () => import('./tracks/western/victory.mp3'),
    defeat: () => import('./tracks/western/defeat.mp3'),
  },
  indian: {
    menu: () => import('./tracks/indian/menu.mp3'),
    calm: () => import('./tracks/indian/calm.mp3'),
    proposals: () => import('./tracks/indian/proposals.mp3'),
    final: () => import('./tracks/indian/final.mp3'),
    council: () => import('./tracks/indian/council.mp3'),
    story: () => import('./tracks/indian/story.mp3'),
    beach: () => import('./tracks/indian/beach.mp3'),
    academy: () => import('./tracks/indian/academy.mp3'),
    victory: () => import('./tracks/indian/victory.mp3'),
    defeat: () => import('./tracks/indian/defeat.mp3'),
  },
  hindi: {
    menu: () => import('./tracks/hindi/menu.mp3'),
    calm: () => import('./tracks/hindi/calm.mp3'),
    proposals: () => import('./tracks/hindi/proposals.mp3'),
    final: () => import('./tracks/hindi/final.mp3'),
    council: () => import('./tracks/hindi/council.mp3'),
    story: () => import('./tracks/hindi/story.mp3'),
    beach: () => import('./tracks/hindi/beach.mp3'),
    academy: () => import('./tracks/hindi/academy.mp3'),
    victory: () => import('./tracks/hindi/victory.mp3'),
    defeat: () => import('./tracks/hindi/defeat.mp3'),
  },
};

const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** True when `value` is a supported music choice key. */
export function isMusicChoice(value: unknown): value is MusicChoice {
  return typeof value === 'string' && (MUSIC_CHOICES as readonly string[]).includes(value);
}

/** True when `value` is a supported soundtrack style key. */
export function isMusicStyle(value: unknown): value is MusicStyle {
  return typeof value === 'string' && (MUSIC_STYLES as readonly string[]).includes(value);
}

/** Resolves the music mood to play given the scene's mood and player's choice. */
export function musicMood(requested: Mood, choice: MusicChoice): Mood {
  if (requested === 'silent') return 'silent';
  return choice === 'dynamic' ? requested : choice;
}

/** Resolves the concrete soundtrack folder given the player's style setting and UI language. */
export function resolveMusicStyle(style: MusicStyle, locale: string): ConcreteMusicStyle {
  if (style !== 'auto') return style;
  return locale === 'hi' ? 'hindi' : 'western';
}

function saveSettings(settings: AudioSettings): void {
  try {
    localStorage.setItem(AUDIO_CONFIG.storageKey, JSON.stringify(settings));
  } catch {
    return;
  }
}

function loadSettings(): AudioSettings {
  const defaults = AUDIO_CONFIG.defaultSettings;
  try {
    const raw = localStorage.getItem(AUDIO_CONFIG.storageKey);
    if (raw !== null) {
      const v = JSON.parse(raw) as Partial<AudioSettings>;
      const num = (x: unknown, d: number): number => (typeof x === 'number' && x >= 0 && x <= 1 ? x : d);
      return {
        muted: v.muted === true,
        music: num(v.music, defaults.music),
        sfx: num(v.sfx, defaults.sfx),
        musicChoice: isMusicChoice(v.musicChoice) ? v.musicChoice : defaults.musicChoice,
        musicStyle: isMusicStyle(v.musicStyle) ? v.musicStyle : defaults.musicStyle,
      };
    }
  } catch {
    return { ...defaults };
  }
  return { ...defaults };
}

/** Streams pre-generated scene music and songs on demand while synthesizing SFX, voice beeps, and ambience. */
export class AudioEngine {
  #ctx: AudioContext | null = null;
  #master: GainNode | null = null;
  #musicBus: GainNode | null = null;
  #musicDuck: GainNode | null = null;
  #sfxBus: GainNode | null = null;
  #ambBus: GainNode | null = null;
  #reverb: ConvolverNode | null = null;
  #noise: AudioBuffer | null = null;
  #settings: AudioSettings = loadSettings();
  #requestedMood: Mood = 'silent';
  #locale = 'en';
  #activeTrackKey: string | null = null;
  #trackEpoch = 0;
  #playingTrack: { key: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  readonly #trackBuffers = new Map<string, AudioBuffer>();
  readonly #trackPending = new Map<string, Promise<AudioBuffer | null>>();
  #wind: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  #rain: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  #surf: { src: AudioBufferSourceNode; gain: GainNode; lfo: OscillatorNode; lfo2: OscillatorNode } | null = null;
  #lastStep = 0;
  readonly #listeners = new Set<() => void>();
  #held = false;
  #dialogueOpen = false;
  #lastTalk = 0;

  /** Current saved audio preferences. */
  get settings(): Readonly<AudioSettings> {
    return this.#settings;
  }

  /** True once Web Audio has been unlocked after a user gesture. */
  get started(): boolean {
    return this.#ctx !== null;
  }

  /** Browsers only allow sound after a user gesture; creates or resumes the AudioContext. */
  unlock(): void {
    if (this.#ctx !== null) {
      if (!this.#held) void this.#ctx.resume();
      return;
    }
    const Ctx = window.AudioContext as typeof AudioContext | undefined;
    if (Ctx === undefined) return;
    const ctx = new Ctx();
    this.#ctx = ctx;
    this.#master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 8;
    this.#master.connect(limiter).connect(ctx.destination);
    this.#musicBus = ctx.createGain();
    this.#musicDuck = ctx.createGain();
    this.#musicDuck.gain.value = this.#dialogueOpen ? AUDIO_CONFIG.dialogueDuckGain : 1;
    this.#sfxBus = ctx.createGain();
    this.#ambBus = ctx.createGain();
    this.#reverb = ctx.createConvolver();
    this.#reverb.buffer = this.#impulse(2.6, 2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    this.#reverb.connect(wet).connect(this.#master);
    for (const bus of [this.#sfxBus, this.#ambBus]) {
      bus.connect(this.#master);
      bus.connect(this.#reverb);
    }
    this.#musicBus.connect(this.#musicDuck).connect(this.#master);
    this.#noise = this.#noiseBuffer(2);
    this.#apply();
    this.#startWind();
    this.#syncMusic();
    if (this.#held) void ctx.suspend();
  }

  /** Suspends all sound while a host asks for silence (hidden Activity, portal mute); never saved to settings. */
  setHeld(held: boolean): void {
    this.#held = held;
    const ctx = this.#ctx;
    if (ctx === null) return;
    if (held) void ctx.suspend();
    else void ctx.resume();
  }

  /** Subscribes to settings updates; returns an unsubscribe callback. */
  onChange(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  /** Persists a partial settings update, updates audio buses, and transitions tracks if needed. */
  update(patch: Partial<AudioSettings>): void {
    this.#settings = { ...this.#settings, ...patch };
    saveSettings(this.#settings);
    this.#apply();
    this.#syncMusic();
    for (const fn of this.#listeners) fn();
  }

  #apply(): void {
    const ctx = this.#ctx;
    if (ctx === null || this.#master === null) return;
    const t = ctx.currentTime;
    this.#master.gain.setTargetAtTime(this.#settings.muted ? 0 : AUDIO_CONFIG.masterGain, t, AUDIO_CONFIG.fastRampTcS);
    this.#musicBus?.gain.setTargetAtTime(this.#settings.music * AUDIO_CONFIG.musicBusGain, t, AUDIO_CONFIG.busRampTcS);
    this.#sfxBus?.gain.setTargetAtTime(this.#settings.sfx, t, AUDIO_CONFIG.fastRampTcS);
    this.#ambBus?.gain.setTargetAtTime(this.#settings.sfx * AUDIO_CONFIG.ambBusScale, t, AUDIO_CONFIG.busRampTcS);
  }

  /** Crossfades to the music for a place or moment. */
  setMood(mood: Mood): void {
    this.#requestedMood = mood;
    this.#syncMusic();
  }

  /** Updates the UI language so `auto` soundtrack selection tracks Hindi vs other languages. */
  setLocale(locale: string): void {
    if (this.#locale === locale) return;
    this.#locale = locale;
    this.#syncMusic();
  }

  /** Gently ducks background music while story dialogue is open so speech beeps stay clear. */
  setDialogueOpen(open: boolean): void {
    if (this.#dialogueOpen === open) return;
    this.#dialogueOpen = open;
    const ctx = this.#ctx;
    if (ctx === null) return;
    this.#musicDuck?.gain.setTargetAtTime(
      open ? AUDIO_CONFIG.dialogueDuckGain : 1,
      ctx.currentTime,
      open ? AUDIO_CONFIG.dialogueDuckTcS : AUDIO_CONFIG.dialogueUnduckTcS,
    );
  }

  #isMusicAudible(): boolean {
    return !this.#settings.muted && this.#settings.music > 0;
  }

  #syncMusic(): void {
    const ctx = this.#ctx;
    const mood = musicMood(this.#requestedMood, this.#settings.musicChoice);
    const style = resolveMusicStyle(this.#settings.musicStyle, this.#locale);
    const targetKey = ctx !== null && this.#musicBus !== null && mood !== 'silent' && this.#isMusicAudible() ? `${style}:${mood}` : null;
    if (targetKey === this.#activeTrackKey) return;
    if (ctx !== null) this.#stopTrack(ctx.currentTime);
    if (ctx === null || this.#musicBus === null || targetKey === null || mood === 'silent') return;
    this.#activeTrackKey = targetKey;
    const epoch = this.#trackEpoch;
    void this.#startTrack(style, mood, targetKey, epoch);
  }

  #stopTrack(now: number): void {
    this.#trackEpoch += 1;
    this.#activeTrackKey = null;
    const playing = this.#playingTrack;
    if (playing !== null) {
      this.#playingTrack = null;
      fadeOut(playing.gain.gain, now, AUDIO_CONFIG.trackFadeOutTcS);
      try {
        playing.src.stop(now + AUDIO_CONFIG.trackStopDelayS);
      } catch {
        this.#playingTrack = null;
      }
      window.setTimeout(() => {
        playing.gain.disconnect();
      }, AUDIO_CONFIG.trackDisconnectMs);
    }
  }

  async #startTrack(style: ConcreteMusicStyle, mood: TrackMood, key: string, epoch: number): Promise<void> {
    const ctx = this.#ctx;
    const bus = this.#musicBus;
    if (ctx === null || bus === null || epoch !== this.#trackEpoch || !this.#isMusicAudible()) return;
    const buffer = await this.#loadTrack(style, mood, key, ctx);
    if (buffer === null) {
      if (epoch === this.#trackEpoch && this.#activeTrackKey === key) this.#activeTrackKey = null;
      return;
    }
    if (epoch !== this.#trackEpoch || this.#ctx !== ctx || !this.#isMusicAudible()) return;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.setTargetAtTime(1, now, AUDIO_CONFIG.trackFadeInTcS);
    gain.connect(bus);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(gain);
    this.#playingTrack = { key, src, gain };
    src.start(now + AUDIO_CONFIG.trackStartOffsetS);
  }

  async #loadTrack(style: ConcreteMusicStyle, mood: TrackMood, key: string, ctx: AudioContext): Promise<AudioBuffer | null> {
    const cached = this.#trackBuffers.get(key);
    if (cached !== undefined) {
      this.#trackBuffers.delete(key);
      this.#trackBuffers.set(key, cached);
      return cached;
    }
    const pending = this.#trackPending.get(key);
    if (pending !== undefined) return pending;
    const load = (async (): Promise<AudioBuffer | null> => {
      try {
        const mod = await TRACK_LOADERS[style][mood]();
        const res = await fetch(mod.default);
        if (!res.ok) return null;
        const bytes = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(bytes);
        if (this.#ctx === ctx) {
          if (this.#trackBuffers.size >= AUDIO_CONFIG.maxCachedBuffers) {
            const oldest = this.#trackBuffers.keys().next().value;
            if (oldest !== undefined) this.#trackBuffers.delete(oldest);
          }
          this.#trackBuffers.set(key, decoded);
        }
        return decoded;
      } catch {
        return null;
      } finally {
        this.#trackPending.delete(key);
      }
    })();
    this.#trackPending.set(key, load);
    return load;
  }

  // Short bursts of noise into a tuned feedback delay: the Karplus-Strong plucked string.
  #pluck(freq: number, t: number, level: number, out: AudioNode, bright = 7): void {
    const ctx = this.#ctx;
    if (ctx === null || this.#noise === null) return;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    const burst = ctx.createGain();
    burst.gain.setValueAtTime(level, t);
    burst.gain.setValueAtTime(0, t + 1 / freq);
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 1 / freq;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = Math.min(9000, freq * bright);
    // Low-pass Q is in dB: a negative value leaves no resonant peak, so the loop gain stays below 1 everywhere.
    damp.Q.value = -6;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.985;
    const env = ctx.createGain();
    env.gain.setValueAtTime(1, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    src.connect(burst).connect(delay);
    delay.connect(damp).connect(feedback).connect(delay);
    delay.connect(env).connect(out);
    src.start(t, Math.random(), 0.05);
    window.setTimeout(() => {
      env.disconnect();
      feedback.disconnect();
    }, (t - ctx.currentTime + 2.5) * 1000);
  }

  // FM bell: a modulator at an inharmonic ratio gives the clang real bells have.
  #bell(freq: number, t: number, level: number, out: AudioNode, length = 3, ratio = 3.5, depth = 2.2): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const env = ctx.createGain();
    car.frequency.value = freq;
    mod.frequency.value = freq * ratio;
    modGain.gain.setValueAtTime(freq * depth, t);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.05, t + length);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0005, t + length);
    mod.connect(modGain).connect(car.frequency);
    car.connect(env).connect(out);
    car.start(t);
    mod.start(t);
    car.stop(t + length + 0.1);
    mod.stop(t + length + 0.1);
  }

  #noiseHit(t: number, level: number, out: AudioNode, type: BiquadFilterType, freq: number, length: number, q = 1): void {
    const ctx = this.#ctx;
    if (ctx === null || this.#noise === null) return;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(level, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + length);
    src.connect(f).connect(env).connect(out);
    src.start(t, Math.random() * 1.5, length + 0.05);
  }

  #tone(freq: number, t: number, length: number, level: number, type: OscillatorType = 'sine', glideTo?: number): void {
    const ctx = this.#ctx;
    if (ctx === null || this.#sfxBus === null) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo !== undefined) o.frequency.exponentialRampToValueAtTime(glideTo, t + length);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.001, t + length);
    o.connect(env).connect(this.#sfxBus);
    o.start(t);
    o.stop(t + length + 0.05);
  }

  /** Says one syllable of a character's talking voice, at most one per short gap so fast text does not buzz. */
  talk(s: TalkSyllable): void {
    const ctx = this.#ctx;
    const out = this.#sfxBus;
    if (ctx === null || out === null || this.#settings.muted) return;
    const c = AUDIO_CONFIG;
    const t = ctx.currentTime + 0.005;
    if (t - this.#lastTalk < c.talkMinGapS) return;
    this.#lastTalk = t;
    const level = c.talkGain * s.level;
    if (s.breathy) {
      this.#noiseHit(t, level * 0.9, out, 'bandpass', s.hz * 9, c.talkLengthS, 3);
      return;
    }
    const o = ctx.createOscillator();
    o.type = s.wave;
    o.frequency.setValueAtTime(s.hz, t);
    o.frequency.exponentialRampToValueAtTime(s.hz * (s.through === 'tape' ? 1 - c.tapeWobbleRatio : 0.94), t + c.talkLengthS);
    const f = ctx.createBiquadFilter();
    f.type = s.through === 'phone' ? 'bandpass' : 'lowpass';
    f.frequency.value = s.through === 'phone' ? c.phoneBandHz : s.hz * c.talkLowpassRatio;
    f.Q.value = s.through === 'phone' ? 2.2 : 0.7;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.001, t + c.talkLengthS);
    o.connect(f).connect(env).connect(out);
    o.start(t);
    o.stop(t + c.talkLengthS + 0.03);
  }

  /** Synthesizes and plays a named sound effect. */
  play(name: Sfx): void {
    const ctx = this.#ctx;
    const out = this.#sfxBus;
    if (ctx === null || out === null || this.#settings.muted) return;
    const t = ctx.currentTime + 0.01;
    switch (name) {
      case 'click':
        this.#noiseHit(t, 0.15, out, 'bandpass', 2400, 0.03, 4);
        return;
      case 'step':
      case 'stepWood':
      case 'stepSand': {
        // Throttled; each surface has its own sound: a crisp click on stone, a hollow knock on planks, a hiss on sand.
        if (t - this.#lastStep < 0.18) return;
        this.#lastStep = t;
        if (name === 'stepWood') {
          this.#tone(130 + Math.random() * 30, t, 0.09, 0.12, 'sine', 90);
          this.#noiseHit(t, 0.04, out, 'bandpass', 600, 0.05, 3);
        } else if (name === 'stepSand') {
          this.#noiseHit(t, 0.05, out, 'highpass', 2500 + Math.random() * 1500, 0.12, 0.7);
        } else {
          this.#noiseHit(t, 0.05, out, 'bandpass', 1400 + Math.random() * 600, 0.04, 2);
        }
        return;
      }
      case 'taskDone':
        [0, 4, 7, 12].forEach((s, i) => {
          this.#bell(hz(76 + s), t + i * 0.07, 0.08, out, 1.4, 2);
        });
        this.#pluck(hz(64), t, 0.3, out);
        return;
      case 'taskFail':
        this.#tone(160, t, 0.35, 0.25, 'triangle', 90);
        return;
      case 'sign':
        // The thump of a seal pressed into warm wax.
        this.#tone(110, t, 0.18, 0.4, 'sine', 55);
        this.#noiseHit(t + 0.01, 0.12, out, 'lowpass', 900, 0.12);
        this.#bell(hz(81), t + 0.06, 0.04, out, 0.8, 2);
        return;
      case 'refuse':
        this.#noiseHit(t, 0.25, out, 'bandpass', 500, 0.08, 3);
        this.#noiseHit(t + 0.09, 0.18, out, 'bandpass', 420, 0.08, 3);
        return;
      case 'council':
        // A great bell: low fundamental, inharmonic partials and a long decay.
        this.#bell(hz(45), t, 0.35, out, 6, 1.4);
        this.#bell(hz(57), t, 0.15, out, 5, 2.76);
        this.#bell(hz(45), t + 1.4, 0.25, out, 6, 1.4);
        return;
      case 'partition':
        // Electrical crackle: bursts of band-passed noise sweeping, and a falling zap.
        for (let i = 0; i < 9; i++) this.#noiseHit(t + i * 0.035 + Math.random() * 0.02, 0.25, out, 'bandpass', 1200 + Math.random() * 3000, 0.05, 6);
        this.#tone(1400, t, 0.5, 0.15, 'sawtooth', 70);
        return;
      case 'repair':
        this.#tone(220, t, 0.7, 0.18, 'sine', 880);
        [0, 7, 12].forEach((s, i) => {
          this.#bell(hz(72 + s), t + 0.4 + i * 0.08, 0.07, out, 1.6, 2);
        });
        return;
      case 'freeze':
        // Glassy shimmer: high bells with a bright inharmonic ratio.
        for (let i = 0; i < 6; i++) this.#bell(hz(88 + Math.floor(Math.random() * 10)), t + i * 0.04, 0.05, out, 1.2, 5.4);
        this.#noiseHit(t, 0.12, out, 'highpass', 6000, 0.6);
        return;
      case 'thaw':
        // Drips: short sine blips whose pitch drops, like a drop leaving a surface.
        for (let i = 0; i < 5; i++) this.#tone(1400 + Math.random() * 900, t + i * 0.13 + Math.random() * 0.05, 0.09, 0.12, 'sine', 500);
        return;
      case 'coin':
        this.#tone(hz(83), t, 0.12, 0.15, 'square');
        this.#tone(hz(88), t + 0.08, 0.4, 0.15, 'square');
        return;
      case 'firework':
        this.#noiseHit(t, 0.08, out, 'highpass', 2000, 0.6);
        for (let i = 0; i < 14; i++) this.#noiseHit(t + 0.6 + Math.random() * 0.5, 0.12, out, 'highpass', 4000, 0.03);
        this.#tone(90, t + 0.6, 0.6, 0.35, 'sine', 40);
        return;
      case 'punch':
        // A cartoon thwack: a low thump with a short slap of noise on top.
        this.#tone(150, t, 0.12, 0.35, 'sine', 60);
        this.#noiseHit(t, 0.22, out, 'lowpass', 1800, 0.06);
        return;
      case 'whiff':
        this.#noiseHit(t, 0.12, out, 'bandpass', 900, 0.14, 1.5);
        return;
      case 'knockout':
        // A bonk, then a falling slide whistle and little bells for the stars.
        this.#tone(120, t, 0.18, 0.4, 'sine', 50);
        this.#tone(1200, t + 0.1, 0.6, 0.1, 'triangle', 300);
        for (let i = 0; i < 4; i++) this.#bell(hz(91 + i * 2), t + 0.45 + i * 0.09, 0.04, out, 0.8, 2);
        return;
      case 'templeBell':
        this.#bell(hz(45), t, 0.2, out, 6, 2.76, 1.2);
        this.#bell(hz(57), t + 0.01, 0.07, out, 4, 3.1, 0.8);
        return;
      case 'mandirBell':
        for (let i = 0; i < 3; i++) this.#bell(hz(69 + (i % 2) * 2), t + i * 0.32, 0.12 - i * 0.025, out, 2.6, 3.4, 1.6);
        return;
      case 'chirp':
        for (let i = 0; i < 3; i++) this.#tone(2600 + Math.random() * 1200, t + i * 0.11, 0.08, 0.05, 'sine', 3800 + Math.random() * 800);
        return;
      case 'rankUp':
        [0, 4, 7, 12, 16].forEach((s, i) => {
          this.#bell(hz(72 + s), t + i * 0.1, 0.09, out, 1.8, 2);
        });
        return;
      case 'thunder': {
        // A crack, then a long rumble: low-passed noise whose cutoff sinks as it rolls away.
        const ctx2 = this.#ctx;
        if (ctx2 === null || this.#noise === null) return;
        this.#noiseHit(t, 0.35, out, 'lowpass', 2500, 0.25);
        const src = ctx2.createBufferSource();
        src.buffer = this.#noise;
        src.loop = true;
        const f = ctx2.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(420, t);
        f.frequency.exponentialRampToValueAtTime(70, t + 4);
        const env = ctx2.createGain();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.5, t + 0.15);
        env.gain.exponentialRampToValueAtTime(0.001, t + 4.5);
        src.connect(f).connect(env).connect(out);
        src.start(t);
        src.stop(t + 4.6);
        return;
      }
      case 'gull':
        // A herring gull's call: a few falling, nasal cries.
        for (let i = 0; i < 3; i++) this.#tone(1500 - i * 80, t + i * 0.22, 0.18, 0.05, 'sawtooth', 900);
        return;
      case 'dissolve':
        this.#tone(660, t, 1.6, 0.12, 'sine', 1760);
        this.#noiseHit(t, 0.05, out, 'highpass', 5000, 1.5);
        return;
    }
  }

  /** Enables or fades out synthesized surf ambience. */
  setSurf(on: boolean): void {
    const ctx = this.#ctx;
    if (ctx === null || this.#noise === null || this.#ambBus === null) return;
    if (on && this.#surf === null) {
      const src = ctx.createBufferSource();
      src.buffer = this.#noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      const gain = ctx.createGain();
      gain.gain.value = 0.05;
      // Two slow, unrelated oscillators make the wave rhythm irregular, as real surf is.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.11;
      const depth = ctx.createGain();
      depth.gain.value = 0.04;
      const lfo2 = ctx.createOscillator();
      lfo2.frequency.value = 0.043;
      const depth2 = ctx.createGain();
      depth2.gain.value = 500;
      lfo.connect(depth).connect(gain.gain);
      lfo2.connect(depth2).connect(filter.frequency);
      src.connect(filter).connect(gain).connect(this.#ambBus);
      src.start();
      lfo.start();
      lfo2.start();
      this.#surf = { src, gain, lfo, lfo2 };
    } else if (!on && this.#surf !== null) {
      const surf = this.#surf;
      this.#surf = null;
      surf.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.8);
      const stopAt = ctx.currentTime + 4;
      surf.src.stop(stopAt);
      surf.lfo.stop(stopAt);
      surf.lfo2.stop(stopAt);
    }
  }

  /** Adjusts synthesized wind and rain ambience for current weather. */
  setAmbience(wind: number, raining: boolean): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    const t = ctx.currentTime;
    if (this.#wind !== null) {
      this.#wind.gain.gain.setTargetAtTime(0.02 + wind * 0.05, t, 0.5);
      this.#wind.filter.frequency.setTargetAtTime(300 + wind * 700, t, 0.5);
    }
    if (raining && this.#rain === null) this.#startRain();
    if (!raining && this.#rain !== null) {
      const rain = this.#rain;
      this.#rain = null;
      rain.gain.gain.setTargetAtTime(0, t, 1.5);
      rain.src.stop(t + 6);
    }
  }

  #startWind(): void {
    const ctx = this.#ctx;
    if (ctx === null || this.#noise === null || this.#ambBus === null) return;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const gain = ctx.createGain();
    gain.gain.value = 0.03;
    src.connect(filter).connect(gain).connect(this.#ambBus);
    src.start();
    this.#wind = { src, gain, filter };
  }

  #startRain(): void {
    const ctx = this.#ctx;
    if (ctx === null || this.#noise === null || this.#ambBus === null) return;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.12, ctx.currentTime, 2);
    src.connect(hp).connect(lp).connect(gain).connect(this.#ambBus);
    src.start();
    this.#rain = { src, gain };
  }

  #noiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.#ctx;
    if (ctx === null) throw new Error('no audio context');
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // A synthetic room: decaying noise as an impulse response.
  #impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.#ctx;
    if (ctx === null) throw new Error('no audio context');
    const length = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
    }
    return buf;
  }
}

/** Shared client audio engine instance. */
export const audio = new AudioEngine();

// Fades a param to silence from wherever it is now; holding first avoids a jump mid-ramp.
function fadeOut(param: AudioParam, now: number, timeConstant: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
  else param.cancelScheduledValues(now);
  param.setTargetAtTime(0, now, timeConstant);
}
