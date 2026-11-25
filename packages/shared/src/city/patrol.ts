// Guards on their rounds: a steady walk around a closed loop of waypoints, facing the way they walk, so their
// torch points ahead of them. The server moves them; tests replay the same walk to prove a route can be beaten.
import type { Vec2 } from '../map.js';

export interface Walker {
  readonly x: number;
  readonly y: number;
  readonly facing: number;
  // The waypoint the walker last reached.
  readonly leg: number;
}

export function walkRoute(w: Walker, route: readonly Vec2[], speed: number, dt: number): Walker {
  if (route.length < 2) return w;
  let { x, y, facing, leg } = w;
  let budget = speed * dt;
  for (let guard = 0; budget > 0 && guard < route.length * 2; guard++) {
    const target = route[(leg + 1) % route.length] ?? route[0] ?? { x, y };
    const dx = target.x - x;
    const dy = target.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist <= budget) {
      x = target.x;
      y = target.y;
      budget -= dist;
      leg = (leg + 1) % route.length;
      continue;
    }
    x += (dx / dist) * budget;
    y += (dy / dist) * budget;
    facing = Math.atan2(dy, dx);
    budget = 0;
  }
  return { x, y, facing, leg };
}
