// Seal glyphs for the Ledger Archive: each has its own shape and colour, so neither alone is needed.
import { GLYPH_COUNT } from '@byzantine-council/shared';
import { h } from '../dom.js';
import { svg } from '../svg.js';

const NAMES = ['circle', 'triangle', 'square', 'diamond', 'star', 'cross'] as const;
const COLORS = ['#ffd27a', '#5fd3b0', '#7fd8ff', '#ff86b8', '#c3a6ff', '#ffa45c'] as const;

function star(cx: number, cy: number, outer: number, inner: number): string {
  return Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
}

function shape(glyph: number): SVGElement {
  const fill = COLORS[glyph] ?? '#fff1de';
  switch (glyph) {
    case 0:
      return svg('circle', { cx: 10, cy: 10, r: 7, fill });
    case 1:
      return svg('polygon', { points: '10,2.5 17.5,16.5 2.5,16.5', fill });
    case 2:
      return svg('rect', { x: 3.5, y: 3.5, width: 13, height: 13, rx: 1.5, fill });
    case 3:
      return svg('polygon', { points: '10,1.5 18.5,10 10,18.5 1.5,10', fill });
    case 4:
      return svg('polygon', { points: star(10, 10.5, 8.5, 3.8), fill });
    default:
      return svg('path', { d: 'M7.5 2.5h5v5h5v5h-5v5h-5v-5h-5v-5h5z', fill });
  }
}

export function glyphName(glyph: number): string {
  return NAMES[glyph] ?? 'unknown';
}

// A row of seal glyphs, readable by screen readers and, through data-glyphs, by the e2e test.
export function sealRow(seal: readonly number[]): HTMLElement {
  const row = h('span', 'seal');
  row.dataset['glyphs'] = seal.join(',');
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', `Seal: ${seal.map(glyphName).join(', ')}`);
  for (const glyph of seal) {
    const icon = svg('svg', { viewBox: '0 0 20 20', width: 20, height: 20, 'aria-hidden': 'true' });
    if (glyph >= 0 && glyph < GLYPH_COUNT) icon.append(shape(glyph));
    row.append(icon);
  }
  return row;
}
