// Worn paths across island maps: from each bridge end to the middle of its islet, as wide as the bridge.
import { tileAt, type Box, type CitadelMap, type Vec2 } from '@byzantine-council/shared';

const inside = (b: Box, c: number, r: number): boolean => c >= b.c0 && c <= b.c1 && r >= b.r0 && r <= b.r1;

// Tile keys ("c,r") of open ground that lies on a path.
export function islandPaths(map: CitadelMap, islets: Readonly<Record<string, Box>>, bridges: readonly Box[], hubs: Readonly<Record<string, Vec2>> = {}): Set<string> {
  const out = new Set<string>();
  const mark = (c: number, r: number): void => {
    if (tileAt(map, c, r) === '.') out.add(`${String(c)},${String(r)}`);
  };
  const entries = Object.entries(islets);
  for (const b of bridges) {
    // A bridge runs along the axis whose ends touch land.
    const horizontal = entries.some(([, i]) => inside(i, b.c0 - 1, b.r0)) || entries.some(([, i]) => inside(i, b.c1 + 1, b.r0));
    const ends = horizontal
      ? [{ c: b.c0 - 1, r: b.r0, dc: -1, dr: 0 }, { c: b.c1 + 1, r: b.r0, dc: 1, dr: 0 }]
      : [{ c: b.c0, r: b.r0 - 1, dc: 0, dr: -1 }, { c: b.c0, r: b.r1 + 1, dc: 0, dr: 1 }];
    const span = horizontal ? b.r1 - b.r0 : b.c1 - b.c0;
    for (const end of ends) {
      const found = entries.find(([, i]) => inside(i, end.c, end.r));
      if (found === undefined) continue;
      const [room, islet] = found;
      const hub = hubs[room] ?? { x: (islet.c0 + islet.c1 + 1) / 2, y: (islet.r0 + islet.r1 + 1) / 2 };
      const hc = Math.floor(hub.x);
      const hr = Math.floor(hub.y);
      // Straight in along the bridge's axis to the hub's line, then across to the hub.
      for (let w = 0; w <= span; w++) {
        let c = end.c + (horizontal ? 0 : w);
        let r = end.r + (horizontal ? w : 0);
        for (let guard = 0; guard < 64 && inside(islet, c, r); guard++) {
          mark(c, r);
          if (horizontal ? c === hc : r === hr) break;
          c += horizontal ? -end.dc : 0;
          r += horizontal ? 0 : -end.dr;
        }
        const step = horizontal ? Math.sign(hr - r) : Math.sign(hc - c);
        for (let guard = 0; guard < 64 && step !== 0 && inside(islet, c, r); guard++) {
          mark(c, r);
          if (horizontal ? r === hr : c === hc) break;
          if (horizontal) r += step;
          else c += step;
        }
      }
    }
  }
  return out;
}
