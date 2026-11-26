// Must stay the first import: zod reads its config when shared's schemas are built.
import './zod-jitless.js';
import './style.css';
import Phaser from 'phaser';
import { Callbacks } from '@colyseus/sdk';
import { ArenaRefusedSchema, BotsRefusedSchema, SERVER_MESSAGES, arenaById, type ArenaRefused, type BotsRefused } from '@byzantine-council/shared';
import type { CouncilState, PlayerState, ProposalState } from '@byzantine-council/shared/state';
import { CitadelScene, SCENE_KEY } from './game/CitadelScene.js';
import { REG_DPR, hiDpiScaleConfig, installHiDpi } from './game/hidpi.js';
import { PlayerInput } from './game/input.js';
import { closeMessage, joinErrorMessage, tokenIsDead } from './net/errors.js';
import { codeFromHash } from './net/invite.js';
import { Session, tokenStore, type GameRoom } from './net/session.js';
import { ProfileApi, type ProfileSummary } from './profile/api.js';
import { ProgressPage } from './profile/progressPage.js';
import { WorldMap } from './profile/worldMap.js';
import { AcademyPanel } from './profile/academy.js';
import { Casebook } from './city/casebook.js';
import { SeasonBanner } from './profile/season.js';
import { StoryBook } from './story/storyBook.js';
import { BEACH_SCENE_KEY, BeachScene } from './beach/BeachScene.js';
import { BeachController } from './beach/beachController.js';
import { CITY_SCENE_KEY, CityScene } from './city/CityScene.js';
import { CityController } from './city/cityController.js';
import { MissionController } from './city/missionController.js';
import type { ActId } from '@byzantine-council/shared/city';
import { ISLAND_SCENE_KEY, IslandScene, type PreviewIslandId } from './explore/IslandScene.js';
import { Wardrobe } from './profile/wardrobe.js';
import { startPlatform, type Platform } from './platform/index.js';
import { registerServiceWorker } from './pwa/register.js';
import { resolveServerEndpoint } from './serverUrl.js';
import { el, h } from './ui/dom.js';
import { NATURE_NOTES, type NatureNote } from './game/atmosphere.js';
import { audio, isMusicChoice, type MusicChoice } from './audio/engine.js';
import { quality, saveQuality } from './game/quality.js';
import { MatchView } from './matchView.js';
import { Hud, type LobbyInfo, type RosterEntry } from './ui/hud.js';
import { Menu, type MenuAction } from './ui/menu.js';
import { bindLanguagePicker, initLocale, onLocaleChange, t, type PlainKey } from './i18n/index.js';

const PING_EVERY_MS = 4000;
const PING_TIMEOUT_MS = 3000;

function hasWebGL(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl') !== null;
  } catch {
    return false;
  }
}

function showFatal(message: string): void {
  const fatal = el('fatal', HTMLDivElement);
  fatal.textContent = message;
  fatal.hidden = false;
}

function startGame(parent: HTMLElement): Promise<CitadelScene> {
  const setup = hiDpiScaleConfig(parent);
  return new Promise((resolve, reject) => {
    // Phaser input is off: the DOM handles keys, touch and wheel (see game/input.ts).
    new Phaser.Game({
      type: Phaser.WEBGL,
      transparent: true,
      antialias: true,
      antialiasGL: true,
      pixelArt: false,
      roundPixels: false,
      powerPreference: 'high-performance',
      banner: false,
      disableContextMenu: true,
      input: { keyboard: false, mouse: false, touch: false, gamepad: false },
      loader: { imageLoadType: 'HTMLImageElement' },
      scale: setup.scale,
      scene: [CitadelScene, BeachScene, IslandScene, CityScene],
      callbacks: {
        preBoot: (game) => {
          game.registry.set(REG_DPR, setup.dpr);
        },
        // The scene has no preload, so its create() has already run here.
        postBoot: (game) => {
          installHiDpi(game, parent);
          const scene = game.scene.getScene(SCENE_KEY);
          if (scene instanceof CitadelScene) resolve(scene);
          else reject(new Error('citadel scene missing'));
        },
      },
    });
  });
}

const BOT_REFUSAL_TEXT: Readonly<Record<BotsRefused['reason'], PlainKey>> = {
  disabled: 'bots.disabled',
  notHost: 'bots.notHost',
  notLobby: 'bots.notLobby',
  roomFull: 'bots.roomFull',
  busy: 'bots.busy',
  limit: 'bots.limit',
  failed: 'bots.failed',
  notABot: 'bots.notABot',
};

const ARENA_REFUSAL_TEXT: Readonly<Record<ArenaRefused['reason'], PlainKey>> = {
  notHost: 'arena.notHost',
  notLobby: 'arena.notLobby',
  notPrivate: 'arena.notPrivate',
  locked: 'arena.locked',
};

const ISLAND_PREVIEWS: Readonly<Record<PreviewIslandId, { name: string; concept: PlainKey; mood: 'menu' | 'calm' | 'proposals' | 'council' | 'final' }>> = {
  mint: { name: 'Mint Island', concept: 'island.concept.mint', mood: 'menu' },
  signing: { name: 'Signing Isle', concept: 'island.concept.signing', mood: 'proposals' },
  council: { name: 'Council Isle', concept: 'island.concept.council', mood: 'council' },
  watchtower: { name: 'Watchtower Peaks', concept: 'island.concept.watchtower', mood: 'final' },
  reef: { name: 'Lightning Reef', concept: 'island.concept.reef', mood: 'calm' },
};

function isPreviewIsland(id: string): id is PreviewIslandId {
  return Object.hasOwn(ISLAND_PREVIEWS, id);
}

class Controller {
  readonly #menu = new Menu();
  readonly #hud = new Hud();
  readonly #input = new PlayerInput(el('stick', HTMLDivElement), el('stick-knob', HTMLDivElement));
  #room: GameRoom | null = null;
  #pingTimer = 0;
  #busy = false;
  #refreshQueued = false;
  // Turned off when the server says practice bots are disabled.
  #botsAvailable = true;
  readonly #match: MatchView;
  // The guest session; joining waits for it so the socket carries the cookie.
  #profileReady: Promise<ProfileSummary | null> = Promise.resolve(null);
  readonly #progressPage = new ProgressPage();
  readonly #world = new WorldMap();
  readonly #season = new SeasonBanner();
  readonly #story = new StoryBook();
  readonly #wardrobe = new Wardrobe();
  #beach: BeachController | null = null;
  #city: CityController | null = null;
  #mission: MissionController | null = null;
  #lastProfile: ProfileSummary | null = null;
  #seasonColors: readonly [string, string] | null = null;
  readonly #academy = new AcademyPanel();
  readonly #casebook = new Casebook();
  readonly #progressChip = el('open-progress', HTMLButtonElement);

  constructor(
    private readonly session: Session,
    private readonly scene: CitadelScene,
    private readonly profiles: ProfileApi,
  ) {
    this.#match = new MatchView(scene, this.#input);
    this.#match.onRewards = () => {
      void this.profiles.profile().then((p) => {
        if (p !== null) this.#setProfile(p);
      });
    };
    this.#match.onToast = (message) => {
      this.#hud.toast(message);
    };
  }

  #setProfile(p: ProfileSummary): void {
    this.#progressPage.setProfile(p);
    this.#world.setProfile(p);
    this.#academy.setProfile(p);
    this.#casebook.setProfile(p);
    this.#wardrobe.setProfile(p);
    this.#beach?.setProfile(p);
    this.#lastProfile = p;
    el('open-wardrobe', HTMLButtonElement).hidden = false;
    const v = p.progress;
    this.#progressChip.hidden = false;
    this.#progressChip.textContent = t('menu.chip', { rank: String(v.rank), sats: p.balance, seals: String(v.seals.filter((s) => s.done).length) });
  }

  #applyProfile(next: Promise<ProfileSummary | null>): void {
    void next.then((p) => {
      if (p === null) this.#hud.toast(t('common.failedRetry'));
      else this.#setProfile(p);
    });
  }

  start(): void {
    this.#progressChip.addEventListener('click', () => {
      this.#progressPage.open();
    });
    this.#academy.connect = async () => {
      await this.#profileReady;
      return this.session.academy();
    };
    this.#academy.onFinished = () => {
      void this.profiles.profile().then((p) => {
        if (p !== null) this.#setProfile(p);
      });
    };
    el('open-academy', HTMLButtonElement).addEventListener('click', () => {
      this.#academy.open();
    });
    this.#progressPage.onTitle = (title) => {
      this.#applyProfile(this.profiles.chooseTitle(title));
    };
    this.#progressPage.onFrame = (frame) => {
      this.#applyProfile(this.profiles.chooseFrame(frame));
    };
    this.#progressPage.onReroll = (quest) => {
      this.#applyProfile(this.profiles.reroll(quest));
    };
    this.#world.setStory(this.#story);
    // Closing the Chronicle also frees a guardian who opened it at their beach hut.
    const storyClosed = this.#story.onClosed;
    this.#story.onClosed = () => {
      storyClosed();
      this.#beach?.holdStill(false);
    };
    this.#world.onNewChapter = (chapter) => {
      audio.play('rankUp');
      this.#hud.toast(t('world.newChapter', { title: chapter.title }));
    };
    this.#world.onVisit = (islandId) => {
      if (islandId === 'beach') void this.#visitBeach();
      else if (isPreviewIsland(islandId)) this.#visitIsland(islandId);
    };
    this.#wardrobe.onClosed = () => {
      this.#beach?.holdStill(false);
    };
    this.#wardrobe.onWear = (look) => {
      void this.profiles.wear(look).then((p) => {
        if (p === null) {
          this.#hud.toast(t('common.failedRetry'));
          return;
        }
        this.#setProfile(p);
        this.#beach?.lookChanged();
      });
    };
    el('open-wardrobe', HTMLButtonElement).addEventListener('click', () => {
      this.#wardrobe.open();
    });
    el('open-city', HTMLButtonElement).addEventListener('click', () => {
      void this.#visitCity();
    });
    el('open-story', HTMLButtonElement).addEventListener('click', () => {
      void this.#playStory({ act: 'dump' });
    });
    el('open-ransom', HTMLButtonElement).addEventListener('click', () => {
      void this.#playStory({ act: 'ransom' });
    });
    el('open-insider', HTMLButtonElement).addEventListener('click', () => {
      void this.#playStory({ act: 'insider' });
    });
    el('open-founder', HTMLButtonElement).addEventListener('click', () => {
      void this.#playStory({ act: 'founder' });
    });
    el('open-overflow', HTMLButtonElement).addEventListener('click', () => {
      void this.#playStory({ act: 'overflow' });
    });
    el('open-split', HTMLButtonElement).addEventListener('click', () => {
      void this.#playStory({ act: 'split' });
    });
    el('open-receipt', HTMLButtonElement).addEventListener('click', () => {
      void this.#playStory({ act: 'receipt' });
    });
    el('open-alert', HTMLButtonElement).addEventListener('click', () => {
      void this.#playStory({ act: 'alert' });
    });
    el('open-dust', HTMLButtonElement).addEventListener('click', () => {
      void this.#playStory({ act: 'dust' });
    });
    el('open-envelope', HTMLButtonElement).addEventListener('click', () => {
      void this.#playStory({ act: 'envelope' });
    });
    el('open-clock', HTMLButtonElement).addEventListener('click', () => {
      void this.#playStory({ act: 'clock' });
    });
    el('open-book', HTMLButtonElement).addEventListener('click', () => {
      void this.#playStory({ act: 'book' });
    });
    el('open-cases', HTMLButtonElement).addEventListener('click', () => {
      this.#casebook.open();
    });
    this.#casebook.onPlay = (act) => {
      void this.#playStory({ act });
    };
    el('island-back', HTMLButtonElement).addEventListener('click', () => {
      this.#leaveIsland();
    });
    const interactIsland = (): void => {
      const preview = this.scene.scene.get(ISLAND_SCENE_KEY);
      if (preview instanceof IslandScene && preview.scene.isActive()) preview.interact();
    };
    el('island-action', HTMLButtonElement).addEventListener('click', interactIsland);
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyE' || e.repeat || el('island-hud', HTMLElement).hidden) return;
      e.preventDefault();
      interactIsland();
    });
    this.#profileReady = this.profiles.session().then((p) => {
      if (p !== null) this.#setProfile(p);
      // A first visit opens the prologue; later visits show new chapters as badges on the map.
      const first = this.#world.firstUnread();
      if (first?.id === 'prologue' && this.#room === null && !this.#story.isOpen && import.meta.env.VITE_E2E !== '1') this.#story.open(first);
      return p;
    });
    // Each sky phenomenon explains itself once per visit.
    const noted = new Set<NatureNote>();
    const noteBox = el('nature-note', HTMLParagraphElement);
    let noteTimer = 0;
    const showNote = (note: NatureNote): void => {
      if (noted.has(note)) return;
      noted.add(note);
      const text = NATURE_NOTES[note];
      const colon = text.indexOf(':');
      noteBox.replaceChildren(h('b', '', text.slice(0, colon + 1)), ` ${text.slice(colon + 1).trim()}`);
      noteBox.classList.add('show');
      window.clearTimeout(noteTimer);
      noteTimer = window.setTimeout(() => {
        noteBox.classList.remove('show');
      }, 9000);
    };
    this.scene.onNatureNote = showNote;
    const beachScene = this.#beachScene();
    if (beachScene !== null) beachScene.onNatureNote = showNote;
    void this.profiles.season().then((reply) => {
      this.#season.show(reply);
      this.#world.setSeason(reply);
      this.scene.setSeason(reply?.featured?.colors ?? null);
      this.#seasonColors = reply?.featured?.colors ?? null;
    });
    this.#menu.onAction = (action) => {
      void this.#join(action);
    };
    this.#hud.onLeave = () => {
      void this.#room?.leave();
    };
    this.#hud.onStart = () => {
      this.#room?.send('startMatch');
    };
    // Streamer mode: remembered per browser; masks room codes everywhere they show.
    const streamer = el('streamer', HTMLButtonElement);
    const applyStreamer = (on: boolean): void => {
      document.documentElement.dataset['streamer'] = on ? 'on' : 'off';
      streamer.textContent = t(on ? 'settings.streamerOn' : 'settings.streamerOff');
      streamer.setAttribute('aria-pressed', String(on));
      this.#hud.refreshStreamerMode();
      try {
        localStorage.setItem('bc.streamer', on ? 'on' : 'off');
      } catch {
        // Storage blocked: the setting lasts for this visit.
      }
    };
    let streamerOn = false;
    try {
      streamerOn = localStorage.getItem('bc.streamer') === 'on';
    } catch {
      // Storage blocked: off.
    }
    applyStreamer(streamerOn);
    streamer.addEventListener('click', () => {
      applyStreamer(document.documentElement.dataset['streamer'] !== 'on');
    });
    onLocaleChange(() => {
      applyStreamer(document.documentElement.dataset['streamer'] === 'on');
      if (this.#lastProfile !== null) this.#setProfile(this.#lastProfile);
      if (this.#room !== null) this.#scheduleRefresh(this.#room);
    });
    this.#hud.onAddBot = () => {
      this.#room?.send('addBot');
    };
    this.#hud.onRemoveBot = (targetId) => {
      this.#room?.send('removeBot', { targetId });
    };
    this.#hud.onArena = (arena) => {
      this.#room?.send('setArena', { arena });
    };
    el('game', HTMLDivElement).addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        if (this.#beach?.active === true) this.#beachScene()?.zoomBy(factor);
        else if (this.#city?.active === true || this.#mission?.active === true) this.#cityScene()?.zoomBy(factor);
        else this.scene.zoomBy(factor);
      },
      { passive: false },
    );
    const code = codeFromHash(window.location.hash);
    if (code !== null) this.#menu.prefillCode(code);
    this.#menu.show();
    const token = tokenStore.load();
    if (token !== null) void this.#resume(token);
  }

  #visitIsland(islandId: PreviewIslandId): void {
    if (this.#busy || this.#room !== null || this.#beach?.active === true || this.#city?.active === true || this.#mission?.active === true) return;
    const island = ISLAND_PREVIEWS[islandId];
    this.#world.close();
    this.#menu.hide();
    document.documentElement.dataset['phase'] = 'exploring';
    this.#input.enabled = true;
    el('island-hud-title', HTMLElement).textContent = island.name;
    el('island-hud-concept', HTMLElement).textContent = t(island.concept);
    el('island-hud', HTMLElement).hidden = false;
    const preview = this.scene.scene.get(ISLAND_SCENE_KEY);
    if (!(preview instanceof IslandScene)) return;
    const action = el('island-action', HTMLButtonElement);
    preview.onProgress = (progress) => {
      el('island-objective', HTMLElement).textContent = progress.objective;
      el('island-objective-progress', HTMLElement).textContent = `${String(progress.progress)}/${String(progress.total)}`;
      el('island-status', HTMLElement).textContent = progress.prompt;
      action.disabled = !progress.canInteract;
      action.textContent = t(progress.complete ? 'island.complete' : 'island.interact');
    };
    preview.onActivated = (complete) => {
      audio.play(complete ? 'rankUp' : 'sign');
    };
    preview.events.once(Phaser.Scenes.Events.CREATE, () => {
      preview.attach(this.#input);
    });
    this.scene.scene.launch(ISLAND_SCENE_KEY, { island: islandId });
    this.scene.scene.sleep();
    audio.setMood(island.mood);
  }

  #leaveIsland(): void {
    const preview = this.scene.scene.get(ISLAND_SCENE_KEY);
    if (preview.scene.isActive()) preview.scene.stop();
    this.scene.scene.wake();
    this.#input.enabled = false;
    el('island-hud', HTMLElement).hidden = true;
    this.#menu.show();
    this.#world.open();
    document.documentElement.dataset['phase'] = 'menu';
    audio.setMood('menu');
  }

  #cityScene(): CityScene | null {
    const s = this.scene.scene.get(CITY_SCENE_KEY);
    return s instanceof CityScene ? s : null;
  }

  // Port Concord: switch scenes, join the city room, and come back to the menu on leaving.
  async #visitCity(): Promise<void> {
    if (this.#busy || this.#room !== null || this.#beach?.active === true || this.#city?.active === true || this.#mission?.active === true) return;
    const nickname = this.#menu.validNickname();
    if (nickname === null) return;
    this.#busy = true;
    await this.#profileReady;
    const city = this.#cityScene();
    if (city === null) {
      this.#busy = false;
      return;
    }
    const created = new Promise<void>((resolve) => {
      city.events.once(Phaser.Scenes.Events.CREATE, () => {
        resolve();
      });
    });
    this.scene.scene.launch(CITY_SCENE_KEY);
    this.scene.scene.sleep();
    await created;
    if (this.#city === null) {
      const controller = new CityController(this.session, this.profiles, city, this.#input);
      controller.onToast = (text) => {
        this.#hud.toast(text);
      };
      controller.onProfile = (p) => {
        this.#setProfile(p);
      };
      controller.onLeft = () => {
        this.scene.scene.stop(CITY_SCENE_KEY);
        this.scene.scene.wake();
        document.documentElement.dataset['phase'] = 'menu';
        this.#menu.show();
      };
      this.#city = controller;
    }
    this.#menu.hide();
    document.documentElement.dataset['phase'] = 'city';
    try {
      await this.#city.enter(nickname);
    } catch (error) {
      this.scene.scene.stop(CITY_SCENE_KEY);
      this.scene.scene.wake();
      document.documentElement.dataset['phase'] = 'menu';
      this.#menu.show();
      this.#menu.showError(joinErrorMessage(error));
    } finally {
      this.#busy = false;
    }
  }

  // A story mission: Port Concord at night, launched in mission mode, in a private room for the crew; a room id joins
  // a friend's crew instead of starting a new night.
  async #playStory(start: { readonly act?: ActId; readonly roomId?: string }): Promise<void> {
    if (this.#busy || this.#room !== null || this.#beach?.active === true || this.#city?.active === true || this.#mission?.active === true) return;
    const nickname = this.#menu.validNickname();
    if (nickname === null) return;
    this.#busy = true;
    await this.#profileReady;
    const city = this.#cityScene();
    if (city === null) {
      this.#busy = false;
      return;
    }
    const created = new Promise<void>((resolve) => {
      city.events.once(Phaser.Scenes.Events.CREATE, () => {
        resolve();
      });
    });
    this.scene.scene.launch(CITY_SCENE_KEY, { mission: true });
    this.scene.scene.sleep();
    await created;
    const back = (): void => {
      this.scene.scene.stop(CITY_SCENE_KEY);
      this.scene.scene.wake();
      document.documentElement.dataset['phase'] = 'menu';
      this.#menu.show();
    };
    if (this.#mission === null) {
      const controller = new MissionController(this.session, this.profiles, city, this.#input);
      controller.onToast = (text) => {
        this.#hud.toast(text);
      };
      controller.onProfile = (p) => {
        this.#setProfile(p);
      };
      controller.onLeft = back;
      controller.onFinale = () => {
        const name = this.#menu.validNickname();
        if (name !== null) void this.#join({ kind: 'create', nickname: name, ceremony: true });
      };
      this.#mission = controller;
    }
    this.#menu.hide();
    document.documentElement.dataset['phase'] = 'city';
    try {
      await this.#mission.enter(nickname, start);
      if (window.location.hash !== '') window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (error) {
      back();
      this.#menu.showError(joinErrorMessage(error));
    } finally {
      this.#busy = false;
    }
  }

  #beachScene(): BeachScene | null {
    const s = this.scene.scene.get(BEACH_SCENE_KEY);
    return s instanceof BeachScene ? s : null;
  }

  // Beach Town: switch scenes, join the hub room, and come back to the map on leaving.
  async #visitBeach(): Promise<void> {
    if (this.#busy || this.#room !== null || this.#beach?.active === true || this.#city?.active === true || this.#mission?.active === true) return;
    const nickname = this.#menu.validNickname();
    if (nickname === null) return;
    this.#busy = true;
    await this.#profileReady;
    const beach = this.#beachScene();
    if (beach === null) {
      this.#busy = false;
      return;
    }
    const created = new Promise<void>((resolve) => {
      beach.events.once(Phaser.Scenes.Events.CREATE, () => {
        resolve();
      });
    });
    this.scene.scene.launch(BEACH_SCENE_KEY);
    this.scene.scene.sleep();
    await created;
    beach.setSeason(this.#seasonColors);
    if (this.#beach === null) {
      const controller = new BeachController(this.session, this.profiles, beach, this.#input);
      controller.onProfile = (p) => {
        this.#setProfile(p);
      };
      controller.onToast = (text) => {
        this.#hud.toast(text);
      };
      controller.onWardrobe = () => {
        controller.holdStill(true);
        this.#wardrobe.open();
      };
      controller.onChronicle = () => {
        const chapter = this.#world.firstUnread() ?? this.#world.latestOpen();
        if (chapter === null) return;
        controller.holdStill(true);
        this.#story.open(chapter);
      };
      controller.onLeft = () => {
        this.scene.scene.stop(BEACH_SCENE_KEY);
        this.scene.scene.wake();
        this.#menu.show();
      };
      this.#beach = controller;
    }
    this.#beach.setProfile(this.#lastProfile);
    this.#menu.hide();
    try {
      await this.#beach.enter(nickname);
    } catch (error) {
      this.scene.scene.stop(BEACH_SCENE_KEY);
      this.scene.scene.wake();
      this.#menu.show();
      this.#menu.showError(joinErrorMessage(error));
    } finally {
      this.#busy = false;
    }
  }

  async #resume(token: string): Promise<void> {
    this.#setBusy(true, t('menu.rejoining'));
    try {
      this.#enter(await this.session.resume(token));
    } catch (error) {
      if (tokenIsDead(error)) tokenStore.clear();
      else this.#menu.showError(joinErrorMessage(error));
    } finally {
      this.#setBusy(false);
    }
  }

  async #join(action: MenuAction): Promise<void> {
    if (this.#busy || this.#room !== null) return;
    const label = t(action.kind === 'quick' ? 'menu.finding' : action.kind === 'create' ? 'menu.creating' : 'menu.joining');
    this.#setBusy(true, label);
    try {
      await this.#profileReady;
      let room: GameRoom;
      if (action.kind === 'quick') room = await this.session.quickMatch(action.nickname);
      else if (action.kind === 'create') room = await this.session.createPrivate(action.nickname, action.ceremony === true);
      else {
        const found = await this.session.lookup(action.code);
        if (found.kind === 'story') {
          this.#setBusy(false);
          await this.#playStory({ roomId: found.roomId });
          return;
        }
        room = await this.session.joinCouncil(found.roomId, action.nickname);
      }
      this.#enter(room);
    } catch (error) {
      this.#menu.showError(joinErrorMessage(error));
    } finally {
      this.#setBusy(false);
    }
  }

  #setBusy(busy: boolean, status = ''): void {
    this.#busy = busy;
    this.#menu.setBusy(busy, status);
  }

  #enter(room: GameRoom): void {
    this.#room = room;
    // The server holds a dropped seat from the first second, so retry from the first second too.
    room.reconnection.minUptime = 0;
    tokenStore.save(room.reconnectionToken);
    // The invite fragment has done its job; a reload should rejoin, not re-prompt.
    if (window.location.hash !== '') window.history.replaceState(null, '', window.location.pathname + window.location.search);
    this.#menu.hide();
    this.#hud.show();
    this.#hud.setConnection('connected');
    this.#input.enabled = true;
    this.#attachScene(room);

    this.#match.attach(room);
    this.#botsAvailable = true;
    room.onMessage(SERVER_MESSAGES.ARENA_REFUSED, (payload: unknown) => {
      const parsed = ArenaRefusedSchema.safeParse(payload);
      if (parsed.success) this.#hud.toast(t(ARENA_REFUSAL_TEXT[parsed.data.reason]));
    });
    room.onMessage(SERVER_MESSAGES.BOTS_REFUSED, (payload: unknown) => {
      const parsed = BotsRefusedSchema.safeParse(payload);
      if (!parsed.success) return;
      if (parsed.data.reason === 'disabled') {
        this.#botsAvailable = false;
        this.#scheduleRefresh(room);
      }
      this.#hud.toast(t(BOT_REFUSAL_TEXT[parsed.data.reason]));
    });

    // One Callbacks instance per room: several instances double-fire nested listeners.
    const callbacks = Callbacks.get(room);
    let synced = false;
    const refresh = (): void => {
      this.#scheduleRefresh(room);
    };
    callbacks.onAdd('players', (player: PlayerState, id: string) => {
      this.scene.addPlayer(id, player);
      callbacks.onChange(player, () => {
        this.scene.updatePlayer(id, player);
      });
      for (const field of ['status', 'name', 'role', 'tasks', 'tasksDone', 'out', 'frozen'] as const) callbacks.listen(player, field, refresh);
      refresh();
      if (synced && id !== room.sessionId) this.#hud.toast(t('hud.joined', { name: player.name }));
    });
    callbacks.onRemove('players', (player: PlayerState, id: string) => {
      this.scene.removePlayer(id);
      refresh();
      if (id !== room.sessionId) this.#hud.toast(t('hud.left', { name: player.name }));
    });
    for (const field of ['hostId', 'phase', 'consensus', 'byzantines', 'winner', 'winReason', 'blockHeight', 'chainLive', 'signaturesNeeded', 'livenessStrikes', 'partition', 'repair', 'relays', 'outages', 'act', 'blocksLeft', 'reefOpen', 'peaksOpen', 'isPrivate'] as const) {
      callbacks.listen(field, refresh);
    }
    callbacks.listen('arena', () => {
      this.#syncArena(room);
      refresh();
    });
    callbacks.onAdd('proposals', (proposal: ProposalState) => {
      for (const field of ['status', 'secondsLeft', 'verdict'] as const) callbacks.listen(proposal, field, refresh);
      callbacks.onAdd(proposal, 'signers', refresh);
      callbacks.onAdd(proposal, 'refusers', refresh);
      refresh();
    });
    callbacks.onRemove('proposals', refresh);
    // Not immediate: the local default council has no decoder reference yet, so nested listeners would throw.
    callbacks.listen('council', (council: CouncilState | undefined) => {
      if (council === undefined) return;
      for (const field of ['stage', 'number', 'calledBy', 'secondsLeft', 'ejected'] as const) callbacks.listen(council, field, refresh);
      callbacks.onAdd(council, 'voted', refresh);
      callbacks.onAdd(council, 'ballots', refresh);
      refresh();
    }, false);
    callbacks.onAdd('recap', refresh);
    callbacks.onRemove('recap', refresh);
    callbacks.listen('code', () => {
      this.#hud.setRoom(room.state.code, room.state.isPrivate);
    });
    callbacks.listen('isPrivate', () => {
      this.#hud.setRoom(room.state.code, room.state.isPrivate);
    });
    callbacks.listen('ceremony', (ceremony: boolean) => {
      if (!ceremony) return;
      this.#hud.toast(t('ceremony.start'));
      this.#hud.toast(t('ceremony.saved'));
    });
    room.onStateChange.once(() => {
      synced = true;
    });

    room.onDrop(() => {
      this.#hud.setConnection('reconnecting');
    });
    room.onReconnect(() => {
      this.#hud.setConnection('connected');
      // The token rotates on reconnect and is only readable after this handler returns.
      queueMicrotask(() => {
        tokenStore.save(room.reconnectionToken);
      });
      const me = room.state.players.get(room.sessionId);
      if (me !== undefined) this.scene.resetPrediction(me);
    });
    room.onLeave((code) => {
      this.#exit(code);
    });
    this.#startPing(room);
    this.#exposeForSmokeTest(room);
  }

  // Coalesces the many field callbacks of one patch into a single re-render.
  #scheduleRefresh(room: GameRoom): void {
    if (this.#refreshQueued) return;
    this.#refreshQueued = true;
    queueMicrotask(() => {
      this.#refreshQueued = false;
      if (this.#room !== room) return;
      this.#hud.renderRoster(this.#roster(room), this.#lobbyInfo(room));
      this.#match.refresh();
    });
  }

  #lobbyInfo(room: GameRoom): LobbyInfo {
    return {
      phase: room.state.phase,
      amHost: room.state.hostId === room.sessionId,
      hostName: room.state.players.get(room.state.hostId)?.name ?? t('hud.theHost'),
      botsAvailable: this.#botsAvailable,
      isPrivate: room.state.isPrivate,
      arena: arenaById(room.state.arena).id,
      reefOpen: room.state.reefOpen,
      peaksOpen: room.state.peaksOpen,
    };
  }

  // Hands the scene this room's players and input.
  #attachScene(room: GameRoom): void {
    this.scene.attach(room.sessionId, this.#input, {
      get canSend() {
        return room.connection.isOpen;
      },
      send: (input) => {
        room.send('move', input);
      },
    });
  }

  // A room on another arena redraws the scene, then puts everyone back into it.
  #syncArena(room: GameRoom): void {
    const arena = arenaById(room.state.arena).id;
    if (this.scene.arenaId === arena) return;
    this.scene.events.once(Phaser.Scenes.Events.CREATE, () => {
      this.scene.setSeason(this.#seasonColors);
      if (this.#room !== room) return;
      this.#attachScene(room);
      for (const [id, p] of room.state.players) this.scene.addPlayer(id, p);
      this.#match.refresh();
    });
    this.scene.useArena(arena);
  }

  #exit(code: number): void {
    window.clearInterval(this.#pingTimer);
    this.#match.detach();
    this.scene.detach();
    // The menu's backdrop is always the Citadel.
    if (this.scene.arenaId !== 'citadel') {
      this.scene.events.once(Phaser.Scenes.Events.CREATE, () => {
        this.scene.setSeason(this.#seasonColors);
      });
      this.scene.useArena('citadel');
    }
    this.#input.enabled = false;
    this.#hud.hide();
    this.#room = null;
    tokenStore.clear();
    this.#menu.show();
    const message = closeMessage(code);
    if (message !== null) this.#menu.showError(message);
  }

  #roster(room: GameRoom): RosterEntry[] {
    return Array.from(room.state.players.entries(), ([id, p]) => ({
      id,
      name: p.name,
      seat: p.seat,
      active: p.status === 'active',
      isHost: room.state.hostId === id,
      isMe: id === room.sessionId,
      bot: p.bot,
      role: p.role,
    }));
  }

  // room.ping keeps one pending callback, so overlapping pings are skipped, not stacked.
  #startPing(room: GameRoom): void {
    let pending = false;
    const ping = (): void => {
      if (pending || !room.connection.isOpen) return;
      pending = true;
      const timeout = window.setTimeout(() => {
        pending = false;
      }, PING_TIMEOUT_MS);
      room.ping((ms) => {
        window.clearTimeout(timeout);
        pending = false;
        this.#hud.setPing(ms);
      });
    };
    ping();
    this.#pingTimer = window.setInterval(ping, PING_EVERY_MS);
  }

  // Smoke-test builds only: read-only positions, so the test can check what each player sees.
  #exposeForSmokeTest(room: GameRoom): void {
    if (import.meta.env.VITE_E2E !== '1') return;
    Object.assign(window, {
      __bcSmoke: {
        me: () => room.sessionId,
        server: () =>
          Array.from(room.state.players.entries(), ([id, p]) => ({ id, name: p.name, x: p.x, y: p.y, status: p.status })),
        rendered: (id: string) => this.scene.positionOf(id),
        predicted: () => this.scene.predictedPosition(),
        phase: () => room.state.phase,
        consensus: () => room.state.consensus,
        // Roles as this client decoded them: proves what the server did and did not send.
        roles: () => Array.from(room.state.players.entries(), ([id, p]) => ({ id, role: p.role ?? null })),
      },
    });
  }
}

const MUSIC_LABELS: Readonly<Record<MusicChoice, PlainKey>> = {
  dynamic: 'music.dynamic',
  menu: 'music.menu',
  calm: 'music.calm',
  proposals: 'music.proposals',
  final: 'music.final',
  council: 'music.council',
  beach: 'music.beach',
  academy: 'music.academy',
  story: 'music.story',
};

// Sound starts on the first tap or key press, as browsers require. Players can keep the
// scene-aware score or pin one of its themes; the button still offers a quick mute cycle.
function setupSound(): void {
  const button = el('sound', HTMLButtonElement);
  const music = el('music', HTMLSelectElement);
  const render = (): void => {
    const s = audio.settings;
    const label = t(s.muted ? 'settings.soundOff' : s.music === 0 ? 'settings.musicOff' : 'settings.soundOn');
    button.textContent = label;
    button.setAttribute('aria-label', t('settings.soundAria', { label }));
    music.value = s.music === 0 ? 'off' : s.musicChoice;
    const choice = t(s.music === 0 ? 'music.off' : MUSIC_LABELS[s.musicChoice]);
    music.setAttribute('aria-label', t('settings.musicAria', { choice }));
  };
  onLocaleChange(render);
  button.addEventListener('click', () => {
    const s = audio.settings;
    if (s.muted) audio.update({ muted: false, music: 0.55 });
    else if (s.music > 0) audio.update({ music: 0 });
    else audio.update({ muted: true });
  });
  music.addEventListener('change', () => {
    if (music.value === 'off') audio.update({ music: 0 });
    else if (isMusicChoice(music.value)) {
      audio.update({ musicChoice: music.value, music: audio.settings.music || 0.55, muted: false });
    }
    audio.play('click');
  });
  audio.onChange(render);
  render();
  const unlock = (): void => {
    audio.unlock();
  };
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
  // A soft click for every button press in the interface.
  el('ui', HTMLDivElement).addEventListener('click', (e) => {
    if (e.target instanceof HTMLElement && e.target.closest('button') !== null) audio.play('click');
  });
  audio.setMood('menu');
}

// Graphics quality applies on reload, since the painted world is drawn once at start.
function setupQuality(): void {
  const button = el('quality', HTMLButtonElement);
  const render = (): void => {
    button.textContent = t(quality.current === 'high' ? 'settings.graphicsHigh' : 'settings.graphicsLow');
    button.setAttribute('aria-label', t('settings.graphicsAria', { label: button.textContent }));
  };
  render();
  onLocaleChange(render);
  button.addEventListener('click', () => {
    saveQuality(quality.current === 'high' ? 'low' : 'high');
    window.location.reload();
  });
}

function boot(): void {
  initLocale();
  bindLanguagePicker(el('language', HTMLSelectElement));
  setupSound();
  setupQuality();
  let session: Session;
  let profiles: ProfileApi;
  let platform: Platform;
  try {
    platform = startPlatform(resolveServerEndpoint(import.meta.env.VITE_SERVER_URL, import.meta.env.DEV), (held) => {
      audio.setHeld(held);
    });
    session = new Session(platform.server, platform.network);
    profiles = new ProfileApi(platform.server.httpBase, platform.network);
  } catch {
    showFatal(t('fatal.noServer'));
    return;
  }
  if (!hasWebGL()) {
    showFatal(t('fatal.noWebgl'));
    return;
  }
  startGame(el('game', HTMLDivElement))
    .then((scene) => {
      // Development only (stripped from builds): lets art checks switch the light.
      if (import.meta.env.DEV) Object.assign(window, { __bcScene: scene });
      new Controller(session, scene, profiles).start();
      platform.loaded();
      if (platform.allows.pwa) void registerServiceWorker();
    })
    .catch(() => {
      showFatal(t('fatal.renderer'));
    });
}

boot();
