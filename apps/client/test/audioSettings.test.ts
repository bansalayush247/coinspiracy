// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import page from '../index.html?raw';
import {
  AUDIO_CONFIG,
  AudioEngine,
  MUSIC_CHOICES,
  audio,
  isMusicChoice,
  musicMood,
  shouldPlayVocal,
} from '../src/audio/engine.js';
import { Dialogue } from '../src/city/dialogue.js';

interface RecordedParam {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  setTargetAtTime: ReturnType<typeof vi.fn>;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  cancelAndHoldAtTime: ReturnType<typeof vi.fn>;
  cancelScheduledValues: ReturnType<typeof vi.fn>;
}

interface RecordedGain {
  gain: RecordedParam;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

interface RecordedSource {
  buffer: AudioBuffer | null;
  loop: boolean;
  onended: (() => void) | null;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function makeParam(initial = 0): RecordedParam {
  return {
    value: initial,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelAndHoldAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

function makeConnectNode<T extends object>(extra: T): T & { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> } {
  const node = {
    ...extra,
    disconnect: vi.fn(),
    connect: vi.fn((dest: unknown) => dest),
  };
  return node;
}

function installFakeAudio(): {
  vocalSources: RecordedSource[];
  vocalGains: RecordedGain[];
  musicDuckGains: RecordedParam[];
  restore: () => void;
} {
  const vocalBuffer = { duration: 15 } as AudioBuffer;
  const vocalSources: RecordedSource[] = [];
  const vocalGains: RecordedGain[] = [];
  const musicDuckGains: RecordedParam[] = [];
  let gainCount = 0;

  class FakeAudioContext {
    currentTime = 10;
    readonly sampleRate = 24_000;
    readonly destination = {};

    resume = vi.fn(() => Promise.resolve());
    suspend = vi.fn(() => Promise.resolve());

    createGain(): RecordedGain {
      const param = makeParam(0);
      const node = makeConnectNode({ gain: param });
      gainCount += 1;
      if (gainCount === 3) musicDuckGains.push(param);
      return node;
    }

    createDynamicsCompressor() {
      return makeConnectNode({ threshold: makeParam(), ratio: makeParam() });
    }

    createConvolver() {
      return makeConnectNode({ buffer: null as AudioBuffer | null });
    }

    createBiquadFilter() {
      return makeConnectNode({
        type: 'lowpass',
        frequency: makeParam(),
        Q: makeParam(),
      });
    }

    createOscillator() {
      return makeConnectNode({
        type: 'sine',
        frequency: makeParam(),
        detune: makeParam(),
        start: vi.fn(),
        stop: vi.fn(),
      });
    }

    createBuffer(_ch: number, len: number): AudioBuffer {
      const data = new Float32Array(len);
      return { getChannelData: () => data } as unknown as AudioBuffer;
    }

    createBufferSource(): RecordedSource {
      const src: RecordedSource = {
        buffer: null,
        loop: false,
        onended: null,
        connect: vi.fn((dest: unknown) => {
          if (src.buffer === vocalBuffer && typeof dest === 'object' && dest !== null && 'gain' in dest) {
            vocalGains.push(dest as RecordedGain);
          }
          return dest;
        }),
        start: vi.fn(() => {
          if (src.buffer === vocalBuffer) vocalSources.push(src);
        }),
        stop: vi.fn(),
      };
      return src;
    }

    decodeAudioData = vi.fn(() => Promise.resolve(vocalBuffer));
  }

  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) } as Response)),
  );
  return {
    vocalSources,
    vocalGains,
    musicDuckGains,
    restore: () => {
      vi.unstubAllGlobals();
    },
  };
}

function loadPage(): void {
  const doc = new DOMParser().parseFromString(page, 'text/html');
  for (const script of doc.querySelectorAll('script')) script.remove();
  document.body.replaceChildren(...Array.from(doc.body.childNodes, (n) => document.importNode(n, true)));
}

async function flushAsync(): Promise<void> {
  await vi.dynamicImportSettled();
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('music selection', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    localStorage.clear();
    loadPage();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
    document.body.replaceChildren();
  });

  it('accepts only the choices shown to players', () => {
    for (const choice of MUSIC_CHOICES) expect(isMusicChoice(choice)).toBe(true);
    for (const value of ['off', 'silent', 'unknown', 1, null]) expect(isMusicChoice(value)).toBe(false);
  });

  it('keeps scene-aware music in adaptive mode', () => {
    expect(musicMood('proposals', 'dynamic')).toBe('proposals');
    expect(musicMood('beach', 'dynamic')).toBe('beach');
  });

  it('pins a selected theme but still respects silent scenes', () => {
    expect(musicMood('proposals', 'council')).toBe('council');
    expect(musicMood('silent', 'council')).toBe('silent');
  });

  it('enforces vocal rules for cooldowns, end screens, toggle and open dialogue', () => {
    expect(shouldPlayVocal('silent', undefined, 50_000)).toBe(false);
    expect(shouldPlayVocal('menu', undefined, 50_000)).toBe(true);
    expect(shouldPlayVocal('menu', 40_000, 50_000)).toBe(false);
    expect(shouldPlayVocal('menu', 10_000, 50_000)).toBe(true);
    expect(shouldPlayVocal('menu', 49_000, 50_000, { force: true })).toBe(true);
    expect(shouldPlayVocal('menu', undefined, 50_000, { vocals: false })).toBe(false);
    expect(shouldPlayVocal('victory', 49_000, 50_000, { dialogueOpen: true })).toBe(false);
    expect(shouldPlayVocal('victory', 49_000, 50_000)).toBe(true);
    expect(shouldPlayVocal('defeat', 49_000, 50_000)).toBe(true);
  });

  it('plays a mood vocal at most once per entry with no 75s repeat, while victory and defeat replay each entry', async () => {
    const audioEnv = installFakeAudio();
    const engine = new AudioEngine();
    engine.unlock();
    engine.setMood('menu');
    await vi.advanceTimersByTimeAsync(AUDIO_CONFIG.vocalDelayMs);
    await flushAsync();
    expect(audioEnv.vocalSources).toHaveLength(1);

    audioEnv.vocalSources[0]?.onended?.();
    await vi.advanceTimersByTimeAsync(200_000);
    await flushAsync();
    expect(audioEnv.vocalSources).toHaveLength(1);

    engine.setMood('menu');
    await vi.advanceTimersByTimeAsync(AUDIO_CONFIG.vocalDelayMs);
    await flushAsync();
    expect(audioEnv.vocalSources).toHaveLength(1);

    engine.setMood('victory');
    await vi.advanceTimersByTimeAsync(AUDIO_CONFIG.vocalDelayMs);
    await flushAsync();
    expect(audioEnv.vocalSources).toHaveLength(2);

    engine.setMood('defeat');
    await vi.advanceTimersByTimeAsync(AUDIO_CONFIG.vocalDelayMs);
    await flushAsync();
    expect(audioEnv.vocalSources).toHaveLength(3);

    engine.setMood('victory');
    await vi.advanceTimersByTimeAsync(AUDIO_CONFIG.vocalDelayMs);
    await flushAsync();
    expect(audioEnv.vocalSources).toHaveLength(4);

    engine.setMood('silent');
  });

  it('stops a playing vocal and blocks new ones while dialogue is open, without replaying on close', async () => {
    const audioEnv = installFakeAudio();
    const engine = new AudioEngine();
    engine.unlock();

    engine.setMood('calm');
    await vi.advanceTimersByTimeAsync(AUDIO_CONFIG.vocalDelayMs);
    await flushAsync();
    expect(audioEnv.vocalSources).toHaveLength(1);
    const duckGain = audioEnv.musicDuckGains[0];

    engine.setDialogueOpen(true);
    expect(audioEnv.vocalGains[0]?.gain.cancelAndHoldAtTime).toHaveBeenCalled();
    expect(audioEnv.vocalGains[0]?.gain.setTargetAtTime).toHaveBeenCalledWith(
      0,
      expect.any(Number),
      AUDIO_CONFIG.vocalFadeOutTcS,
    );
    expect(audioEnv.vocalSources[0]?.stop).toHaveBeenCalled();
    expect(duckGain?.setTargetAtTime).toHaveBeenLastCalledWith(
      1,
      expect.any(Number),
      AUDIO_CONFIG.vocalUnduckTcS,
    );

    engine.setMood('story');
    await vi.advanceTimersByTimeAsync(AUDIO_CONFIG.vocalDelayMs);
    await flushAsync();
    expect(audioEnv.vocalSources).toHaveLength(1);

    engine.update({ musicChoice: 'story' });
    await vi.advanceTimersByTimeAsync(AUDIO_CONFIG.vocalDelayMs);
    await flushAsync();
    expect(audioEnv.vocalSources).toHaveLength(1);

    engine.setDialogueOpen(false);
    await vi.advanceTimersByTimeAsync(120_000);
    await flushAsync();
    expect(audioEnv.vocalSources).toHaveLength(1);

    engine.setMood('menu');
    engine.setDialogueOpen(true);
    await vi.advanceTimersByTimeAsync(AUDIO_CONFIG.vocalDelayMs);
    await flushAsync();
    expect(audioEnv.vocalSources).toHaveLength(1);

    engine.setDialogueOpen(false);
    engine.update({ musicChoice: 'dynamic' });
    engine.setMood('beach');
    await vi.advanceTimersByTimeAsync(AUDIO_CONFIG.vocalDelayMs);
    await flushAsync();
    expect(audioEnv.vocalSources).toHaveLength(2);

    engine.setMood('silent');
  });

  it('notifies audio when story dialogue opens and closes', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, media: '', onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })),
    );
    loadPage();
    const spy = vi.spyOn(audio, 'setDialogueOpen');
    const dialogue = new Dialogue();
    dialogue.show('pell', 1, new Set(), '');
    expect(spy).toHaveBeenCalledWith(true);
    dialogue.hide();
    expect(spy).toHaveBeenCalledWith(false);
    spy.mockRestore();
  });

  it('saves and loads the vocals setting (default on) and stops a playing vocal cleanly when turned off', async () => {
    const audioEnv = installFakeAudio();
    const fresh = new AudioEngine();
    expect(fresh.settings.vocals).toBe(true);

    localStorage.setItem(
      AUDIO_CONFIG.storageKey,
      JSON.stringify({ muted: false, music: 0.55, sfx: 0.8, musicChoice: 'dynamic' }),
    );
    expect(new AudioEngine().settings.vocals).toBe(true);

    fresh.unlock();
    fresh.setMood('calm');
    await vi.advanceTimersByTimeAsync(AUDIO_CONFIG.vocalDelayMs);
    await flushAsync();
    expect(audioEnv.vocalSources).toHaveLength(1);
    const duckGain = audioEnv.musicDuckGains[0];
    expect(duckGain?.setTargetAtTime).toHaveBeenCalledWith(
      AUDIO_CONFIG.vocalDuckGain,
      expect.any(Number),
      AUDIO_CONFIG.vocalDuckTcS,
    );

    fresh.update({ vocals: false });
    expect(fresh.settings.vocals).toBe(false);
    const saved = JSON.parse(localStorage.getItem(AUDIO_CONFIG.storageKey) ?? '{}') as { vocals?: boolean };
    expect(saved.vocals).toBe(false);
    expect(audioEnv.vocalGains[0]?.gain.cancelAndHoldAtTime).toHaveBeenCalled();
    expect(audioEnv.vocalGains[0]?.gain.setTargetAtTime).toHaveBeenCalledWith(
      0,
      expect.any(Number),
      AUDIO_CONFIG.vocalFadeOutTcS,
    );
    expect(audioEnv.vocalSources[0]?.stop).toHaveBeenCalled();
    expect(duckGain?.setTargetAtTime).toHaveBeenLastCalledWith(
      1,
      expect.any(Number),
      AUDIO_CONFIG.vocalUnduckTcS,
    );

    const reloaded = new AudioEngine();
    expect(reloaded.settings.vocals).toBe(false);
    reloaded.unlock();
    reloaded.setMood('menu');
    await vi.advanceTimersByTimeAsync(AUDIO_CONFIG.vocalDelayMs);
    await flushAsync();
    expect(audioEnv.vocalSources).toHaveLength(1);

    fresh.setMood('silent');
    reloaded.setMood('silent');
  });
});
