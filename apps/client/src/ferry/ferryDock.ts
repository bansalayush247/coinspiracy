// The ferry stop on each island: the ferry moored at the dock, a sign post and a ring on the boards where it boards,
// the "Ferry to" button in the HUD, and the stop's mark on the city minimap.
import Phaser from 'phaser';
import type { Vec2 } from '@byzantine-council/shared';
import { CITY_HEIGHT, FERRY_TUNING, atFerryStop, ferryDestination, type FerryIsland } from '@byzantine-council/shared/city';
import { drawShip } from '../city/shipArt.js';
import { ART_SCALE, TILE_H, TILE_W, isoDepth, worldToScreen } from '../game/iso.js';
import { t } from '../i18n/index.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const RING = 0x8fd3ff;

/** Draws the moored ferry, its sign and its boarding ring; `depthOf` sorts them among the island's other things. */
export function drawFerryDock(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, island: FerryIsland, depthOf: (x: number, y: number) => number, reduced: boolean): void {
  const stop = FERRY_TUNING.stops[island];
  const at = worldToScreen(stop.ship.x, stop.ship.y);
  const along = stop.ship.heading === 'e' || stop.ship.heading === 'w';
  const back = { x: stop.ship.x - (along ? FERRY_TUNING.hull.length : FERRY_TUNING.hull.beam) / 2, y: stop.ship.y - (along ? FERRY_TUNING.hull.beam : FERRY_TUNING.hull.length) / 2 };
  const ship = scene.add.graphics().setPosition(at.x, at.y).setDepth(depthOf(back.x, back.y));
  drawShip(ship, 'ferry', stop.ship.heading, stop.ship.seed);
  layer.add(ship);
  if (!reduced) scene.tweens.add({ targets: ship, y: at.y + 1.6 * ART_SCALE, duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  const spot = worldToScreen(stop.at.x, stop.at.y);
  const ring = scene.add.graphics().setPosition(spot.x, spot.y).setDepth(isoDepth(stop.at.x, stop.at.y) - TILE_H);
  const w = FERRY_TUNING.reach * TILE_W * Math.SQRT2;
  ring.fillStyle(RING, 0.18);
  ring.fillEllipse(0, 0, w, w / 2, 40);
  ring.lineStyle(3 * ART_SCALE, RING, 0.85);
  ring.strokeEllipse(0, 0, w, w / 2, 40);
  layer.add(ring);
  const post = worldToScreen(stop.sign.x, stop.sign.y);
  const sign = scene.add.graphics().setPosition(post.x, post.y).setDepth(depthOf(stop.sign.x, stop.sign.y));
  drawSign(sign);
  layer.add(sign);
  const label = scene.add
    .text(post.x, post.y - 108 * ART_SCALE, t('ferry.sign').toUpperCase(), { fontFamily: FONT, fontSize: '20px', fontStyle: '900', color: '#2a1a33', resolution: 2 })
    .setOrigin(0.5)
    .setDepth(depthOf(stop.sign.x, stop.sign.y) + 1);
  if (label.width > 66 * ART_SCALE) label.setScale((66 * ART_SCALE) / label.width);
  layer.add(label);
}

// A post with a blue board: the word on top, a little white ferry under it.
function drawSign(g: Phaser.GameObjects.Graphics): void {
  const s = ART_SCALE;
  g.fillStyle(0x2a1a33, 0.25);
  g.fillEllipse(4 * s, 2 * s, 22 * s, 8 * s);
  g.fillStyle(0x5a4636, 1);
  g.fillRect(-2.5 * s, -74 * s, 5 * s, 74 * s);
  g.fillStyle(0x2a1a33, 1);
  g.fillRoundedRect(-38 * s, -122 * s, 76 * s, 50 * s, 6 * s);
  g.fillStyle(RING, 1);
  g.fillRoundedRect(-35 * s, -119 * s, 70 * s, 44 * s, 5 * s);
  g.fillStyle(0x2c5a8a, 1);
  g.fillRect(-30 * s, -80 * s, 60 * s, 2.5 * s);
  g.fillStyle(0xfff6e6, 1);
  g.fillTriangle(-20 * s, -88 * s, 22 * s, -88 * s, 15 * s, -81 * s);
  g.fillTriangle(-20 * s, -88 * s, 15 * s, -81 * s, -16 * s, -81 * s);
  g.fillRect(-13 * s, -94 * s, 23 * s, 6 * s);
  g.fillStyle(0x2c5a8a, 1);
  for (let i = 0; i < 4; i++) g.fillRect((-10 + i * 5.5) * s, -92.5 * s, 2.5 * s, 2.5 * s);
  g.fillStyle(0xe0574b, 1);
  g.fillRect(-7 * s, -99 * s, 4.5 * s, 5 * s);
}

/** The "Ferry to …" HUD button for one island: shown while a guardian on foot stands at the stop. */
export class FerryButton {
  readonly #to: FerryIsland;

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly island: FerryIsland,
    onBoard: () => void,
  ) {
    this.#to = ferryDestination(island);
    button.addEventListener('click', () => {
      if (!button.hidden) onBoard();
    });
  }

  /** Whether the button is showing, so E boards the ferry. */
  get shown(): boolean {
    return !this.button.hidden;
  }

  /** Shows the button at the stop when the guardian can board; `open` says whether the other island is open to them. */
  update(pos: Vec2 | null, canBoard: boolean, open: boolean): void {
    const here = canBoard && pos !== null && atFerryStop(this.island, pos);
    this.button.hidden = !here;
    if (!here) return;
    const label = t(this.#to === 'beach' ? 'ferry.toBeach' : 'ferry.toCity');
    if (this.button.firstChild?.textContent !== label) this.button.firstChild?.replaceWith(document.createTextNode(label));
    const small = this.button.querySelector('small');
    const hint = open ? t('ferry.board') : t('ferry.lockedKey');
    if (small !== null && small.textContent !== hint) small.textContent = hint;
    this.button.classList.toggle('locked', !open);
  }

  /** Hides the button, as on leaving the island. */
  hide(): void {
    this.button.hidden = true;
  }
}

/** Marks the city's ferry stop on the minimap: a blue boat-shaped badge on the seafront. */
export function markFerryOnMinimap(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const p = FERRY_TUNING.stops.city.at;
  const x = p.x - p.y + CITY_HEIGHT;
  const y = (p.x + p.y) / 2;
  ctx.fillStyle = '#2a1a33';
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8fd3ff';
  ctx.beginPath();
  ctx.moveTo(x - 4.5, y - 0.5);
  ctx.lineTo(x + 4.5, y - 0.5);
  ctx.lineTo(x + 2.5, y + 3);
  ctx.lineTo(x - 2.5, y + 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x - 1.5, y - 3.5, 3, 3);
}
