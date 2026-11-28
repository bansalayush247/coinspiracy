// Runs a visit to Beach Town: the hub room, the HUD, the shops and courier jobs.
import { Callbacks } from '@colyseus/sdk';
import { SHOPS, getShop, type ShopId } from '@byzantine-council/shared/economy';
import { BEACH_MESSAGES, CourierDoneSchema, CourierJobSchema, CourierRefusedSchema, EMOTES, EmoteLineSchema, JumpLineSchema, atHome, shopAt, type CourierJob, type Emote, type HubPlayer } from '@byzantine-council/shared/hub';
import { audio } from '../audio/engine.js';
import { Achievements } from '../profile/achievements.js';
import { Coach } from '../ui/coach.js';
import { sealName } from '../profile/names.js';
import { type PlayerInput, isEditable } from '../game/input.js';
import type { Session } from '../net/session.js';
import type { ProfileApi, ProfileSummary } from '../profile/api.js';
import { mountEmoteBar } from '../ui/emoteBar.js';
import { shopPanel } from '../ui/shopPanel.js';
import { el } from '../ui/dom.js';
import { FerryButton } from '../ferry/ferryDock.js';
import type { FerryLook } from '../ferry/FerryScene.js';
import { t, type PlainKey } from '../i18n/index.js';
import type { BeachScene } from './BeachScene.js';

type BeachRoom = Awaited<ReturnType<Session['beach']>>;

const SHOP_NAMES = new Map(SHOPS.map((s) => [s.id, s.name]));
const name = (shop: ShopId): string => SHOP_NAMES.get(shop) ?? shop;

const REFUSALS: Readonly<Record<string, PlainKey>> = {
  notHere: 'beach.notHere',
  busy: 'beach.busy',
  noJob: 'beach.noJob',
  wrongShop: 'beach.wrongShop',
  tooFast: 'beach.tooFast',
};

export class BeachController {
  readonly #hud = el('beach-hud', HTMLElement);
  readonly #wallet = el('beach-wallet', HTMLElement);
  readonly #jobLine = el('beach-job', HTMLParagraphElement);
  readonly #prompt = el('beach-prompt', HTMLDivElement);
  readonly #promptText = el('beach-prompt-text', HTMLSpanElement);
  readonly #browse = el('beach-shop', HTMLButtonElement);
  readonly #jobAction = el('beach-job-action', HTMLButtonElement);
  readonly #ferry = new FerryButton(el('beach-ferry', HTMLButtonElement), 'beach', () => {
    this.onFerry();
  });
  readonly #achievements = new Achievements();
  readonly #coach = new Coach();
  #room: BeachRoom | null = null;
  #profile: ProfileSummary | null = null;
  #here: ShopId | null = null;
  #job: CourierJob | null = null;
  #poll = 0;
  onLeft: () => void = () => undefined;
  onProfile: (p: ProfileSummary) => void = () => undefined;
  onToast: (text: string) => void = () => undefined;
  onWardrobe: () => void = () => undefined;
  onChronicle: () => void = () => undefined;
  onFerry: () => void = () => undefined;
  ferryOpen: () => boolean = () => true;
  // True while the guardian stands on their own hut's porch (and at no shop).
  #home = false;

  // While a panel from the menu (the wardrobe) is open over the town, the guardian stands still.
  holdStill(hold: boolean): void {
    if (this.#room !== null) this.input.enabled = !hold && !shopPanel().isOpen;
  }

  // The wardrobe changed: let the town see the new look.
  lookChanged(): void {
    this.#room?.send('refreshLook');
  }

  constructor(
    private readonly session: Session,
    private readonly profiles: ProfileApi,
    private readonly scene: BeachScene,
    private readonly input: PlayerInput,
  ) {
    el('beach-wardrobe', HTMLButtonElement).addEventListener('click', () => {
      this.onWardrobe();
    });
    el('beach-leave', HTMLButtonElement).addEventListener('click', () => {
      void this.leave();
    });
    this.#browse.addEventListener('click', () => {
      this.#use();
    });
    this.#jobAction.addEventListener('click', () => {
      if (this.#home) this.onChronicle();
      else this.#jobStep();
    });
    // Emote buttons, also on keys 1 to 6.
    mountEmoteBar(el('beach-emotes', HTMLDivElement), (emote) => {
      this.#emote(emote);
    });
    window.addEventListener('keydown', (e) => {
      if (this.#room === null || this.#hud.hidden || !el('wardrobe', HTMLElement).hidden || !el('story', HTMLElement).hidden) return;
      if (e.code === 'Space' && !e.repeat && !isEditable(e.target) && !shopPanel().isOpen) {
        // A focused HUD button would otherwise be clicked by Space as well.
        if (e.target instanceof HTMLButtonElement) e.target.blur();
        e.preventDefault();
        this.scene.jump(this.#room.sessionId);
        this.#room.send('jump');
        return;
      }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= EMOTES.length && !shopPanel().isOpen) {
        const emote = EMOTES[n - 1];
        if (emote !== undefined) this.#emote(emote);
        return;
      }
      if ((e.key === 'e' || e.key === 'E') && !shopPanel().isOpen) this.#use();
    });
  }

  // The prompt's main action: browse the shop here, or open the wardrobe at home.
  #use(): void {
    if (this.#here !== null) this.#openShop(this.#here);
    else if (this.#home) this.onWardrobe();
    else if (this.#ferry.shown) this.onFerry();
  }

  setProfile(p: ProfileSummary | null): void {
    this.#profile = p;
    this.#wallet.textContent = p === null ? t('beach.noWallet') : t('beach.wallet', { sats: p.balance });
    this.scene.setHutDecor(p?.owned ?? []);
  }

  get active(): boolean {
    return this.#room !== null;
  }

  /** How this guardian looks right now, for the ferry crossing; null when not in town. */
  ferryLook(): FerryLook | null {
    const room = this.#room;
    const me = room?.state.players.get(room.sessionId);
    return me === undefined ? null : { seat: me.seat, wear: { hat: me.hat, shades: me.shades, outfit: me.outfit } };
  }

  async enter(nickname: string, byFerry = false): Promise<void> {
    const room = await this.session.beach(nickname, byFerry);
    this.#room = room;
    this.scene.attach(room.sessionId, this.input, {
      get canSend() {
        return room.connection.isOpen;
      },
      send: (input) => {
        room.send('move', input);
      },
    });
    const callbacks = Callbacks.get(room);
    callbacks.onAdd('players', (player: HubPlayer, id: string) => {
      this.scene.addPlayer(id, player);
      callbacks.onChange(player, () => {
        this.scene.updatePlayer(id, player);
      });
    });
    callbacks.onRemove('players', (_p: HubPlayer, id: string) => {
      this.scene.removePlayer(id);
    });
    room.onMessage(BEACH_MESSAGES.JOB, (payload: unknown) => {
      const job = CourierJobSchema.safeParse(payload);
      if (!job.success) return;
      this.#job = job.data;
      this.scene.setTarget(job.data.to);
      audio.play('click');
      this.onToast(t('beach.jobTaken', { shop: name(job.data.to), sats: String(job.data.reward) }));
      this.#render();
    });
    room.onMessage(BEACH_MESSAGES.DONE, (payload: unknown) => {
      const done = CourierDoneSchema.safeParse(payload);
      if (!done.success) return;
      if (done.data.reason === 'error') {
        this.onToast(t('beach.payError'));
        return;
      }
      const to = this.#job?.to;
      this.#job = null;
      this.scene.setTarget(null);
      if (to !== undefined) this.scene.delivered(to, done.data.paid);
      for (const seal of done.data.seals) this.#achievements.announce('seal', sealName(seal));
      if (done.data.paid > 0) {
        audio.play('coin');
        this.onToast(t('beach.delivered', { paid: String(done.data.paid), today: String(done.data.deliveredToday) }));
      } else {
        this.onToast(t(done.data.reason === 'dailyLimit' ? 'beach.deliveredLimit' : 'beach.deliveredThanks'));
      }
      void this.profiles.profile().then((p) => {
        if (p !== null) this.onProfile(p);
      });
      this.#render();
    });
    room.onMessage(BEACH_MESSAGES.REFUSED, (payload: unknown) => {
      const r = CourierRefusedSchema.safeParse(payload);
      if (r.success) this.onToast(t(REFUSALS[r.data.reason] ?? 'beach.failed'));
    });
    room.onMessage(BEACH_MESSAGES.JUMP, (payload: unknown) => {
      const line = JumpLineSchema.safeParse(payload);
      if (line.success) this.scene.jump(line.data.from);
    });
    room.onMessage(BEACH_MESSAGES.EMOTE, (payload: unknown) => {
      const line = EmoteLineSchema.safeParse(payload);
      if (line.success) this.scene.emote(line.data.from, line.data.emote);
    });
    room.onLeave(() => {
      this.#exit();
    });
    this.#hud.hidden = false;
    this.input.enabled = true;
    audio.setMood('beach');
    audio.setSurf(true);
    this.#coach.tip('beach');
    this.#poll = window.setInterval(() => {
      this.#render();
    }, 150);
    this.#render();
  }

  async leave(): Promise<void> {
    const room = this.#room;
    if (room === null) return;
    await room.leave().catch(() => undefined);
    this.#exit();
  }

  #exit(): void {
    if (this.#room === null) return;
    this.#room = null;
    window.clearInterval(this.#poll);
    this.#job = null;
    this.#ferry.hide();
    shopPanel().close();
    this.scene.detach();
    this.#here = null;
    this.#home = false;
    this.#hud.hidden = true;
    this.#coach.hide();
    this.input.enabled = false;
    audio.setSurf(false);
    audio.setMood('menu');
    this.onLeft();
  }

  // Which counter the guardian stands at, and what the prompt offers there.
  #render(): void {
    const pos = this.scene.predictedPosition();
    this.#ferry.update(pos, !shopPanel().isOpen, this.ferryOpen());
    const here = pos === null ? null : shopAt(pos);
    if (here !== this.#here) {
      this.#here = here;
      this.scene.setFocusShop(here);
    }
    const job = this.#job;
    this.#jobLine.textContent = job === null ? t('beach.jobsHint') : t('beach.carrying', { shop: name(job.to), sats: String(job.reward) });
    const home = here === null && pos !== null && atHome(pos);
    if (home !== this.#home) {
      this.#home = home;
      this.scene.setFocusHome(home);
      // A small welcome chime on stepping onto your own porch.
      if (home) audio.play('chirp');
    }
    this.#prompt.hidden = (here === null && !home) || shopPanel().isOpen;
    if (home) {
      this.#promptText.textContent = t('beach.hut');
      this.#browse.textContent = t('beach.wardrobeKey');
      this.#jobAction.textContent = t('beach.readChronicle');
      this.#jobAction.hidden = false;
      return;
    }
    if (here === null) return;
    this.#browse.textContent = t('beach.browse');
    this.#promptText.textContent = `${name(here)} · ${getShop(here)?.sells ?? ''}`;
    if (job === null) {
      this.#jobAction.textContent = t('beach.takeJob');
      this.#jobAction.hidden = false;
    } else if (job.to === here) {
      this.#jobAction.textContent = t('beach.deliver', { sats: String(job.reward) });
      this.#jobAction.hidden = false;
    } else {
      this.#jobAction.hidden = true;
    }
  }

  #emote(emote: Emote): void {
    this.#room?.send('emote', { emote });
  }

  #jobStep(): void {
    const room = this.#room;
    const here = this.#here;
    if (room === null || here === null) return;
    if (this.#job === null) room.send('takeJob', { shop: here });
    else if (this.#job.to === here) room.send('deliver');
  }

  #openShop(shop: ShopId): void {
    shopPanel().open(shop, this.#profile, {
      profiles: this.profiles,
      onProfile: (p) => {
        this.onProfile(p);
      },
      onToast: (text) => {
        this.onToast(text);
      },
      onClose: () => {
        if (this.#room !== null) this.input.enabled = true;
        this.#render();
      },
    });
    this.input.enabled = false;
    this.#render();
  }
}
