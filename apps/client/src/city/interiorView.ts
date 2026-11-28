// The room a guardian is inside: its floor and back walls under everyone, its furniture sorted in among the people,
// and the low front walls over them. Drawn once at the rooms' place far off the city map; it keeps no game state.
import Phaser from 'phaser';
import { INTERIOR_ORIGIN, toWorld, type RoomKind, type RoomLayout, type RoomSpot } from '@byzantine-council/shared/city';
import { TILE_H, TILE_W, worldToScreen } from '../game/iso.js';
import { drawPiece, drawRoomShell, pieceFront } from './interiorArt.js';

const SPOT_GOLD = 0xffd36b;

// A spot's floor tile, a soft gold diamond, brighter with a rim while the guardian is close enough to use it.
function drawSpot(g: Phaser.GameObjects.Graphics, spot: RoomSpot, near: boolean): void {
  const x = (spot.c - spot.r) * (TILE_W / 2);
  const y = (spot.c + spot.r) * (TILE_H / 2);
  const inset = 0.14;
  const pts = [
    { x, y: y + TILE_H * inset },
    { x: x + (TILE_W / 2) * (1 - inset * 2), y: y + TILE_H / 2 },
    { x, y: y + TILE_H * (1 - inset) },
    { x: x - (TILE_W / 2) * (1 - inset * 2), y: y + TILE_H / 2 },
  ];
  const trace = (): void => {
    g.beginPath();
    pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.closePath();
  };
  g.fillStyle(SPOT_GOLD, near ? 0.45 : 0.28);
  trace();
  g.fillPath();
  g.lineStyle(near ? 3 : 2, SPOT_GOLD, near ? 1 : 0.7);
  trace();
  g.strokePath();
}

export class InteriorView {
  readonly #parts: Phaser.GameObjects.Graphics[] = [];
  readonly #spots: { readonly spot: RoomSpot; readonly g: Phaser.GameObjects.Graphics }[] = [];
  #marked: RoomSpot | null = null;

  constructor(scene: Phaser.Scene, ground: Phaser.GameObjects.Layer, entities: Phaser.GameObjects.Layer, layout: RoomLayout, room: RoomKind, seed: number, depthOf: (x: number, y: number) => number) {
    const at = worldToScreen(INTERIOR_ORIGIN.x, INTERIOR_ORIGIN.y);
    const make = (): Phaser.GameObjects.Graphics => {
      const g = new Phaser.GameObjects.Graphics(scene).setPosition(at.x, at.y);
      this.#parts.push(g);
      return g;
    };
    const floor = make();
    const back = make();
    const front = make();
    drawRoomShell(floor, back, front, layout, room, seed);
    ground.add([floor, back]);
    for (const spot of layout.spots) {
      const g = make();
      drawSpot(g, spot, false);
      this.#spots.push({ spot, g });
    }
    const corner = toWorld({ x: layout.w, y: layout.d });
    entities.add(front.setDepth(depthOf(corner.x, corner.y) + 1));
    for (const f of layout.furniture) {
      const g = make();
      drawPiece(g, f, layout, room, seed);
      if (f.piece === 'rug') {
        ground.add(g);
        continue;
      }
      const p = toWorld(pieceFront(f, layout));
      entities.add(g.setDepth(depthOf(p.x, p.y)));
    }
    ground.add(this.#spots.map((s) => s.g));
  }

  /** Lights up the spot the guardian is close enough to use; null lights none. */
  mark(spot: RoomSpot | null): void {
    if (spot === this.#marked) return;
    this.#marked = spot;
    for (const s of this.#spots) {
      s.g.clear();
      drawSpot(s.g, s.spot, s.spot === spot);
    }
  }

  destroy(): void {
    for (const g of this.#parts) g.destroy();
    this.#parts.length = 0;
    this.#spots.length = 0;
  }
}
