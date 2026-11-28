// The shop window shared by Beach Town's stalls and Port Concord's shops: a shop's wares, then paying for one with
// notes picked from the wallet, the same rule the mint applies saying when they are enough.
import { toDenominations } from '@byzantine-council/shared';
import { getShop, itemsInShop, ownsItem, payWithNotes, type CatalogItem, type ShopId } from '@byzantine-council/shared/economy';
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
}

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
  #host: ShopHost | null = null;
  #profile: ProfileSummary | null = null;
  #shop: ShopId | null = null;
  #buying: { item: CatalogItem; price: number } | null = null;
  #selected: number[] = [];

  constructor() {
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
    this.#title.textContent = info.name;
    this.#sells.textContent = info.sells;
    this.#pay.hidden = true;
    this.#items.hidden = false;
    const owned = new Set(profile?.owned ?? []);
    const rows = itemsInShop(shop).flatMap((item) => {
      if (item.source.kind !== 'shop' || item.source.price < 1) return [];
      const price = item.source.price;
      const row = h('div', 'shop-item');
      const swatch = h('span', 'swatch');
      swatch.style.background = item.hints.swatch;
      const have = item.category !== 'food' && ownsItem(owned, item.id);
      const buy = h('button', have ? '' : 'cta', t(have ? 'beach.owned' : 'beach.buy'));
      buy.type = 'button';
      buy.disabled = have || profile === null;
      buy.addEventListener('click', () => {
        this.#startPay(item, price);
      });
      row.append(swatch, h('span', 'name', item.name), h('span', 'price', t('progress.sats', { sats: String(price) })), buy);
      return [row];
    });
    this.#items.replaceChildren(...rows);
    this.#root.hidden = false;
    this.#root.focus();
  }

  /** Closes the window, dropping any half-made payment. */
  close(): void {
    if (this.#root.hidden) return;
    this.#root.hidden = true;
    this.#buying = null;
    const host = this.#host;
    this.#host = null;
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
    host.onToast(b.item.category === 'food' ? t('beach.enjoy', { name: b.item.name.toLowerCase() }) : t('beach.inWardrobe', { name: b.item.name }));
    if (this.#host === host) this.open(shop, next, host);
  }
}

let panel: ShopPanel | null = null;

/** The page's shop window, made on first use. */
export function shopPanel(): ShopPanel {
  panel ??= new ShopPanel();
  return panel;
}
