// Sound is synthesized in the browser, except the short spoken vocals in ./vocals, credited in CREDITS.md.
// Plucked strings use Karplus-Strong; bells use FM with inharmonic partials; music is composed live (composer.ts).
import { Composer, MOODS, STEPS_PER_BAR, type BarPlan, type Mood } from './composer.js';

export type { Mood };
/** Non-silent music moods paired with spoken intro vocals. */
export type TrackMood = Exclude<Mood, 'silent'>;
/** Music themes shown to players, with adaptive scene selection first. */
export const MUSIC_CHOICES = ['dynamic', 'menu', 'calm', 'proposals', 'final', 'council', 'beach', 'academy', 'story'] as const;
/** Player preference for background music selection. */
export type MusicChoice = (typeof MUSIC_CHOICES)[number];
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
  | 'knockout';

/** Player audio preferences stored under localStorage key `bc.audio`. */
export interface AudioSettings {
  muted: boolean;
  music: number;
  sfx: number;
  vocals: boolean;
  musicChoice: MusicChoice;
}

/** Central timing, gain, and filter tuning for browser synth and vocal mixing. */
export const AUDIO_CONFIG = Object.freeze({
  storageKey: 'bc.audio',
  defaultSettings: Object.freeze<AudioSettings>({
    muted: false,
    music: 0.55,
    sfx: 0.8,
    vocals: true,
    musicChoice: 'dynamic',
  }),
  lookaheadS: 0.12,
  tickMs: 25,
  vocalCooldownMs: 35_000,
  vocalDelayMs: 1100,
  vocalStartOffsetS: 0.04,
  vocalFadeInS: 0.06,
  vocalFadeOutTcS: 0.2,
  vocalStopDelayS: 1.0,
  vocalDisconnectMs: 1300,
  vocalDuckGain: 0.56,
  vocalDuckTcS: 0.35,
  vocalUnduckTcS: 0.45,
  masterGain: 0.9,
  musicBusGain: 0.6,
  vocalBusGain: 0.85,
  ambBusScale: 0.7,
  busRampTcS: 0.1,
  fastRampTcS: 0.05,
  moodGainBoost: 1.6,
  moodFadeInTcS: 1.3,
  moodFadeOutTcS: 1.1,
  moodDisconnectMs: 8000,
  vinylStopDelayS: 3.5,
  musicLowpassHz: 5600,
  musicLowpassQ: 0.5,
  hallDurationS: 4.2,
  hallDecay: 3.2,
  hallDampHz: 3400,
  hallWetGain: 0.36,
  vocalLowpassHz: 7800,
  vocalLowpassQ: 0.4,
  vocalHallGain: 0.2,
  noirSwellBars: 4,
  noirSwellLengthBars: 0.75,
  noirSwellLeadScale: 0.06,
  vinylBandpassHz: 1800,
  vinylQ: 0.9,
  vinylGain: 0.0055,
});

const VOCAL_LOADERS: Readonly<Record<TrackMood, () => Promise<{ readonly default: string }>>> = {
  menu: () => import('./vocals/menu.mp3'),
  calm: () => import('./vocals/calm.mp3'),
  proposals: () => import('./vocals/proposals.mp3'),
  final: () => import('./vocals/final.mp3'),
  council: () => import('./vocals/council.mp3'),
  story: () => import('./vocals/story.mp3'),
  beach: () => import('./vocals/beach.mp3'),
  academy: () => import('./vocals/academy.mp3'),
  victory: () => import('./vocals/victory.mp3'),
  defeat: () => import('./vocals/defeat.mp3'),
};

const NOIR_MOODS = new Set<TrackMood>(['menu', 'calm', 'proposals', 'council', 'story', 'academy', 'defeat']);

const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** Options checked when deciding whether entering a mood should play its vocal clip. */
export interface VocalPlayOptions {
  readonly force?: boolean;
  readonly vocals?: boolean;
  readonly dialogueOpen?: boolean;
}

/** True when a mood transition should play its vocal clip (always on victory/defeat unless disabled or story dialogue is open). */
export function shouldPlayVocal(
  mood: Mood,
  lastPlayedAt: number | undefined,
  nowMs: number,
  options: VocalPlayOptions = {},
): mood is TrackMood {
  const { force = false, vocals = true, dialogueOpen = false } = options;
  if (mood === 'silent' || !vocals || dialogueOpen) return false;
  if (force || mood === 'victory' || mood === 'defeat' || lastPlayedAt === undefined) return true;
  return nowMs - lastPlayedAt >= AUDIO_CONFIG.vocalCooldownMs;
}

/** True when `value` is a supported music choice key. */
export function isMusicChoice(value: unknown): value is MusicChoice {
  return typeof value === 'string' && (MUSIC_CHOICES as readonly string[]).includes(value);
}

/** Resolves the music mood to play given the scene's mood and player's choice. */
export function musicMood(requested: Mood, choice: MusicChoice): Mood {
  if (requested === 'silent') return 'silent';
  return choice === 'dynamic' ? requested : choice;
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
        vocals: v.vocals !== false,
        musicChoice: isMusicChoice(v.musicChoice) ? v.musicChoice : defaults.musicChoice,
      };
    }
  } catch {
    return { ...defaults };
  }
  return { ...defaults };
}

/** Synthesizes Web Audio music/SFX/ambience, mixes spoken mood vocals, and saves settings. */
export class AudioEngine {
  #ctx: AudioContext | null = null;
  #master: GainNode | null = null;
  #musicBus: GainNode | null = null;
  #musicDuck: GainNode | null = null;
  #vocalBus: GainNode | null = null;
  #sfxBus: GainNode | null = null;
  #ambBus: GainNode | null = null;
  #reverb: ConvolverNode | null = null;
  #noise: AudioBuffer | null = null;
  #settings: AudioSettings = loadSettings();
  #requestedMood: Mood = 'silent';
  #mood: Mood = 'silent';
  #moodGain: GainNode | null = null;
  #timer = 0;
  #composer: Composer | null = null;
  #barCount = 0;
  #nextBar = 0;
  #lead: LeadVoice | null = null;
  #vinyl: AudioBufferSourceNode | null = null;
  #hall: ConvolverNode | null = null;
  #wind: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  #rain: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  #lastStep = 0;
  readonly #listeners = new Set<() => void>();
  #held = false;
  #dialogueOpen = false;
  readonly #vocalBuffers = new Map<TrackMood, AudioBuffer>();
  readonly #vocalPending = new Map<TrackMood, Promise<AudioBuffer | null>>();
  readonly #lastVocalAt = new Map<TrackMood, number>();
  #vocalEpoch = 0;
  #vocalCueTimer = 0;
  #vocalPlaying: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

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
    this.#musicDuck.gain.value = 1;
    this.#vocalBus = ctx.createGain();
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
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = AUDIO_CONFIG.musicLowpassHz;
    tone.Q.value = AUDIO_CONFIG.musicLowpassQ;
    this.#musicBus.connect(this.#musicDuck).connect(tone).connect(this.#master);
    this.#hall = ctx.createConvolver();
    this.#hall.buffer = this.#impulse(AUDIO_CONFIG.hallDurationS, AUDIO_CONFIG.hallDecay);
    const hallDamp = ctx.createBiquadFilter();
    hallDamp.type = 'lowpass';
    hallDamp.frequency.value = AUDIO_CONFIG.hallDampHz;
    const hallWet = ctx.createGain();
    hallWet.gain.value = AUDIO_CONFIG.hallWetGain;
    tone.connect(this.#hall).connect(hallDamp).connect(hallWet).connect(this.#master);
    const vocalTone = ctx.createBiquadFilter();
    vocalTone.type = 'lowpass';
    vocalTone.frequency.value = AUDIO_CONFIG.vocalLowpassHz;
    vocalTone.Q.value = AUDIO_CONFIG.vocalLowpassQ;
    const vocalHall = ctx.createGain();
    vocalHall.gain.value = AUDIO_CONFIG.vocalHallGain;
    this.#vocalBus.connect(vocalTone).connect(this.#master);
    vocalTone.connect(vocalHall).connect(this.#hall);
    this.#noise = this.#noiseBuffer(2);
    this.#apply();
    this.#startWind();
    this.#mood = 'silent';
    this.#playMood(this.#selectedMood());
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

  /** Persists a partial settings update, updates audio buses, and stops or cues vocals accordingly. */
  update(patch: Partial<AudioSettings>): void {
    const prevAudible = !this.#settings.muted && this.#settings.music > 0;
    const prevVocals = this.#settings.vocals;
    const musicChoiceChanged = patch.musicChoice !== undefined && patch.musicChoice !== this.#settings.musicChoice;
    this.#settings = { ...this.#settings, ...patch };
    saveSettings(this.#settings);
    this.#apply();
    const nowAudible = !this.#settings.muted && this.#settings.music > 0;
    if (!nowAudible || !this.#settings.vocals) {
      this.#stopVocal(this.#ctx?.currentTime ?? 0);
    }
    if (musicChoiceChanged) this.#playMood(this.#selectedMood(), true);
    else if (nowAudible && this.#settings.vocals && (!prevAudible || !prevVocals) && this.#mood !== 'silent' && this.#vocalPlaying === null) {
      this.#cueVocal(this.#mood, false);
    }
    for (const fn of this.#listeners) fn();
  }

  #apply(): void {
    const ctx = this.#ctx;
    if (ctx === null || this.#master === null) return;
    const t = ctx.currentTime;
    this.#master.gain.setTargetAtTime(this.#settings.muted ? 0 : AUDIO_CONFIG.masterGain, t, AUDIO_CONFIG.fastRampTcS);
    this.#musicBus?.gain.setTargetAtTime(this.#settings.music * AUDIO_CONFIG.musicBusGain, t, AUDIO_CONFIG.busRampTcS);
    this.#vocalBus?.gain.setTargetAtTime(this.#settings.music * AUDIO_CONFIG.vocalBusGain, t, AUDIO_CONFIG.busRampTcS);
    this.#sfxBus?.gain.setTargetAtTime(this.#settings.sfx, t, AUDIO_CONFIG.fastRampTcS);
    this.#ambBus?.gain.setTargetAtTime(this.#settings.sfx * AUDIO_CONFIG.ambBusScale, t, AUDIO_CONFIG.busRampTcS);
  }

  /** Crossfades to the music for a place or moment. */
  setMood(mood: Mood): void {
    this.#requestedMood = mood;
    this.#playMood(this.#selectedMood());
  }

  /** Blocks new vocals and fades out any playing or pending vocal while story dialogue is open. */
  setDialogueOpen(open: boolean): void {
    if (this.#dialogueOpen === open) return;
    this.#dialogueOpen = open;
    if (open) this.#stopVocal(this.#ctx?.currentTime ?? 0);
  }

  #selectedMood(): Mood {
    return musicMood(this.#requestedMood, this.#settings.musicChoice);
  }

  #playMood(mood: Mood, forceVocal = false): void {
    if (mood === this.#mood && !forceVocal) return;
    this.#mood = mood;
    const ctx = this.#ctx;
    if (ctx === null || this.#musicBus === null) return;
    this.#stopVocal(ctx.currentTime);
    const old = this.#moodGain;
    if (old !== null) {
      fadeOut(old.gain, ctx.currentTime, AUDIO_CONFIG.moodFadeOutTcS);
      window.setTimeout(() => {
        old.disconnect();
      }, AUDIO_CONFIG.moodDisconnectMs);
    }
    if (this.#vinyl !== null) {
      try {
        this.#vinyl.stop(ctx.currentTime + AUDIO_CONFIG.vinylStopDelayS);
      } catch {
        this.#vinyl = null;
      }
      this.#vinyl = null;
    }
    this.#lead?.stop(ctx.currentTime);
    this.#lead = null;
    window.clearInterval(this.#timer);
    this.#moodGain = null;
    this.#composer = null;
    this.#barCount = 0;
    if (mood === 'silent') return;
    const spec = MOODS[mood];
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(AUDIO_CONFIG.moodGainBoost, ctx.currentTime, AUDIO_CONFIG.moodFadeInTcS);
    gain.connect(this.#musicBus);
    this.#moodGain = gain;
    this.#composer = new Composer(spec);
    this.#lead = spec.lead > 0 ? new LeadVoice(ctx, gain, mood === 'story' || mood === 'council' || mood === 'defeat' ? 'sine' : 'triangle') : null;
    if (NOIR_MOODS.has(mood)) this.#startVinyl(gain);
    this.#nextBar = ctx.currentTime + 0.15;
    this.#timer = window.setInterval(() => {
      this.#schedule();
    }, AUDIO_CONFIG.tickMs);
    this.#cueVocal(mood, forceVocal);
  }

  #stopVocal(now: number): void {
    this.#vocalEpoch += 1;
    window.clearTimeout(this.#vocalCueTimer);
    this.#vocalCueTimer = 0;
    const playing = this.#vocalPlaying;
    if (playing !== null) {
      this.#vocalPlaying = null;
      fadeOut(playing.gain.gain, now, AUDIO_CONFIG.vocalFadeOutTcS);
      try {
        playing.src.stop(now + AUDIO_CONFIG.vocalStopDelayS);
      } catch {
        this.#vocalPlaying = null;
      }
      window.setTimeout(() => {
        playing.gain.disconnect();
      }, AUDIO_CONFIG.vocalDisconnectMs);
    }
    this.#musicDuck?.gain.setTargetAtTime(1, now, AUDIO_CONFIG.vocalUnduckTcS);
  }

  #cueVocal(mood: Mood, force: boolean): void {
    const ctx = this.#ctx;
    if (ctx === null || mood === 'silent' || this.#settings.muted || this.#settings.music <= 0) return;
    if (!shouldPlayVocal(mood, this.#lastVocalAt.get(mood), Date.now(), { force, vocals: this.#settings.vocals, dialogueOpen: this.#dialogueOpen })) return;
    const epoch = this.#vocalEpoch;
    this.#vocalCueTimer = window.setTimeout(() => {
      void this.#playVocal(mood, epoch);
    }, AUDIO_CONFIG.vocalDelayMs);
  }

  async #playVocal(mood: TrackMood, epoch: number): Promise<void> {
    const ctx = this.#ctx;
    const bus = this.#vocalBus;
    if (ctx === null || bus === null || epoch !== this.#vocalEpoch) return;
    if (this.#dialogueOpen || !this.#settings.vocals || this.#settings.muted || this.#settings.music <= 0) return;
    const buffer = await this.#loadVocal(mood, ctx);
    if (buffer === null || epoch !== this.#vocalEpoch || this.#ctx !== ctx) return;
    this.#lastVocalAt.set(mood, Date.now());
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + AUDIO_CONFIG.vocalFadeInS);
    gain.connect(bus);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(gain);
    this.#musicDuck?.gain.setTargetAtTime(AUDIO_CONFIG.vocalDuckGain, now, AUDIO_CONFIG.vocalDuckTcS);
    this.#vocalPlaying = { src, gain };
    src.onended = () => {
      gain.disconnect();
      if (this.#vocalPlaying?.src === src) this.#vocalPlaying = null;
      if (epoch !== this.#vocalEpoch) return;
      this.#musicDuck?.gain.setTargetAtTime(1, ctx.currentTime, AUDIO_CONFIG.vocalUnduckTcS);
    };
    src.start(now + AUDIO_CONFIG.vocalStartOffsetS);
  }

  async #loadVocal(mood: TrackMood, ctx: AudioContext): Promise<AudioBuffer | null> {
    const cached = this.#vocalBuffers.get(mood);
    if (cached !== undefined) return cached;
    const pending = this.#vocalPending.get(mood);
    if (pending !== undefined) return pending;
    const load = (async (): Promise<AudioBuffer | null> => {
      try {
        const mod = await VOCAL_LOADERS[mood]();
        const res = await fetch(mod.default);
        if (!res.ok) return null;
        const bytes = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(bytes);
        this.#vocalBuffers.set(mood, decoded);
        return decoded;
      } catch {
        return null;
      } finally {
        this.#vocalPending.delete(mood);
      }
    })();
    this.#vocalPending.set(mood, load);
    return load;
  }

  // Look-ahead scheduler: whole bars are timed on the audio clock, never on timers, so they never drift.
  #schedule(): void {
    const ctx = this.#ctx;
    const out = this.#moodGain;
    const composer = this.#composer;
    if (ctx === null || out === null || composer === null) return;
    const sixteenth = 60 / composer.spec.bpm / 4;
    if (this.#nextBar < ctx.currentTime - 1) this.#nextBar = ctx.currentTime + 0.05;
    while (this.#nextBar < ctx.currentTime + AUDIO_CONFIG.lookaheadS) {
      this.#playBar(composer.next(), this.#nextBar, sixteenth, out, this.#barCount);
      this.#barCount += 1;
      this.#nextBar += sixteenth * STEPS_PER_BAR;
    }
  }

  #playBar(plan: BarPlan, t: number, sixteenth: number, out: GainNode, barIndex: number): void {
    const spec = this.#composer?.spec;
    if (spec === undefined) return;
    const bar = sixteenth * STEPS_PER_BAR;
    for (const m of plan.pad) this.#pad(hz(m), t, bar, spec.pad * 0.06, out);
    for (const e of plan.bass) this.#bass(hz(e.midi), t + e.at * sixteenth, e.len * sixteenth, spec.bass * 0.2, out);
    for (const e of plan.arp) {
      const at = t + e.at * sixteenth;
      const level = spec.arp * (e.at % 4 === 0 ? 0.075 : 0.055) * (0.9 + Math.random() * 0.2);
      if (spec.arpVoice === 'pluck') this.#pluck(hz(e.midi), at + Math.random() * 0.008, level * 2.4, out, 3.2);
      else this.#keys(hz(e.midi), at + Math.random() * 0.008, e.len * sixteenth, level, out);
    }
    for (const e of plan.lead) this.#lead?.note(hz(e.midi), t + e.at * sixteenth, e.len * sixteenth, spec.lead * 0.11, e.tied, e.release);
    if (barIndex % AUDIO_CONFIG.noirSwellBars === 0 && this.#mood !== 'silent' && NOIR_MOODS.has(this.#mood)) {
      const anchor = plan.lead[0];
      if (anchor !== undefined) this.#noirSwell(hz(anchor.midi), t + anchor.at * sixteenth, bar * AUDIO_CONFIG.noirSwellLengthBars, spec.lead * AUDIO_CONFIG.noirSwellLeadScale, out);
    }
    for (const e of plan.bells) this.#bell(hz(e.midi), t + e.at * sixteenth, spec.bell * 0.05, out, 4, 2, 0.6);
    for (const e of plan.pulse) {
      if (e.kind === 'thump') this.#thump(t + e.at * sixteenth, e.level * 0.28, out);
      else this.#shaker(t + e.at * sixteenth, e.level * 0.05, out);
    }
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

  // A warm pad: detuned triangles with a slow swell and a long release that overlaps the next chord.
  #pad(freq: number, t: number, length: number, level: number, out: AudioNode): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(1550, freq * 4.5);
    filter.Q.value = 0.3;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + Math.min(1.6, length * 0.45));
    env.gain.setValueAtTime(level, t + length);
    env.gain.setTargetAtTime(0, t + length, 0.9);
    filter.connect(env).connect(out);
    const stop = t + length + 4.5;
    for (const [type, detune, gain] of [['triangle', -7, 1], ['triangle', 7, 1], ['sine', 0, 0.85]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(filter);
      o.start(t);
      o.stop(stop);
    }
  }

  // Soft muted harbour-noir brass swell for phrase downbeats.
  #noirSwell(freq: number, t: number, length: number, level: number, out: AudioNode): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(700, freq * 2.2), t);
    filter.frequency.linearRampToValueAtTime(Math.min(1400, freq * 4), t + length * 0.45);
    filter.frequency.setTargetAtTime(520, t + length * 0.65, 0.4);
    filter.Q.value = 0.8;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + Math.min(0.65, length * 0.35));
    env.gain.setTargetAtTime(0, t + length * 0.7, 0.55);
    filter.connect(env).connect(out);
    const stop = t + length + 2.5;
    for (const [type, detune, gain] of [['sawtooth', -4, 0.35], ['triangle', 3, 0.65]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(filter);
      o.start(t);
      o.stop(stop);
    }
  }

  // Subtle late-night lo-fi vinyl warmth behind noir moods.
  #startVinyl(out: AudioNode): void {
    const ctx = this.#ctx;
    if (ctx === null || this.#noise === null) return;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = AUDIO_CONFIG.vinylBandpassHz;
    bp.Q.value = AUDIO_CONFIG.vinylQ;
    const gain = ctx.createGain();
    gain.gain.value = AUDIO_CONFIG.vinylGain;
    src.connect(bp).connect(gain).connect(out);
    src.start();
    this.#vinyl = src;
  }

  // Warm Rhodes electric-piano keys: a gentle chime transient that settles into round sine warmth.
  #keys(freq: number, t: number, length: number, level: number, out: AudioNode): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    car.frequency.value = freq;
    mod.frequency.value = freq * 2;
    modGain.gain.setValueAtTime(freq * 0.85, t);
    modGain.gain.setTargetAtTime(freq * 0.015, t, 0.14);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.012);
    env.gain.setTargetAtTime(level * 0.38, t + 0.02, 0.42);
    env.gain.setTargetAtTime(0, t + length, 0.38);
    mod.connect(modGain).connect(car.frequency);
    car.connect(env).connect(out);
    const stop = t + length + 2;
    car.start(t);
    mod.start(t);
    car.stop(stop);
    mod.stop(stop);
  }

  // A round bass: sine with a filtered triangle for body, legato with a soft release.
  #bass(freq: number, t: number, length: number, level: number, out: AudioNode): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.05);
    env.gain.setTargetAtTime(level * 0.7, t + 0.05, 0.6);
    env.gain.setTargetAtTime(0, t + length * 0.95, 0.12);
    filter.connect(env).connect(out);
    for (const type of ['sine', 'triangle'] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.connect(filter);
      o.start(t);
      o.stop(t + length + 1);
    }
  }

  // A felt-soft heartbeat instead of a drum kick.
  #thump(t: number, level: number, out: AudioNode): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(72, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.25);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o.connect(env).connect(out);
    o.start(t);
    o.stop(t + 0.45);
  }

  // A shaker that fades in over a few milliseconds, so it whispers rather than clicks.
  #shaker(t: number, level: number, out: AudioNode): void {
    const ctx = this.#ctx;
    if (ctx === null || this.#noise === null) return;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 5200;
    f.Q.value = 0.7;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.014);
    env.gain.exponentialRampToValueAtTime(0.0005, t + 0.11);
    src.connect(f).connect(env).connect(out);
    src.start(t, Math.random() * 1.5, 0.13);
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

  #surf: { src: AudioBufferSourceNode; gain: GainNode; lfo: OscillatorNode; lfo2: OscillatorNode } | null = null;

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

// The melody voice: one held oscillator pair per mood that glides between notes (portamento),
// swells on each note and breathes out at rests, with a slow vibrato like a singer's.
class LeadVoice {
  readonly #osc: OscillatorNode[];
  readonly #lfo: OscillatorNode;
  readonly #gain: GainNode;

  constructor(ctx: AudioContext, out: AudioNode, type: OscillatorType) {
    this.#gain = ctx.createGain();
    this.#gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    filter.Q.value = 0.4;
    this.#gain.connect(filter).connect(out);
    this.#lfo = ctx.createOscillator();
    this.#lfo.frequency.value = 4.8;
    const depth = ctx.createGain();
    depth.gain.value = 7;
    this.#lfo.connect(depth);
    const voices: readonly { readonly kind: OscillatorType; readonly detune: number; readonly level: number }[] = [
      { kind: type, detune: -3, level: 0.6 },
      { kind: 'sine', detune: 4, level: 0.36 },
    ];
    this.#osc = voices.map((v) => {
      const o = ctx.createOscillator();
      o.type = v.kind;
      o.detune.value = v.detune;
      depth.connect(o.detune);
      const g = ctx.createGain();
      g.gain.value = v.level;
      o.connect(g).connect(this.#gain);
      o.start();
      return o;
    });
    this.#lfo.start();
  }

  note(freq: number, t: number, length: number, level: number, tied: boolean, release: boolean): void {
    for (const o of this.#osc) {
      // Tied notes glide; a fresh note after a rest starts on pitch.
      if (tied) o.frequency.setTargetAtTime(freq, t, 0.05);
      else o.frequency.setValueAtTime(freq, t);
    }
    const g = this.#gain.gain;
    g.setTargetAtTime(level, t, tied ? 0.06 : 0.09);
    g.setTargetAtTime(level * 0.72, t + Math.min(0.35, length * 0.5), 0.7);
    if (release) g.setTargetAtTime(0, t + length * 0.92, 0.22);
  }

  stop(now: number): void {
    fadeOut(this.#gain.gain, now, 0.4);
    for (const o of [...this.#osc, this.#lfo]) o.stop(now + 4);
  }
}
