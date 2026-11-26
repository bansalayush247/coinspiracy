// Which way a walker shows on screen: toward the right or the left, and toward the camera or away from it, so
// someone walking up the screen is seen from behind instead of side-stepping in profile.

/** A walker's on-screen pose. */
export interface Pose {
  facing: 1 | -1;
  back: boolean;
}

// Screen pixels a walker must move in a frame before turning, so a standing figure never flickers.
const TURN_PX = 0.2;

/** Turns a walker toward this frame's screen motion; true when its drawing has to change. */
export function turnToward(pose: Pose, dx: number, dy: number): boolean {
  let changed = false;
  if (Math.abs(dx) > TURN_PX) {
    const facing = dx > 0 ? 1 : -1;
    if (facing !== pose.facing) {
      pose.facing = facing;
      changed = true;
    }
  }
  // Screen height is half the width in this projection, so half the threshold for the same world distance.
  if (Math.abs(dy) > TURN_PX / 2) {
    const back = dy < 0;
    if (back !== pose.back) {
      pose.back = back;
      changed = true;
    }
  }
  return changed;
}

/** The pose for a world-space heading in radians, for figures the server turns. */
export function poseOf(heading: number): Pose {
  const dx = Math.cos(heading) - Math.sin(heading);
  const dy = (Math.cos(heading) + Math.sin(heading)) / 2;
  return { facing: dx >= 0 ? 1 : -1, back: dy < -1e-9 };
}
