// All sound is synthesized in the browser: no audio files, nothing to license or download.
// Plucked strings use Karplus-Strong (a physical model of a vibrating string); bells use FM with
// inharmonic partials, as real bells ring; music is composed live per mood (composer.ts) and crossfaded.
import { Composer, MOODS, STEPS_PER_BAR, type BarPlan, type Mood } from './composer.js';

export type { Mood };
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
  | 'stepSand';

interface Settings {
  muted: boolean;
  music: number;
  sfx: number;
}

const STORAGE_KEY = 'bc.audio';
const LOOKAHEAD_S = 0.12;
const TICK_MS = 25;

const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const v = JSON.parse(raw) as Partial<Settings>;
      const num = (x: unknown, d: number): number => (typeof x === 'number' && x >= 0 && x <= 1 ? x : d);
      return { muted: v.muted === true, music: num(v.music, 0.55), sfx: num(v.sfx, 0.8) };
    }
  } catch {
    // Storage blocked: defaults.
  }
  return { muted: false, music: 0.55, sfx: 0.8 };
}

export class AudioEngine {
  #ctx: AudioContext | null = null;
  #master: GainNode | null = null;
  #musicBus: GainNode | null = null;
  #sfxBus: GainNode | null = null;
  #ambBus: GainNode | null = null;
  #reverb: ConvolverNode | null = null;
  #noise: AudioBuffer | null = null;
  #settings: Settings = loadSettings();
  #mood: Mood = 'silent';
  #moodGain: GainNode | null = null;
  #timer = 0;
  #composer: Composer | null = null;
  #nextBar = 0;
  #lead: LeadVoice | null = null;
  #hall: ConvolverNode | null = null;
  #wind: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  #rain: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  #lastStep = 0;
  readonly #listeners = new Set<() => void>();

  get settings(): Readonly<Settings> {
    return this.#settings;
  }

  get started(): boolean {
    return this.#ctx !== null;
  }

  // Browsers only allow sound after a user gesture; call this from one.
  unlock(): void {
    if (this.#ctx !== null) {
      void this.#ctx.resume();
      return;
    }
    const Ctx = window.AudioContext as typeof AudioContext | undefined;
    if (Ctx === undefined) return;
    const ctx = new Ctx();
    this.#ctx = ctx;
    this.#master = ctx.createGain();
    // A gentle limiter so stacked effects never clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 8;
    this.#master.connect(limiter).connect(ctx.destination);
    this.#musicBus = ctx.createGain();
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
    // Music gets its own warm chain: a gentle low-pass, then a long, darker hall so notes melt together.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 6000;
    tone.Q.value = 0.5;
    this.#musicBus.connect(tone).connect(this.#master);
    this.#hall = ctx.createConvolver();
    this.#hall.buffer = this.#impulse(4.2, 3.2);
    const hallDamp = ctx.createBiquadFilter();
    hallDamp.type = 'lowpass';
    hallDamp.frequency.value = 3600;
    const hallWet = ctx.createGain();
    hallWet.gain.value = 0.34;
    tone.connect(this.#hall).connect(hallDamp).connect(hallWet).connect(this.#master);
    this.#noise = this.#noiseBuffer(2);
    this.#apply();
    this.#startWind();
    const mood = this.#mood;
    this.#mood = 'silent';
    this.setMood(mood);
  }

  onChange(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  update(patch: Partial<Settings>): void {
    this.#settings = { ...this.#settings, ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#settings));
    } catch {
      // Storage blocked: the setting lasts for this visit only.
    }
    this.#apply();
    for (const fn of this.#listeners) fn();
  }

  #apply(): void {
    const ctx = this.#ctx;
    if (ctx === null || this.#master === null) return;
    const t = ctx.currentTime;
    this.#master.gain.setTargetAtTime(this.#settings.muted ? 0 : 0.9, t, 0.05);
    this.#musicBus?.gain.setTargetAtTime(this.#settings.music * 0.6, t, 0.1);
    this.#sfxBus?.gain.setTargetAtTime(this.#settings.sfx, t, 0.05);
    this.#ambBus?.gain.setTargetAtTime(this.#settings.sfx * 0.7, t, 0.1);
  }

  // Crossfades to the music for a place or moment.
  setMood(mood: Mood): void {
    if (mood === this.#mood) return;
    this.#mood = mood;
    const ctx = this.#ctx;
    if (ctx === null || this.#musicBus === null) return;
    const old = this.#moodGain;
    if (old !== null) {
      old.gain.cancelScheduledValues(ctx.currentTime);
      old.gain.setTargetAtTime(0, ctx.currentTime, 1.1);
      window.setTimeout(() => {
        old.disconnect();
      }, 8000);
    }
    this.#lead?.stop(ctx.currentTime);
    this.#lead = null;
    window.clearInterval(this.#timer);
    this.#moodGain = null;
    this.#composer = null;
    if (mood === 'silent') return;
    const spec = MOODS[mood];
    const gain = ctx.createGain();
    gain.gain.value = 0;
    // Soft instruments sit lower, so the mood bus lifts them about 4 dB.
    gain.gain.setTargetAtTime(1.6, ctx.currentTime, 1.3);
    gain.connect(this.#musicBus);
    this.#moodGain = gain;
    this.#composer = new Composer(spec);
    this.#lead = spec.lead > 0 ? new LeadVoice(ctx, gain, mood === 'story' || mood === 'council' ? 'sine' : 'triangle') : null;
    this.#nextBar = ctx.currentTime + 0.15;
    this.#timer = window.setInterval(() => {
      this.#schedule();
    }, TICK_MS);
  }

  // Look-ahead scheduler: whole bars are timed on the audio clock, never on timers, so they never drift.
  #schedule(): void {
    const ctx = this.#ctx;
    const out = this.#moodGain;
    const composer = this.#composer;
    if (ctx === null || out === null || composer === null) return;
    const sixteenth = 60 / composer.spec.bpm / 4;
    // After a stall (a background tab), skip ahead rather than playing a burst of late bars.
    if (this.#nextBar < ctx.currentTime - 1) this.#nextBar = ctx.currentTime + 0.05;
    while (this.#nextBar < ctx.currentTime + LOOKAHEAD_S) {
      this.#playBar(composer.next(), this.#nextBar, sixteenth, out);
      this.#nextBar += sixteenth * STEPS_PER_BAR;
    }
  }

  #playBar(plan: BarPlan, t: number, sixteenth: number, out: GainNode): void {
    const spec = this.#composer?.spec;
    if (spec === undefined) return;
    const bar = sixteenth * STEPS_PER_BAR;
    for (const m of plan.pad) this.#pad(hz(m), t, bar, spec.pad * 0.06, out);
    for (const e of plan.bass) this.#bass(hz(e.midi), t + e.at * sixteenth, e.len * sixteenth, spec.bass * 0.2, out);
    for (const e of plan.arp) {
      const at = t + e.at * sixteenth;
      // A touch of human timing and touch keeps the arpeggio from sounding mechanical.
      const level = spec.arp * (e.at % 4 === 0 ? 0.075 : 0.055) * (0.9 + Math.random() * 0.2);
      if (spec.arpVoice === 'pluck') this.#pluck(hz(e.midi), at + Math.random() * 0.008, level * 2.4, out, 3.2);
      else this.#keys(hz(e.midi), at + Math.random() * 0.008, e.len * sixteenth, level, out);
    }
    for (const e of plan.lead) this.#lead?.note(hz(e.midi), t + e.at * sixteenth, e.len * sixteenth, spec.lead * 0.11, e.tied, e.release);
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
    filter.frequency.value = Math.min(1800, freq * 5);
    filter.Q.value = 0.3;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + Math.min(1.6, length * 0.45));
    env.gain.setValueAtTime(level, t + length);
    env.gain.setTargetAtTime(0, t + length, 0.9);
    filter.connect(env).connect(out);
    const stop = t + length + 4.5;
    for (const [type, detune, gain] of [['triangle', -6, 1], ['triangle', 6, 1], ['sine', 0, 0.8]] as const) {
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

  // Electric-piano keys: FM at a 1:1 ratio whose brightness fades fast, leaving a round sine.
  #keys(freq: number, t: number, length: number, level: number, out: AudioNode): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    car.frequency.value = freq;
    mod.frequency.value = freq;
    modGain.gain.setValueAtTime(freq * 1.1, t);
    modGain.gain.setTargetAtTime(freq * 0.02, t, 0.18);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.012);
    env.gain.setTargetAtTime(level * 0.35, t + 0.02, 0.4);
    env.gain.setTargetAtTime(0, t + length, 0.35);
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

  // Surf on the lagoon: noise whose volume and brightness swell and fall like waves breaking on sand.
  #surf: { src: AudioBufferSourceNode; gain: GainNode; lfo: OscillatorNode; lfo2: OscillatorNode } | null = null;

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

  // Wind follows the world's wind; rain fades in and out with the weather.
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

export const audio = new AudioEngine();

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
    this.#gain.gain.cancelScheduledValues(now);
    this.#gain.gain.setTargetAtTime(0, now, 0.4);
    for (const o of [...this.#osc, this.#lfo]) o.stop(now + 4);
  }
}
