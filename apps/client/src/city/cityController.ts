// Runs a visit to Port Concord: the city room, the HUD, the minimap and district arrivals.
import { Callbacks } from '@colyseus/sdk';
import { CITY_HEIGHT, CITY_MAP, CITY_MESSAGES, CITY_WIDTH, DepositResultSchema, PunchLineSchema, VAULT_DOOR, atVault, districtAt, isRough, type CityDrop, type CityPlayer, type DepositResult, type DistrictId } from '@byzantine-council/shared/city';
import { EMOTES, EMOTE_GLYPHS, EmoteLineSchema, type Emote } from '@byzantine-council/shared/hub';
import { audio } from '../audio/engine.js';
import type { PlayerInput } from '../game/input.js';
import type { Session } from '../net/session.js';
import type { ProfileApi, ProfileSummary } from '../profile/api.js';
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
  readonly #zone = el('city-zone', HTMLParagraphElement);
  readonly #pocket = el('city-pocket', HTMLElement);
  readonly #punch = el('city-punch', HTMLButtonElement);
  readonly #down = el('city-down', HTMLParagraphElement);
  readonly #deposit = el('city-deposit', HTMLButtonElement);
  #atVault = false;
  #rough: boolean | null = null;
  #coins = 0;
  #room: CityRoom | null = null;
  #here: DistrictId | null = null;
  #poll = 0;
  onLeft: () => void = () => undefined;
  onToast: (text: string) => void = () => undefined;
  onProfile: (p: ProfileSummary) => void = () => undefined;

  constructor(
    private readonly session: Session,
    private readonly profiles: ProfileApi,
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
    this.#punch.addEventListener('click', () => {
      this.#swing();
    });
    this.#deposit.addEventListener('click', () => {
      this.#vault();
    });
    window.addEventListener('keydown', (e) => {
      if (this.#room === null || this.#hud.hidden) return;
      if ((e.key === 'f' || e.key === 'F') && !e.repeat && !(e.target instanceof HTMLInputElement)) {
        this.#swing();
        return;
      }
      if ((e.key === 'e' || e.key === 'E') && !e.repeat && !(e.target instanceof HTMLInputElement)) {
        this.#vault();
        return;
      }
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
      if (id === room.sessionId) this.#mine(player);
      callbacks.onChange(player, () => {
        this.scene.updatePlayer(id, player);
        if (id === room.sessionId) this.#mine(player);
      });
    });
    callbacks.onAdd('drops', (drop: CityDrop, id: string) => {
      this.scene.addDrop(id, drop);
      callbacks.onChange(drop, () => {
        this.scene.updateDrop(id, drop);
      });
    });
    callbacks.onRemove('drops', (_d: CityDrop, id: string) => {
      this.scene.removeDrop(id);
    });
    room.onMessage(CITY_MESSAGES.VAULT, (payload: unknown) => {
      const result = DepositResultSchema.safeParse(payload);
      if (result.success) this.#deposited(result.data);
    });
    room.onMessage(CITY_MESSAGES.PUNCH, (payload: unknown) => {
      const line = PunchLineSchema.safeParse(payload);
      if (line.success) this.scene.punch(line.data);
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
    this.#rough = null;
    this.#coins = 0;
    this.#pocket.textContent = '0';
    this.#down.hidden = true;
    this.#deposit.hidden = true;
    this.#deposit.disabled = false;
    this.#atVault = false;
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
    const rough = isRough(pos);
    if (rough !== this.#rough) {
      const announce = this.#rough !== null;
      this.#rough = rough;
      this.#zone.dataset.rough = String(rough);
      this.#zone.replaceChildren(rough ? 'Rough streets' : 'Safe streets', h('span', 'city-zone-more', rough ? ' · fights allowed' : ''));
      if (announce) this.onToast(rough ? 'Rough streets: anyone can knock you out and take your pocket' : 'Safe streets: nobody can fight here');
    }
    this.#punch.disabled = !rough || this.scene.meDown;
    const vaultHere = atVault(pos) && !this.scene.meDown;
    if (vaultHere !== this.#atVault) {
      this.#atVault = vaultHere;
      if (vaultHere) this.onToast(this.#coins > 0 ? 'The Mint vault. Coins inside can’t be punched out of you.' : 'The Mint vault. Bring coins from the rough streets to keep them safe here.');
    }
    this.#deposit.hidden = !vaultHere || this.#coins === 0;
    drawDots(this.#dots, pos, this.scene.others());
  }

  // Pocket and knockout state for this client's own guardian.
  #mine(player: CityPlayer): void {
    const coins = player.pocket ?? 0;
    if (coins !== this.#coins) {
      if (coins > this.#coins) audio.play('coin');
      this.#coins = coins;
      this.#pocket.textContent = coins.toLocaleString();
    }
    if (this.#down.hidden === player.down) {
      this.#down.hidden = !player.down;
      if (player.down) this.input.enabled = false;
      else this.input.enabled = this.#room !== null;
    }
  }

  #vault(): void {
    if (this.#deposit.hidden || this.#deposit.disabled) return;
    this.#deposit.disabled = true;
    this.#room?.send('deposit');
  }

  #deposited(r: DepositResult): void {
    this.#deposit.disabled = false;
    const left = `${String(r.limit - r.today)} more today`;
    if (r.reason === 'paid') {
      audio.play('coin');
      this.scene.celebrate(VAULT_DOOR);
      this.onToast(r.kept > 0 ? `Vaulted ${String(r.paid)} play sats. That’s today’s limit; ${String(r.kept)} stay in your pocket.` : `Vaulted ${String(r.paid)} play sats. Safe from any punch. (${left})`);
      void this.profiles.profile().then((p) => {
        if (p !== null) this.onProfile(p);
      });
      return;
    }
    const why: Record<Exclude<DepositResult['reason'], 'paid'>, string> = {
      empty: 'Your pocket is empty.',
      notAtVault: 'Stand at the Mint Hall door to use the vault.',
      dailyLimit: 'The vault has taken today’s limit. Your coins stay in your pocket; come back tomorrow.',
      walletFull: 'Your wallet is full.',
      noProfile: 'The vault needs a saved guest profile. Your coins stay in your pocket.',
      busy: 'Still counting your last deposit…',
      error: 'The vault couldn’t take coins just now. They’re back in your pocket.',
    };
    this.onToast(why[r.reason]);
  }

  #swing(): void {
    if (this.#punch.disabled) return;
    this.#room?.send('punch');
  }

  #emote(emote: Emote): void {
    this.#room?.send('emote', { emote });
  }
}

// The minimap in the same diamond view as the game: each tile is a 2 x 1 pixel diamond.
const mapX = (c: number, r: number): number => c - r + CITY_HEIGHT;
const mapY = (c: number, r: number): number => (c + r) / 2;

export function paintMinimap(canvas: HTMLCanvasElement): void {
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
  ctx.fillStyle = '#2a1a33';
  ctx.beginPath();
  ctx.arc(mapX(VAULT_DOOR.x, VAULT_DOOR.y), mapY(VAULT_DOOR.x, VAULT_DOOR.y), 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd27a';
  ctx.fillRect(mapX(VAULT_DOOR.x, VAULT_DOOR.y) - 3.5, mapY(VAULT_DOOR.x, VAULT_DOOR.y) - 3.5, 7, 7);
}

// A ringed dot on the minimap at a world position.
export function drawMapDot(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, color: string, r: number): void {
  ctx.fillStyle = '#2a1a33';
  ctx.beginPath();
  ctx.arc(mapX(p.x, p.y), mapY(p.x, p.y), r + 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(mapX(p.x, p.y), mapY(p.x, p.y), r, 0, Math.PI * 2);
  ctx.fill();
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
