// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELEASE_GUARD_MS, holdToConfirm } from '../src/ui/tasks/hold.js';

const DURATION = 1200;

function setup() {
  const button = document.createElement('button');
  button.type = 'button';
  document.body.append(button);
  const calls: string[] = [];
  // Counts clicks that reach the button's next job, which starts once the hold is done.
  let nextJobClicks = 0;
  const dispose = holdToConfirm(button, {
    durationMs: DURATION,
    onFilled: () => calls.push('filled'),
    onDone: () => calls.push('done'),
    onShortPress: () => calls.push('short'),
  });
  button.addEventListener('click', () => {
    if (calls.includes('done')) nextJobClicks += 1;
  });
  return { button, calls, nextJobClicks: () => nextJobClicks, dispose };
}

function pointer(type: string, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, { pointerId: 1, isPrimary: true, button: 0, bubbles: true, cancelable: true, ...init });
}

function key(type: 'keydown' | 'keyup', k: string, repeat = false): KeyboardEvent {
  return new KeyboardEvent(type, { key: k, repeat, bubbles: true, cancelable: true });
}

function click(detail: number): MouseEvent {
  return new MouseEvent('click', { detail, bubbles: true, cancelable: true });
}

function progress(button: HTMLButtonElement): number {
  return Number(button.style.getPropertyValue('--p'));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  // Frames every 16 ms on the fake clock.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => {
    cb(performance.now());
  }, 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    window.clearTimeout(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('holdToConfirm with a pointer', () => {
  it('fills after the hold time and finishes only once the press ends', () => {
    const { button, calls, nextJobClicks } = setup();
    expect(button.classList.contains('hold')).toBe(true);
    button.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(DURATION / 2);
    expect(progress(button)).toBeGreaterThan(0.3);
    expect(progress(button)).toBeLessThan(0.7);
    vi.advanceTimersByTime(DURATION);
    expect(calls).toStrictEqual(['filled']);
    // Still held: nothing more happens however long the press lasts.
    vi.advanceTimersByTime(5000);
    expect(calls).toStrictEqual(['filled']);
    button.dispatchEvent(pointer('pointerup'));
    // The browser clicks on release; that click must not reach the next job.
    button.dispatchEvent(click(1));
    expect(calls).toStrictEqual(['filled']);
    vi.advanceTimersByTime(RELEASE_GUARD_MS);
    expect(calls).toStrictEqual(['filled', 'done']);
    expect(nextJobClicks()).toBe(0);
    expect(button.classList.contains('hold')).toBe(false);
    button.dispatchEvent(click(1));
    expect(nextJobClicks()).toBe(1);
  });

  it('resets a short press and lets the player try again', () => {
    const { button, calls } = setup();
    button.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(DURATION / 3);
    button.dispatchEvent(pointer('pointerup'));
    button.dispatchEvent(click(1));
    expect(calls).toStrictEqual(['short']);
    expect(progress(button)).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(calls).toStrictEqual(['short']);
    button.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(DURATION + 100);
    button.dispatchEvent(pointer('pointerup'));
    vi.advanceTimersByTime(RELEASE_GUARD_MS);
    expect(calls).toStrictEqual(['short', 'filled', 'done']);
  });

  it.each(['pointercancel', 'lostpointercapture'])('ends the hold on %s', (type) => {
    const { button, calls } = setup();
    button.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(DURATION / 2);
    button.dispatchEvent(pointer(type));
    vi.advanceTimersByTime(DURATION);
    expect(calls).toStrictEqual(['short']);
  });

  it('ignores secondary buttons, extra fingers and other pointers', () => {
    const { button, calls } = setup();
    button.dispatchEvent(pointer('pointerdown', { button: 2 }));
    button.dispatchEvent(pointer('pointerdown', { isPrimary: false, pointerId: 7 }));
    vi.advanceTimersByTime(DURATION * 2);
    expect(calls).toStrictEqual([]);
    button.dispatchEvent(pointer('pointerdown'));
    vi.advanceTimersByTime(DURATION / 2);
    // Another pointer lifting does not end this one's hold.
    button.dispatchEvent(pointer('pointerup', { pointerId: 9 }));
    vi.advanceTimersByTime(DURATION);
    expect(calls).toStrictEqual(['filled']);
  });

  it('keeps long presses from opening a menu', () => {
    const { button } = setup();
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    button.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });
});

describe('holdToConfirm with the keyboard', () => {
  it.each([' ', 'Enter'])('fills while %j is held and swallows its key events', (k) => {
    const { button, calls, nextJobClicks } = setup();
    const down = key('keydown', k);
    button.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(DURATION / 2);
    // Auto-repeat neither restarts the hold nor gets to click the button.
    const repeat = key('keydown', k, true);
    button.dispatchEvent(repeat);
    expect(repeat.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(DURATION);
    expect(calls).toStrictEqual(['filled']);
    const up = key('keyup', k);
    button.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(RELEASE_GUARD_MS);
    expect(calls).toStrictEqual(['filled', 'done']);
    expect(nextJobClicks()).toBe(0);
  });

  it('treats losing focus as letting go', () => {
    const { button, calls } = setup();
    button.dispatchEvent(key('keydown', ' '));
    vi.advanceTimersByTime(DURATION / 2);
    button.dispatchEvent(new FocusEvent('blur'));
    vi.advanceTimersByTime(DURATION);
    expect(calls).toStrictEqual(['short']);
  });

  it('leaves other keys alone', () => {
    const { button, calls } = setup();
    const tab = key('keydown', 'Tab');
    button.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    vi.advanceTimersByTime(DURATION * 2);
    expect(calls).toStrictEqual([]);
  });
});

describe('holdToConfirm and assistive tech', () => {
  it('signs at once on a click with no pointer behind it, without passing that click on', () => {
    const { button, calls, nextJobClicks } = setup();
    button.dispatchEvent(click(0));
    expect(calls).toStrictEqual(['filled']);
    vi.advanceTimersByTime(RELEASE_GUARD_MS);
    expect(calls).toStrictEqual(['filled', 'done']);
    expect(nextJobClicks()).toBe(0);
  });

  it('ignores a plain mouse click, which is a press too short to sign', () => {
    const { button, calls } = setup();
    button.dispatchEvent(click(1));
    vi.advanceTimersByTime(DURATION * 2);
    expect(calls).toStrictEqual([]);
  });
});

describe('holdToConfirm teardown', () => {
  it('stops listening once disposed', () => {
    const { button, calls, dispose } = setup();
    button.dispatchEvent(pointer('pointerdown'));
    dispose();
    vi.advanceTimersByTime(DURATION * 2);
    button.dispatchEvent(pointer('pointerup'));
    vi.advanceTimersByTime(RELEASE_GUARD_MS);
    expect(calls).toStrictEqual([]);
    expect(button.classList.contains('hold')).toBe(false);
  });
});
