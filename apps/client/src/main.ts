// Must stay the first import: zod reads its config when shared's schemas are built.
import './zod-jitless.js';
import './style.css';
import Phaser from 'phaser';
import { Callbacks } from '@colyseus/sdk';
import { BotsRefusedSchema, SERVER_MESSAGES, type BotsRefused } from '@byzantine-council/shared';
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
import { SeasonBanner } from './profile/season.js';
import { StoryBook } from './story/storyBook.js';
import { BEACH_SCENE_KEY, BeachScene } from './beach/BeachScene.js';
import { BeachController } from './beach/beachController.js';
import { Wardrobe } from './profile/wardrobe.js';
import { registerServiceWorker } from './pwa/register.js';
import { resolveServerEndpoint } from './serverUrl.js';
import { el, h } from './ui/dom.js';
import { NATURE_NOTES, type NatureNote } from './game/atmosphere.js';
import { audio } from './audio/engine.js';
import { quality, saveQuality } from './game/quality.js';
import { MatchView } from './matchView.js';
import { Hud, type LobbyInfo, type RosterEntry } from './ui/hud.js';
import { Menu, type MenuAction } from './ui/menu.js';

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
      scene: [CitadelScene, BeachScene],
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

const BOT_REFUSAL_TEXT: Readonly<Record<BotsRefused['reason'], string>> = {
  disabled: 'Practice bots are off on this server.',
  notHost: 'Only the host can add or remove bots.',
  notLobby: 'Bots can only join between matches.',
  roomFull: 'The room is full.',
  busy: 'A bot is already joining. Try again in a moment.',
  limit: 'The server is running as many bots as it can. Try again later.',
  failed: 'The bot couldn’t join. Try again.',
  notABot: 'That guardian isn’t a bot.',
};

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
  #lastProfile: ProfileSummary | null = null;
  #seasonColors: readonly [string, string] | null = null;
  readonly #academy = new AcademyPanel();
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
    this.#wardrobe.setProfile(p);
    this.#beach?.setProfile(p);
    this.#lastProfile = p;
    el('open-wardrobe', HTMLButtonElement).hidden = false;
    const v = p.progress;
    this.#progressChip.hidden = false;
    this.#progressChip.textContent = `Rank ${String(v.rank)} · ${p.balance.toLocaleString('en-US')} sats · ${String(v.seals.filter((s) => s.done).length)} seals`;
  }

  #applyProfile(next: Promise<ProfileSummary | null>): void {
    void next.then((p) => {
      if (p === null) this.#hud.toast('That didn’t work. Try again in a moment.');
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
      this.#hud.toast(`A new chapter of the Chronicle has opened: ${chapter.title}. Read it from the island map.`);
    };
    this.#world.onVisit = () => {
      void this.#visitBeach();
    };
    this.#wardrobe.onClosed = () => {
      this.#beach?.holdStill(false);
    };
    this.#wardrobe.onWear = (look) => {
      void this.profiles.wear(look).then((p) => {
        if (p === null) {
          this.#hud.toast('That didn’t work. Try again in a moment.');
          return;
        }
        this.#setProfile(p);
        this.#beach?.lookChanged();
      });
    };
    el('open-wardrobe', HTMLButtonElement).addEventListener('click', () => {
      this.#wardrobe.open();
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
      streamer.textContent = `Streamer mode: ${on ? 'On' : 'Off'}`;
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
    this.#hud.onAddBot = () => {
      this.#room?.send('addBot');
    };
    this.#hud.onRemoveBot = (targetId) => {
      this.#room?.send('removeBot', { targetId });
    };
    el('game', HTMLDivElement).addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        if (this.#beach?.active === true) this.#beachScene()?.zoomBy(factor);
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

  #beachScene(): BeachScene | null {
    const s = this.scene.scene.get(BEACH_SCENE_KEY);
    return s instanceof BeachScene ? s : null;
  }

  // Beach Town: switch scenes, join the hub room, and come back to the map on leaving.
  async #visitBeach(): Promise<void> {
    if (this.#busy || this.#room !== null || this.#beach?.active === true) return;
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
    this.#setBusy(true, 'Rejoining your room…');
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
    const label = action.kind === 'quick' ? 'Finding a room…' : action.kind === 'create' ? 'Creating your room…' : 'Joining room…';
    this.#setBusy(true, label);
    try {
      await this.#profileReady;
      const room =
        action.kind === 'quick'
          ? await this.session.quickMatch(action.nickname)
          : action.kind === 'create'
            ? await this.session.createPrivate(action.nickname)
            : await this.session.joinByCode(action.code, action.nickname);
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
    this.scene.attach(room.sessionId, this.#input, {
      get canSend() {
        return room.connection.isOpen;
      },
      send: (input) => {
        room.send('move', input);
      },
    });

    this.#match.attach(room);
    this.#botsAvailable = true;
    room.onMessage(SERVER_MESSAGES.BOTS_REFUSED, (payload: unknown) => {
      const parsed = BotsRefusedSchema.safeParse(payload);
      if (!parsed.success) return;
      if (parsed.data.reason === 'disabled') {
        this.#botsAvailable = false;
        this.#scheduleRefresh(room);
      }
      this.#hud.toast(BOT_REFUSAL_TEXT[parsed.data.reason]);
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
      if (synced && id !== room.sessionId) this.#hud.toast(`${player.name} joined`);
    });
    callbacks.onRemove('players', (player: PlayerState, id: string) => {
      this.scene.removePlayer(id);
      refresh();
      if (id !== room.sessionId) this.#hud.toast(`${player.name} left`);
    });
    for (const field of ['hostId', 'phase', 'consensus', 'byzantines', 'winner', 'winReason', 'blockHeight', 'chainLive', 'signaturesNeeded', 'livenessStrikes', 'partition', 'repair', 'relays', 'outages', 'act', 'blocksLeft'] as const) {
      callbacks.listen(field, refresh);
    }
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
      hostName: room.state.players.get(room.state.hostId)?.name ?? 'the host',
      botsAvailable: this.#botsAvailable,
    };
  }

  #exit(code: number): void {
    window.clearInterval(this.#pingTimer);
    this.#match.detach();
    this.scene.detach();
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

// Sound starts on the first tap or key press, as browsers require; one button cycles all, music off, muted.
function setupSound(): void {
  const button = el('sound', HTMLButtonElement);
  const render = (): void => {
    const s = audio.settings;
    const label = s.muted ? 'Sound off' : s.music === 0 ? 'Music off' : 'Sound on';
    button.textContent = label;
    button.setAttribute('aria-label', `${label}. Change sound`);
  };
  button.addEventListener('click', () => {
    const s = audio.settings;
    if (s.muted) audio.update({ muted: false, music: 0.55 });
    else if (s.music > 0) audio.update({ music: 0 });
    else audio.update({ muted: true });
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
  button.textContent = `Graphics: ${quality.current === 'high' ? 'High' : 'Low'}`;
  button.setAttribute('aria-label', `${button.textContent}. Change and reload`);
  button.addEventListener('click', () => {
    saveQuality(quality.current === 'high' ? 'low' : 'high');
    window.location.reload();
  });
}

function boot(): void {
  setupSound();
  setupQuality();
  let session: Session;
  let profiles: ProfileApi;
  try {
    const endpoint = resolveServerEndpoint(import.meta.env.VITE_SERVER_URL, import.meta.env.DEV);
    session = new Session(endpoint);
    profiles = new ProfileApi(endpoint.httpBase);
  } catch {
    showFatal('This build doesn’t know which game server to use.');
    return;
  }
  if (!hasWebGL()) {
    showFatal('Byzantine Council needs WebGL. Turn on hardware acceleration or try another browser.');
    return;
  }
  startGame(el('game', HTMLDivElement))
    .then((scene) => {
      // Development only (stripped from builds): lets art checks switch the light.
      if (import.meta.env.DEV) Object.assign(window, { __bcScene: scene });
      new Controller(session, scene, profiles).start();
      void registerServiceWorker();
    })
    .catch(() => {
      showFatal('The game couldn’t start its renderer. Try reloading, or use another browser.');
    });
}

boot();
