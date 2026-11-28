import Phaser from 'phaser';
import { ART_SCALE, worldToScreen } from '../game/iso.js';
import { t } from '../i18n/index.js';
import { el } from '../ui/dom.js';
import { IslandFinds, type FindIsland, type IslandFind } from './islandFinds.js';

export const islandFinds = new IslandFinds();

export function findJournalOpen(): boolean {
  return el('finds-journal', HTMLDialogElement).open;
}

export function openFindJournal(island: FindIsland, rank: number, onClose: () => void): void {
  const journal = el('finds-journal', HTMLDialogElement);
  if (journal.open) return;
  const entries = islandFinds.entries(island);
  const list = el('finds-list', HTMLOListElement);
  list.replaceChildren();
  for (const find of entries) {
    const found = islandFinds.has(find);
    const unlocked = found || find.rank <= rank;
    const item = document.createElement('li');
    item.classList.toggle('found', found);
    const title = document.createElement('b');
    title.textContent = found ? find.name : unlocked ? t('finds.clue') : t('finds.locked', { rank: find.rank });
    item.append(title);
    if (unlocked && !found) {
      const clue = document.createElement('span');
      clue.textContent = find.clue;
      item.append(clue);
    }
    list.append(item);
  }
  el('finds-count', HTMLParagraphElement).textContent = t('finds.count', {
    found: entries.filter((find) => islandFinds.has(find)).length, total: entries.length,
  });
  journal.addEventListener('close', onClose, { once: true });
  journal.showModal();
}

export function findSparkle(graphics: Phaser.GameObjects.Graphics, find: IslandFind | null): void {
  graphics.setVisible(find !== null);
  if (find === null) return;
  const at = worldToScreen(find.at.x, find.at.y);
  graphics.setPosition(at.x, at.y - 15 * ART_SCALE);
  if (graphics.commandBuffer.length > 0) return;
  const points = [[0, -10], [3, -3], [8, 0], [3, 3], [0, 10], [-3, 3], [-8, 0], [-3, -3]]
    .map(([x = 0, y = 0]) => new Phaser.Math.Vector2(x * ART_SCALE, y * ART_SCALE));
  graphics.fillStyle(0xffdd8b, 0.22).fillEllipse(0, 20, 36 * ART_SCALE, 10 * ART_SCALE);
  graphics.fillStyle(0xfff5cd, 1).fillPoints(points, true);
}
