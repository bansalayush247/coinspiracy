// The progress page: Rank Road, the Seal Book, quests and the Epoch Road. Every locked thing says
// what it gives and how to get it, so the next goal is always in view.
import { RANK_ROAD, RANK_TITLES, SEALS, SEAL_TAB_NAMES, SEAL_TABS, SEAL_XP, type Seal } from '@byzantine-council/shared/progression';
import { el, h } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { button } from '../ui/tasks/types.js';
import type { ProfileSummary } from './api.js';
import { frameName, itemName, titleName } from './names.js';

type Tab = 'rank' | 'seals' | 'quests' | 'epoch';

function meter(value: number, max: number, label: string): HTMLDivElement {
  const outer = h('div', 'bar');
  outer.setAttribute('role', 'progressbar');
  outer.setAttribute('aria-label', label);
  outer.setAttribute('aria-valuemin', '0');
  outer.setAttribute('aria-valuemax', String(max));
  outer.setAttribute('aria-valuenow', String(value));
  const fill = h('div', 'fill');
  fill.style.width = `${String(max <= 0 ? 0 : Math.min(100, (100 * value) / max))}%`;
  outer.append(fill);
  return outer;
}

function depth(seal: Seal): number {
  let d = 0;
  let parent = seal.parent;
  while (parent !== null && d < 6) {
    d += 1;
    parent = SEALS.find((s) => s.id === parent)?.parent ?? null;
  }
  return d;
}

function sealReward(s: Seal): string {
  const parts = [t('rewards.xp', { xp: String(SEAL_XP[s.frame]) })];
  if (s.item !== undefined) parts.push(itemName(s.item));
  if (s.title !== undefined) parts.push(t('progress.titleReward', { name: titleName(s.title) }));
  return parts.join(' · ');
}

export class ProgressPage {
  readonly #root = el('progress', HTMLElement);
  readonly #title = el('progress-title', HTMLHeadingElement);
  readonly #body = el('progress-body', HTMLDivElement);
  readonly #tabs = Array.from(this.#root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  #tab: Tab = 'rank';
  #profile: ProfileSummary | null = null;
  onTitle: (title: string | null) => void = () => undefined;
  onFrame: (frame: string | null) => void = () => undefined;
  onReroll: (quest: string) => void = () => undefined;

  constructor() {
    el('progress-close', HTMLButtonElement).addEventListener('click', () => {
      this.hide();
    });
    for (const t of this.#tabs) {
      t.addEventListener('click', () => {
        this.#tab = (t.dataset['tab'] ?? 'rank') as Tab;
        this.#render();
      });
    }
    this.#root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
    });
  }

  get isOpen(): boolean {
    return !this.#root.hidden;
  }

  open(): void {
    this.#root.hidden = false;
    this.#render();
    this.#root.focus();
  }

  hide(): void {
    this.#root.hidden = true;
  }

  setProfile(p: ProfileSummary): void {
    this.#profile = p;
    if (this.isOpen) this.#render();
  }

  #render(): void {
    for (const t of this.#tabs) t.setAttribute('aria-selected', String(t.dataset['tab'] === this.#tab));
    const p = this.#profile;
    if (p === null) {
      this.#title.textContent = t('progress.unavailable');
      this.#body.replaceChildren(h('p', 'hint', t('progress.unreachable')));
      return;
    }
    const v = p.progress;
    this.#title.textContent = t('progress.heading', { rank: String(v.rank), title: titleName(v.title) });
    this.#body.replaceChildren(...(this.#tab === 'rank' ? this.#rank(p) : this.#tab === 'seals' ? this.#seals(p) : this.#tab === 'quests' ? this.#quests(p) : this.#epoch(p)));
  }

  #rank(p: ProfileSummary): HTMLElement[] {
    const v = p.progress;
    const head = h('div', 'rank-row');
    const label = h('p', 'rank-label');
    label.append(h('b', '', `${t('rank.name', { rank: String(v.rank) })}${v.stars > 0 ? ` ★${String(v.stars)}` : ''}`), h('span', '', t('rank.xp', { into: String(v.into), next: String(v.forNext) })));
    head.append(label, meter(v.into, v.forNext, t('progress.rankAria')));
    const wallet = h('p', 'hint', t('progress.wallet', { sats: p.balance, notes: String(p.notes.length), rankUp: String(v.rankUpSats) }));

    const road = h('ol', 'road');
    for (const [rank, unlock] of RANK_ROAD) {
      const li = h('li', rank <= v.rank ? 'reached' : '');
      const title = RANK_TITLES.find((t) => t.rank === rank);
      const gets = [unlock.item === undefined ? null : itemName(unlock.item), unlock.frame === undefined ? null : frameName(unlock.frame), title === undefined ? null : t('progress.titleReward', { name: title.name })].filter((x) => x !== null);
      li.append(h('b', '', t('rank.name', { rank: String(rank) })), h('span', '', gets.join(' · ')));
      road.append(li);
    }

    const choose = h('div', 'choosers');
    const titles = h('select', 'chat-select');
    titles.setAttribute('aria-label', t('progress.titleAria'));
    for (const t of v.titles) {
      const o = h('option', '', titleName(t));
      o.value = t;
      titles.append(o);
    }
    titles.value = v.title;
    titles.addEventListener('change', () => {
      this.onTitle(titles.value);
    });
    const frames = h('select', 'chat-select');
    frames.setAttribute('aria-label', t('progress.frameAria'));
    const none = h('option', '', t('progress.noFrame'));
    none.value = '';
    frames.append(none);
    for (const f of v.frames) {
      const o = h('option', '', frameName(f));
      o.value = f;
      frames.append(o);
    }
    frames.value = v.frame ?? '';
    frames.addEventListener('change', () => {
      this.onFrame(frames.value === '' ? null : frames.value);
    });
    const tl = h('label', '', `${t('progress.title')} `);
    tl.append(titles);
    const fl = h('label', '', `${t('progress.frame')} `);
    fl.append(frames);
    choose.append(tl, fl);
    return [head, wallet, choose, h('h3', '', t('progress.tabRank')), road];
  }

  #seals(p: ProfileSummary): HTMLElement[] {
    const state = new Map(p.progress.seals.map((s) => [s.id, s]));
    const done = p.progress.seals.filter((s) => s.done).length;
    const out: HTMLElement[] = [h('p', 'hint', t('progress.sealsEarned', { done: String(done), total: String(SEALS.length) }))];
    for (const tab of SEAL_TABS) {
      out.push(h('h3', '', SEAL_TAB_NAMES[tab]));
      const list = h('ul', 'seal-list');
      for (const seal of SEALS.filter((s) => s.tab === tab)) {
        const s = state.get(seal.id);
        // Like an advancement tree: past what is visible, only the next locked step shows.
        const parentShown = seal.parent === null || state.get(seal.parent)?.visible === true;
        if (s?.visible !== true && !parentShown) continue;
        const li = h('li', ['seal-card', seal.frame, s?.done === true ? 'done' : '', s?.visible === true ? '' : 'locked'].filter(Boolean).join(' '));
        li.style.marginLeft = `${String(Math.min(4, depth(seal)) * 14)}px`;
        if (s === undefined || !s.visible) {
          li.append(h('b', '', seal.hidden ? '???' : t('progress.locked')), h('span', 'goal', t(seal.hidden ? 'progress.hiddenSeal' : 'progress.lockedSeal')));
        } else {
          li.append(h('b', '', `${s.done ? '✓ ' : ''}${seal.name}`), h('span', 'goal', seal.goal));
          if (!s.done) li.append(meter(s.progress, seal.target, t('progress.sealAria', { name: seal.name })), h('span', 'count', `${String(s.progress)} / ${String(seal.target)}`));
          li.append(h('span', 'reward', sealReward(seal)));
        }
        list.append(li);
      }
      out.push(list);
    }
    return out;
  }

  #quests(p: ProfileSummary): HTMLElement[] {
    const v = p.progress;
    const list = h('ul', 'quest-list');
    for (const q of v.quests) {
      const li = h('li', 'quest');
      li.append(h('b', '', q.text), meter(q.progress, q.target, q.text), h('span', 'count', t('progress.questCount', { progress: String(q.progress), target: String(q.target), xp: String(q.xp), sats: String(q.sats) })));
      if (v.canReroll) {
        const r = button(t('progress.swap'), 'reroll');
        r.setAttribute('aria-label', t('progress.swapAria', { text: q.text }));
        r.addEventListener('click', () => {
          this.onReroll(q.id);
        });
        li.append(r);
      }
      list.append(li);
    }
    for (let i = v.quests.length; i < v.questSlots; i++) list.append(h('li', 'quest empty', t('progress.questTomorrow')));
    return [h('p', 'hint', t('progress.questsHint')), list];
  }

  #epoch(p: ProfileSummary): HTMLElement[] {
    const e = p.progress.epoch;
    const head = h('div', 'rank-row');
    const label = h('p', 'rank-label');
    label.append(h('b', '', t('progress.epochHeading', { epoch: String(e.index), tier: String(e.tier), tiers: String(e.tiers) })), h('span', '', t('progress.epochXp', { xp: String(e.xp) })));
    head.append(label, meter(e.xp, e.tiers * e.tierXp, t('progress.epochAria')));
    const road = h('ol', 'road');
    for (const r of e.rewards) {
      const li = h('li', r.tier <= e.tier ? 'reached' : '');
      const what = r.item !== undefined ? itemName(r.item) : r.frame !== undefined ? frameName(r.frame) : t('progress.sats', { sats: String(r.sats ?? 0) });
      li.append(h('b', '', t('progress.tier', { tier: String(r.tier) })), h('span', '', t('progress.tierReward', { xp: String(r.tier * e.tierXp), what })));
      road.append(li);
    }
    return [
      head,
      h('p', 'hint', t('progress.epochHint')),
      road,
    ];
  }
}
