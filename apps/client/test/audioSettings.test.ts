// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import page from '../index.html?raw';
import {
  AUDIO_CONFIG,
  AudioEngine,
  MUSIC_CHOICES,
  MUSIC_STYLES,
  TRACK_LOADERS,
  audio,
  isMusicChoice,
  isMusicStyle,
  musicMood,
  resolveMusicStyle,
  type TrackMood,
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
  return {
    ...extra,
    disconnect: vi.fn(),
    connect: vi.fn((dest: unknown) => dest),
  };
}

function installFakeAudio(options: { readonly deferDecode?: boolean } = {}): {
  trackSources: RecordedSource[];
  trackGains: RecordedGain[];
  musicDuckGains: RecordedParam[];
  fetchMock: ReturnType<typeof vi.fn>;
  decodeResolvers: Array<() => void>;
} {
  const trackBuffers = new Set<AudioBuffer>();
  const trackSources: RecordedSource[] = [];
  const trackGains: RecordedGain[] = [];
  const musicDuckGains: RecordedParam[] = [];
  const decodeResolvers: Array<() => void> = [];
  let gainCount = 0;

  class FakeAudioContext {
    currentTime = 10;
    readonly sampleRate = 48_000;
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
          if (src.buffer !== null && trackBuffers.has(src.buffer) && typeof dest === 'object' && dest !== null && 'gain' in dest) {
            trackGains.push(dest as RecordedGain);
          }
          return dest;
        }),
        start: vi.fn(() => {
          if (src.buffer !== null && trackBuffers.has(src.buffer)) trackSources.push(src);
        }),
        stop: vi.fn(),
      };
      return src;
    }

    decodeAudioData = vi.fn(() => {
      const buffer = { duration: 200 } as AudioBuffer;
      trackBuffers.add(buffer);
      if (options.deferDecode) {
        return new Promise<AudioBuffer>((resolve) => {
          decodeResolvers.push(() => {
            resolve(buffer);
          });
        });
      }
      return Promise.resolve(buffer);
    });
  }

  const fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) } as Response),
  );
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('fetch', fetchMock);
  return {
    trackSources,
    trackGains,
    musicDuckGains,
    fetchMock,
    decodeResolvers,
  };
}

function loadPage(): void {
  const doc = new DOMParser().parseFromString(page, 'text/html');
  for (const script of doc.querySelectorAll('script')) script.remove();
  document.body.replaceChildren(...Array.from(doc.body.childNodes, (n) => document.importNode(n, true)));
}

async function flushAsync(): Promise<void> {
  await vi.dynamicImportSettled();
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('music selection and generated soundtracks', () => {
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

  it('accepts only supported music choices and soundtrack styles', () => {
    for (const choice of MUSIC_CHOICES) expect(isMusicChoice(choice)).toBe(true);
    for (const value of ['off', 'silent', 'unknown', 1, null]) expect(isMusicChoice(value)).toBe(false);

    for (const style of MUSIC_STYLES) expect(isMusicStyle(style)).toBe(true);
    for (const value of ['latin', 'old', '', 1, null]) expect(isMusicStyle(value)).toBe(false);
  });

  it('keeps scene-aware music in adaptive mode and pins explicit themes', () => {
    expect(musicMood('proposals', 'dynamic')).toBe('proposals');
    expect(musicMood('beach', 'dynamic')).toBe('beach');
    expect(musicMood('proposals', 'council')).toBe('council');
    expect(musicMood('silent', 'council')).toBe('silent');
  });

  it('resolves auto soundtrack to Hindi songs for Hindi locale and Western instrumental otherwise', () => {
    expect(resolveMusicStyle('auto', 'hi')).toBe('hindi');
    for (const locale of ['en', 'es', 'fr', 'sw', 'ha', 'zu']) {
      expect(resolveMusicStyle('auto', locale)).toBe('western');
    }
    expect(resolveMusicStyle('indian', 'en')).toBe('indian');
    expect(resolveMusicStyle('hindi', 'en')).toBe('hindi');
    expect(resolveMusicStyle('western', 'hi')).toBe('western');
  });

  it('provides all 10 scene moods across all 3 generated soundtrack sets', async () => {
    const moods: TrackMood[] = ['menu', 'calm', 'proposals', 'final', 'council', 'story', 'beach', 'academy', 'victory', 'defeat'];
    for (const style of ['western', 'indian', 'hindi'] as const) {
      for (const mood of moods) {
        const mod = await TRACK_LOADERS[style][mood]();
        expect(mod.default, `${style}:${mood}`).toMatch(/\.mp3$/);
      }
    }
  });

  it('lazily loads tracks when audible, skips fetching when muted, and crossfades on mood or style change', async () => {
    const env = installFakeAudio();
    const engine = new AudioEngine();
    engine.setMood('menu');
    await flushAsync();
    expect(env.fetchMock).not.toHaveBeenCalled();

    engine.unlock();
    await flushAsync();
    expect(env.fetchMock).toHaveBeenCalledTimes(1);
    expect(env.trackSources).toHaveLength(1);
    expect(env.trackSources[0]?.loop).toBe(true);
    expect(env.trackSources[0]?.start).toHaveBeenCalledTimes(1);

    engine.setMood('beach');
    await flushAsync();
    expect(env.fetchMock).toHaveBeenCalledTimes(2);
    expect(env.trackSources).toHaveLength(2);
    expect(env.trackSources[0]?.stop).toHaveBeenCalled();
    expect(env.trackGains[0]?.gain.cancelAndHoldAtTime).toHaveBeenCalled();

    engine.update({ musicStyle: 'indian' });
    await flushAsync();
    expect(env.fetchMock).toHaveBeenCalledTimes(3);
    expect(env.trackSources).toHaveLength(3);
    expect(env.trackSources[1]?.stop).toHaveBeenCalled();

    engine.update({ music: 0 });
    await flushAsync();
    expect(env.trackSources[2]?.stop).toHaveBeenCalled();
    engine.setMood('council');
    await flushAsync();
    expect(env.fetchMock).toHaveBeenCalledTimes(3);

    engine.setMood('silent');
  });

  it('switches soundtrack on language changes only when musicStyle is auto', async () => {
    const env = installFakeAudio();
    const engine = new AudioEngine();
    engine.unlock();
    engine.setMood('menu');
    await flushAsync();
    expect(env.trackSources).toHaveLength(1);
    expect(String(env.fetchMock.mock.calls[0]?.[0])).toContain('western');

    engine.setLocale('hi');
    await flushAsync();
    expect(env.trackSources).toHaveLength(2);
    expect(String(env.fetchMock.mock.calls[1]?.[0])).toContain('hindi');

    engine.update({ musicStyle: 'indian' });
    await flushAsync();
    expect(env.trackSources).toHaveLength(3);
    expect(String(env.fetchMock.mock.calls[2]?.[0])).toContain('indian');

    engine.setLocale('en');
    await flushAsync();
    expect(env.trackSources).toHaveLength(3);

    engine.setMood('silent');
  });

  it('cancels stale in-flight track loads on rapid mood transitions and keeps decoded buffer cache bounded', async () => {
    const env = installFakeAudio({ deferDecode: true });
    const engine = new AudioEngine();
    engine.unlock();
    engine.setMood('menu');
    await vi.dynamicImportSettled();
    await Promise.resolve();
    expect(env.decodeResolvers).toHaveLength(1);

    engine.setMood('calm');
    await vi.dynamicImportSettled();
    await Promise.resolve();
    expect(env.decodeResolvers).toHaveLength(2);

    env.decodeResolvers[0]?.();
    await flushAsync();
    expect(env.trackSources).toHaveLength(0);

    env.decodeResolvers[1]?.();
    await flushAsync();
    expect(env.trackSources).toHaveLength(1);

    const fastEnv = installFakeAudio();
    const cachedEngine = new AudioEngine();
    cachedEngine.unlock();
    for (const mood of ['menu', 'calm', 'proposals', 'final'] as const) {
      cachedEngine.setMood(mood);
      await flushAsync();
    }
    expect(fastEnv.fetchMock).toHaveBeenCalledTimes(4);

    // `final`, `proposals`, and `calm` are the 3 MRU entries; `proposals` is a cache hit, while `menu` was evicted.
    cachedEngine.setMood('proposals');
    await flushAsync();
    expect(fastEnv.fetchMock).toHaveBeenCalledTimes(4);

    cachedEngine.setMood('menu');
    await flushAsync();
    expect(fastEnv.fetchMock).toHaveBeenCalledTimes(5);

    cachedEngine.setMood('silent');
  });

  it('ducks music while story dialogue is open and notifies audio on Dialogue show/hide', async () => {
    const env = installFakeAudio();
    const engine = new AudioEngine();
    engine.unlock();
    engine.setMood('story');
    await flushAsync();
    const duckGain = env.musicDuckGains[0];

    engine.setDialogueOpen(true);
    expect(duckGain?.setTargetAtTime).toHaveBeenLastCalledWith(
      AUDIO_CONFIG.dialogueDuckGain,
      expect.any(Number),
      AUDIO_CONFIG.dialogueDuckTcS,
    );

    engine.setDialogueOpen(false);
    expect(duckGain?.setTargetAtTime).toHaveBeenLastCalledWith(
      1,
      expect.any(Number),
      AUDIO_CONFIG.dialogueUnduckTcS,
    );
    engine.setMood('silent');

    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
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

  it('persists musicStyle and defaults legacy saved audio settings cleanly to auto', () => {
    const fresh = new AudioEngine();
    expect(fresh.settings.musicStyle).toBe('auto');

    localStorage.setItem(
      AUDIO_CONFIG.storageKey,
      JSON.stringify({ muted: false, music: 0.55, sfx: 0.8, vocals: true, musicChoice: 'dynamic' }),
    );
    expect(new AudioEngine().settings.musicStyle).toBe('auto');

    fresh.update({ musicStyle: 'hindi' });
    const saved = JSON.parse(localStorage.getItem(AUDIO_CONFIG.storageKey) ?? '{}') as { musicStyle?: string };
    expect(saved.musicStyle).toBe('hindi');
    expect(new AudioEngine().settings.musicStyle).toBe('hindi');
  });
});
