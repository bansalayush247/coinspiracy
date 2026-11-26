// The casebook: the side cases "ripped from the ledger", each a one-night story for a crew of up to four. Shows
// which ones this profile has solved; picking one starts it.
import { SIDE_CASES, type ActId } from '@byzantine-council/shared/city';
import type { ProfileSummary } from '../profile/api.js';
import { el, h } from '../ui/dom.js';
import { t } from '../i18n/index.js';

export class Casebook {
  readonly #root = el('cases', HTMLElement);
  readonly #list = el('cases-list', HTMLUListElement);
  #solved = new Set<string>();
  onPlay: (act: ActId) => void = () => undefined;

  constructor() {
    el('cases-close', HTMLButtonElement).addEventListener('click', () => {
      this.close();
    });
    this.#root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  setProfile(p: ProfileSummary): void {
    this.#solved = new Set(p.progress.stories);
    if (!this.#root.hidden) this.#render();
  }

  open(): void {
    this.#render();
    this.#root.hidden = false;
    this.#root.focus();
  }

  close(): void {
    this.#root.hidden = true;
  }

  #render(): void {
    this.#list.replaceChildren(
      ...SIDE_CASES.map((c) => {
        const solved = this.#solved.has(c.id);
        const li = h('li', solved ? 'case solved' : 'case');
        const action = t(solved ? 'cases.again' : 'cases.take');
        const play = h('button', '', action);
        play.type = 'button';
        play.setAttribute('aria-label', t('cases.playAria', { action, title: c.title }));
        play.addEventListener('click', () => {
          this.close();
          this.onPlay(c.id);
        });
        li.append(h('h3', '', c.title), h('p', '', c.blurb), h('p', 'meta', solved ? t('cases.solved') : t('cases.reward', { sats: String(c.rewardSats) })), play);
        return li;
      }),
    );
  }
}
