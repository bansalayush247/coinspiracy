import { describe, expect, it } from 'vitest';
import { poseOf, turnToward, type Pose } from '../src/game/facing.js';
import { worldToScreen } from '../src/game/iso.js';

const screenMotion = (wx: number, wy: number): { dx: number; dy: number } => {
  const a = worldToScreen(10, 10);
  const b = worldToScreen(10 + wx * 0.05, 10 + wy * 0.05);
  return { dx: b.x - a.x, dy: b.y - a.y };
};

describe('walker poses', () => {
  it('shows the back when walking up the screen and the front when walking down, on every street direction', () => {
    const cases: [string, number, number, Pose][] = [
      ['up (world -y)', 0, -1, { facing: 1, back: true }],
      ['left (world -x)', -1, 0, { facing: -1, back: true }],
      ['down (world +y)', 0, 1, { facing: -1, back: false }],
      ['right (world +x)', 1, 0, { facing: 1, back: false }],
    ];
    for (const [label, wx, wy, want] of cases) {
      expect(poseOf(Math.atan2(wy, wx)), label).toStrictEqual(want);
      const pose: Pose = { facing: want.facing === 1 ? -1 : 1, back: !want.back };
      const { dx, dy } = screenMotion(wx, wy);
      expect(turnToward(pose, dx, dy), label).toBe(true);
      expect(pose, label).toStrictEqual(want);
    }
  });

  it('keeps its pose while standing or barely moving, so a still figure never flickers', () => {
    const pose: Pose = { facing: -1, back: true };
    expect(turnToward(pose, 0, 0)).toBe(false);
    expect(turnToward(pose, 0.15, 0.05)).toBe(false);
    expect(pose).toStrictEqual({ facing: -1, back: true });
  });

  it('turns only the part that changed: walking straight across the screen keeps front or back', () => {
    const pose: Pose = { facing: -1, back: true };
    expect(turnToward(pose, 5, 0)).toBe(true);
    expect(pose).toStrictEqual({ facing: 1, back: true });
    expect(turnToward(pose, 5, 0)).toBe(false);
  });
});
