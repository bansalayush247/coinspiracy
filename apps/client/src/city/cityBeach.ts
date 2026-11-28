import { tileAt, type Box, type Vec2 } from '@byzantine-council/shared';
import { CITY_MAP, CITY_SHALLOWS_ISLETS } from '@byzantine-council/shared/city';

export const CITY_SAND = 0xf3d7a1;
export const CITY_WET_SAND = 0xd5b484;

const at = (c: number, r: number): string => tileAt(CITY_MAP, c, r);

/** The beaches on the Shallows islets and the open ground behind the south boardwalk. */
export function citySandAt(c: number, r: number, tile = at(c, r)): boolean {
  if (tile !== '.' && tile !== ',' && tile !== 'T') return false;
  if (c < 40) return isShallowsBeach(c, r);
  if (r < 89) return false;
  const reach = 4 + Math.round(Math.cos(c * 0.21));
  for (let offset = 3; offset <= reach; offset++) {
    if (at(c, r + offset) === '~' && at(c, r + offset - 1) === '=' && at(c, r + offset - 2) === '=') return true;
  }
  return false;
}

export function isShallowsBeach(c: number, r: number): boolean {
  return c < 40 && r >= 90 && CITY_SHALLOWS_ISLETS.some((b) => c >= b.c0 && c <= b.c1 && r >= b.r0 && r <= b.r1);
}

// The same outline is used from the street and from the ferry. Keep the small insets within
// the walking clearance, with straight joins where the boardwalk touches the beach.
export const SHALLOWS_BEACHES = CITY_SHALLOWS_ISLETS.map((box, index) => ({ box, shore: shorePoints(box, index) }));

function shorePoints({ c0, r0, c1, r1 }: Box, index: number): readonly Vec2[] {
  const corners: readonly Vec2[] = [{ x: c0, y: r0 }, { x: c1 + 1, y: r0 }, { x: c1 + 1, y: r1 + 1 }, { x: c0, y: r1 + 1 }];
  const nearPlanks = (x: number, y: number): boolean => {
    for (const dy of [-0.55, 0.55]) for (const dx of [-0.55, 0.55]) {
      if (at(Math.floor(x + dx), Math.floor(y + dy)) === '=') return true;
    }
    return false;
  };
  const radii = corners.map(({ x, y }, i) => nearPlanks(x, y) ? 0 : 0.96 + ((i + index * 2) % 4) * 0.075);
  const sides = corners.map((from, i) => {
    const next = (i + 1) % corners.length;
    const to = corners[next] ?? from;
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);
    const a = radii[i] ?? 0;
    const b = radii[next] ?? 0;
    return { start: { x: from.x + dx * a, y: from.y + dy * a }, end: { x: to.x - dx * b, y: to.y - dy * b }, dx, dy };
  });
  const points: Vec2[] = [];
  for (const [i, { start, end, dx, dy }] of sides.entries()) {
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.ceil(length * 4);
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const x = start.x + dx * length * t;
      const y = start.y + dy * length * t;
      const insets = 0.13 + 0.12 * Math.cos(t * 3 * Math.PI + (i + index) * 1.6);
      const inset = nearPlanks(x, y) ? 0 : insets * Math.sin(t * Math.PI) ** 2;
      points.push({ x: x - dy * inset, y: y + dx * inset });
    }
    const next = (i + 1) % sides.length;
    const corner = corners[next];
    const after = sides[next]?.start;
    if (corner === undefined || after === undefined || radii[next] === 0) continue;
    for (let s = 0; s < 8; s++) {
      const t = s / 8;
      const u = 1 - t;
      points.push({
        x: end.x * u * u + 2 * corner.x * u * t + after.x * t * t,
        y: end.y * u * u + 2 * corner.y * u * t + after.y * t * t,
      });
    }
  }
  return points;
}
