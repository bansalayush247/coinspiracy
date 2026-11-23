// What a player earned in the match that just ended: XP lines, the rank bar, unlocks, seals and quests.
import { QUESTS, RANK_START, nextUnlock, rankFor, type AwardMessage } from '@byzantine-council/shared/progression';
import { audio } from '../audio/engine.js';
import { el, h } from '../ui/dom.js';
import { XP_REASON_TEXT, frameName, itemName, sealName, titleName } from './names.js';

const INELIGIBLE: Readonly<Record<'left' | 'afk' | 'idle', string>> = {
  left: 'You left before the end, so this match pays nothing.',
  afk: 'You were removed for idling, so this match pays nothing.',
  idle: 'No rewards for standing still: walk around, do a task or sign a withdrawal next time.',
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
    if (award.rankAfter > award.rankBefore) this.onAchievement('rank', `Rank ${String(award.rankAfter)}`);
    for (const s of award.seals) this.onAchievement('seal', sealName(s));
    for (const id of award.items) this.onAchievement('look', itemName(id));
    if (award.rankAfter > award.rankBefore) audio.play('rankUp');
    else if (award.eligible) audio.play('coin');
    const parts: HTMLElement[] = [];
    if (!award.eligible) {
      parts.push(h('p', 'hint', award.ineligible === undefined ? 'No rewards this time.' : INELIGIBLE[award.ineligible]));
      this.#body.replaceChildren(...parts);
      return;
    }
    if (award.practice) parts.push(h('p', 'hint', 'Practice match: half XP, and only station progress counts.'));

    const lines = h('ul', 'xp-lines');
    for (const l of award.lines) {
      const li = h('li', '');
      li.append(h('span', '', XP_REASON_TEXT[l.reason]), h('b', '', `+${String(l.xp)} XP`));
      lines.append(li);
    }
    parts.push(lines);

    // The rank bar fills from where the player was to where they are now.
    const after = rankFor(award.xpAfter);
    const before = rankFor(award.xpBefore);
    const rank = h('div', 'rank-row');
    const label = h('p', 'rank-label');
    label.append(h('b', '', `Rank ${String(after.rank)}`), h('span', '', `${String(after.into)} / ${String(after.forNext)} XP`));
    const startPct = after.rank === before.rank ? (100 * before.into) / after.forNext : 0;
    const meter = bar(startPct);
    meter.setAttribute('role', 'progressbar');
    meter.setAttribute('aria-label', `Rank ${String(after.rank)} progress`);
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
    if (award.rankAfter > award.rankBefore) parts.push(h('p', 'rank-up', `Rank up! You reached Rank ${String(award.rankAfter)}.`));

    const gains = h('ul', 'gains');
    if (award.sats > 0) gains.append(h('li', 'sats', `+${award.sats.toLocaleString('en-US')} play sats in your wallet`));
    for (const id of award.items) gains.append(h('li', 'item', `New look: ${itemName(id)}`));
    for (const f of award.frames) gains.append(h('li', 'item', `New ${frameName(f)}`));
    for (const t of award.titles) gains.append(h('li', 'item', `New title: ${titleName(t)}`));
    for (const s of award.seals) gains.append(h('li', 'seal-earned', `Seal earned: ${sealName(s)}`));
    for (const q of award.questsDone) {
      const text = QUESTS.find((x) => x.id === q.id)?.text ?? q.id;
      gains.append(h('li', 'quest', `Quest done: ${text} (+${String(q.xp)} XP, +${String(q.sats)} sats)`));
    }
    if (award.epoch.tierAfter > award.epoch.tierBefore) gains.append(h('li', 'epoch', `Epoch ${String(award.epoch.index)} road: tier ${String(award.epoch.tierAfter)} of 10`));
    if (gains.childElementCount > 0) parts.push(gains);

    // Always show what comes next: the motivation is the next unlock in view.
    const next = nextUnlock(after.rank);
    if (next !== null) {
      const xpLeft = (RANK_START[next.rank - 1] ?? 0) - award.xpAfter;
      const what = [next.unlock.item === undefined ? null : itemName(next.unlock.item), next.unlock.frame === undefined ? null : frameName(next.unlock.frame)].filter((x) => x !== null).join(' and ');
      parts.push(h('p', 'next-unlock', `${xpLeft.toLocaleString('en-US')} XP to Rank ${String(next.rank)}: ${what}`));
    }
    const open = award.quests
      .map((q) => ({ q, t: QUESTS.find((x) => x.id === q.id) }))
      .filter((x) => x.t !== undefined)
      .map(({ q, t }) => `${t?.text ?? ''} (${String(q.progress)}/${String(t?.target ?? 0)})`);
    if (open.length > 0) parts.push(h('p', 'hint', `Quests: ${open.join(' · ')}`));
    this.#body.replaceChildren(...parts);
  }
}
