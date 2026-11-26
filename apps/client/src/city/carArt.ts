// A modern car at any heading, in the city's low-poly style: a rounded body, a sloped glass cabin with tinted
// windows, alloy wheels, LED light strips and a sheen on the roof. Every car on screen, parked, driven or ambient,
// is drawn here, around its middle, the same size as the body the server collides with.
import type Phaser from 'phaser';
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH } from '@byzantine-council/shared/city';
import { P, fan } from '../beach/beachArt.js';
import { ART_SCALE } from '../game/iso.js';
import { lit, mix, shade } from '../game/palette.js';

type G = Phaser.GameObjects.Graphics;
type UV = readonly [number, number];

const GLASS = 0x22323f;
const GLASS_LIT = 0x5d7c92;
const TYRE = 0x16141b;
const RIM = 0xc9ccd4;
const TRIM = 0x2a2830;
const LED = 0xfff6da;
const TAIL = 0xff3b4a;

// A footprint with its corners cut, so the body reads round rather than boxy.
function rounded(u0: number, v0: number, u1: number, v1: number, cut: number): UV[] {
  return [
    [u0 + cut, v0], [u1 - cut, v0], [u1, v0 + cut], [u1, v1 - cut],
    [u1 - cut, v1], [u0 + cut, v1], [u0, v1 - cut], [u0, v0 + cut],
  ];
}

/** Draws a modern car facing `heading` (radians, world space); `occupied` darkens the glass as if someone is in. */
export function drawModernCar(g: G, heading: number, color: number, occupied = false): void {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const at = (u: number, v: number, z: number) => P(u * c - v * s, u * s + v * c, z);
  // Sides facing the camera, lit from the left; `top` closes the solid. Base and top rings share a vertex order.
  const solid = (base: readonly UV[], top: readonly UV[], z0: number, z1: number, side: number, roof: number | null): void => {
    const cu = base.reduce((a, p) => a + p[0], 0) / base.length;
    const cv = base.reduce((a, p) => a + p[1], 0) / base.length;
    for (let i = 0; i < base.length; i++) {
      const a = base[i];
      const b = base[(i + 1) % base.length];
      const ta = top[i];
      const tb = top[(i + 1) % top.length];
      if (a === undefined || b === undefined || ta === undefined || tb === undefined) continue;
      const mu = (a[0] + b[0]) / 2 - cu;
      const mv = (a[1] + b[1]) / 2 - cv;
      const nx = mu * c - mv * s;
      const ny = mu * s + mv * c;
      if (nx + ny <= 1e-6) continue;
      const light = (nx - ny) / Math.hypot(nx, ny);
      const col = light > 0.35 ? shade(side, 0.28) : light < -0.35 ? lit(side, 0.06) : shade(side, 0.1);
      fan(g, col, [at(a[0], a[1], z0), at(b[0], b[1], z0), at(tb[0], tb[1], z1), at(ta[0], ta[1], z1)]);
    }
    if (roof !== null) fan(g, roof, top.map(([u, v]) => at(u, v, z1)));
  };
  const hl = CAR_HALF_LENGTH;
  const hw = CAR_HALF_WIDTH;
  g.clear();
  const wheels = (side: number): void => {
    for (const u of [-hl + 0.3, hl - 0.28]) {
      const w = at(u, side * (hw - 0.02), 3.4);
      g.fillStyle(TYRE, 1);
      g.fillEllipse(w.x, w.y, 10 * ART_SCALE, 9 * ART_SCALE);
      g.fillStyle(RIM, 1);
      g.fillEllipse(w.x, w.y, 5.2 * ART_SCALE, 4.6 * ART_SCALE);
      g.fillStyle(mix(RIM, TYRE, 0.55), 1);
      g.fillEllipse(w.x, w.y, 1.8 * ART_SCALE, 1.6 * ART_SCALE);
    }
  };
  // The side of the car facing the camera: its wheels sit over the sill, half hidden by the body like wheel arches.
  const nearSide = c - s > 0 ? 1 : -1;
  g.fillStyle(0x1e1426, 0.22);
  g.fillEllipse(0, 3 * ART_SCALE, 72 * ART_SCALE, 32 * ART_SCALE);
  wheels(-nearSide);
  const sill = rounded(-hl + 0.04, -hw + 0.04, hl - 0.04, hw - 0.04, 0.14);
  solid(sill, sill, 2.2, 4, TRIM, null);
  wheels(nearSide);
  const body = rounded(-hl, -hw, hl, hw, 0.2);
  const shoulder = rounded(-hl + 0.03, -hw + 0.03, hl - 0.05, hw - 0.03, 0.22);
  solid(body, shoulder, 4, 10.5, color, lit(color, 0.22));
  // Sheen along the bonnet and the boot lid.
  fan(g, lit(color, 0.45), [at(hl - 0.36, -0.08, 10.5), at(hl - 0.1, -0.06, 10.5), at(hl - 0.1, 0.06, 10.5), at(hl - 0.36, 0.08, 10.5)], 0.6);
  // The glass cabin: a long, low greenhouse that slopes front and back, with a body-coloured roof.
  const cabinBase: UV[] = [[-0.46, -hw + 0.07], [0.3, -hw + 0.07], [0.3, hw - 0.07], [-0.46, hw - 0.07]];
  const cabinTop: UV[] = [[-0.3, -hw + 0.12], [0.08, -hw + 0.12], [0.08, hw - 0.12], [-0.3, hw - 0.12]];
  solid(cabinBase, cabinTop, 10.5, 17, occupied ? mix(GLASS, 0x000000, 0.35) : GLASS, shade(color, 0.04));
  fan(g, lit(color, 0.35), [at(-0.26, -0.12, 17), at(0.02, -0.12, 17), at(0.02, 0.12, 17), at(-0.26, 0.12, 17)], 0.5);
  // A streak of reflected sky across the glass on the camera's side.
  fan(g, GLASS_LIT, [at(-0.2, nearSide * (hw - 0.07), 11.5), at(0.05, nearSide * (hw - 0.07), 11.5), at(-0.05, nearSide * (hw - 0.11), 15.5), at(-0.26, nearSide * (hw - 0.11), 15.5)], 0.55);
  // Beltline trim along the side facing the camera, and the mirrors.
  const beltA = at(-hl + 0.22, nearSide * hw, 9.6);
  const beltB = at(hl - 0.24, nearSide * hw, 9.6);
  g.lineStyle(0.9 * ART_SCALE, TRIM, 0.6);
  g.lineBetween(beltA.x, beltA.y, beltB.x, beltB.y);
  for (const v of [-hw, hw]) {
    const m = at(0.3, v * 1.08, 11.2);
    g.fillStyle(shade(color, 0.2), 1);
    g.fillEllipse(m.x, m.y, 3 * ART_SCALE, 2 * ART_SCALE);
  }
  // LED strips on whichever end faces the camera: a white bar in front, a red bar behind.
  const frontShows = c + s > 0;
  const end = frontShows ? hl : -hl;
  const l = at(end, -hw + 0.08, 8.4);
  const r = at(end, hw - 0.08, 8.4);
  g.lineStyle(1.8 * ART_SCALE, frontShows ? LED : TAIL, 1);
  g.lineBetween(l.x, l.y, r.x, r.y);
  g.fillStyle(frontShows ? LED : TAIL, 0.28);
  g.fillCircle(l.x, l.y, 3.2 * ART_SCALE);
  g.fillCircle(r.x, r.y, 3.2 * ART_SCALE);
}
