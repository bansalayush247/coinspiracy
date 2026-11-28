// The shop window shared by Beach Town's stalls and Port Concord's shops: a shop's wares, tried on your guardian before
// you pay, then paying for one with notes picked from the wallet, the same rule the mint applies saying when they are enough.
import { toDenominations } from '@byzantine-council/shared';
import { DEFAULT_LOOK, getShop, itemsInShop, ownsItem, payWithNotes, type CatalogItem, type CosmeticSlot, type Look, type ShopId } from '@byzantine-council/shared/economy';
import type { Wear } from '../game/guardianArt.js';
import { lookWear } from '../game/wear.js';
import { guardianPortrait } from '../profile/portrait.js';
import { audio } from '../audio/engine.js';
import type { ProfileApi, ProfileSummary } from '../profile/api.js';
import { t } from '../i18n/index.js';
import { el, h } from './dom.js';

/** Whoever opened the shop: told when a purchase changes the profile, what to toast, and when the shop closes. */
export interface ShopHost {
  readonly profiles: ProfileApi;
  readonly onProfile: (p: ProfileSummary) => void;
  readonly onToast: (text: string) => void;
  readonly onClose: () => void;
  /** The shop's own name, over the trade's, for a shop in a named building. */
  readonly title?: string;
  /** The colour seat the guardian wears in this place, for the try-on preview. */
  readonly seat?: number;
  /** Shows a look on the guardian in the world while it is tried on; null puts back what they wear. */
  readonly onTry?: (wear: Wear | null) => void;
  /** A bought item was put on: let everyone else see the new look. */
  readonly onWorn?: () => void;
}

const slotOf = (item: CatalogItem): CosmeticSlot | null => (item.category === 'food' ? null : item.category);
const withItem = (look: Look, item: CatalogItem): Look => {
  const slot = slotOf(item);
  return slot === null ? look : { ...look, [slot]: item.id };
};

/** The one shop window on the page; open it with a shop id and the host that pays. */
export class ShopPanel {
  readonly #root = el('shop', HTMLElement);
  readonly #title = el('shop-title', HTMLHeadingElement);
  readonly #sells = el('shop-sells', HTMLParagraphElement);
  readonly #items = el('shop-items', HTMLDivElement);
  readonly #pay = el('shop-pay', HTMLDivElement);
  readonly #payTitle = el('shop-pay-title', HTMLParagraphElement);
  readonly #notes = el('shop-notes', HTMLDivElement);
  readonly #payStatus = el('shop-pay-status', HTMLParagraphElement);
  readonly #payGo = el('shop-pay-go', HTMLButtonElement);
  readonly #preview = h('div', 'wardrobe-preview shop-preview');
  #trying: CatalogItem | null = null;
  #host: ShopHost | null = null;
  #profile: ProfileSummary | null = null;
  #shop: ShopId | null = null;
  #buying: { item: CatalogItem; price: number } | null = null;
  #selected: number[] = [];

  constructor() {
    this.#root.insertBefore(this.#preview, this.#items);
    el('shop-close', HTMLButtonElement).addEventListener('click', () => {
      this.close();
    });
    el('shop-pay-back', HTMLButtonElement).addEventListener('click', () => {
      this.#pay.hidden = true;
      this.#items.hidden = false;
    });
    this.#payGo.addEventListener('click', () => {
      void this.#confirm();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }

  /** Whether the shop window is showing. */
  get isOpen(): boolean {
    return !this.#root.hidden;
  }

  /** Opens a shop's wares for a guardian with this profile; null shows prices but no way to pay. */
  open(shop: ShopId, profile: ProfileSummary | null, host: ShopHost): void {
    const info = getShop(shop);
    if (info === undefined) return;
    this.#host = host;
    this.#profile = profile;
    this.#shop = shop;
    this.#title.textContent = host.title ?? info.name;
    this.#sells.textContent = info.sells;
    this.#pay.hidden = true;
    this.#items.hidden = false;
    this.#trying = null;
    this.#renderItems();
    this.#renderPreview();
    this.#root.hidden = false;
    this.#root.focus();
  }

  #renderItems(): void {
    const shop = this.#shop;
    if (shop === null) return;
    const profile = this.#profile;
    const owned = new Set(profile?.owned ?? []);
    const rows = itemsInShop(shop).flatMap((item) => {
      if (item.source.kind !== 'shop' || item.source.price < 1) return [];
      const price = item.source.price;
      const trying = this.#trying?.id === item.id;
      const row = h('div', `shop-item${trying ? ' trying' : ''}`);
      const swatch = h('span', 'swatch');
      swatch.style.background = item.hints.swatch;
      const wearable = slotOf(item) !== null;
      const have = wearable && ownsItem(owned, item.id);
      row.append(swatch, h('span', 'name', item.name), h('span', 'price', t('progress.sats', { sats: String(price) })));
      if (wearable) {
        const tryOn = h('button', 'shop-try', t(trying ? 'shop.trying' : 'shop.try'));
        tryOn.type = 'button';
        tryOn.setAttribute('aria-pressed', String(trying));
        tryOn.addEventListener('click', () => {
          this.#trying = trying ? null : item;
          audio.play('click');
          this.#renderItems();
          this.#renderPreview();
        });
        row.append(tryOn);
      }
      const buy = h('button', have ? '' : 'cta', t(have ? 'beach.owned' : 'beach.buy'));
      buy.type = 'button';
      buy.disabled = have || profile === null;
      buy.addEventListener('click', () => {
        this.#startPay(item, price);
      });
      row.append(buy);
      return [row];
    });
    this.#items.replaceChildren(...rows);
  }

  // The guardian in the look being tried on, in the window and out in the world; hidden for shops that sell only food.
  #renderPreview(): void {
    const shop = this.#shop;
    const wearables = shop !== null && itemsInShop(shop).some((i) => slotOf(i) !== null);
    this.#preview.hidden = !wearables;
    if (!wearables) return;
    const base = this.#profile?.look ?? DEFAULT_LOOK;
    const look = this.#trying === null ? base : withItem(base, this.#trying);
    this.#preview.replaceChildren(guardianPortrait(this.#host?.seat ?? 0, lookWear(look)));
    this.#host?.onTry?.(this.#profile === null && this.#trying === null ? null : lookWear(look));
  }

  /** Closes the window, dropping any half-made payment. */
  close(): void {
    if (this.#root.hidden) return;
    this.#root.hidden = true;
    this.#buying = null;
    this.#trying = null;
    const host = this.#host;
    this.#host = null;
    host?.onTry?.(this.#profile === null ? null : lookWear(this.#profile.look));
    host?.onClose();
  }

  #startPay(item: CatalogItem, price: number): void {
    this.#buying = { item, price };
    this.#selected = [];
    this.#payTitle.textContent = t('beach.payTitle', { name: item.name, sats: String(price) });
    this.#items.hidden = true;
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
    if (check === null) this.#payStatus.textContent = t('beach.selectedNone', { price: String(b.price) });
    else if (check.ok) {
      const change = sum - b.price;
      this.#payStatus.textContent = change === 0 ? t('beach.exact') : t('beach.change', { change: String(change), notes: toDenominations(change).join(' + ') });
    } else if (check.error === 'underpaid') this.#payStatus.textContent = t('beach.underpaid', { sum: String(sum), price: String(b.price) });
    else if (check.error === 'overpaid') this.#payStatus.textContent = t('beach.overpaid');
    else if (check.error === 'insufficientFunds') this.#payStatus.textContent = t('beach.insufficient');
    else this.#payStatus.textContent = t('beach.pickNotes');
    this.#payGo.disabled = check?.ok !== true;
  }

  async #confirm(): Promise<void> {
    const p = this.#profile;
    const b = this.#buying;
    const host = this.#host;
    const shop = this.#shop;
    if (p === null || b === null || host === null || shop === null) return;
    const notes = [...p.notes].sort((x, y) => y - x);
    const chosen = this.#selected.map((i) => notes[i] ?? 0);
    this.#payGo.disabled = true;
    const next = await host.profiles.buy(b.item.id, shop, chosen);
    if (next === null) {
      this.#payStatus.textContent = t('beach.refused');
      this.#payGo.disabled = false;
      return;
    }
    audio.play('coin');
    host.onProfile(next);
    if (slotOf(b.item) === null) {
      host.onToast(t('beach.enjoy', { name: b.item.name.toLowerCase() }));
      if (this.#host === host) this.open(shop, next, host);
      return;
    }
    // Bought to wear: put it on straight away, so the guardian walks out in it.
    const dressed = await host.profiles.wear(withItem(next.look, b.item));
    if (dressed !== null) {
      host.onProfile(dressed);
      host.onWorn?.();
    }
    host.onToast(t(dressed === null ? 'beach.inWardrobe' : 'shop.wearing', { name: b.item.name }));
    if (this.#host === host) this.open(shop, dressed ?? next, host);
  }
}

let panel: ShopPanel | null = null;

/** The page's shop window, made on first use. */
export function shopPanel(): ShopPanel {
  panel ??= new ShopPanel();
  return panel;
}
