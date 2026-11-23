// Festive decorations for seasonal events.
import type Phaser from 'phaser';
import { ART_SCALE } from './iso.js';

// Bunting hangs in a catenary, y = a·cosh(x/a), the curve of a chain under its own weight, with flags along it.
export function drawBunting(g: Phaser.GameObjects.Graphics, from: { x: number; y: number }, to: { x: number; y: number }, height: number, colors: readonly number[]): void {
  const span = Math.hypot(to.x - from.x, to.y - from.y);
  const a = span * 0.55;
  const sag = a * (Math.cosh(span / 2 / a) - 1);
  const point = (t: number): { x: number; y: number } => {
    const u = (t - 0.5) * span;
    const drop = sag - a * (Math.cosh(u / a) - 1);
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t - height + drop };
  };
  g.lineStyle(1.5 * ART_SCALE, 0x5a4466, 0.9);
  g.beginPath();
  for (let i = 0; i <= 24; i++) {
    const p = point(i / 24);
    if (i === 0) g.moveTo(p.x, p.y);
    else g.lineTo(p.x, p.y);
  }
  g.strokePath();
  const flags = 12;
  for (let i = 1; i < flags; i++) {
    const p = point(i / flags);
    const q = point((i + 0.5) / flags);
    g.fillStyle(colors[i % colors.length] ?? 0xffd27a, 1);
    g.fillTriangle(p.x, p.y, q.x, q.y, (p.x + q.x) / 2, (p.y + q.y) / 2 + 12 * ART_SCALE);
  }
}
