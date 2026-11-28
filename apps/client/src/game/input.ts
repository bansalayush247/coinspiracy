// Keyboard and touch-stick input from the DOM. Phaser's own keyboard plugin is off: its key
// captures block typing into form fields and outlive scenes.
import type { Vec2 } from '@byzantine-council/shared';
import { screenDirToWorld } from './iso.js';
import { keysVector, stickVector } from './stick.js';

type Dir = 'up' | 'down' | 'left' | 'right';
const KEYS: Readonly<Record<string, Dir>> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

/** Whether a key event is aimed at something the player is typing into. */
export function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export class PlayerInput {
  readonly #held = new Set<Dir>();
  #stick = { dx: 0, dy: 0 };
  #stickPointer: number | null = null;
  #origin = { x: 0, y: 0 };
  #enabled = false;
  readonly #abort = new AbortController();

  constructor(
    private readonly zone: HTMLElement,
    private readonly knob: HTMLElement,
  ) {
    const signal = this.#abort.signal;
    window.addEventListener('keydown', (e) => {
      if (isEditable(e.target)) return;
      const dir = KEYS[e.code];
      if (dir === undefined) return;
      this.#held.add(dir);
      if (this.#enabled) e.preventDefault();
    }, { signal });
    window.addEventListener('keyup', (e) => {
      const dir = KEYS[e.code];
      if (dir !== undefined) this.#held.delete(dir);
    }, { signal });
    window.addEventListener('blur', () => {
      this.clear();
    }, { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    }, { signal });

    zone.addEventListener('pointerdown', (e) => {
      if (!this.#enabled || this.#stickPointer !== null) return;
      this.#stickPointer = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      const r = zone.getBoundingClientRect();
      this.#origin = { x: e.clientX, y: e.clientY };
      this.#moveKnob(e.clientX - r.left, e.clientY - r.top, 0, 0);
      zone.classList.add('active');
      e.preventDefault();
    }, { signal });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.#stickPointer) return;
      const v = stickVector(this.#origin.x, this.#origin.y, e.clientX, e.clientY);
      this.#stick = { dx: v.dx, dy: v.dy };
      const r = zone.getBoundingClientRect();
      this.#moveKnob(this.#origin.x - r.left, this.#origin.y - r.top, v.kx, v.ky);
    }, { signal });
    const release = (e: PointerEvent): void => {
      if (e.pointerId !== this.#stickPointer) return;
      this.#releaseStick();
    };
    zone.addEventListener('pointerup', release, { signal });
    zone.addEventListener('pointercancel', release, { signal });
    zone.addEventListener('lostpointercapture', release, { signal });
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  set enabled(on: boolean) {
    this.#enabled = on;
    this.zone.hidden = !on;
    if (!on) this.clear();
  }

  // World-space direction, length 0..1. The stick points on screen; the keys follow the streets, so one key walks
  // straight down a road: up and down along one street axis, left and right along the other.
  direction(): Vec2 {
    if (!this.#enabled) return { x: 0, y: 0 };
    if (this.#stick.dx !== 0 || this.#stick.dy !== 0) return screenDirToWorld(this.#stick.dx, this.#stick.dy);
    const k = keysVector(this.#held.has('up'), this.#held.has('down'), this.#held.has('left'), this.#held.has('right'));
    return { x: k.dx, y: k.dy };
  }

  /** Pedal and wheel from the keys (up/W gas, down/S brake and reverse, left/right steer), or null when no key is held. */
  pedals(): { throttle: number; steer: number } | null {
    if (!this.#enabled || this.#held.size === 0) return null;
    const throttle = (this.#held.has('up') ? 1 : 0) - (this.#held.has('down') ? 1 : 0);
    const steer = (this.#held.has('right') ? 1 : 0) - (this.#held.has('left') ? 1 : 0);
    return { throttle, steer };
  }

  clear(): void {
    this.#held.clear();
    this.#releaseStick();
  }

  dispose(): void {
    this.#abort.abort();
  }

  #releaseStick(): void {
    this.#stickPointer = null;
    this.#stick = { dx: 0, dy: 0 };
    this.zone.classList.remove('active');
  }

  #moveKnob(baseX: number, baseY: number, kx: number, ky: number): void {
    this.zone.style.setProperty('--base-x', `${String(baseX)}px`);
    this.zone.style.setProperty('--base-y', `${String(baseY)}px`);
    this.knob.style.transform = `translate(${String(kx)}px, ${String(ky)}px)`;
  }
}
