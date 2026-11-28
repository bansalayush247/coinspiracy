import { describe, expect, it } from 'vitest';
import { COSMETIC_IDS, getItem } from '@byzantine-council/shared/economy';
import { drawGuardian, NO_WEAR, type Wear } from '../src/game/guardianArt.js';
import type { Pen } from '../src/game/pen.js';
import { seatColors } from '../src/game/palette.js';

// A Pen that writes every call down, so two drawings can be compared exactly.
function record(wear: Wear, facing: 1 | -1 = 1, back = false): string[] {
  const log: string[] = [];
  const pen = new Proxy({} as Pen, {
    get: (_, name) => (...args: unknown[]) => {
      log.push(`${String(name)}(${args.join(',')})`);
    },
  });
  drawGuardian(pen, seatColors(2), facing, wear, back, { face: 'happy', blink: false, talk: true });
  return log;
}

const ids = (category: string): string[] => COSMETIC_IDS.filter((id) => getItem(id)?.category === category);
const HAIRS = ids('hair').filter((id) => id !== 'hair:hood');

describe('guardian cosmetics', () => {
  it('draws the hood-up default exactly as before for every way of leaving hair, dye, beard and board unset', () => {
    for (const facing of [1, -1] as const) {
      for (const back of [false, true]) {
        const plain = record(NO_WEAR, facing, back);
        for (const wear of [{ hair: '' }, { hair: 'hair:hood' }, { hair: 'hair:hood', dye: 'dye:coral' }, { beard: '', board: '' }, { hair: 'hat:cap', beard: 'board:lime', board: 'beard:trim' }]) {
          expect(record({ ...NO_WEAR, ...wear }, facing, back)).toEqual(plain);
        }
      }
    }
  });

  it('gives every hair style its own look from the front and from behind', () => {
    for (const back of [false, true]) {
      const looks = new Set([record(NO_WEAR, 1, back).join(';'), ...HAIRS.map((hair) => record({ ...NO_WEAR, hair }, 1, back).join(';'))]);
      expect(looks.size).toBe(HAIRS.length + 1);
    }
  });

  it('colours hair and beard by the worn dye', () => {
    for (const style of [{ hair: 'hair:curls' }, { beard: 'beard:trim' }]) {
      const looks = new Set(ids('dye').map((dye) => record({ ...NO_WEAR, ...style, dye }).join(';')));
      expect(looks.size).toBe(ids('dye').length);
    }
  });

  it('draws every board and the beard, mirrored with facing, and only finite coordinates', () => {
    for (const board of ids('board')) {
      for (const back of [false, true]) {
        const right = record({ ...NO_WEAR, board, beard: 'beard:trim', hair: 'hair:long' }, 1, back);
        expect(right).not.toEqual(record({ ...NO_WEAR, hair: 'hair:long' }, 1, back));
        expect(right).not.toEqual(record({ ...NO_WEAR, board, beard: 'beard:trim', hair: 'hair:long' }, -1, back));
        expect(right.join(';')).not.toMatch(/NaN|Infinity/);
      }
    }
  });
});
