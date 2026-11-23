import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLOSE_CODES } from '@byzantine-council/shared';
import { leaveCode, quickMatch, sdk, startServer, waitFor } from './helpers.js';

const PORT = 3863;
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await startServer(PORT, { idleKickMs: 300 }));
});

afterAll(async () => {
  await colyseus.shutdown();
});

describe('idle players', () => {
  it('removes a player who sends nothing, and keeps one who keeps moving', async () => {
    const idle = await quickMatch(sdk(PORT), { nickname: 'Sleepy' });
    const busy = await quickMatch(sdk(PORT), { nickname: 'Busy' });
    await waitFor(() => busy.state.players.size === 2, 'synced');
    const idleCode = leaveCode(idle);
    let seq = 0;
    const timer = setInterval(() => {
      seq += 1;
      busy.send('move', { seq, dx: seq % 2 === 0 ? 1 : -1, dy: 0 });
    }, 50);
    try {
      expect(await idleCode).toBe(CLOSE_CODES.IDLE);
      await waitFor(() => busy.state.players.size === 1, 'idle player removed', 8000);
      expect(busy.connection.isOpen).toBe(true);
    } finally {
      clearInterval(timer);
    }
  });
});
