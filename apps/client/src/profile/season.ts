// The seasonal event banner on the menu: halvings, Genesis Day, Pizza Day and the rest.
import type { SeasonReply } from '@byzantine-council/shared/seasons';
import { el } from '../ui/dom.js';

export class SeasonBanner {
  readonly #root = el('season', HTMLElement);
  readonly #title = el('season-title', HTMLParagraphElement);
  readonly #headline = el('season-headline', HTMLParagraphElement);
  readonly #blurb = el('season-blurb', HTMLParagraphElement);

  show(reply: SeasonReply | null): void {
    const event = reply?.featured ?? null;
    if (event === null) {
      this.#root.hidden = true;
      return;
    }
    this.#title.textContent = event.title;
    this.#headline.textContent = event.headline;
    this.#blurb.textContent = event.blurb;
    // Colours come from a validated #RRGGBB pair; CSSOM writes are allowed under the page CSP.
    this.#root.style.setProperty('--season-a', event.colors[0]);
    this.#root.style.setProperty('--season-b', event.colors[1]);
    this.#root.dataset['event'] = event.id;
    this.#root.hidden = false;
  }
}
