// Runs a visit to Port Concord: the city room, the HUD, the minimap and district arrivals.
import { Callbacks } from '@colyseus/sdk';
import { CITY_HEIGHT, CITY_MAP, CITY_MESSAGES, CITY_WIDTH, districtAt, type CityPlayer, type DistrictId } from '@byzantine-council/shared/city';
import { EMOTES, EMOTE_GLYPHS, EmoteLineSchema, type Emote } from '@byzantine-council/shared/hub';
import { audio } from '../audio/engine.js';
import type { PlayerInput } from '../game/input.js';
import type { Session } from '../net/session.js';
import { el, h } from '../ui/dom.js';
import type { CityScene } from './CityScene.js';

type CityRoom = Awaited<ReturnType<Session['city']>>;

const MAP_COLORS: Readonly<Record<string, string>> = {
  '~': '#2b6a8a', '#': '#1d4a66', ':': '#5a5462', '=': '#b8845a', ',': '#8fb86a', d: '#9a8060', M: '#6a5a48',
  B: '#e9d9c4', T: '#4f8a4e', L: '#d2c8bc', C: '#c0503a', '.': '#cfc4b6',
};

export class CityController {
  readonly #hud = el('city-hud', HTMLElement);
  readonly #district = el('city-district', HTMLElement);
  readonly #was = el('city-was', HTMLParagraphElement);
  readonly #pop = el('city-pop', HTMLElement);
  readonly #dots = el('city-dots', HTMLCanvasElement);
  #room: CityRoom | null = null;
  #here: DistrictId | null = null;
  #poll = 0;
  onLeft: () => void = () => undefined;
  onToast: (text: string) => void = () => undefined;

  constructor(
    private readonly session: Session,
    private readonly scene: CityScene,
    private readonly input: PlayerInput,
  ) {
    paintMinimap(el('city-minimap', HTMLCanvasElement));
    el('city-leave', HTMLButtonElement).addEventListener('click', () => {
      void this.leave();
    });
    el('city-emotes', HTMLDivElement).replaceChildren(
      ...EMOTES.map((emote, i) => {
        const b = h('button', '', EMOTE_GLYPHS[emote]);
        b.type = 'button';
        b.setAttribute('aria-label', `${emote} (key ${String(i + 1)})`);
        b.addEventListener('click', () => {
          this.#emote(emote);
        });
        return b;
      }),
    );
    window.addEventListener('keydown', (e) => {
      if (this.#room === null || this.#hud.hidden) return;
      const n = Number(e.key);
      const emote = Number.isInteger(n) ? EMOTES[n - 1] : undefined;
      if (emote !== undefined) this.#emote(emote);
    });
  }

  get active(): boolean {
    return this.#room !== null;
  }

  async enter(nickname: string): Promise<void> {
    const room = await this.session.city(nickname);
    this.#room = room;
    this.scene.attach(room.sessionId, this.input, {
      get canSend() {
        return room.connection.isOpen;
      },
      send: (input) => {
        room.send('move', input);
      },
    });
    const callbacks = Callbacks.get(room);
    callbacks.onAdd('players', (player: CityPlayer, id: string) => {
      this.scene.addPlayer(id, player);
      callbacks.onChange(player, () => {
        this.scene.updatePlayer(id, player);
      });
    });
    callbacks.onRemove('players', (_p: CityPlayer, id: string) => {
      this.scene.removePlayer(id);
    });
    room.onMessage(CITY_MESSAGES.EMOTE, (payload: unknown) => {
      const line = EmoteLineSchema.safeParse(payload);
      if (line.success) this.scene.emote(line.data.from, EMOTE_GLYPHS[line.data.emote], line.data.emote);
    });
    room.onLeave(() => {
      this.#exit();
    });
    this.#hud.hidden = false;
    this.input.enabled = true;
    audio.setMood('beach');
    this.#poll = window.setInterval(() => {
      this.#render();
    }, 150);
    this.#render();
  }

  async leave(): Promise<void> {
    const room = this.#room;
    if (room === null) return;
    await room.leave().catch(() => undefined);
    this.#exit();
  }

  #exit(): void {
    if (this.#room === null) return;
    this.#room = null;
    window.clearInterval(this.#poll);
    this.scene.detach();
    this.#here = null;
    this.#hud.hidden = true;
    this.input.enabled = false;
    audio.setMood('menu');
    this.onLeft();
  }

  #render(): void {
    const room = this.#room;
    const pos = this.scene.predictedPosition();
    if (room === null || pos === null) return;
    const near = this.scene.others().length;
    const total = room.state.population;
    this.#pop.textContent = `${String(total)} in the city · ${String(near)} nearby`;
    const d = districtAt(pos);
    if (d !== null && d.id !== this.#here) {
      const first = this.#here === null;
      this.#here = d.id;
      this.#district.textContent = d.name;
      this.#was.textContent = d.was === 'new' ? 'A new part of the city' : `Once ${d.was}`;
      if (!first) {
        audio.play('chirp');
        this.onToast(`Entering ${d.name}`);
      }
    }
    drawDots(this.#dots, pos, this.scene.others());
  }

  #emote(emote: Emote): void {
    this.#room?.send('emote', { emote });
  }
}

// The minimap in the same diamond view as the game: each tile is a 2 x 1 pixel diamond.
const mapX = (c: number, r: number): number => c - r + CITY_HEIGHT;
const mapY = (c: number, r: number): number => (c + r) / 2;

function paintMinimap(canvas: HTMLCanvasElement): void {
  canvas.width = CITY_WIDTH + CITY_HEIGHT;
  canvas.height = (CITY_WIDTH + CITY_HEIGHT) / 2;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  for (let r = 0; r < CITY_HEIGHT; r++) {
    const row = CITY_MAP.rows[r] ?? '';
    for (let c = 0; c < CITY_WIDTH; c++) {
      ctx.fillStyle = MAP_COLORS[row[c] ?? '#'] ?? '#cfc4b6';
      ctx.fillRect(mapX(c, r) - 1, mapY(c, r), 2, 1);
    }
  }
}

function drawDots(canvas: HTMLCanvasElement, me: { x: number; y: number }, others: readonly { x: number; y: number }[]): void {
  canvas.width = CITY_WIDTH + CITY_HEIGHT;
  canvas.height = (CITY_WIDTH + CITY_HEIGHT) / 2;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  ctx.fillStyle = '#fff1de';
  for (const o of others) ctx.fillRect(mapX(o.x, o.y) - 1.5, mapY(o.x, o.y) - 1.5, 3, 3);
  ctx.fillStyle = '#2a1a33';
  ctx.beginPath();
  ctx.arc(mapX(me.x, me.y), mapY(me.x, me.y), 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd27a';
  ctx.beginPath();
  ctx.arc(mapX(me.x, me.y), mapY(me.x, me.y), 3, 0, Math.PI * 2);
  ctx.fill();
}
