// Story portraits: each speaker's head and shoulders drawn by the game's own character art, in three frames (at rest,
// mid-word, mid-blink) so the dialogue animates a face by showing one frame or another instead of redrawing it.
// Voices with no one on screen, a phone call or an old voicemail, get the device they come out of.
import { SPEAKER_NAMES, type Face, type Speaker } from '@byzantine-council/shared/city';
import { drawCostume } from '../game/costumes.js';
import { drawGuardian, type Wear } from '../game/guardianArt.js';
import { ART_SCALE } from '../game/iso.js';
import { cssColor, seatColors, type GuardianColors } from '../game/palette.js';
import { svg } from '../ui/svg.js';
import { SvgPen } from '../ui/svgPen.js';
import { LOOKS, type Look } from './looks.js';

/** Who a portrait shows: a figure with a look, or the device a voice comes out of. */
export type Sitter = { readonly kind: 'figure'; readonly look: Look } | { readonly kind: 'device'; readonly device: 'phone' | 'tape'; readonly tint: number };

/** The frames a portrait can show. */
export type PortraitFrame = 'rest' | 'talk' | 'blink';

const FRAMES: readonly PortraitFrame[] = ['rest', 'talk', 'blink'];
const PLAIN: Wear = { hat: '', shades: '', outfit: '' };
const CACHE_LIMIT = 32;

function figure(who: Speaker, lit: number, shadow: number, highlight: number, costume: Look['costume']): Sitter {
  return { kind: 'figure', look: { name: SPEAKER_NAMES[who], colors: { lit, shadow, highlight }, wear: PLAIN, costume } };
}

const fromLook = (look: Look): Sitter => ({ kind: 'figure', look });

// Speakers who never walk the streets as a story NPC, dressed for their part.
const SITTERS: Readonly<Record<Exclude<Speaker, 'rook'>, Sitter>> = {
  dani: fromLook(LOOKS.dani),
  mags: fromLook(LOOKS.mags),
  pell: figure('pell', 0x6a4a8c, 0x3a2850, 0xc9a6ff, { head: ['topHat', 0x1a1420], neck: ['tie', 0x8c2f39] }),
  voice: { kind: 'device', device: 'phone', tint: 0xff8f7a },
  teo: fromLook(LOOKS.teo),
  ivy: fromLook(LOOKS.ivy),
  brannigan: fromLook(LOOKS.brannigan),
  lookout: fromLook(LOOKS.lookout),
  nonce: fromLook(LOOKS.nonce),
  watchman: figure('watchman', 0x5a6a7a, 0x2f3a46, 0xa9b8c8, { head: ['beanie', 0x8c2f39], neck: ['scarf', 0xd9b36a] }),
  quint: figure('quint', 0x2b3d63, 0x162038, 0x8aa6dc, { eyes: ['shades', 0x0f0d16], neck: ['tie', 0xf2c14e] }),
  sharpe: fromLook(LOOKS.sharpe),
  choir: fromLook(LOOKS.choir),
  founder: { kind: 'device', device: 'tape', tint: 0xf2c14e },
  okafor: fromLook(LOOKS.okafor),
  pip: fromLook(LOOKS.pip),
  juno: fromLook(LOOKS.juno),
  crane: fromLook(LOOKS.crane),
  stall: fromLook(LOOKS.stall),
  mc: fromLook(LOOKS.mc),
  penrose: fromLook(LOOKS.penrose),
  keeper: fromLook(LOOKS.keeper),
  kit: fromLook(LOOKS.kit),
  sol: figure('sol', 0x3f6f8c, 0x1f3a4c, 0x9ccbe6, { head: ['beanie', 0x1f2533], neck: ['scarf', 0xe2553f] }),
  marco: fromLook(LOOKS.marco),
  benny: fromLook(LOOKS.benny),
  ozzy: fromLook(LOOKS.ozzy),
  rex: fromLook(LOOKS.rex),
  nell: fromLook(LOOKS.nell),
  silas: fromLook(LOOKS.silas),
  clerk: figure('clerk', 0x9a9486, 0x58534a, 0xd6d0c2, { eyes: ['glasses', 0xd9d4e6], neck: ['bowtie', 0x2b4c7e] }),
  dee: fromLook(LOOKS.dee),
  fennick: fromLook(LOOKS.fennick),
  glass: fromLook(LOOKS.glass),
  lumley: fromLook(LOOKS.lumley),
  varnish: fromLook(LOOKS.varnish),
  wren: figure('wren', 0xa0785a, 0x5c4230, 0xe0bfa2, { head: ['beret', 0x2f4858], neck: ['scarf', 0xf2d13a] }),
  marta: figure('marta', 0x7a5c8c, 0x43314f, 0xc8acd9, { head: ['bun', 0x3a2a20], neck: ['pearls', 0xf4f1ff] }),
};

/** Rook as the player dresses them: their seat's colours and what they wear. */
export function rookSitter(seat: number, wear: Wear): Sitter {
  return { kind: 'figure', look: { name: SPEAKER_NAMES.rook, colors: seatColors(seat), wear, costume: {} } };
}

/** The portrait sitter for a story speaker; Rook is whoever the player is, so it is passed in. */
export function sitterFor(who: Speaker, rook: Sitter): Sitter {
  return who === 'rook' ? rook : SITTERS[who];
}

/** The colour a speaker's name is written in: their robe's highlight, or their device's glow. */
export function sitterColor(sitter: Sitter): string {
  return cssColor(sitter.kind === 'figure' ? sitter.look.colors.highlight : sitter.tint);
}

const S = ART_SCALE;
// Close on the face so its expression reads: the hood, a hat's brim and the collar.
const VIEW = `${String(-16 * S)} ${String(-61 * S)} ${String(32 * S)} ${String(32 * S)}`;

function figureFrame(look: Look, face: Face, facing: 1 | -1, frame: PortraitFrame): SVGGElement {
  const pen = new SvgPen();
  drawGuardian(pen, look.colors, facing, look.wear, false, { face, blink: frame === 'blink', talk: frame === 'talk' });
  drawCostume(pen, look.costume, facing);
  return pen.root;
}

function deviceFrame(device: 'phone' | 'tape', tint: number, frame: PortraitFrame): SVGGElement {
  const g = svg('g');
  const glow = cssColor(tint);
  const lit = frame === 'talk' ? 1 : 0.45;
  if (device === 'phone') {
    g.append(
      svg('rect', { x: -7 * S, y: -60 * S, width: 14 * S, height: 26 * S, rx: 2.4 * S, fill: '#1a1020', stroke: '#3a3550', 'stroke-width': 0.8 * S }),
      svg('rect', { x: -5.6 * S, y: -57.5 * S, width: 11.2 * S, height: 18 * S, rx: 1 * S, fill: glow, 'fill-opacity': 0.25 + 0.35 * lit }),
      svg('circle', { cx: 0, cy: -36.6 * S, r: 1.1 * S, fill: '#3a3550' }),
    );
    for (const [i, r] of [6, 10, 14].entries()) {
      g.append(svg('path', { d: `M${String(9 * S)} ${String((-52 - r / 2) * S)} A${String(r * S)} ${String(r * S)} 0 0 1 ${String(9 * S)} ${String((-52 + r / 2) * S)}`, fill: 'none', stroke: glow, 'stroke-width': 1 * S, 'stroke-linecap': 'round', 'stroke-opacity': frame === 'talk' ? 0.9 - i * 0.2 : 0.25 }));
    }
    return g;
  }
  const turn = frame === 'talk' ? 30 : 0;
  g.append(
    svg('rect', { x: -15 * S, y: -56 * S, width: 30 * S, height: 19 * S, rx: 2 * S, fill: '#2a2238', stroke: '#4a4560', 'stroke-width': 0.8 * S }),
    svg('rect', { x: -11 * S, y: -53.5 * S, width: 22 * S, height: 9 * S, rx: 1.2 * S, fill: glow, 'fill-opacity': 0.35 }),
  );
  for (const cx of [-5.5, 5.5]) {
    const reel = svg('g', { transform: `rotate(${String(turn)} ${String(cx * S)} ${String(-49 * S)})` });
    reel.append(svg('circle', { cx: cx * S, cy: -49 * S, r: 3 * S, fill: '#f4f1ea' }));
    for (const a of [0, 120, 240]) {
      const rad = (a * Math.PI) / 180;
      reel.append(svg('line', { x1: cx * S, y1: -49 * S, x2: (cx + Math.cos(rad) * 2.4) * S, y2: (-49 + Math.sin(rad) * 2.4) * S, stroke: '#2a2238', 'stroke-width': 0.8 * S }));
    }
    g.append(reel);
  }
  g.append(svg('path', { d: `M${String(-7 * S)} ${String(-37 * S)} L${String(-5 * S)} ${String(-41 * S)} L${String(5 * S)} ${String(-41 * S)} L${String(7 * S)} ${String(-37 * S)}`, fill: '#1a1020' }));
  return g;
}

const cache = new Map<string, SVGSVGElement>();

function sitterKey(sitter: Sitter): string {
  if (sitter.kind === 'device') return `${sitter.device}:${String(sitter.tint)}`;
  const { colors, wear, costume } = sitter.look;
  return JSON.stringify([sitter.look.name, colorsKey(colors), wear, costume]);
}

const colorsKey = (c: GuardianColors): string => `${String(c.lit)},${String(c.shadow)},${String(c.highlight)}`;

/** A portrait of a sitter wearing a face, looking toward the middle of the panel from its side; built once, then reused. */
export function portrait(sitter: Sitter, face: Face, facing: 1 | -1): SVGSVGElement {
  const key = `${sitterKey(sitter)}|${face}|${String(facing)}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const out = svg('svg', { viewBox: VIEW, class: 'story-portrait', 'data-frame': 'rest' });
  for (const frame of FRAMES) {
    const g = sitter.kind === 'figure' ? figureFrame(sitter.look, face, facing, frame) : deviceFrame(sitter.device, sitter.tint, frame);
    g.setAttribute('class', `frame-${frame}`);
    if (frame !== 'rest') g.setAttribute('visibility', 'hidden');
    out.append(g);
  }
  cache.set(key, out);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return out;
}

/** Shows one frame of a portrait. */
export function showFrame(portraitSvg: SVGSVGElement, frame: PortraitFrame): void {
  if (portraitSvg.getAttribute('data-frame') === frame) return;
  portraitSvg.setAttribute('data-frame', frame);
  for (const g of portraitSvg.children) g.setAttribute('visibility', g.getAttribute('class') === `frame-${frame}` ? 'visible' : 'hidden');
}
