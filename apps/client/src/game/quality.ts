// Graphics quality: High everywhere it runs well, Low on small devices. Low halves the painted ground's
// resolution and drops ambient particles; gameplay effects stay, so nothing a player needs is hidden.
export type Quality = 'high' | 'low';
const KEY = 'bc.quality';

function guess(): Quality {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData === true) return 'low';
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4) return 'low';
  if (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4) return 'low';
  return 'high';
}

export function loadQuality(): Quality {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'high' || v === 'low') return v;
  } catch {
    // Storage blocked: guess.
  }
  return guess();
}

export function saveQuality(q: Quality): void {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
}

export const quality = { current: loadQuality() };
