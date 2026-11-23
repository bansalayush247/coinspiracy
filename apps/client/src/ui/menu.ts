import { NicknameSchema, normalizeRoomCode } from '@byzantine-council/shared';
import { el } from './dom.js';

export type MenuAction =
  | { readonly kind: 'quick'; readonly nickname: string }
  | { readonly kind: 'create'; readonly nickname: string }
  | { readonly kind: 'join'; readonly nickname: string; readonly code: string };

const NICKNAME_KEY = 'bc.nickname';

function savedNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberNickname(name: string): void {
  try {
    localStorage.setItem(NICKNAME_KEY, name);
  } catch {
    // storage blocked
  }
}

export class Menu {
  readonly #panel = el('menu', HTMLElement);
  readonly #form = el('menu-form', HTMLFormElement);
  readonly #nickname = el('nickname', HTMLInputElement);
  readonly #code = el('room-code', HTMLInputElement);
  readonly #error = el('menu-error', HTMLParagraphElement);
  readonly #status = el('menu-status', HTMLParagraphElement);
  onAction: (action: MenuAction) => void = () => undefined;

  constructor() {
    this.#nickname.value = savedNickname();
    this.#form.addEventListener('submit', (e) => {
      e.preventDefault();
      const submitter = e.submitter instanceof HTMLButtonElement ? e.submitter.dataset['action'] : undefined;
      this.#submit(submitter === 'create' || submitter === 'join' ? submitter : 'quick');
    });
    // Enter in the code field means "join", not the form's first button.
    this.#code.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      this.#submit('join');
    });
  }

  show(): void {
    this.#panel.hidden = false;
    if (this.#nickname.value === '') this.#nickname.focus();
  }

  hide(): void {
    this.#panel.hidden = true;
    this.clearMessages();
  }

  prefillCode(code: string): void {
    this.#code.value = code;
    this.#status.textContent = 'Enter a nickname and press Join to enter your friend’s room.';
  }

  setBusy(busy: boolean, status = ''): void {
    for (const control of this.#form.querySelectorAll('button, input')) {
      if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) control.disabled = busy;
    }
    this.#form.setAttribute('aria-busy', String(busy));
    this.#status.textContent = status;
  }

  showError(message: string): void {
    this.#error.textContent = message;
  }

  clearMessages(): void {
    this.#error.textContent = '';
    this.#status.textContent = '';
  }

  // The nickname for a visit outside a match; shows the same error as the menu buttons.
  validNickname(): string | null {
    this.clearMessages();
    const nickname = NicknameSchema.safeParse(this.#nickname.value);
    if (!nickname.success) {
      this.showError('Pick a nickname of 2–16 letters, numbers, spaces, _ or -.');
      this.#nickname.focus();
      return null;
    }
    rememberNickname(nickname.data);
    return nickname.data;
  }

  #submit(kind: MenuAction['kind']): void {
    this.clearMessages();
    const nickname = NicknameSchema.safeParse(this.#nickname.value);
    if (!nickname.success) {
      this.showError('Pick a nickname of 2–16 letters, numbers, spaces, _ or -.');
      this.#nickname.focus();
      return;
    }
    rememberNickname(nickname.data);
    this.#nickname.value = nickname.data;
    if (kind !== 'join') {
      this.onAction({ kind, nickname: nickname.data });
      return;
    }
    const code = normalizeRoomCode(this.#code.value);
    if (code === null) {
      this.showError('Room codes are 6 letters and numbers, like K7Q-X9M.');
      this.#code.focus();
      return;
    }
    this.onAction({ kind, nickname: nickname.data, code });
  }
}
