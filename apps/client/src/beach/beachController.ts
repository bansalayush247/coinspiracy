// Runs a visit to Beach Town: the hub room, the HUD, the shops and courier jobs.
import { Callbacks } from '@colyseus/sdk';
import { toDenominations } from '@byzantine-council/shared';
import { SHOPS, getShop, itemsInShop, ownsItem, payWithNotes, type CatalogItem, type ShopId } from '@byzantine-council/shared/economy';
import { BEACH_MESSAGES, CourierDoneSchema, CourierJobSchema, CourierRefusedSchema, EMOTES, EMOTE_GLYPHS, EmoteLineSchema, atHome, shopAt, type CourierJob, type Emote, type HubPlayer } from '@byzantine-council/shared/hub';
import { audio } from '../audio/engine.js';
import { Achievements } from '../profile/achievements.js';
import { Coach } from '../ui/coach.js';
import { sealName } from '../profile/names.js';
import type { PlayerInput } from '../game/input.js';
import type { Session } from '../net/session.js';
import type { ProfileApi, ProfileSummary } from '../profile/api.js';
import { el, h } from '../ui/dom.js';
import type { BeachScene } from './BeachScene.js';

type BeachRoom = Awaited<ReturnType<Session['beach']>>;

const SHOP_NAMES = new Map(SHOPS.map((s) => [s.id, s.name]));
const name = (shop: ShopId): string => SHOP_NAMES.get(shop) ?? shop;

const REFUSALS: Readonly<Record<string, string>> = {
  notHere: 'Stand at a shop counter to take a delivery.',
  busy: 'You are already carrying a parcel.',
  noJob: 'You have no parcel to deliver.',
  wrongShop: 'This parcel is for another shop.',
  tooFast: 'That was quicker than anyone can walk. Try again.',
};

export class BeachController {
  readonly #hud = el('beach-hud', HTMLElement);
  readonly #wallet = el('beach-wallet', HTMLElement);
  readonly #jobLine = el('beach-job', HTMLParagraphElement);
  readonly #prompt = el('beach-prompt', HTMLDivElement);
  readonly #promptText = el('beach-prompt-text', HTMLSpanElement);
  readonly #browse = el('beach-shop', HTMLButtonElement);
  readonly #jobAction = el('beach-job-action', HTMLButtonElement);
  readonly #shopRoot = el('shop', HTMLElement);
  readonly #shopTitle = el('shop-title', HTMLHeadingElement);
  readonly #shopSells = el('shop-sells', HTMLParagraphElement);
  readonly #shopItems = el('shop-items', HTMLDivElement);
  readonly #pay = el('shop-pay', HTMLDivElement);
  readonly #payTitle = el('shop-pay-title', HTMLParagraphElement);
  readonly #notes = el('shop-notes', HTMLDivElement);
  readonly #payStatus = el('shop-pay-status', HTMLParagraphElement);
  readonly #payGo = el('shop-pay-go', HTMLButtonElement);
  readonly #achievements = new Achievements();
  readonly #coach = new Coach();
  #room: BeachRoom | null = null;
  #profile: ProfileSummary | null = null;
  #here: ShopId | null = null;
  #job: CourierJob | null = null;
  #buying: { item: CatalogItem; shop: ShopId; price: number } | null = null;
  #selected: number[] = [];
  #poll = 0;
  onLeft: () => void = () => undefined;
  onProfile: (p: ProfileSummary) => void = () => undefined;
  onToast: (text: string) => void = () => undefined;
  onWardrobe: () => void = () => undefined;
  onChronicle: () => void = () => undefined;
  // True while the guardian stands on their own hut's porch (and at no shop).
  #home = false;

  // While a panel from the menu (the wardrobe) is open over the town, the guardian stands still.
  holdStill(hold: boolean): void {
    if (this.#room !== null) this.input.enabled = !hold && this.#shopRoot.hidden;
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
    el('shop-close', HTMLButtonElement).addEventListener('click', () => {
      this.#closeShop();
    });
    el('shop-pay-back', HTMLButtonElement).addEventListener('click', () => {
      this.#pay.hidden = true;
      this.#shopItems.hidden = false;
    });
    this.#payGo.addEventListener('click', () => {
      void this.#confirmPay();
    });
    // Emote buttons, also on keys 1 to 6.
    el('beach-emotes', HTMLDivElement).replaceChildren(
      ...EMOTES.map((emote, i) => {
        const b = h('button', '', EMOTE_GLYPHS[emote]);
        b.type = 'button';
        b.setAttribute('aria-label', `${emote} (key ${String(i + 1)})`);
        b.addEventListener('click', () => {
          this.#emote(emote);
        });
        return b;
      }),
    );
    window.addEventListener('keydown', (e) => {
      if (this.#room === null || this.#hud.hidden || !el('wardrobe', HTMLElement).hidden || !el('story', HTMLElement).hidden) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= EMOTES.length && this.#shopRoot.hidden) {
        const emote = EMOTES[n - 1];
        if (emote !== undefined) this.#emote(emote);
        return;
      }
      if (e.key === 'Escape' && !this.#shopRoot.hidden) this.#closeShop();
      else if ((e.key === 'e' || e.key === 'E') && this.#shopRoot.hidden) this.#use();
    });
  }

  // The prompt's main action: browse the shop here, or open the wardrobe at home.
  #use(): void {
    if (this.#here !== null) this.#openShop(this.#here);
    else if (this.#home) this.onWardrobe();
  }

  setProfile(p: ProfileSummary | null): void {
    this.#profile = p;
    this.#wallet.textContent = p === null ? 'No wallet' : `${p.balance.toLocaleString('en-US')} play sats`;
    this.scene.setHutDecor(p?.owned ?? []);
  }

  get active(): boolean {
    return this.#room !== null;
  }

  async enter(nickname: string): Promise<void> {
    const room = await this.session.beach(nickname);
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
      this.onToast(`Parcel for the ${name(job.data.to)}: ${String(job.data.reward)} sats on delivery.`);
      this.#render();
    });
    room.onMessage(BEACH_MESSAGES.DONE, (payload: unknown) => {
      const done = CourierDoneSchema.safeParse(payload);
      if (!done.success) return;
      if (done.data.reason === 'error') {
        this.onToast('The mint couldn’t pay just now. You still have the parcel: try delivering again in a moment.');
        return;
      }
      const to = this.#job?.to;
      this.#job = null;
      this.scene.setTarget(null);
      if (to !== undefined) this.scene.delivered(to, done.data.paid);
      for (const seal of done.data.seals) this.#achievements.announce('seal', sealName(seal));
      if (done.data.paid > 0) {
        audio.play('coin');
        this.onToast(`Delivered! +${String(done.data.paid)} play sats (${String(done.data.deliveredToday)} today).`);
      } else {
        this.onToast(done.data.reason === 'dailyLimit' ? 'Delivered, with thanks. You have done today’s paid deliveries; come back tomorrow.' : 'Delivered, with thanks.');
      }
      void this.profiles.profile().then((p) => {
        if (p !== null) this.onProfile(p);
      });
      this.#render();
    });
    room.onMessage(BEACH_MESSAGES.REFUSED, (payload: unknown) => {
      const r = CourierRefusedSchema.safeParse(payload);
      if (r.success) this.onToast(REFUSALS[r.data.reason] ?? 'That did not work.');
    });
    room.onMessage(BEACH_MESSAGES.EMOTE, (payload: unknown) => {
      const line = EmoteLineSchema.safeParse(payload);
      if (line.success) this.scene.emote(line.data.from, EMOTE_GLYPHS[line.data.emote], line.data.emote);
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
    this.#closeShop();
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
    const here = pos === null ? null : shopAt(pos);
    if (here !== this.#here) {
      this.#here = here;
      this.scene.setFocusShop(here);
    }
    const job = this.#job;
    this.#jobLine.textContent = job === null ? 'Courier jobs: take a parcel at any shop counter and carry it to another for play sats.' : `Carrying a parcel to the ${name(job.to)} for ${String(job.reward)} sats.`;
    const home = here === null && pos !== null && atHome(pos);
    if (home !== this.#home) {
      this.#home = home;
      this.scene.setFocusHome(home);
      // A small welcome chime on stepping onto your own porch.
      if (home) audio.play('chirp');
    }
    this.#prompt.hidden = (here === null && !home) || !this.#shopRoot.hidden;
    if (home) {
      this.#promptText.textContent = 'Your hut · Rest, try on your look or reread the Chronicle';
      this.#browse.textContent = 'Wardrobe (E)';
      this.#jobAction.textContent = 'Read the Chronicle';
      this.#jobAction.hidden = false;
      return;
    }
    if (here === null) return;
    this.#browse.textContent = 'Browse (E)';
    this.#promptText.textContent = `${name(here)} · ${getShop(here)?.sells ?? ''}`;
    if (job === null) {
      this.#jobAction.textContent = 'Take a delivery';
      this.#jobAction.hidden = false;
    } else if (job.to === here) {
      this.#jobAction.textContent = `Deliver the parcel (+${String(job.reward)} sats)`;
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
    const info = getShop(shop);
    if (info === undefined) return;
    this.#shopTitle.textContent = info.name;
    this.#shopSells.textContent = info.sells;
    this.#pay.hidden = true;
    this.#shopItems.hidden = false;
    const owned = new Set(this.#profile?.owned ?? []);
    const rows = itemsInShop(shop).flatMap((item) => {
      if (item.source.kind !== 'shop' || item.source.price < 1) return [];
      const price = item.source.price;
      const row = h('div', 'shop-item');
      const swatch = h('span', 'swatch');
      swatch.style.background = item.hints.swatch;
      const have = item.category !== 'food' && ownsItem(owned, item.id);
      const buy = h('button', have ? '' : 'cta', have ? 'Owned' : 'Buy');
      buy.type = 'button';
      buy.disabled = have || this.#profile === null;
      buy.addEventListener('click', () => {
        this.#startPay(item, shop, price);
      });
      row.append(swatch, h('span', 'name', item.name), h('span', 'price', `${String(price)} sats`), buy);
      return [row];
    });
    this.#shopItems.replaceChildren(...rows);
    this.#shopRoot.hidden = false;
    this.#shopRoot.focus();
    this.input.enabled = false;
    this.#render();
  }

  #closeShop(): void {
    this.#shopRoot.hidden = true;
    this.#buying = null;
    if (this.#room !== null) this.input.enabled = true;
  }

  // Note picking: tap notes from the wallet; the same rule as the mint says when it is enough.
  #startPay(item: CatalogItem, shop: ShopId, price: number): void {
    this.#buying = { item, shop, price };
    this.#selected = [];
    this.#payTitle.textContent = `${item.name}: ${String(price)} sats`;
    this.#shopItems.hidden = true;
    this.#pay.hidden = false;
    this.#renderNotes();
  }

  #renderNotes(): void {
    const p = this.#profile;
    const b = this.#buying;
    if (p === null || b === null) return;
    const notes = [...p.notes].sort((x, y) => y - x);
    const picked = [...this.#selected];
    const buttons = notes.map((note, i) => {
      const btn = h('button', '', String(note));
      btn.type = 'button';
      const on = picked.includes(i);
      btn.setAttribute('aria-pressed', String(on));
      btn.addEventListener('click', () => {
        this.#selected = on ? this.#selected.filter((k) => k !== i) : [...this.#selected, i];
        audio.play('click');
        this.#renderNotes();
      });
      return btn;
    });
    this.#notes.replaceChildren(...buttons);
    const chosen = this.#selected.map((i) => notes[i] ?? 0);
    const sum = chosen.reduce((a, n) => a + n, 0);
    const check = chosen.length === 0 ? null : payWithNotes(p.notes, chosen, b.price);
    this.#payStatus.classList.toggle('ok', check?.ok === true);
    if (check === null) this.#payStatus.textContent = `Selected 0 of ${String(b.price)} sats.`;
    else if (check.ok) {
      const change = sum - b.price;
      this.#payStatus.textContent = change === 0 ? 'Exact. No change needed.' : `That covers it. Change: ${String(change)} sats, reissued as ${toDenominations(change).join(' + ')}.`;
    } else if (check.error === 'underpaid') this.#payStatus.textContent = `Selected ${String(sum)} of ${String(b.price)} sats. Add another note.`;
    else if (check.error === 'overpaid') this.#payStatus.textContent = 'One of these notes is not needed. Take the smallest back.';
    else if (check.error === 'insufficientFunds') this.#payStatus.textContent = 'Your wallet does not hold enough for this yet. Courier jobs and matches earn more.';
    else this.#payStatus.textContent = 'Pick notes from your wallet.';
    this.#payGo.disabled = check?.ok !== true;
  }

  async #confirmPay(): Promise<void> {
    const p = this.#profile;
    const b = this.#buying;
    if (p === null || b === null) return;
    const notes = [...p.notes].sort((x, y) => y - x);
    const chosen = this.#selected.map((i) => notes[i] ?? 0);
    this.#payGo.disabled = true;
    const next = await this.profiles.buy(b.item.id, b.shop, chosen);
    if (next === null) {
      this.#payStatus.textContent = 'The mint refused that payment. Check the notes and try again.';
      this.#payGo.disabled = false;
      return;
    }
    audio.play('coin');
    this.onProfile(next);
    this.onToast(b.item.category === 'food' ? `Enjoy your ${b.item.name.toLowerCase()}!` : `${b.item.name} is in your wardrobe.`);
    this.#openShop(b.shop);
  }
}
