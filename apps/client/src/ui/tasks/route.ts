// Gateway Dock: pick a route from the gateway to the shop where every channel can carry the payment.
import { ROUTE_EDGES, ROUTE_SOURCE, ROUTE_TARGET, type RouteChallenge } from '@byzantine-council/shared';
import { h } from '../dom.js';
import { svg } from '../svg.js';
import { button, type MinigameHost } from './types.js';

// Node positions in the 400 x 220 drawing: gateway, three columns of two, then the shop.
const POS: readonly (readonly [number, number])[] = [
  [36, 110], [122, 46], [122, 174], [208, 46], [208, 174], [294, 46], [294, 174], [370, 110],
];
const NODE_LABEL = ['Gateway', 'A', 'B', 'C', 'D', 'E', 'F', 'Shop'];
// The gateway and the shop are pills wide enough for their names.
const PILL_WIDTH: Readonly<Record<number, number>> = { [ROUTE_SOURCE]: 66, [ROUTE_TARGET]: 54 };
const PILL_HEIGHT = 26;
const NODE_RADIUS = 15;
// Invisible touch target around each column node.
const HIT_RADIUS = 22;
// Channels that cross another one: their labels sit a third of the way along so they stay apart.
const CROSSING: ReadonlySet<string> = new Set(['1-4', '2-3', '3-6', '4-5']);

function at(i: number): readonly [number, number] {
  return POS[i] ?? [0, 0];
}

function capacityText(capacity: number): string {
  return `${String(capacity)}k`;
}

// What a screen reader says for a node: its name and the channels leaving it.
export function nodeDescription(c: RouteChallenge, node: number): string {
  const name = NODE_LABEL[node] ?? '';
  if (node === ROUTE_TARGET) return `${name}, where the payment ends`;
  const out = ROUTE_EDGES.flatMap(([from, to], i) =>
    from === node ? [`to ${NODE_LABEL[to] ?? ''} holds ${capacityText(c.capacities[i] ?? 0)}`] : [],
  );
  const lead = node === ROUTE_SOURCE ? `${name}, where the payment starts` : name;
  return `${lead}. Channel ${out.join(', channel ')}`;
}

export function routeGame(root: HTMLElement, c: RouteChallenge, host: MinigameHost): void {
  const prompt = h(
    'p',
    'prompt',
    `Pay ${String(c.amount)}k sats from the gateway to the shop. Pick a route where every channel holds at least ${String(c.amount)}k.`,
  );
  const drawing = svg('svg', { viewBox: '0 0 400 220', class: 'route-map', role: 'group', 'aria-label': 'Lightning channels', 'data-amount': c.amount });
  const edgeLayer = svg('g');
  const nodeLayer = svg('g');
  drawing.append(edgeLayer, nodeLayer);

  const lines = ROUTE_EDGES.map(([from, to], i) => {
    const [x1, y1] = at(from);
    const [x2, y2] = at(to);
    const line = svg('line', { x1, y1, x2, y2, class: 'channel' });
    const along = CROSSING.has(`${String(from)}-${String(to)}`) ? 0.36 : 0.5;
    const lx = x1 + (x2 - x1) * along;
    const ly = y1 + (y2 - y1) * along;
    const label = svg('g', { class: 'capacity', 'data-edge': i, 'data-capacity': c.capacities[i] ?? 0, 'aria-hidden': 'true' });
    label.append(svg('rect', { x: lx - 19, y: ly - 11, width: 38, height: 22, rx: 11 }));
    const text = svg('text', { x: lx, y: ly + 4.5, 'text-anchor': 'middle' });
    text.textContent = capacityText(c.capacities[i] ?? 0);
    label.append(text);
    edgeLayer.append(line);
    return { from, to, line, label };
  });
  for (const l of lines) edgeLayer.append(l.label);

  const path: number[] = [ROUTE_SOURCE];
  const action = button('Send payment', 'cta');
  const status = h('p', 'tally');
  status.setAttribute('aria-live', 'polite');

  const nodes = POS.map(([x, y], i) => {
    const g = svg('g', { class: 'node', tabindex: 0, role: 'button', 'data-node': i, 'aria-label': nodeDescription(c, i) });
    const pill = PILL_WIDTH[i];
    if (pill === undefined) {
      g.append(svg('circle', { class: 'hit', cx: x, cy: y, r: HIT_RADIUS }), svg('circle', { class: 'dot', cx: x, cy: y, r: NODE_RADIUS }));
    } else {
      g.append(svg('rect', { class: 'dot', x: x - pill / 2, y: y - PILL_HEIGHT / 2, width: pill, height: PILL_HEIGHT, rx: PILL_HEIGHT / 2 }));
    }
    const text = svg('text', { x, y: y + 4.5, 'text-anchor': 'middle', 'aria-hidden': 'true' });
    text.textContent = NODE_LABEL[i] ?? '';
    g.append(text);
    g.addEventListener('click', () => {
      tap(i);
    });
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!e.repeat) tap(i);
      }
    });
    nodeLayer.append(g);
    return g;
  });

  const render = (): void => {
    nodes.forEach((g, i) => {
      const on = path.includes(i);
      g.classList.toggle('on', on);
      g.setAttribute('aria-pressed', String(on));
    });
    for (const l of lines) {
      const k = path.indexOf(l.from);
      l.line.classList.toggle('on', k >= 0 && path[k + 1] === l.to);
    }
    const done = path[path.length - 1] === ROUTE_TARGET;
    action.disabled = !done;
    status.textContent = done ? 'Route complete. Send it?' : `Route: ${path.map((n) => NODE_LABEL[n] ?? '').join(' → ')}`;
  };

  // Picking a node on the route cuts back to it; a node one hop ahead extends it.
  const tap = (i: number): void => {
    const k = path.indexOf(i);
    if (k >= 0) {
      path.length = k + 1;
    } else {
      const last = path[path.length - 1] ?? ROUTE_SOURCE;
      if (!ROUTE_EDGES.some(([from, to]) => from === last && to === i)) {
        status.textContent = 'No channel goes there from the end of your route.';
        return;
      }
      path.push(i);
    }
    render();
  };

  action.addEventListener('click', () => {
    if (path[path.length - 1] !== ROUTE_TARGET) return;
    action.disabled = true;
    host.submit({ kind: 'route', path: [...path] });
  });
  render();
  root.append(prompt, drawing, status, action);
}
