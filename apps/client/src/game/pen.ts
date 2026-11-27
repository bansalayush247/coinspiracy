/** The drawing calls the game's character art makes: a Phaser Graphics object, or an SVG pen for portraits. */
export interface Pen {
  clear(): unknown;
  fillStyle(color: number, alpha?: number): unknown;
  lineStyle(width: number, color: number, alpha?: number): unknown;
  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): unknown;
  fillEllipse(x: number, y: number, width: number, height: number, smoothness?: number): unknown;
  strokeEllipse(x: number, y: number, width: number, height: number, smoothness?: number): unknown;
  strokeCircle(x: number, y: number, radius: number): unknown;
  lineBetween(x0: number, y0: number, x1: number, y1: number): unknown;
  beginPath(): unknown;
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  closePath(): unknown;
  fillPath(): unknown;
  strokePath(): unknown;
}
