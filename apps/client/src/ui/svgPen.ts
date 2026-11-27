// Records the game's art calls as SVG, so a portrait drawn outside the game always matches the game.
import type { Pen } from '../game/pen.js';
import { svg } from './svg.js';

const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** A Pen that draws into an SVG group, for portraits in the page. */
export class SvgPen implements Pen {
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
    this.root.append(svg('ellipse', { cx: x, cy: y, rx: w / 2, ry: h / 2, ...this.#strokeAttrs() }));
    return this;
  }
  strokeCircle(x: number, y: number, r: number): this {
    this.root.append(svg('circle', { cx: x, cy: y, r, ...this.#strokeAttrs() }));
    return this;
  }
  lineBetween(x0: number, y0: number, x1: number, y1: number): this {
    this.root.append(svg('line', { x1: x0, y1: y0, x2: x1, y2: y1, ...this.#strokeAttrs(), 'stroke-linecap': 'round' }));
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
  fillPath(): this {
    this.root.append(svg('path', { d: this.#path.join(' '), fill: this.#fill, 'fill-opacity': this.#fillAlpha }));
    return this;
  }
  strokePath(): this {
    this.root.append(svg('path', { d: this.#path.join(' '), ...this.#strokeAttrs(), 'stroke-linejoin': 'round' }));
    return this;
  }

  #strokeAttrs(): Record<string, string | number> {
    return { fill: 'none', stroke: this.#stroke, 'stroke-opacity': this.#strokeAlpha, 'stroke-width': this.#width };
  }
}
