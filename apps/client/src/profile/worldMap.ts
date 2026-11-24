// The archipelago on the menu: every island visible, the open ones bright, the rest showing how to open them.
import { ISLANDS, islandOpen, type Island } from '@byzantine-council/shared/progression';
import { el, h } from '../ui/dom.js';
import { svg } from '../ui/svg.js';
import type { ProfileSummary } from './api.js';
import { CHAPTERS, chapterOpen, type StoryBook } from '../story/storyBook.js';
import type { Chapter } from '../story/chapters.js';
import type { SeasonReply } from '@byzantine-council/shared/seasons';

const COLORS: Readonly<Record<string, string>> = {
  mint: '#5FD3B0',
  signing: '#FFD27A',
  council: '#A983FF',
  watchtower: '#7FC8FF',
  reef: '#4FA7CF',
  beach: '#FF9A6A',
};

export class WorldMap {
  readonly #root = el('world', HTMLElement);
  readonly #map = el('world-map', HTMLDivElement);
  readonly #card = el('world-card', HTMLDivElement);
  readonly #openButton = el('open-world', HTMLButtonElement);
  readonly #progressText = el('world-progress-text', HTMLElement);
  readonly #progressLeft = el('world-progress-left', HTMLElement);
  readonly #progressBar = el('world-progress-bar', HTMLDivElement);
  readonly #progressFill = el('world-progress-fill', HTMLDivElement);
  readonly #previewAll: boolean;
  #selected = 'mint';
  #profile: ProfileSummary | null = null;
  #story: StoryBook | null = null;
  // Called when the player chooses to visit an island they can walk around (Beach Town).
  onVisit: (islandId: string) => void = () => undefined;

  constructor(previewAll = islandPreviewEnabled()) {
    this.#previewAll = previewAll;
    this.#openButton.addEventListener('click', () => {
      this.open();
    });
    el('world-close', HTMLButtonElement).addEventListener('click', () => {
      this.close();
    });
    this.#root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    if (previewAll) {
      this.#root.dataset['preview'] = 'all';
      el('world-title', HTMLElement).textContent = 'The archipelago · Explorer preview';
    }
  }

  open(): void {
    if (this.#profile === null) return;
    this.#root.hidden = false;
    this.#root.focus();
  }

  close(): void {
    this.#root.hidden = true;
  }

  // Chapters of the Chronicle are read from the island cards.
  setStory(story: StoryBook): void {
    this.#story = story;
    story.onClosed = () => {
      this.#render();
    };
  }

  // Story chapters belonging to an island (the prologue sits with Mint Island), open ones only.
  #chapters(islandId: string): Chapter[] {
    const v = this.#profile?.progress;
    const rank = this.#previewAll ? Number.MAX_SAFE_INTEGER : (v?.rank ?? 1);
    const stars = this.#previewAll ? Number.MAX_SAFE_INTEGER : (v?.academy.reduce((a, l) => a + l.stars, 0) ?? 0);
    return CHAPTERS.filter((c) => (c.island ?? 'mint') === islandId && (c.island !== null || islandId === 'mint') && chapterOpen(c, rank, stars) && !(c.id === 'epilogue' && islandId !== 'beach'));
  }

  // The newest chapter open to this profile, for rereading at the beach hut.
  latestOpen(): Chapter | null {
    let latest: Chapter | null = null;
    for (const island of ISLANDS) for (const c of this.#chapters(island.id)) if (latest === null || c.number > latest.number) latest = c;
    return latest;
  }

  // The first open chapter this browser has not read yet, if any.
  firstUnread(): Chapter | null {
    for (const island of ISLANDS) for (const c of this.#chapters(island.id)) if (this.#story?.isRead(c.id) === false) return c;
    return null;
  }

  // Called once for each chapter that opens while the game is running (not on the first load).
  onNewChapter: (chapter: Chapter) => void = () => undefined;
  #openChapters: Set<string> | null = null;
  #season: SeasonReply | null = null;

  // A live seasonal event raises its own island on the map while it lasts.
  setSeason(reply: SeasonReply | null): void {
    this.#season = reply;
    if (this.#profile !== null) this.#render();
  }

  setProfile(p: ProfileSummary): void {
    this.#profile = p;
    const open = new Set(ISLANDS.flatMap((i) => this.#chapters(i.id).map((c) => c.id)));
    if (this.#openChapters !== null) {
      for (const c of CHAPTERS) if (open.has(c.id) && !this.#openChapters.has(c.id)) this.onNewChapter(c);
    }
    this.#openChapters = open;
    this.#openButton.hidden = false;
    this.#render();
  }

  #status(island: Island): { open: boolean; text: string } {
    const v = this.#profile?.progress;
    const rank = v?.rank ?? 1;
    const stars = v?.academy.reduce((a, l) => a + l.stars, 0) ?? 0;
    if (!island.ready) return { open: false, text: `Coming soon · opens at Rank ${String(island.rank)}` };
    if (this.#previewAll) return { open: true, text: 'Explorer preview · progression locks ignored' };
    const open = islandOpen(island, rank, stars);
    if (open) return { open: true, text: island.id === 'mint' ? 'Open · you start here' : 'Open' };
    return { open: false, text: `Opens at Rank ${String(island.rank)} or with ${String(island.stars)} Academy stars (you have Rank ${String(rank)}, ${String(stars)} stars)` };
  }

  #render(): void {
    const ready = ISLANDS.filter((island) => island.ready);
    const openCount = ready.filter((island) => this.#status(island).open).length;
    const left = ready.length - openCount;
    this.#progressText.textContent = this.#previewAll ? `All ${String(ready.length)} islands open for review` : `${String(openCount)} of ${String(ready.length)} islands open`;
    this.#progressLeft.textContent = this.#previewAll ? 'Explorer preview does not change progress' : left === 0 ? 'Archipelago complete' : `${String(left)} left to unlock`;
    this.#progressBar.setAttribute('aria-valuemax', String(ready.length));
    this.#progressBar.setAttribute('aria-valuenow', String(openCount));
    this.#progressFill.style.width = `${String((openCount / Math.max(1, ready.length)) * 100)}%`;
    this.#openButton.replaceChildren('Explore', Object.assign(document.createElement('small'), { textContent: left === 0 ? 'All unlocked' : `${String(left)} to unlock` }));
    const drawing = svg('svg', { viewBox: '0 0 100 100', class: 'world-svg', role: 'group', 'aria-label': 'Islands' });
    drawing.append(worldDefs());
    // Sky above a sea of cloud, then drifting cloud banks.
    drawing.append(svg('rect', { x: 0, y: 0, width: 100, height: 100, rx: 4, fill: 'url(#wm-sky)' }));
    for (const [x, y, w, cls] of [[10, 70, 30, 'wm-cloud slow'], [55, 88, 40, 'wm-cloud'], [70, 35, 26, 'wm-cloud slow'], [25, 30, 22, 'wm-cloud']] as const) {
      const g = svg('g', { class: cls });
      for (const [dx, dy, r] of [[0, 0, 0.32], [0.3, -0.12, 0.38], [0.62, 0, 0.3]] as const) g.append(svg('ellipse', { cx: x + dx * w, cy: y + dy * w * 0.5, rx: w * r, ry: w * r * 0.42, fill: '#fff6ea', opacity: 0.55 }));
      drawing.append(g);
    }
    // Light-bridges: bright between open islands, faint toward locked ones.
    for (let i = 1; i < ISLANDS.length; i++) {
      const a = ISLANDS[i - 1];
      const b = ISLANDS[i];
      if (a === undefined || b === undefined) continue;
      const lit = this.#status(a).open && this.#status(b).open;
      drawing.append(svg('path', { d: `M${String(a.x)} ${String(a.y)} Q${String((a.x + b.x) / 2)} ${String(Math.min(a.y, b.y) - 8)} ${String(b.x)} ${String(b.y)}`, class: lit ? 'bridge lit' : 'bridge' }));
    }
    for (const island of ISLANDS) {
      const { open } = this.#status(island);
      const g = svg('g', { class: `island${open ? ' open' : ''}${island.id === this.#selected ? ' selected' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${island.name}: ${this.#status(island).text}` });
      drawIsland(g, island, open, COLORS[island.id] ?? '#9fbe5c');
      const label = svg('text', { x: island.x, y: island.y + 14.5, 'text-anchor': 'middle' });
      label.textContent = open ? island.name : `🔒 ${island.name}`;
      g.append(label);
      if (this.#chapters(island.id).some((c) => this.#story?.isRead(c.id) === false)) g.append(svg('circle', { cx: island.x + 9, cy: island.y - 5, r: 2.2, class: 'new-dot' }));
      const choose = (): void => {
        this.#selected = island.id;
        this.#render();
      };
      g.addEventListener('click', choose);
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose();
        }
      });
      drawing.append(g);
    }
    const event = this.#season?.featured ?? null;
    if (event !== null) {
      const g = svg('g', { class: `island open event${this.#selected === 'event' ? ' selected' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${event.title}: a seasonal event island` });
      const [a, b] = event.colors;
      g.append(svg('ellipse', { cx: 61, cy: 13, rx: 12, ry: 6.5, fill: a, opacity: 0.4, filter: 'url(#wm-glow)', class: 'halo' }));
      g.append(svg('path', { d: 'M54 12 L57 16 L60 20 L63 16 L66 12 Z', fill: 'url(#wm-cliff)' }), svg('ellipse', { cx: 61, cy: 12, rx: 7.5, ry: 3.2, fill: b, class: 'rim' }));
      // A five-point star for the event.
      const star = Array.from({ length: 10 }, (_, i) => {
        const r = i % 2 === 0 ? 3.2 : 1.4;
        const t = (i * Math.PI) / 5 - Math.PI / 2;
        return `${String(61 + Math.cos(t) * r)},${String(7 + Math.sin(t) * r)}`;
      }).join(' ');
      g.append(svg('polygon', { points: star, fill: a, stroke: '#fff6e6', 'stroke-width': 0.4 }));
      const label = svg('text', { x: 61, y: 24, 'text-anchor': 'middle' });
      label.textContent = event.title;
      g.append(label);
      const choose = (): void => {
        this.#selected = 'event';
        this.#render();
      };
      g.addEventListener('click', choose);
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose();
        }
      });
      drawing.append(g);
    }
    this.#map.replaceChildren(drawing);
    if (this.#selected === 'event' && event !== null) {
      this.#card.replaceChildren(h('b', '', event.title), h('span', 'concept', event.headline), h('p', '', event.blurb), h('span', 'tag me', 'Event island · finish a match while it lasts to earn a hidden seal'));
      return;
    }
    const island = ISLANDS.find((i) => i.id === this.#selected) ?? ISLANDS[0];
    if (island === undefined) return;
    const status = this.#status(island);
    this.#card.replaceChildren(h('b', '', island.name), h('span', 'concept', island.concept), h('p', '', island.about), h('span', status.open ? 'tag honest' : 'tag left', status.text));
    if (status.open) {
      const visit = h('button', 'cta world-visit', island.id === 'beach' ? 'Visit Beach Town' : `Explore ${island.name}`);
      visit.type = 'button';
      visit.addEventListener('click', () => {
        this.close();
        this.onVisit(island.id);
      });
      this.#card.append(visit);
    }
    const chapters = this.#chapters(island.id);
    if (chapters.length > 0 && this.#story !== null) {
      const list = h('div', 'world-chapters');
      for (const c of chapters) {
        const b = h('button', '', c.number === 0 ? `Prologue: ${c.title}` : `Chapter ${String(c.number)}: ${c.title}`);
        b.type = 'button';
        if (!this.#story.isRead(c.id)) b.append(h('span', 'tag me', 'New'));
        b.addEventListener('click', () => {
          this.#story?.open(c);
        });
        list.append(b);
      }
      this.#card.append(list);
    }
  }
}

export function islandPreviewEnabled(search = window.location.search): boolean {
  return new URLSearchParams(search).get('explore') === 'all';
}

function worldDefs(): SVGDefsElement {
  const defs = svg('defs');
  const grad = (id: string, stops: readonly (readonly [number, string, number?])[], vertical = true): SVGLinearGradientElement => {
    const g = svg('linearGradient', { id, x1: 0, y1: 0, x2: vertical ? 0 : 1, y2: vertical ? 1 : 0 });
    for (const [offset, color, opacity] of stops) g.append(svg('stop', { offset, 'stop-color': color, 'stop-opacity': opacity ?? 1 }));
    return g;
  };
  defs.append(
    grad('wm-sky', [[0, '#4a3f86'], [0.45, '#b9719a'], [0.8, '#f0a382'], [1, '#ffdcaa']]),
    grad('wm-cliff', [[0, '#c98f6c'], [0.5, '#8e5e72'], [1, '#4e3466', 0.2]]),
    grad('wm-sand', [[0, '#fae8c8'], [1, '#e2c49a']]),
  );
  const blur = svg('filter', { id: 'wm-fog', x: '-50%', y: '-50%', width: '200%', height: '200%' });
  blur.append(svg('feGaussianBlur', { stdDeviation: 1.6 }));
  const glow = svg('filter', { id: 'wm-glow', x: '-50%', y: '-50%', width: '200%', height: '200%' });
  glow.append(svg('feGaussianBlur', { stdDeviation: 1.2 }));
  defs.append(blur, glow);
  return defs;
}

// A floating island: rocky underside, sandy rim, grass top in the island's colour, and its landmark.
function drawIsland(g: SVGGElement, island: Island, open: boolean, color: string): void {
  const { x, y } = island;
  if (open) g.append(svg('ellipse', { cx: x, cy: y + 1, rx: 13, ry: 7, fill: color, opacity: 0.35, filter: 'url(#wm-glow)', class: 'halo' }));
  g.append(
    svg('path', { d: `M${String(x - 10)} ${String(y)} L${String(x - 7)} ${String(y + 4)} L${String(x - 4.5)} ${String(y + 9)} L${String(x - 2)} ${String(y + 5.5)} L${String(x + 1)} ${String(y + 11)} L${String(x + 4)} ${String(y + 6)} L${String(x + 7.5)} ${String(y + 3.5)} L${String(x + 10)} ${String(y)} Z`, fill: 'url(#wm-cliff)' }),
    svg('ellipse', { cx: x, cy: y, rx: 10, ry: 4.6, fill: 'url(#wm-sand)', class: 'rim' }),
    svg('ellipse', { cx: x - 0.6, cy: y - 0.4, rx: 8.2, ry: 3.5, fill: open ? color : '#7d6a86' }),
    svg('ellipse', { cx: x - 2.5, cy: y - 1.2, rx: 3.5, ry: 1.2, fill: '#ffffff', opacity: 0.22 }),
  );
  const ink = open ? '#fff6e6' : '#c9b6cf';
  const dark = '#3a2a48';
  switch (island.id) {
    case 'mint':
      g.append(svg('rect', { x: x - 2.5, y: y - 5, width: 5, height: 4, fill: ink }), svg('path', { d: `M${String(x - 3)} ${String(y - 5)} Q${String(x)} ${String(y - 9)} ${String(x + 3)} ${String(y - 5)} Z`, fill: '#a983ff' }));
      break;
    case 'signing':
      g.append(svg('rect', { x: x - 3.5, y: y - 4, width: 7, height: 3, fill: ink }), svg('path', { d: `M${String(x - 4)} ${String(y - 4)} L${String(x)} ${String(y - 6.5)} L${String(x + 4)} ${String(y - 4)} Z`, fill: dark }), svg('line', { x1: x + 2, y1: y - 9, x2: x + 4, y2: y - 5, stroke: '#ffd27a', 'stroke-width': 0.6 }));
      break;
    case 'council':
      g.append(svg('ellipse', { cx: x, cy: y - 0.6, rx: 4, ry: 1.6, fill: 'none', stroke: '#ffd27a', 'stroke-width': 0.5 }), svg('ellipse', { cx: x, cy: y - 0.6, rx: 1.6, ry: 0.7, fill: '#ffd27a' }));
      break;
    case 'watchtower':
      g.append(svg('rect', { x: x - 1.2, y: y - 9, width: 2.4, height: 8, fill: ink }), svg('path', { d: `M${String(x - 2)} ${String(y - 9)} L${String(x)} ${String(y - 13)} L${String(x + 2)} ${String(y - 9)} Z`, fill: '#e26e52' }), svg('circle', { cx: x, cy: y - 13.6, r: 0.7, fill: '#ffe9be' }));
      break;
    case 'reef':
      g.append(svg('path', { d: `M${String(x - 4)} ${String(y - 1)} q2 -3 4 0 t4 0`, fill: 'none', stroke: '#ffe36a', 'stroke-width': 0.6 }), svg('path', { d: `M${String(x - 1)} ${String(y - 5)} l1.5 2 l-1 0 l1.5 2.5`, fill: 'none', stroke: '#ffe36a', 'stroke-width': 0.5 }));
      break;
    case 'beach':
      g.append(svg('line', { x1: x + 2, y1: y - 1, x2: x + 3, y2: y - 7, stroke: '#7a4e3e', 'stroke-width': 0.6 }), svg('path', { d: `M${String(x + 3)} ${String(y - 7)} q-3 -1 -5 1 M${String(x + 3)} ${String(y - 7)} q3 -1 4 2 M${String(x + 3)} ${String(y - 7)} q0 -2 -2 -3`, fill: 'none', stroke: '#6f9e48', 'stroke-width': 0.7 }), svg('rect', { x: x - 4, y: y - 3, width: 3, height: 2.2, fill: '#ff9a6a' }));
      break;
    default:
      break;
  }
  if (!open) g.append(svg('ellipse', { cx: x, cy: y - 1, rx: 12, ry: 6, fill: '#f4ecf6', opacity: 0.45, filter: 'url(#wm-fog)', class: 'fog' }));
}
