import Phaser from 'phaser';

// Phaser 4 has no game-level resolution and Scale.RESIZE renders 1 px per CSS px (blurry on HiDPI).
// So the canvas is css size x dpr device pixels with scale.zoom = 1/dpr, and cameras zoom by dpr.
export const REG_DPR = 'dpr';

export function pickDpr(cssW: number, cssH: number, maxDpr = 2, maxPixels = 8_000_000): number {
  const raw = window.devicePixelRatio || 1;
  const budget = Math.sqrt(maxPixels / Math.max(1, cssW * cssH));
  return Math.max(1, Math.min(raw, maxDpr, budget));
}

export function cssSize(el: HTMLElement): { w: number; h: number } {
  const r = el.getBoundingClientRect();
  return { w: Math.max(1, Math.floor(r.width)), h: Math.max(1, Math.floor(r.height)) };
}

export function hiDpiScaleConfig(parent: HTMLElement): { scale: Phaser.Types.Core.ScaleConfig; dpr: number } {
  const { w, h } = cssSize(parent);
  const dpr = pickDpr(w, h);
  return {
    dpr,
    scale: { mode: Phaser.Scale.NONE, parent, width: Math.round(w * dpr), height: Math.round(h * dpr), zoom: 1 / dpr },
  };
}

// Keeps the canvas at parent size x dpr. Resize first, then zoom: the other order leaves a stale
// CSS size when dpr drops to 1.
export function installHiDpi(game: Phaser.Game, parent: HTMLElement): () => void {
  let mq: MediaQueryList | null = null;
  const sync = (): void => {
    const { w, h } = cssSize(parent);
    const dpr = pickDpr(w, h);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (game.scale.width !== bw || game.scale.height !== bh) game.scale.resize(bw, bh);
    if (game.scale.zoom !== 1 / dpr) game.scale.setZoom(1 / dpr);
    if (game.registry.get(REG_DPR) !== dpr) game.registry.set(REG_DPR, dpr);
    mq?.removeEventListener('change', sync);
    mq = window.matchMedia(`(resolution: ${String(window.devicePixelRatio)}dppx)`);
    mq.addEventListener('change', sync);
  };
  const ro = new ResizeObserver(sync);
  ro.observe(parent);
  sync();
  return () => {
    ro.disconnect();
    mq?.removeEventListener('change', sync);
  };
}

export function sceneDpr(scene: Phaser.Scene): number {
  const v: unknown = scene.registry.get(REG_DPR);
  return typeof v === 'number' && v > 0 ? v : 1;
}

// Logical (CSS px) viewport size.
export function viewSize(scene: Phaser.Scene): { w: number; h: number } {
  const dpr = sceneDpr(scene);
  return { w: scene.scale.width / dpr, h: scene.scale.height / dpr };
}

// Every screen sees about the same world area, so a big monitor is no advantage in a hidden-role game.
export function fairZoom(cssW: number, cssH: number, targetArea = 1280 * 720, min = 0.5, max = 1.25): number {
  return Math.min(max, Math.max(min, Math.sqrt((cssW * cssH) / targetArea)));
}
