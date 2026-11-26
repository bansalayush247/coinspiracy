// What a player earned in the match that just ended: XP lines, the rank bar, unlocks, seals and quests.
import { QUESTS, RANK_START, nextUnlock, rankFor, type AwardMessage } from '@byzantine-council/shared/progression';
import { audio } from '../audio/engine.js';
import { el, h } from '../ui/dom.js';
import { t, type PlainKey } from '../i18n/index.js';
import { XP_REASON_TEXT, frameName, itemName, sealName, titleName } from './names.js';

const INELIGIBLE: Readonly<Record<'left' | 'afk' | 'idle', PlainKey>> = {
  left: 'rewards.left',
  afk: 'rewards.afk',
  idle: 'rewards.idle',
};

function bar(percent: number): HTMLDivElement {
  const outer = h('div', 'bar');
  const fill = h('div', 'fill');
  fill.style.width = `${String(Math.max(0, Math.min(100, percent)))}%`;
  outer.append(fill);
  return outer;
}

export class RewardsPanel {
  readonly #root = el('rewards', HTMLElement);
  readonly #body = el('rewards-body', HTMLDivElement);
  readonly #reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  hide(): void {
    this.#root.hidden = true;
    this.#body.replaceChildren();
  }

  // Set by the controller: seals, looks and rank-ups also pop up as achievement cards.
  onAchievement: (kind: 'seal' | 'look' | 'rank', name: string) => void = () => undefined;

  show(award: AwardMessage): void {
    this.#root.hidden = false;
    if (award.rankAfter > award.rankBefore) this.onAchievement('rank', t('rank.name', { rank: String(award.rankAfter) }));
    for (const s of award.seals) this.onAchievement('seal', sealName(s));
    for (const id of award.items) this.onAchievement('look', itemName(id));
    if (award.rankAfter > award.rankBefore) audio.play('rankUp');
    else if (award.eligible) audio.play('coin');
    const parts: HTMLElement[] = [];
    if (!award.eligible) {
      parts.push(h('p', 'hint', t(award.ineligible === undefined ? 'rewards.none' : INELIGIBLE[award.ineligible])));
      this.#body.replaceChildren(...parts);
      return;
    }
    if (award.practice) parts.push(h('p', 'hint', t('rewards.practice')));

    const lines = h('ul', 'xp-lines');
    for (const l of award.lines) {
      const li = h('li', '');
      li.append(h('span', '', t(XP_REASON_TEXT[l.reason])), h('b', '', t('rewards.xp', { xp: String(l.xp) })));
      lines.append(li);
    }
    parts.push(lines);

    // The rank bar fills from where the player was to where they are now.
    const after = rankFor(award.xpAfter);
    const before = rankFor(award.xpBefore);
    const rank = h('div', 'rank-row');
    const label = h('p', 'rank-label');
    label.append(h('b', '', t('rank.name', { rank: String(after.rank) })), h('span', '', t('rank.xp', { into: String(after.into), next: String(after.forNext) })));
    const startPct = after.rank === before.rank ? (100 * before.into) / after.forNext : 0;
    const meter = bar(startPct);
    meter.setAttribute('role', 'progressbar');
    meter.setAttribute('aria-label', t('rank.progressAria', { rank: String(after.rank) }));
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', String(after.forNext));
    meter.setAttribute('aria-valuenow', String(after.into));
    rank.append(label, meter);
    parts.push(rank);
    const target = (100 * after.into) / after.forNext;
    const fill = meter.firstElementChild;
    if (fill instanceof HTMLElement) {
      if (this.#reduced) fill.style.width = `${String(target)}%`;
      else window.setTimeout(() => (fill.style.width = `${String(target)}%`), 250);
    }
    if (award.rankAfter > award.rankBefore) parts.push(h('p', 'rank-up', t('rewards.rankUp', { rank: String(award.rankAfter) })));

    const gains = h('ul', 'gains');
    if (award.sats > 0) gains.append(h('li', 'sats', t('rewards.sats', { sats: award.sats })));
    for (const id of award.items) gains.append(h('li', 'item', t('rewards.newLook', { name: itemName(id) })));
    for (const f of award.frames) gains.append(h('li', 'item', t('rewards.newFrame', { name: frameName(f) })));
    for (const title of award.titles) gains.append(h('li', 'item', t('rewards.newTitle', { name: titleName(title) })));
    for (const s of award.seals) gains.append(h('li', 'seal-earned', t('rewards.seal', { name: sealName(s) })));
    for (const q of award.questsDone) {
      const text = QUESTS.find((x) => x.id === q.id)?.text ?? q.id;
      gains.append(h('li', 'quest', t('rewards.quest', { text, xp: String(q.xp), sats: String(q.sats) })));
    }
    if (award.epoch.tierAfter > award.epoch.tierBefore) gains.append(h('li', 'epoch', t('rewards.epoch', { epoch: String(award.epoch.index), tier: String(award.epoch.tierAfter) })));
    if (gains.childElementCount > 0) parts.push(gains);

    // Always show what comes next: the motivation is the next unlock in view.
    const next = nextUnlock(after.rank);
    if (next !== null) {
      const xpLeft = (RANK_START[next.rank - 1] ?? 0) - award.xpAfter;
      const what = [next.unlock.item === undefined ? null : itemName(next.unlock.item), next.unlock.frame === undefined ? null : frameName(next.unlock.frame)].filter((x) => x !== null).join(t('common.and'));
      parts.push(h('p', 'next-unlock', t('rewards.next', { xp: xpLeft, rank: String(next.rank), what })));
    }
    const open = award.quests
      .map((q) => ({ q, t: QUESTS.find((x) => x.id === q.id) }))
      .filter((x) => x.t !== undefined)
      .map(({ q, t: quest }) => `${quest?.text ?? ''} (${String(q.progress)}/${String(quest?.target ?? 0)})`);
    if (open.length > 0) parts.push(h('p', 'hint', t('rewards.quests', { list: open.join(' · ') })));
    this.#body.replaceChildren(...parts);
  }
}
