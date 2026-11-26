import { Decoder, Encoder, StateView, type Iterator } from '@colyseus/schema';
import { describe, expect, it } from 'vitest';
import { CLOSE_CODES } from '../src/protocol.js';
import { CitadelState, PlayerState, VIEW_TAGS } from '../src/state.js';

// Same steps as Colyseus SchemaSerializer: shared bytes, then the per-view bytes.
function fullStateFor(encoder: Encoder, view: StateView): Uint8Array {
  const shared = encoder.encodeAll({ offset: 0 }).slice();
  encoder.sharedBuffer.set(shared);
  return encoder.encodeAllView(view, shared.byteLength, { offset: shared.byteLength }).slice();
}

function patchFor(encoder: Encoder, views: readonly StateView[]): Uint8Array[] {
  const it: Iterator = { offset: 0 };
  encoder.encode(it);
  const sharedOffset = it.offset;
  const out = views.map((view) => encoder.encodeView(view, sharedOffset, it).slice());
  encoder.discardChanges();
  return out;
}

function setup() {
  const state = new CitadelState();
  const encoder = new Encoder(state);
  const a = new PlayerState({ name: 'Ava', seat: 0, x: 15, y: 12.8 });
  const b = new PlayerState({ name: 'Ben', seat: 1, x: 16.4, y: 13.3 });
  a.ack = 0;
  b.ack = 0;
  state.players.set('A', a);
  state.players.set('B', b);
  const viewA = new StateView();
  const viewB = new StateView();
  viewA.add(a, VIEW_TAGS.OWNER);
  viewB.add(b, VIEW_TAGS.OWNER);
  const clientA = new CitadelState();
  const clientB = new CitadelState();
  const decA = new Decoder(clientA);
  const decB = new Decoder(clientB);
  decA.decode(fullStateFor(encoder, viewA));
  decB.decode(fullStateFor(encoder, viewB));
  encoder.discardChanges();
  return { state, encoder, a, b, viewA, viewB, clientA, clientB, decA, decB };
}

describe('CitadelState sync', () => {
  it('sends each player their own ack and nobody else’s', () => {
    const { clientA, clientB } = setup();
    expect(clientA.players.get('A')?.ack).toBe(0);
    expect(clientA.players.get('B')?.ack).toBeUndefined();
    expect(clientB.players.get('B')?.ack).toBe(0);
    expect(clientB.players.get('A')?.ack).toBeUndefined();
  });

  it('keeps acks private in patches while positions stay public', () => {
    const { encoder, a, viewA, viewB, clientA, clientB, decA, decB } = setup();
    a.x = 15.175;
    a.ack = 41;
    const [pa, pb] = patchFor(encoder, [viewA, viewB]);
    if (pa === undefined || pb === undefined) throw new Error('missing patch');
    decA.decode(pa);
    decB.decode(pb);
    expect(clientA.players.get('A')?.ack).toBe(41);
    expect(clientB.players.get('A')?.ack).toBeUndefined();
    expect(clientB.players.get('A')?.x).toBe(15.175);
  });

  it('decodes positions exactly, so prediction can replay from them', () => {
    const { encoder, a, viewA, viewB, clientA, clientB, decA, decB } = setup();
    a.x = 15 + 0.1 + 0.2; // not representable in float32
    a.y = 12.8 + 1 / 3;
    const [pa, pb] = patchFor(encoder, [viewA, viewB]);
    if (pa === undefined || pb === undefined) throw new Error('missing patch');
    decA.decode(pa);
    decB.decode(pb);
    expect(clientA.players.get('A')?.x).toBe(a.x);
    expect(clientA.players.get('A')?.y).toBe(a.y);
    expect(clientB.players.get('A')?.y).toBe(a.y);
  });

  it('syncs the room code, privacy flag and host to everyone', () => {
    const { state, encoder, viewA, viewB, clientA, clientB, decA, decB } = setup();
    state.code = 'K7QX9M';
    state.isPrivate = true;
    state.hostId = 'A';
    const [pa, pb] = patchFor(encoder, [viewA, viewB]);
    if (pa === undefined || pb === undefined) throw new Error('missing patch');
    decA.decode(pa);
    decB.decode(pb);
    for (const client of [clientA, clientB]) {
      expect(client.code).toBe('K7QX9M');
      expect(client.isPrivate).toBe(true);
      expect(client.hostId).toBe('A');
      expect(client.phase).toBe('lobby');
    }
  });

  it('starts players active with no ack until the server sets one', () => {
    const player = new PlayerState();
    expect(player.status).toBe('active');
    expect(player.ack).toBeUndefined();
    expect(player.x).toBe(0);
  });
});

// Three players: Ava honest, Ben and Cy Byzantine, each with the views the server builds.
function matchSetup() {
  const state = new CitadelState();
  const encoder = new Encoder(state);
  const ids = ['A', 'B', 'C'] as const;
  const roles = { A: 'honest', B: 'byzantine', C: 'byzantine' } as const;
  const players = ids.map((id, seat) => {
    const p = new PlayerState({ name: id, seat, x: 15, y: 13 + seat });
    p.ack = 0;
    state.players.set(id, p);
    return p;
  });
  const views = players.map((p) => {
    const view = new StateView();
    view.add(p, VIEW_TAGS.OWNER);
    return view;
  });
  const clients = ids.map(() => new CitadelState());
  const decoders = clients.map((c) => new Decoder(c));
  decoders.forEach((d, i) => {
    const view = views[i];
    if (view !== undefined) d.decode(fullStateFor(encoder, view));
  });
  encoder.discardChanges();
  // Match start, as the room does it: roles and tasks set, then tags granted.
  ids.forEach((id, i) => {
    const p = players[i];
    if (p === undefined) return;
    p.role = roles[id];
    p.tasks = 15;
    p.tasksDone = 0;
  });
  ids.forEach((id, i) => {
    const view = views[i];
    const own = players[i];
    if (view === undefined || own === undefined) return;
    view.add(own, VIEW_TAGS.ROLE);
    if (roles[id] === 'byzantine') {
      ids.forEach((other, j) => {
        const p = players[j];
        if (other !== id && roles[other] === 'byzantine' && p !== undefined) view.add(p, VIEW_TAGS.ROLE);
      });
    }
  });
  const sync = (): void => {
    const patches = patchFor(encoder, views);
    patches.forEach((patch, i) => decoders[i]?.decode(patch));
  };
  sync();
  const seen = (viewer: number, id: string) => clients[viewer]?.players.get(id);
  return { state, players, views, sync, seen };
}

describe('hidden roles', () => {
  it('shows an honest guardian only their own role', () => {
    const { seen } = matchSetup();
    expect(seen(0, 'A')?.role).toBe('honest');
    expect(seen(0, 'B')?.role).toBeUndefined();
    expect(seen(0, 'C')?.role).toBeUndefined();
  });

  it('shows Byzantines each other, but not the honest guardian', () => {
    const { seen } = matchSetup();
    expect(seen(1, 'B')?.role).toBe('byzantine');
    expect(seen(1, 'C')?.role).toBe('byzantine');
    expect(seen(1, 'A')?.role).toBeUndefined();
    expect(seen(2, 'B')?.role).toBe('byzantine');
  });

  it('keeps task progress and acks owner-only, even between Byzantines', () => {
    const { players, sync, seen } = matchSetup();
    const c = players[2];
    if (c === undefined) throw new Error('missing player');
    c.tasksDone = 4;
    c.ack = 9;
    sync();
    expect(seen(2, 'C')?.tasksDone).toBe(4);
    expect(seen(2, 'C')?.tasks).toBe(15);
    expect(seen(1, 'C')?.tasksDone).toBeUndefined();
    expect(seen(1, 'C')?.tasks).toBeUndefined();
    expect(seen(1, 'C')?.ack).toBeUndefined();
    expect(seen(0, 'C')?.tasksDone).toBeUndefined();
  });

  it('reveals every role once the match ends, then clears them all for the lobby', () => {
    const { players, views, sync, seen } = matchSetup();
    for (const view of views) for (const p of players) view.add(p, VIEW_TAGS.ROLE);
    sync();
    expect(seen(0, 'B')?.role).toBe('byzantine');
    expect(seen(0, 'C')?.role).toBe('byzantine');
    expect(seen(1, 'A')?.role).toBe('honest');

    for (const view of views) for (const p of players) if (view.hasTag(p, VIEW_TAGS.ROLE)) view.remove(p, VIEW_TAGS.ROLE);
    for (const p of players) {
      p.role = undefined;
      p.tasks = undefined;
      p.tasksDone = undefined;
    }
    sync();
    for (let viewer = 0; viewer < 3; viewer++) {
      for (const id of ['A', 'B', 'C']) {
        expect(seen(viewer, id)?.role).toBeUndefined();
        expect(seen(viewer, id)?.tasks).toBeUndefined();
      }
      // Removing the role tag leaves the player itself visible.
      expect(seen(viewer, 'A')?.name).toBe('A');
    }
  });

  it('starts the room with no winner, no consensus and no chain height', () => {
    const state = new CitadelState();
    expect(state.consensus).toBe(0);
    expect(state.winner).toBe('');
    expect(state.blockHeight).toBe(0);
    expect(state.chainLive).toBe(false);
    expect(new PlayerState().role).toBeUndefined();
  });
});

describe('CLOSE_CODES', () => {
  it('keeps app codes clear of the range Colyseus reserves', () => {
    for (const code of Object.values(CLOSE_CODES)) {
      expect(code).toBeGreaterThan(4010);
      expect(code).toBeLessThanOrEqual(4999);
    }
  });
});
