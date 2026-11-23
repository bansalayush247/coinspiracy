// A guardian portrait for the wardrobe, drawn by the game's own art code into SVG.
// The adapter records the handful of Graphics calls guardianArt uses, so the preview always matches the game.
import type Phaser from 'phaser';
import { drawGuardian, type Wear } from '../game/guardianArt.js';
import { ART_SCALE } from '../game/iso.js';
import { seatColors } from '../game/palette.js';
import { svg } from '../ui/svg.js';

const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

class SvgPen {
  readonly root = svg('g');
  #fill = '#000';
  #fillAlpha = 1;
  #stroke = '#000';
  #strokeAlpha = 1;
  #width = 1;
  #path: string[] = [];

  clear(): this {
    this.root.replaceChildren();
    return this;
  }
  fillStyle(color: number, alpha = 1): this {
    this.#fill = css(color);
    this.#fillAlpha = alpha;
    return this;
  }
  lineStyle(width: number, color: number, alpha = 1): this {
    this.#width = width;
    this.#stroke = css(color);
    this.#strokeAlpha = alpha;
    return this;
  }
  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): this {
    this.root.append(svg('polygon', { points: `${String(x0)},${String(y0)} ${String(x1)},${String(y1)} ${String(x2)},${String(y2)}`, fill: this.#fill, 'fill-opacity': this.#fillAlpha }));
    return this;
  }
  fillEllipse(x: number, y: number, w: number, h: number): this {
    this.root.append(svg('ellipse', { cx: x, cy: y, rx: w / 2, ry: h / 2, fill: this.#fill, 'fill-opacity': this.#fillAlpha }));
    return this;
  }
  fillCircle(x: number, y: number, r: number): this {
    this.root.append(svg('circle', { cx: x, cy: y, r, fill: this.#fill, 'fill-opacity': this.#fillAlpha }));
    return this;
  }
  fillRect(x: number, y: number, w: number, h: number): this {
    this.root.append(svg('rect', { x, y, width: w, height: h, fill: this.#fill, 'fill-opacity': this.#fillAlpha }));
    return this;
  }
  strokeEllipse(x: number, y: number, w: number, h: number): this {
    this.root.append(svg('ellipse', { cx: x, cy: y, rx: w / 2, ry: h / 2, fill: 'none', stroke: this.#stroke, 'stroke-opacity': this.#strokeAlpha, 'stroke-width': this.#width }));
    return this;
  }
  lineBetween(x0: number, y0: number, x1: number, y1: number): this {
    this.root.append(svg('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: this.#stroke, 'stroke-opacity': this.#strokeAlpha, 'stroke-width': this.#width, 'stroke-linecap': 'round' }));
    return this;
  }
  beginPath(): this {
    this.#path = [];
    return this;
  }
  moveTo(x: number, y: number): this {
    this.#path.push(`M${String(x)} ${String(y)}`);
    return this;
  }
  lineTo(x: number, y: number): this {
    this.#path.push(`L${String(x)} ${String(y)}`);
    return this;
  }
  arc(x: number, y: number, r: number, a0: number, a1: number): this {
    const sx = x + Math.cos(a0) * r;
    const sy = y + Math.sin(a0) * r;
    const ex = x + Math.cos(a1) * r;
    const ey = y + Math.sin(a1) * r;
    this.#path.push(`M${String(sx)} ${String(sy)} A${String(r)} ${String(r)} 0 ${a1 - a0 > Math.PI ? '1' : '0'} 1 ${String(ex)} ${String(ey)}`);
    return this;
  }
  closePath(): this {
    this.#path.push('Z');
    return this;
  }
  strokePath(): this {
    this.root.append(svg('path', { d: this.#path.join(' '), fill: 'none', stroke: this.#stroke, 'stroke-opacity': this.#strokeAlpha, 'stroke-width': this.#width, 'stroke-linejoin': 'round' }));
    return this;
  }
}

// The guardian in a given seat colour and wear, standing on a little plinth of light.
export function guardianPortrait(seat: number, wear: Wear): SVGSVGElement {
  const pen = new SvgPen();
  drawGuardian(pen as unknown as Phaser.GameObjects.Graphics, seatColors(seat), 1, wear);
  const s = ART_SCALE;
  const out = svg('svg', { viewBox: `${String(-40 * s)} ${String(-90 * s)} ${String(80 * s)} ${String(100 * s)}`, class: 'portrait', role: 'img', 'aria-label': 'Your guardian' });
  out.append(svg('ellipse', { cx: 0, cy: 2 * s, rx: 22 * s, ry: 7 * s, fill: '#3b2752', 'fill-opacity': 0.35 }), pen.root);
  return out;
}
