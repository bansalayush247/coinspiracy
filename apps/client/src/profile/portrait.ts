// A guardian portrait for the wardrobe, drawn by the game's own art code into SVG, so it always matches the game.
import { drawGuardian, type Wear } from '../game/guardianArt.js';
import { ART_SCALE } from '../game/iso.js';
import { robeColors } from '../game/wear.js';
import { svg } from '../ui/svg.js';
import { SvgPen } from '../ui/svgPen.js';

// The guardian in a given seat colour and wear, standing on a little plinth of light.
export function guardianPortrait(seat: number, wear: Wear): SVGSVGElement {
  const pen = new SvgPen();
  drawGuardian(pen, robeColors(seat, wear), 1, wear);
  const s = ART_SCALE;
  const out = svg('svg', { viewBox: `${String(-40 * s)} ${String(-90 * s)} ${String(80 * s)} ${String(100 * s)}`, class: 'portrait', role: 'img', 'aria-label': 'Your guardian' });
  out.append(svg('ellipse', { cx: 0, cy: 2 * s, rx: 22 * s, ry: 7 * s, fill: '#3b2752', 'fill-opacity': 0.35 }), pen.root);
  return out;
}
