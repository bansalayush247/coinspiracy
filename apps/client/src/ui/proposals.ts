// Withdrawal proposals: sign, refuse, audit, and (for Byzantines) forge. The server decides everything;
// this only shows synced state plus what this player privately learned (their audits, their team's forgeries).
import { LIVENESS_LIMIT, type ProposalStatus } from '@byzantine-council/shared';
import { cssColor, seatColors } from '../game/palette.js';
import { getLocale, t, type PlainKey } from '../i18n/index.js';
import { el, h } from './dom.js';
import { button, formatSats } from './tasks/types.js';

export interface ProposalView {
  readonly id: string;
  readonly amount: number;
  readonly status: ProposalStatus;
  readonly secondsLeft: number;
  readonly signers: readonly string[];
  readonly refusers: readonly string[];
  readonly verdict: '' | 'legit' | 'forged';
}

export interface PlayerRef {
  readonly name: string;
  readonly seat: number;
}

export interface ProposalsContext {
  readonly me: string;
  readonly needed: number;
  readonly strikes: number;
  readonly canAct: boolean;
  readonly atDesk: boolean;
  readonly players: ReadonlyMap<string, PlayerRef>;
  // Private knowledge: proposals this player audited, and forgeries their team filed.
  readonly audits: ReadonlyMap<string, boolean>;
  readonly auditing: string | null;
  readonly forgedByTeam: ReadonlySet<string>;
}

const STATUS_TEXT: Readonly<Record<Exclude<ProposalStatus, 'open'>, PlainKey>> = {
  passed: 'proposal.passed',
  rejected: 'proposal.rejected',
  expired: 'proposal.expired',
};

function cardKey(p: ProposalView, ctx: ProposalsContext): string {
  return JSON.stringify([
    getLocale(),
    p.status,
    p.verdict,
    p.signers,
    p.refusers,
    ctx.needed,
    ctx.canAct,
    ctx.atDesk,
    ctx.audits.get(p.id) ?? null,
    ctx.auditing === p.id,
    ctx.auditing === null,
    ctx.forgedByTeam.has(p.id),
    [...p.signers, ...p.refusers].map((id) => ctx.players.get(id)?.seat ?? -1),
  ]);
}

export class ProposalsPanel {
  readonly #root = el('proposals', HTMLElement);
  readonly #list = el('proposal-list', HTMLUListElement);
  readonly #liveness = el('liveness', HTMLElement);
  readonly #empty = el('proposals-empty', HTMLParagraphElement);
  onSign: (id: string) => void = () => undefined;
  onRefuse: (id: string) => void = () => undefined;
  onAudit: (id: string) => void = () => undefined;

  show(on: boolean): void {
    this.#root.hidden = !on;
  }

  // Cards are kept by id and rebuilt only when something besides the timer changed, so focus survives the countdown.
  readonly #cards = new Map<string, { li: HTMLLIElement; key: string; timer: HTMLElement | null }>();
  #order = '';

  render(proposals: readonly ProposalView[], ctx: ProposalsContext): void {
    this.#renderLiveness(ctx.strikes);
    this.#empty.hidden = proposals.length > 0;
    const seen = new Set<string>();
    for (const p of proposals) {
      seen.add(p.id);
      const key = cardKey(p, ctx);
      const cached = this.#cards.get(p.id);
      if (cached?.key === key) {
        if (cached.timer !== null) cached.timer.textContent = `${String(p.secondsLeft)}s`;
        continue;
      }
      const li = this.#card(p, ctx);
      cached?.li.replaceWith(li);
      this.#cards.set(p.id, { li, key, timer: li.querySelector<HTMLElement>('.timer') });
    }
    for (const id of [...this.#cards.keys()]) if (!seen.has(id)) this.#cards.delete(id);
    const order = proposals.map((p) => p.id).join(',');
    if (order !== this.#order) {
      this.#order = order;
      this.#list.replaceChildren(...proposals.flatMap((p) => this.#cards.get(p.id)?.li ?? []));
    }
  }

  reset(): void {
    this.#cards.clear();
    this.#order = '';
    this.#list.replaceChildren();
  }

  #renderLiveness(strikes: number): void {
    const pips = Array.from({ length: LIVENESS_LIMIT }, (_, i) => h('span', i < strikes ? 'pip lost' : 'pip'));
    this.#liveness.replaceChildren(h('span', 'label', t('proposal.liveness')), ...pips);
    this.#liveness.title = t('proposal.livenessTitle', { strikes: String(strikes), limit: String(LIVENESS_LIMIT) });
  }

  #card(p: ProposalView, ctx: ProposalsContext): HTMLLIElement {
    const open = p.status === 'open';
    const li = h('li', `proposal ${open ? 'open' : `closed ${p.verdict}`}`);
    li.dataset['id'] = p.id;
    li.dataset['status'] = p.status;

    const head = h('div', 'head');
    head.append(h('b', '', `#${p.id}`), h('span', 'amount', t('proposal.withdraw', { amount: formatSats(p.amount) })));
    if (open) head.append(h('span', 'timer', `${String(p.secondsLeft)}s`));
    li.append(head);

    const sigs = h('div', 'sigs');
    sigs.append(h('span', 'count', t('proposal.signed', { n: String(p.signers.length), needed: String(ctx.needed) })));
    const dots = h('span', 'dots');
    for (const id of p.signers) dots.append(this.#dot(id, ctx, 'signed'));
    for (const id of p.refusers) dots.append(this.#dot(id, ctx, 'refused'));
    sigs.append(dots);
    li.append(sigs);

    const tags = h('div', 'tags');
    if (!open) {
      tags.append(h('span', `tag ${p.verdict === 'forged' ? 'byzantine' : 'honest'}`, t(p.verdict === 'forged' ? 'proposal.forged' : 'proposal.real')));
      tags.append(h('span', 'tag left', t(STATUS_TEXT[p.status])));
    } else {
      if (ctx.forgedByTeam.has(p.id)) tags.append(h('span', 'tag byzantine', t('proposal.teamForgery')));
      const audit = ctx.audits.get(p.id);
      if (audit !== undefined) tags.append(h('span', `tag ${audit ? 'byzantine' : 'honest'}`, t(audit ? 'proposal.checkedForged' : 'proposal.checkedReal')));
      if (ctx.auditing === p.id) tags.append(h('span', 'tag auditing', t('proposal.auditing')));
    }
    if (tags.childElementCount > 0) li.append(tags);

    if (open) {
      const responded = p.signers.includes(ctx.me) || p.refusers.includes(ctx.me);
      const actions = h('div', 'proposal-actions');
      const sign = button(t('proposal.sign'), 'sign');
      const refuse = button(t('proposal.refuse'), 'refuse');
      sign.disabled = refuse.disabled = responded || !ctx.canAct;
      sign.setAttribute('aria-label', t('proposal.signAria', { id: p.id }));
      refuse.setAttribute('aria-label', t('proposal.refuseAria', { id: p.id }));
      sign.addEventListener('click', () => {
        this.onSign(p.id);
      });
      refuse.addEventListener('click', () => {
        this.onRefuse(p.id);
      });
      actions.append(sign, refuse);
      if (ctx.atDesk && ctx.audits.get(p.id) === undefined && ctx.auditing === null) {
        const audit = button(t('proposal.audit'), 'audit');
        audit.disabled = !ctx.canAct;
        audit.setAttribute('aria-label', t('proposal.auditAria', { id: p.id }));
        audit.addEventListener('click', () => {
          this.onAudit(p.id);
        });
        actions.append(audit);
      }
      if (responded) actions.append(h('span', 'answered', t(p.signers.includes(ctx.me) ? 'proposal.youSigned' : 'proposal.youRefused')));
      li.append(actions);
    }
    return li;
  }

  #dot(id: string, ctx: ProposalsContext, kind: 'signed' | 'refused'): HTMLSpanElement {
    const who = ctx.players.get(id);
    const dot = h('span', `who ${kind}`);
    if (who !== undefined) dot.style.background = cssColor(seatColors(who.seat).lit);
    const name = who?.name ?? t('proposal.guardianLeft');
    const label = t(kind === 'signed' ? 'proposal.whoSigned' : 'proposal.whoRefused', { name });
    dot.title = label;
    dot.setAttribute('aria-label', label);
    dot.setAttribute('role', 'img');
    return dot;
  }
}
