// The Forgotten Password's own rules: Kit waits at his flat while the crew visits the brothers' three places; each
// one plays its memory, and the last one sends everyone home to guess.
import { KIT_FLAT, MEMORIES, MEMORY_NOTES, MissionNpc } from '@byzantine-council/shared/city';
import { workedCount, type ActContext, type ActRules } from './rules.js';

export class PasswordRules implements ActRules {
  setup(ctx: ActContext): void {
    ctx.state.npcs.set('kit', new MissionNpc({ kind: 'kit', x: KIT_FLAT.x + 1.1, y: KIT_FLAT.y - 0.4 }));
  }

  worked(ctx: ActContext, spot: number): string {
    if (workedCount(ctx) >= MEMORIES.length) ctx.mark('allMemories');
    return MEMORY_NOTES[spot] ?? '';
  }
}
