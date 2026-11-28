// A small window for choosing one thing from a few, used indoors: a book from the shelf (then read page by page), or
// something to cook in the kitchen.
import { audio } from '../audio/engine.js';
import { BOOK_COLORS, BOOK_IDS, bookText, loadBooks, type BookId } from '../i18n/books.js';
import { t } from '../i18n/index.js';
import { el, h } from './dom.js';

/** One choice in the window: its label, an optional line under it, its colour, and what picking it does. */
export interface PickOption {
  readonly label: string;
  readonly sub?: string;
  readonly color: string;
  readonly pick: () => void;
}

/** The one pick window on the page. */
export class PickPanel {
  readonly #root = el('pick', HTMLElement);
  readonly #title = el('pick-title', HTMLHeadingElement);
  readonly #hint = el('pick-hint', HTMLParagraphElement);
  readonly #list = el('pick-list', HTMLDivElement);
  readonly #book = el('pick-book', HTMLElement);
  readonly #by = el('pick-by', HTMLParagraphElement);
  readonly #page = el('pick-page', HTMLParagraphElement);
  readonly #count = el('pick-count', HTMLSpanElement);
  readonly #prev = el('pick-prev', HTMLButtonElement);
  readonly #next = el('pick-next', HTMLButtonElement);
  readonly #shelf = el('pick-shelf', HTMLButtonElement);
  #reading: { id: BookId; page: number } | null = null;
  /** Called once each time the window closes. */
  onClosed: () => void = () => undefined;

  constructor() {
    el('pick-close', HTMLButtonElement).addEventListener('click', () => {
      this.close();
    });
    this.#shelf.addEventListener('click', () => {
      void this.openShelf();
    });
    this.#prev.addEventListener('click', () => {
      this.#turn(-1);
    });
    this.#next.addEventListener('click', () => {
      this.#turn(1);
    });
    this.#root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowLeft' && this.#reading !== null) this.#turn(-1);
      else if (e.key === 'ArrowRight' && this.#reading !== null) this.#turn(1);
    });
  }

  /** Whether the window is showing. */
  get isOpen(): boolean {
    return !this.#root.hidden;
  }

  /** Shows a list of choices under a title. */
  choose(title: string, hint: string, options: readonly PickOption[]): void {
    this.#reading = null;
    this.#title.textContent = title;
    this.#hint.textContent = hint;
    this.#hint.hidden = false;
    this.#book.hidden = true;
    this.#shelf.hidden = true;
    this.#list.hidden = false;
    this.#list.replaceChildren(
      ...options.map((o) => {
        const b = h('button', 'pick-option');
        b.type = 'button';
        const spine = h('span', 'pick-spine');
        spine.style.background = o.color;
        const words = h('span', 'pick-words');
        words.append(h('span', 'pick-label', o.label));
        if (o.sub !== undefined) words.append(h('span', 'pick-sub', o.sub));
        b.append(spine, words);
        b.addEventListener('click', () => {
          audio.play('click');
          o.pick();
        });
        return b;
      }),
    );
    this.#show();
    this.#list.querySelector('button')?.focus();
  }

  /** Shows the bookshelf: every book, in the player's language once it has loaded. */
  async openShelf(): Promise<void> {
    await loadBooks();
    this.choose(
      t('books.title'),
      t('books.pick'),
      BOOK_IDS.map((id) => {
        const book = bookText(id);
        return {
          label: book.title,
          sub: t('books.by', { author: book.author }),
          color: BOOK_COLORS[id],
          pick: () => {
            this.#read(id);
          },
        };
      }),
    );
  }

  /** Closes the window. */
  close(): void {
    if (this.#root.hidden) return;
    this.#root.hidden = true;
    this.#reading = null;
    this.onClosed();
  }

  #read(id: BookId): void {
    this.#reading = { id, page: 0 };
    this.#hint.hidden = true;
    this.#list.hidden = true;
    this.#book.hidden = false;
    this.#shelf.hidden = false;
    this.#renderPage();
    this.#next.focus();
  }

  #turn(step: number): void {
    const r = this.#reading;
    if (r === null) return;
    const pages = bookText(r.id).pages.length;
    const page = Math.max(0, Math.min(pages - 1, r.page + step));
    if (page === r.page) return;
    r.page = page;
    audio.play('click');
    this.#renderPage();
  }

  #renderPage(): void {
    const r = this.#reading;
    if (r === null) return;
    const book = bookText(r.id);
    this.#title.textContent = book.title;
    this.#by.textContent = t('books.by', { author: book.author });
    this.#page.textContent = book.pages[r.page] ?? '';
    this.#count.textContent = t('books.page', { n: String(r.page + 1), total: String(book.pages.length) });
    this.#prev.disabled = r.page === 0;
    this.#next.disabled = r.page === book.pages.length - 1;
  }

  #show(): void {
    this.#root.hidden = false;
    this.#root.focus();
  }
}

let panel: PickPanel | null = null;

/** The page's pick window, made on first use. */
export function pickPanel(): PickPanel {
  panel ??= new PickPanel();
  return panel;
}
