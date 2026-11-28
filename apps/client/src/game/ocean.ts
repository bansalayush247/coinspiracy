import type Phaser from 'phaser';
import { hex, rng } from './groundPaint.js';

/** Continues the sea past the map so the zoomed-out camera never exposes the texture boundary. */
export function addOcean(scene: Phaser.Scene, key: string, color: number): Phaser.GameObjects.TileSprite {
  scene.cameras.main.setBackgroundColor(color);
  if (!scene.textures.exists(key)) {
    const size = 384;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('no 2d canvas');
    ctx.fillStyle = hex(color);
    ctx.fillRect(0, 0, size, size);
    const rand = rng(671);
    for (let i = 0; i < 62; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const width = 8 + rand() * 38;
      ctx.strokeStyle = `rgba(192,235,244,${0.03 + rand() * 0.08})`;
      ctx.lineWidth = 1 + rand();
      for (const offset of [0, -size]) {
        ctx.beginPath();
        ctx.moveTo(x + offset, y);
        ctx.quadraticCurveTo(x + offset + width * 0.52, y - 1.2, x + offset + width, y + 1);
        ctx.stroke();
      }
    }
    scene.textures.addCanvas(key, canvas);
  }
  return scene.add.tileSprite(0, 0, 1, 1, key).setOrigin(0).setDepth(-20);
}

export function fitOcean(ocean: Phaser.GameObjects.TileSprite, camera: Phaser.Cameras.Scene2D.Camera): void {
  const width = camera.width / camera.zoom;
  const height = camera.height / camera.zoom;
  const x = camera.scrollX + (camera.width - width) / 2 - 120;
  const y = camera.scrollY + (camera.height - height) / 2 - 120;
  ocean.setPosition(x, y).setSize(width + 240, height + 240);
  ocean.tilePositionX = x;
  ocean.tilePositionY = y;
}
