import type { TaskAnswer } from '@byzantine-council/shared';
import { tn } from '../../i18n/index.js';
import { h } from '../dom.js';

// What a minigame may do: hand in one answer. The panel handles timing, sending and results.
export interface MinigameHost {
  submit(answer: TaskAnswer): void;
}

export function button(text: string, className = ''): HTMLButtonElement {
  const b = h('button', className, text);
  b.type = 'button';
  return b;
}

// Toggle button that reports its state to assistive tech.
export function setPressed(b: HTMLButtonElement, pressed: boolean): void {
  b.setAttribute('aria-pressed', String(pressed));
  b.classList.toggle('picked', pressed);
}

export function formatSats(n: number): string {
  return tn('common.sats', n);
}

// Numbered steps along the top of a multi-step task.
export function stepper(labels: readonly string[]): { readonly el: HTMLOListElement; set(step: number): void } {
  const el = h('ol', 'steps');
  const items = labels.map((label) => h('li', '', label));
  el.append(...items);
  return {
    el,
    set(step) {
      items.forEach((li, i) => {
        li.classList.toggle('done', i < step);
        li.classList.toggle('now', i === step);
        if (i === step) li.setAttribute('aria-current', 'step');
        else li.removeAttribute('aria-current');
      });
    },
  };
}
