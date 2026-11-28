// The room a guardian is inside: its floor and back walls under everyone, its furniture sorted in among the people,
// and the low front walls over them. Drawn once at the rooms' place far off the city map; it keeps no game state.
import Phaser from 'phaser';
import { INTERIOR_ORIGIN, toWorld, type RoomKind, type RoomLayout } from '@byzantine-council/shared/city';
import { worldToScreen } from '../game/iso.js';
import { drawPiece, drawRoomShell, pieceFront } from './interiorArt.js';

export class InteriorView {
  readonly #parts: Phaser.GameObjects.Graphics[] = [];

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
  }

  destroy(): void {
    for (const g of this.#parts) g.destroy();
    this.#parts.length = 0;
  }
}
