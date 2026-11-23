import type { Role, Side, WinReason } from '@byzantine-council/shared';
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
      this.#title.textContent = 'You are a Byzantine guardian';
      this.#text.textContent = 'Blend in with the honest guardians. Your tasks are fake, so fake them convincingly and don’t get caught.';
      this.#team.textContent = fellows.length > 0 ? `Your fellow Byzantine: ${fellows.join(', ')}` : 'You are the only Byzantine guardian.';
    } else {
      this.#title.textContent = 'You are an honest guardian';
      this.#text.textContent = 'Do your tasks to fill the Consensus bar. Keep an eye on the others.';
      this.#team.textContent = `${String(byzantines)} Byzantine guardian${byzantines === 1 ? ' is' : 's are'} hiding among you.`;
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

const REASONS: Readonly<Record<WinReason, string>> = {
  consensusReached: 'The honest guardians finished their work and reached consensus.',
  allByzantineRotatedOut: 'No Byzantine guardians are left in the federation.',
  federationHalted: 'Byzantine guardians made up a third of the federation, so it halted.',
  forgedProposalPassed: 'A forged withdrawal collected enough signatures.',
  livenessLost: 'Real withdrawals kept failing or the network stayed split, so users lost access to their money.',
  outOfTime: 'The final block arrived before the honest guardians reached consensus.',
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
    this.#title.textContent = winner === 'honest' ? 'Honest guardians win' : 'Byzantine guardians win';
    this.#verdict.textContent = mine === undefined ? '' : mine === winner ? 'Your side won.' : 'Your side lost this time.';
    this.#reason.textContent = reason === '' ? '' : REASONS[reason];
    this.#info = { won: mine === winner, winner, role: mine, reason: reason === '' ? '' : REASONS[reason] };
    const slug = reason === '' ? undefined : CODEX_FOR_REASON[reason];
    this.#learn.hidden = SITE_URL === null || slug === undefined;
    if (SITE_URL !== null && slug !== undefined) this.#learn.href = `${SITE_URL}/codex/${slug}/`;
    const items = [...entries]
      .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'byzantine' ? -1 : 1))
      .map((e) => {
        const li = h('li', e.isMe ? 'me' : '');
        const tags = h('span', 'tags');
        if (e.left) tags.append(h('span', 'tag left', 'Left'));
        tags.append(h('span', `tag ${e.role}`, e.role === 'byzantine' ? 'Byzantine' : 'Honest'));
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
