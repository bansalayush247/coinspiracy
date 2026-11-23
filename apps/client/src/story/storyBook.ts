// The storybook: an illustrated chapter, one page at a time, with the real idea at the end.
import { ISLANDS, islandOpen } from '@byzantine-council/shared/progression';
import { audio } from '../audio/engine.js';
import { el, h } from '../ui/dom.js';
import { svg } from '../ui/svg.js';
import { SITE_URL } from '../siteUrl.js';
import { CHAPTERS, NARRATOR, type Chapter, type Motif } from './chapters.js';

const READ_KEY = 'bc.story.read';

// Which chapters this browser has read; a convenience only, so failures just mean "unread".
function loadRead(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    const ids = raw === null ? [] : (JSON.parse(raw) as unknown);
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string').slice(0, 32) : []);
  } catch {
    return new Set();
  }
}

export function chapterOpen(chapter: Chapter, rank: number, stars: number): boolean {
  if (chapter.island === null) return true;
  const island = ISLANDS.find((i) => i.id === chapter.island);
  if (island === undefined) return false;
  // Chapters for islands still being built open with the island's rank, so the story never stalls.
  const open = island.ready ? islandOpen(island, rank, stars) : rank >= island.rank;
  return open && rank >= (chapter.rank ?? 0);
}

export class StoryBook {
  readonly #root = el('story', HTMLElement);
  readonly #art = el('story-art', HTMLDivElement);
  readonly #title = el('story-title', HTMLHeadingElement);
  readonly #text = el('story-text', HTMLParagraphElement);
  readonly #pageNo = el('story-page', HTMLSpanElement);
  readonly #back = el('story-back', HTMLButtonElement);
  readonly #next = el('story-next', HTMLButtonElement);
  readonly #close = el('story-close', HTMLButtonElement);
  readonly #read = loadRead();
  #chapter: Chapter | null = null;
  #page = 0;
  onClosed: () => void = () => undefined;

  constructor() {
    this.#back.addEventListener('click', () => {
      this.#turn(-1);
    });
    this.#next.addEventListener('click', () => {
      if (this.#chapter !== null && this.#page >= this.#chapter.pages.length) this.close();
      else this.#turn(1);
    });
    this.#close.addEventListener('click', () => {
      this.close();
    });
    this.#root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      if (e.key === 'ArrowRight') this.#turn(1);
      if (e.key === 'ArrowLeft') this.#turn(-1);
    });
  }

  isRead(id: string): boolean {
    return this.#read.has(id);
  }

  get isOpen(): boolean {
    return !this.#root.hidden;
  }

  open(chapter: Chapter): void {
    this.#chapter = chapter;
    this.#page = 0;
    this.#art.replaceChildren(illustration(chapter.motif));
    this.#title.textContent = chapter.number === 0 ? `Prologue · ${chapter.title}` : `Chapter ${String(chapter.number)} · ${chapter.title}`;
    this.#root.hidden = false;
    this.#render();
    this.#root.focus();
    audio.setMood('story');
  }

  close(): void {
    if (this.#root.hidden) return;
    const chapter = this.#chapter;
    if (chapter !== null) {
      this.#read.add(chapter.id);
      try {
        localStorage.setItem(READ_KEY, JSON.stringify([...this.#read]));
      } catch {
        // Storage blocked: the chapter shows as new again next visit.
      }
    }
    this.#root.hidden = true;
    this.#chapter = null;
    audio.setMood('menu');
    this.onClosed();
  }

  #turn(by: number): void {
    const c = this.#chapter;
    if (c === null) return;
    const next = Math.max(0, Math.min(c.pages.length, this.#page + by));
    if (next === this.#page) return;
    this.#page = next;
    audio.play('click');
    this.#render();
  }

  #render(): void {
    const c = this.#chapter;
    if (c === null) return;
    const last = this.#page >= c.pages.length;
    this.#text.classList.remove('turn');
    // Restart the page-turn fade.
    this.#text.getBoundingClientRect();
    this.#text.classList.add('turn');
    if (last) {
      this.#text.replaceChildren(h('span', 'story-idea-label', 'The real idea'), h('span', 'story-idea', c.idea));
      if (SITE_URL !== null) {
        const link = h('a', 'story-codex', 'Read more in the Codex');
        link.href = `${SITE_URL}/codex/${c.codex}/`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        this.#text.append(link);
      }
    } else {
      this.#text.textContent = c.pages[this.#page] ?? '';
    }
    this.#pageNo.textContent = last ? `— ${NARRATOR}` : `${String(this.#page + 1)} / ${String(c.pages.length)}`;
    this.#back.disabled = this.#page === 0;
    this.#next.textContent = last ? 'Close the book' : 'Next page';
  }
}

export { CHAPTERS };

// A small painted vignette for each chapter: layered sky, the island, and the chapter's motif.
function illustration(motif: Motif): SVGSVGElement {
  const s = svg('svg', { viewBox: '0 0 400 200', class: 'story-svg', role: 'img', 'aria-label': `Illustration: ${motif}` });
  const defs = svg('defs');
  const sky = svg('linearGradient', { id: `sky-${motif}`, x1: 0, y1: 0, x2: 0, y2: 1 });
  const night = motif === 'storm' || motif === 'reef';
  const stops: [string, string][] = night
    ? [['0', '#2b2350'], ['0.6', '#4a3a78'], ['1', '#6a5a9a']]
    : motif === 'rise'
      ? [['0', '#6a62b0'], ['0.5', '#ff9ec0'], ['1', '#ffe1a8']]
      : [['0', '#6a62b0'], ['0.45', '#d9849a'], ['0.8', '#ffae7e'], ['1', '#ffd59a']];
  for (const [offset, color] of stops) sky.append(svg('stop', { offset, 'stop-color': color }));
  const glow = svg('radialGradient', { id: `glow-${motif}` });
  glow.append(svg('stop', { offset: 0, 'stop-color': '#fff3c8', 'stop-opacity': 0.95 }), svg('stop', { offset: 1, 'stop-color': '#fff3c8', 'stop-opacity': 0 }));
  defs.append(sky, glow);
  s.append(defs, svg('rect', { x: 0, y: 0, width: 400, height: 200, fill: `url(#sky-${motif})` }));
  // Sun or moon with a soft halo.
  s.append(svg('circle', { cx: night ? 330 : 80, cy: night ? 40 : 60, r: 46, fill: `url(#glow-${motif})` }), svg('circle', { cx: night ? 330 : 80, cy: night ? 40 : 60, r: 14, fill: night ? '#e8e4ff' : '#fff1c9' }));
  // Cloud bank below.
  for (const [cx, cy, rx] of [[60, 190, 90], [200, 196, 120], [340, 188, 100]] as const) s.append(svg('ellipse', { cx, cy, rx, ry: 26, fill: '#fff4e6', opacity: 0.85 }));
  const island = (cx: number, cy: number, w: number, tilt = 0): SVGGElement => {
    const g = svg('g', { transform: `rotate(${String(tilt)} ${String(cx)} ${String(cy)})` });
    g.append(
      svg('path', { d: `M${String(cx - w)} ${String(cy)} L${String(cx + w)} ${String(cy)} L${String(cx + w * 0.5)} ${String(cy + w * 0.45)} L${String(cx + w * 0.1)} ${String(cy + w * 0.8)} L${String(cx - w * 0.35)} ${String(cy + w * 0.5)} Z`, fill: '#8e5e72' }),
      svg('ellipse', { cx, cy, rx: w, ry: w * 0.18, fill: '#f0d7b0' }),
      svg('ellipse', { cx: cx - w * 0.3, cy: cy - 4, rx: w * 0.18, ry: w * 0.1, fill: '#9fbe5c' }),
    );
    return g;
  };
  switch (motif) {
    case 'fall': {
      s.append(island(270, 70, 50), island(150, 120, 70, 16));
      for (let i = 0; i < 6; i++) s.append(svg('rect', { x: 120 + i * 14, y: 150 + (i % 3) * 10, width: 6, height: 6, fill: '#8e5e72', transform: `rotate(${String(i * 23)} ${String(120 + i * 14)} 150)` }));
      break;
    }
    case 'seal': {
      s.append(island(200, 140, 120));
      s.append(svg('circle', { cx: 200, cy: 90, r: 40, fill: '#c8402e' }), svg('circle', { cx: 200, cy: 90, r: 28, fill: 'none', stroke: '#ffd27a', 'stroke-width': 4 }), svg('circle', { cx: 200, cy: 90, r: 12, fill: '#2a1a33' }));
      break;
    }
    case 'hands': {
      s.append(island(200, 150, 130));
      s.append(svg('rect', { x: 165, y: 70, width: 70, height: 50, rx: 6, fill: '#fff4dc' }));
      for (let i = 0; i < 5; i++) {
        const a = (-150 + i * 30) * (Math.PI / 180);
        const x = 200 + Math.cos(a) * 80;
        const y = 95 + Math.sin(a) * 60;
        s.append(svg('line', { x1: x, y1: y, x2: 200 + Math.cos(a) * 30, y2: 95 + Math.sin(a) * 22, stroke: '#ffd27a', 'stroke-width': 4, 'stroke-linecap': 'round' }));
      }
      break;
    }
    case 'scales': {
      s.append(island(200, 150, 130));
      s.append(svg('line', { x1: 200, y1: 50, x2: 200, y2: 140, stroke: '#ffd27a', 'stroke-width': 5 }), svg('line', { x1: 130, y1: 70, x2: 270, y2: 58, stroke: '#ffd27a', 'stroke-width': 5 }));
      s.append(svg('path', { d: 'M110 70 Q130 100 150 70 Z', fill: '#a983ff' }), svg('path', { d: 'M250 58 Q270 88 290 58 Z', fill: '#5fd3b0' }));
      for (let i = 0; i < 3; i++) s.append(svg('circle', { cx: 122 + i * 8, cy: 64, r: 5, fill: '#ff8a9a' }));
      break;
    }
    case 'storm': {
      s.append(island(100, 120, 60), island(300, 110, 60));
      s.append(svg('path', { d: 'M160 112 L190 95 L182 112 L215 96 L206 115 L240 104', fill: 'none', stroke: '#ff6b7a', 'stroke-width': 4 }));
      for (let i = 0; i < 26; i++) s.append(svg('line', { x1: (i * 37) % 400, y1: (i * 23) % 120, x2: ((i * 37) % 400) - 6, y2: ((i * 23) % 120) + 18, stroke: '#cfe0ff', 'stroke-width': 1.5, opacity: 0.6 }));
      break;
    }
    case 'reef': {
      s.append(svg('rect', { x: 0, y: 120, width: 400, height: 80, fill: '#244a7a' }));
      for (let i = 0; i < 4; i++) s.append(svg('path', { d: `M0 ${String(140 + i * 12)} C100 ${String(120 + i * 10)} 200 ${String(170 + i * 6)} 400 ${String(135 + i * 12)}`, fill: 'none', stroke: i % 2 === 0 ? '#ffe36a' : '#7fc8ff', 'stroke-width': 3, opacity: 0.8 }));
      s.append(island(200, 100, 60));
      break;
    }
    case 'town': {
      s.append(svg('rect', { x: 0, y: 130, width: 400, height: 70, fill: '#4fa7cf' }), svg('rect', { x: 0, y: 118, width: 400, height: 16, fill: '#f2d6a0' }));
      for (let i = 0; i < 6; i++) {
        const x = 40 + i * 58;
        s.append(svg('rect', { x, y: 88, width: 40, height: 32, fill: ['#ff9a6a', '#5fd3b0', '#ffd27a', '#a983ff', '#7fc8ff', '#ff8a9a'][i] ?? '#fff' }), svg('path', { d: `M${String(x - 4)} 88 L${String(x + 20)} 70 L${String(x + 44)} 88 Z`, fill: '#8e5e72' }), svg('circle', { cx: x + 20, cy: 100, r: 4, fill: '#fff1c9' }));
      }
      break;
    }
    case 'rise': {
      for (let i = 0; i < 7; i++) s.append(svg('path', { d: `M200 120 L${String(120 + i * 27)} 0 L${String(132 + i * 27)} 0 Z`, fill: '#fff3c8', opacity: 0.25 }));
      s.append(island(200, 115, 90));
      s.append(svg('path', { d: 'M170 115 L170 80 L200 62 L230 80 L230 115 Z', fill: '#f2cfa0' }), svg('path', { d: 'M165 80 L200 52 L235 80 Z', fill: '#a983ff' }));
      break;
    }
  }
  return s;
}
