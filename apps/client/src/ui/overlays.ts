import type { Role, Side, WinReason } from '@byzantine-council/shared';
import { t, tn, type PlainKey } from '../i18n/index.js';
import { el, h } from './dom.js';
import { shareResult, type ShareInfo } from './shareCard.js';
import { CODEX_FOR_REASON, SITE_URL } from '../siteUrl.js';

const ROLE_CARD_MS = 7000;

export class RoleCard {
  readonly #root = el('role-card', HTMLElement);
  readonly #title = el('role-title', HTMLHeadingElement);
  readonly #text = el('role-text', HTMLParagraphElement);
  readonly #team = el('role-team', HTMLParagraphElement);
  readonly #ok = el('role-ok', HTMLButtonElement);
  #timer = 0;

  constructor() {
    this.#ok.addEventListener('click', () => {
      this.hide();
    });
  }

  get isOpen(): boolean {
    return !this.#root.hidden;
  }

  show(role: Role, fellows: readonly string[], byzantines: number): void {
    this.#root.dataset['role'] = role;
    if (role === 'byzantine') {
      this.#title.textContent = t('role.byzTitle');
      this.#text.textContent = t('role.byzText');
      this.#team.textContent = fellows.length > 0 ? t('role.fellows', { names: fellows.join(', ') }) : t('role.alone');
    } else {
      this.#title.textContent = t('role.honestTitle');
      this.#text.textContent = t('role.honestText');
      this.#team.textContent = tn('role.hiding', byzantines);
    }
    this.#root.hidden = false;
    this.#ok.focus();
    window.clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => {
      this.hide();
    }, ROLE_CARD_MS);
  }

  hide(): void {
    window.clearTimeout(this.#timer);
    this.#root.hidden = true;
  }
}

export interface ResultEntry {
  readonly name: string;
  readonly role: Role;
  readonly isMe: boolean;
  readonly left: boolean;
}

const REASONS: Readonly<Record<WinReason, PlainKey>> = {
  consensusReached: 'reason.consensusReached',
  allByzantineRotatedOut: 'reason.allByzantineRotatedOut',
  federationHalted: 'reason.federationHalted',
  forgedProposalPassed: 'reason.forgedProposalPassed',
  livenessLost: 'reason.livenessLost',
  outOfTime: 'reason.outOfTime',
};

export class ResultCard {
  readonly #root = el('result', HTMLElement);
  readonly #title = el('result-title', HTMLHeadingElement);
  readonly #verdict = el('result-verdict', HTMLParagraphElement);
  readonly #reason = el('result-reason', HTMLParagraphElement);
  readonly #roles = el('result-roles', HTMLUListElement);
  readonly #share = el('result-share', HTMLButtonElement);
  readonly #learn = el('result-learn', HTMLAnchorElement);
  #info: ShareInfo | null = null;
  onShared: (outcome: 'shared' | 'saved' | 'failed') => void = () => undefined;

  constructor() {
    this.#share.addEventListener('click', () => {
      const info = this.#info;
      if (info === null) return;
      this.#share.disabled = true;
      void shareResult(info).then((outcome) => {
        this.#share.disabled = false;
        this.onShared(outcome);
      });
    });
  }

  // Called on every patch while the match is over; focus moves only when the card first appears.
  show(winner: Side, reason: WinReason | '', mine: Role | undefined, entries: readonly ResultEntry[]): void {
    const appearing = this.#root.hidden;
    this.#root.dataset['winner'] = winner;
    this.#title.textContent = t(winner === 'honest' ? 'result.honestWin' : 'result.byzWin');
    this.#verdict.textContent = mine === undefined ? '' : t(mine === winner ? 'result.won' : 'result.lost');
    this.#reason.textContent = reason === '' ? '' : t(REASONS[reason]);
    this.#info = { won: mine === winner, winner, role: mine, reason: reason === '' ? '' : t(REASONS[reason]) };
    const slug = reason === '' ? undefined : CODEX_FOR_REASON[reason];
    this.#learn.hidden = SITE_URL === null || slug === undefined;
    if (SITE_URL !== null && slug !== undefined) this.#learn.href = `${SITE_URL}/codex/${slug}/`;
    const items = [...entries]
      .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'byzantine' ? -1 : 1))
      .map((e) => {
        const li = h('li', e.isMe ? 'me' : '');
        const tags = h('span', 'tags');
        if (e.left) tags.append(h('span', 'tag left', t('tag.left')));
        tags.append(h('span', `tag ${e.role}`, t(e.role === 'byzantine' ? 'tag.byzantine' : 'tag.honest')));
        li.append(h('span', 'name', e.name), tags);
        return li;
      });
    this.#roles.replaceChildren(...items);
    this.#root.hidden = false;
    if (appearing) this.#root.focus();
  }

  hide(): void {
    this.#root.hidden = true;
  }
}
