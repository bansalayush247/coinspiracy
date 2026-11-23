// Press-and-hold for mouse, touch and keyboard (Space or Enter). The step only finishes once the
// press that filled the bar has ended, so that press can never also trigger the button's next job.

export interface HoldOptions {
  readonly durationMs: number;
  // The bar is full; the press may still be down.
  readonly onFilled?: () => void;
  // The filling press has ended; the button is free for its next job.
  readonly onDone: () => void;
  // Let go before the bar filled.
  readonly onShortPress?: () => void;
}

const HOLD_KEYS: ReadonlySet<string> = new Set([' ', 'Enter']);
// Covers the click a release fires, including the late one some touch browsers send.
export const RELEASE_GUARD_MS = 250;

type Phase = 'idle' | 'holding' | 'filled' | 'released';

// Wires `button` as a hold control until the hold completes; returns a function that cancels it.
export function holdToConfirm(button: HTMLButtonElement, options: HoldOptions): () => void {
  const abort = new AbortController();
  const signal = abort.signal;
  let phase: Phase = 'idle';
  let pointerId: number | null = null;
  let startedAt = 0;
  let frame = 0;
  let timer = 0;

  const setProgress = (p: number): void => {
    button.style.setProperty('--p', String(p));
  };
  const dispose = (): void => {
    abort.abort();
    cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    button.classList.remove('hold');
  };
  const fill = (): void => {
    phase = 'filled';
    setProgress(1);
    options.onFilled?.();
  };
  const finish = (): void => {
    dispose();
    setProgress(0);
    options.onDone();
  };
  const tick = (): void => {
    if (phase !== 'holding') return;
    const p = Math.min(1, (performance.now() - startedAt) / options.durationMs);
    setProgress(p);
    if (p >= 1) fill();
    else frame = requestAnimationFrame(tick);
  };
  const press = (): void => {
    if (phase !== 'idle') return;
    phase = 'holding';
    startedAt = performance.now();
    frame = requestAnimationFrame(tick);
  };
  const release = (): void => {
    pointerId = null;
    if (phase === 'holding') {
      phase = 'idle';
      cancelAnimationFrame(frame);
      setProgress(0);
      options.onShortPress?.();
    } else if (phase === 'filled') {
      phase = 'released';
      timer = window.setTimeout(finish, RELEASE_GUARD_MS);
    }
  };

  button.classList.add('hold');
  setProgress(0);
  button.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button !== 0 || phase !== 'idle') return;
    pointerId = e.pointerId;
    try {
      button.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers cannot be captured; pointerup still reaches the button.
    }
    press();
  }, { signal });
  const onPointerEnd = (e: PointerEvent): void => {
    if (e.pointerId === pointerId) release();
  };
  button.addEventListener('pointerup', onPointerEnd, { signal });
  button.addEventListener('pointercancel', onPointerEnd, { signal });
  button.addEventListener('lostpointercapture', onPointerEnd, { signal });
  // Default actions of these keys would click the button, so they are always swallowed here.
  button.addEventListener('keydown', (e) => {
    if (!HOLD_KEYS.has(e.key)) return;
    e.preventDefault();
    if (!e.repeat && pointerId === null) press();
  }, { signal });
  button.addEventListener('keyup', (e) => {
    if (!HOLD_KEYS.has(e.key)) return;
    e.preventDefault();
    if (pointerId === null) release();
  }, { signal });
  button.addEventListener('blur', release, { signal });
  // Long presses on touch screens would open a menu and cancel the pointer.
  button.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  }, { signal });
  // A click with no pointer behind it is assistive tech activating the button: sign at once, then
  // finish after the guard like any release, so this same click never reaches the next job.
  button.addEventListener('click', (e) => {
    if (e.detail !== 0 || phase !== 'idle') return;
    fill();
    release();
  }, { signal });
  return dispose;
}
