import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK } from '@byzantine-council/shared/economy';
import { dress, type Dressable } from '../src/hub/look.js';

const bare = (): Dressable => ({ hat: '', shades: '', outfit: '', hair: '', dye: '', beard: '', board: '' });

describe('dressing a synced guardian', () => {
  it('copies every part of a look, with empty slots as nothing', () => {
    const player = bare();
    dress(player, { ...DEFAULT_LOOK, hat: 'hat:cap', hair: 'hair:curls', dye: 'dye:coral', beard: 'beard:trim', board: 'board:lime' });
    expect(player).toEqual({ hat: 'hat:cap', shades: '', outfit: DEFAULT_LOOK.outfit, hair: 'hair:curls', dye: 'dye:coral', beard: 'beard:trim', board: 'board:lime' });
  });

  it('only writes the fields that changed', () => {
    const writes: string[] = [];
    const fields = { ...bare(), hair: DEFAULT_LOOK.hair, dye: DEFAULT_LOOK.dye, outfit: DEFAULT_LOOK.outfit };
    const player = new Proxy(fields, {
      set(target, key, value: string) {
        writes.push(String(key));
        return Reflect.set(target, key, value);
      },
    });
    dress(player, { ...DEFAULT_LOOK, shades: 'shades:classic' });
    expect(writes).toEqual(['shades']);
  });

  it('never puts an unknown item on', () => {
    const player = bare();
    dress(player, { ...DEFAULT_LOOK, hat: 'hat:crown' as never });
    expect(player.hat).toBe('');
  });
});
