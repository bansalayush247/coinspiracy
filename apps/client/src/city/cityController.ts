// Runs a visit to Port Concord: the city room, the HUD, the minimap and district arrivals.
import { Callbacks } from '@colyseus/sdk';
import { CITY_DISTRICTS, CITY_HEIGHT, CITY_MAP, CITY_MESSAGES, CITY_WALKABLE, CITY_WIDTH, DepositResultSchema, DoorResultSchema, ENTER_RANGE, PunchLineSchema, RestResultSchema, VAULT_DOOR, atExit, atVault, buildingName, districtAt, doorAt, doorBySeed, isRough, layoutFor, shopTradeOf, spotAt, type CityCar, type CityDrop, type CityPlayer, type DepositResult, type DistrictId, type DoorResult, type RestResult, type RoomKind, type RoomSpot, type SpotKind } from '@byzantine-council/shared/city';
import type { ShopId } from '@byzantine-council/shared/economy';
import { EMOTES, EmoteLineSchema, JumpLineSchema, type Emote } from '@byzantine-council/shared/hub';
import { audio } from '../audio/engine.js';
import { type PlayerInput, isEditable } from '../game/input.js';
import type { Session } from '../net/session.js';
import type { ProfileApi, ProfileSummary } from '../profile/api.js';
import { mountEmoteBar } from '../ui/emoteBar.js';
import { shopPanel } from '../ui/shopPanel.js';
import { pickPanel } from '../ui/pickPanel.js';
import { wearOf } from '../game/wear.js';
import type { Wear } from '../game/guardianArt.js';
import { el, h } from '../ui/dom.js';
import { FerryButton, markFerryOnMinimap } from '../ferry/ferryDock.js';
import type { FerryLook } from '../ferry/FerryScene.js';
import { formatNumber, t, type PlainKey } from '../i18n/index.js';
import type { CityScene } from './CityScene.js';
import { boardNotices, boardOf, shelfBooks } from './reading.js';

type CityRoom = Awaited<ReturnType<Session['city']>>;

// If the server's answer is lost, the door button comes back after this long.
const DOOR_RETRY_MS = 1_500;

// What can be done at each kind of spot, by its button label; the Mint Hall counter takes deposits through the vault button.
const SPOT_LABELS: Readonly<Record<Exclude<SpotKind, 'counter'>, PlainKey>> = {
  bed: 'city.useBed',
  reception: 'city.useReception',
  wardrobe: 'city.useWardrobe',
  tv: 'city.useTv',
  board: 'city.useBoard',
  books: 'city.useBooks',
  kitchen: 'city.useKitchen',
  arcade: 'city.useArcade',
  candles: 'city.useCandles',
  bell: 'city.useBell',
  cushion: 'city.useCushion',
  diya: 'city.useDiya',
};
// What the kitchen can make, each with the colour of its card.
const DISHES: readonly { readonly name: PlainKey; readonly color: string }[] = [
  { name: 'cook.tea', color: '#c98a4e' },
  { name: 'cook.toast', color: '#e0a84a' },
  { name: 'cook.soup', color: '#d9603f' },
];
const WELCOME: Readonly<Record<Exclude<RoomKind, 'shop' | 'fishMarket'>, PlainKey>> = {
  mintHall: 'city.welcomeMint',
  hospital: 'city.welcomeHospital',
  flat: 'city.welcomeFlat',
  cityHall: 'city.welcomeCityHall',
  chapel: 'city.welcomeChapel',
  arcade: 'city.welcomeArcade',
  office: 'city.welcomeOffice',
  temple: 'city.welcomeTemple',
  mandir: 'city.welcomeMandir',
};

const BELL_GAP_MS = 2500;
const QUIET_TOASTS: Readonly<Record<'candles' | 'cushion' | 'diya', readonly [PlainKey, PlainKey]>> = {
  candles: ['city.candleLit', 'city.candleCalm'],
  cushion: ['city.meditated', 'city.meditateCalm'],
  diya: ['city.diyaLit', 'city.diyaCalm'],
};

type Zone = 'rough' | 'safe' | 'indoors';
const ZONE_LABELS: Readonly<Record<Zone, readonly [PlainKey, PlainKey | null]>> = {
  rough: ['city.rough', 'city.fightsAllowed'],
  safe: ['city.safe', null],
  indoors: ['city.indoors', 'city.indoorsMore'],
};

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
  readonly #ride = el('city-ride', HTMLButtonElement);
  readonly #door = el('city-door', HTMLButtonElement);
  // The button for whatever the spot this guardian stands at offers: a shop's counter, a bed, the hospital desk and so on.
  readonly #use = el('city-shop', HTMLButtonElement);
  readonly #ferry = new FerryButton(el('city-ferry', HTMLButtonElement), 'city', () => {
    this.onFerry();
  });
  #inCar = false;
  #driveLoop = 0;
  #atVault = false;
  #rough: boolean | null = null;
  #zoneShown: Zone | null = null;
  #coins = 0;
  #safeToastAt = 0;
  #room: CityRoom | null = null;
  #here: DistrictId | null = null;
  #poll = 0;
  #held = false;
  #lastRestAt = 0;
  // The dish being made, while the kitchen's answer is on its way.
  #dish: PlainKey | null = null;
  #quiet: 'candles' | 'cushion' | 'diya' | null = null;
  #lastBellAt = 0;
  // The building whose name the HUD shows while inside it; 0 on the street.
  #namedInside = 0;
  onLeft: () => void = () => undefined;
  onToast: (text: string) => void = () => undefined;
  onProfile: (p: ProfileSummary) => void = () => undefined;
  onFerry: () => void = () => undefined;
  ferryOpen: () => boolean = () => true;
  onWardrobe: () => void = () => undefined;
  /** Opens the Chronicle; false if there is no chapter to read yet. */
  onChronicle: () => boolean = () => false;
  onBoard: () => void = () => undefined;
  onArcade: () => void = () => undefined;

  constructor(
    private readonly session: Session,
    private readonly profiles: ProfileApi,
    private readonly scene: CityScene,
    private readonly input: PlayerInput,
  ) {
    paintMinimap(el('city-minimap', HTMLCanvasElement));
    markFerryOnMinimap(el('city-minimap', HTMLCanvasElement));
    el('city-leave', HTMLButtonElement).addEventListener('click', () => {
      void this.leave();
    });
    mountEmoteBar(el('city-emotes', HTMLDivElement), (emote) => {
      this.#emote(emote);
    });
    this.#punch.addEventListener('click', () => {
      this.#swing();
    });
    this.#deposit.addEventListener('click', () => {
      this.#vault();
    });
    this.#door.addEventListener('click', () => {
      this.#useDoor();
    });
    this.#use.addEventListener('click', () => {
      this.#useSpot();
    });
    this.#ride.addEventListener('click', () => {
      this.#room?.send('ride');
    });
    window.addEventListener('keydown', (e) => {
      if (this.#room === null || this.#hud.hidden || this.#held || shopPanel().isOpen) return;
      if (e.code === 'Space' && !e.repeat && !isEditable(e.target)) {
        // A focused HUD button would otherwise be clicked by Space as well.
        if (e.target instanceof HTMLButtonElement) e.target.blur();
        e.preventDefault();
        this.#jump();
        return;
      }
      if ((e.key === 'f' || e.key === 'F') && !e.repeat && !(e.target instanceof HTMLInputElement)) {
        this.#swing();
        return;
      }
      if ((e.key === 'e' || e.key === 'E') && !e.repeat && !(e.target instanceof HTMLInputElement)) {
        if (!this.#deposit.hidden) this.#vault();
        else if (!this.#ride.hidden) this.#room.send('ride');
        else if (!this.#use.hidden) this.#useSpot();
        else if (!this.#door.hidden) this.#useDoor();
        else if (this.#ferry.shown) this.onFerry();
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

  /** The colour seat this guardian has in this place; 0 before joining. */
  mySeat(): number {
    const room = this.#room;
    return room?.state.players.get(room.sessionId)?.seat ?? 0;
  }

  /** Shows a look on this guardian straight away, before the city has it; null goes back to what the city sees. */
  dressMe(wear: Wear | null): void {
    this.scene.dressMe(wear);
  }

  /** The wardrobe changed: let the city see the new look. */
  lookChanged(): void {
    this.#room?.send('refreshLook');
  }

  /** Keeps the guardian still while a panel opened from a spot (wardrobe, Chronicle, notice board) is over the city. */
  holdStill(hold: boolean): void {
    this.#held = hold;
    if (this.#room !== null) this.input.enabled = !hold && !shopPanel().isOpen && !this.scene.meDown;
  }

  /** How this guardian looks right now, for the ferry crossing; null when not in the city. */
  ferryLook(): FerryLook | null {
    const room = this.#room;
    const me = room?.state.players.get(room.sessionId);
    return me === undefined ? null : { seat: me.seat, wear: wearOf(me) };
  }

  async enter(nickname: string, byFerry = false): Promise<void> {
    const room = await this.session.city(nickname, byFerry);
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
    callbacks.onAdd('cars', (car: CityCar, id: string) => {
      this.scene.addCar(id, car);
      callbacks.onChange(car, () => {
        this.scene.updateCar(id, car);
      });
    });
    callbacks.onRemove('cars', (_c: CityCar, id: string) => {
      this.scene.removeCar(id);
    });
    room.onMessage(CITY_MESSAGES.DOOR, (payload: unknown) => {
      const result = DoorResultSchema.safeParse(payload);
      if (result.success) this.#doorAnswered(result.data);
    });
    room.onMessage(CITY_MESSAGES.VAULT, (payload: unknown) => {
      const result = DepositResultSchema.safeParse(payload);
      if (result.success) this.#deposited(result.data);
    });
    room.onMessage(CITY_MESSAGES.REST, (payload: unknown) => {
      const result = RestResultSchema.safeParse(payload);
      if (result.success) this.#rested(result.data);
    });
    room.onMessage(CITY_MESSAGES.PUNCH, (payload: unknown) => {
      const line = PunchLineSchema.safeParse(payload);
      if (line.success) this.scene.punch(line.data);
    });
    callbacks.onRemove('players', (_p: CityPlayer, id: string) => {
      this.scene.removePlayer(id);
    });
    room.onMessage(CITY_MESSAGES.JUMP, (payload: unknown) => {
      const line = JumpLineSchema.safeParse(payload);
      if (line.success) this.scene.jump(line.data.from);
    });
    room.onMessage(CITY_MESSAGES.EMOTE, (payload: unknown) => {
      const line = EmoteLineSchema.safeParse(payload);
      if (line.success) this.scene.emote(line.data.from, line.data.emote);
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
    this.#zoneShown = null;
    this.#coins = 0;
    this.#pocket.textContent = '0';
    this.#down.hidden = true;
    this.#deposit.hidden = true;
    this.#deposit.disabled = false;
    this.#atVault = false;
    this.#setDriving(false);
    this.#ride.hidden = true;
    this.#door.hidden = true;
    this.#use.hidden = true;
    this.#held = false;
    this.scene.markSpot(null);
    this.#ferry.hide();
    shopPanel().close();
    pickPanel().close();
    this.#hud.classList.remove('indoors');
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
    const near = this.scene.others().filter((o) => !o.npc).length;
    const total = room.state.population;
    this.#pop.textContent = t('city.population', { total: String(total), near: String(near) });
    const d = districtAt(pos);
    if (d !== null && d.id !== this.#here) {
      const first = this.#here === null;
      this.#here = d.id;
      this.#district.textContent = d.name;
      this.#was.textContent = d.was === 'new' ? t('city.newPart') : t('city.once', { was: d.was });
      if (!first) {
        audio.play('chirp');
        this.onToast(t('city.entering', { name: d.name }));
      }
    }
    const indoors = this.scene.inside !== 0;
    this.#nameInside(this.scene.inside);
    const rough = !indoors && isRough(pos);
    const zone: Zone = indoors ? 'indoors' : rough ? 'rough' : 'safe';
    if (zone !== this.#zoneShown) {
      const announce = this.#zoneShown !== null && this.#zoneShown !== 'indoors' && zone !== 'indoors';
      this.#zoneShown = zone;
      this.#zone.dataset.rough = String(rough);
      this.#zone.replaceChildren(t(ZONE_LABELS[zone][0]), h('span', 'city-zone-more', ZONE_LABELS[zone][1] === null ? '' : t(ZONE_LABELS[zone][1])));
      if (announce) this.onToast(t(rough ? 'city.roughToast' : 'city.safeToast'));
    }
    this.#rough = rough;
    this.#punch.disabled = this.scene.meDown || this.#inCar;
    const canRide = this.#inCar || (!this.scene.meDown && this.scene.freeCarNear(pos, ENTER_RANGE));
    this.#ride.hidden = !canRide;
    this.#ride.firstChild?.replaceWith(document.createTextNode(t(this.#inCar ? 'city.getOut' : 'city.getIn')));
    this.#punch.classList.toggle('off', !rough);
    this.#punch.setAttribute('aria-disabled', String(!rough));
    const vaultHere = (atVault(pos) || (this.#spotHere(pos)?.kind === 'counter' && doorBySeed(this.scene.inside)?.room === 'mintHall')) && !this.scene.meDown;
    if (vaultHere !== this.#atVault) {
      this.#atVault = vaultHere;
      if (vaultHere) this.onToast(t(this.#coins > 0 ? 'city.vaultSafe' : 'city.vaultEmpty'));
    }
    this.#deposit.hidden = !vaultHere || this.#coins === 0;
    this.#renderDoor(pos);
    this.#ferry.update(pos, this.scene.inside === 0 && !this.scene.meDown && !this.#inCar, this.ferryOpen());
    drawDots(this.#dots, pos, this.scene.others());
  }

  // Inside, the HUD names the building and its district; back out, it goes back to naming the district on the street.
  #nameInside(inside: number): void {
    if (inside === this.#namedInside) return;
    this.#namedInside = inside;
    const door = doorBySeed(inside);
    if (door === null) {
      this.#here = null;
      return;
    }
    this.#district.textContent = buildingName(inside);
    this.#was.textContent = CITY_DISTRICTS.find((d) => d.id === door.building.district)?.name ?? '';
  }

  // The door button: the way in when standing at a building's door, the way out when standing at it inside.
  #renderDoor(pos: { x: number; y: number }): void {
    const inside = this.scene.inside;
    this.#hud.classList.toggle('indoors', inside !== 0);
    let label: string | null = null;
    if (inside !== 0) {
      const door = doorBySeed(inside);
      if (door !== null && atExit(pos, layoutFor(door.room, inside))) label = t('city.leaveBuilding');
    } else if (!this.scene.meDown && !this.#inCar && this.#ride.hidden) {
      const door = doorAt(pos);
      if (door !== null) label = t(door.room === 'flat' ? 'city.enterHome' : 'city.enterNamed', { name: buildingName(door.building.seed) });
    }
    this.#door.hidden = label === null;
    if (label !== null) this.#door.firstChild?.replaceWith(document.createTextNode(label));
    const spot = this.#spotHere(pos);
    this.scene.markSpot(spot);
    const action = spot === null ? null : this.#spotLabel(spot);
    this.#use.hidden = action === null || shopPanel().isOpen || this.#held;
    if (action !== null) this.#use.firstChild?.replaceWith(document.createTextNode(action));
  }

  // The spot inside this guardian stands close enough to use; null on the street, when down, or nowhere near one.
  #spotHere(pos: { x: number; y: number }): RoomSpot | null {
    const inside = this.scene.inside;
    const door = inside === 0 ? null : doorBySeed(inside);
    if (door === null || this.scene.meDown) return null;
    return spotAt(pos, layoutFor(door.room, inside));
  }

  // The use button's label at this spot; null where the spot has its own button (the Mint Hall counter's deposit).
  #spotLabel(spot: RoomSpot): string | null {
    if (spot.kind !== 'counter') return t(SPOT_LABELS[spot.kind]);
    return this.#shopHere() === null ? null : t('city.browseShop', { name: buildingName(this.scene.inside) });
  }

  // What the shop this guardian is inside sells from its counter: a trade's wares, or the fish hall's; null elsewhere.
  #shopHere(): ShopId | null {
    const inside = this.scene.inside;
    const room = doorBySeed(inside)?.room;
    return room === 'shop' ? shopTradeOf(inside) : room === 'fishMarket' ? 'fish-market' : null;
  }

  #useSpot(): void {
    const pos = this.scene.predictedPosition();
    const spot = pos === null ? null : this.#spotHere(pos);
    if (spot === null || this.#use.hidden || this.#held || shopPanel().isOpen) return;
    switch (spot.kind) {
      case 'counter':
        void this.#openShop();
        return;
      case 'bed':
      case 'reception':
      case 'candles':
      case 'cushion':
      case 'diya':
        this.#dish = null;
        this.#quiet = spot.kind === 'bed' || spot.kind === 'reception' ? null : spot.kind;
        this.#rest();
        return;
      case 'bell':
        this.#ringBell();
        return;
      case 'arcade':
        this.holdStill(true);
        this.onArcade();
        return;
      case 'kitchen':
        this.#withPanel(() => {
          pickPanel().choose(
            t('cook.title'),
            t('cook.pick'),
            DISHES.map((d) => ({
              label: t(d.name),
              color: d.color,
              pick: () => {
                this.#dish = d.name;
                this.#quiet = null;
                pickPanel().close();
                this.#rest();
              },
            })),
          );
        });
        return;
      case 'books': {
        const room = doorBySeed(this.scene.inside)?.room ?? 'flat';
        const books = shelfBooks(room, this.scene.inside);
        this.#withPanel(() => {
          void pickPanel().openShelf(books);
        });
        return;
      }
      case 'wardrobe':
        this.holdStill(true);
        this.onWardrobe();
        return;
      case 'tv':
        this.holdStill(true);
        if (!this.onChronicle()) {
          this.holdStill(false);
          this.onToast(t('city.tvNothing'));
        }
        return;
      case 'board': {
        const inside = this.scene.inside;
        const board = boardOf(doorBySeed(inside)?.room ?? 'flat');
        if (board === null) {
          this.holdStill(true);
          this.onBoard();
          return;
        }
        this.#withPanel(() => {
          void pickPanel().openBoard(buildingName(inside), boardNotices(board, inside), () => {
            pickPanel().close();
            this.holdStill(true);
            this.onBoard();
          });
        });
      }
    }
  }

  #ringBell(): void {
    const now = performance.now();
    if (now - this.#lastBellAt < BELL_GAP_MS) return;
    this.#lastBellAt = now;
    const mandir = doorBySeed(this.scene.inside)?.room === 'mandir';
    audio.play(mandir ? 'mandirBell' : 'templeBell');
    this.onToast(t(mandir ? 'city.mandirBell' : 'city.bellRung'));
  }

  #rest(): void {
    const now = performance.now();
    if (now - this.#lastRestAt < 500) return;
    this.#lastRestAt = now;
    this.#room?.send('rest');
  }

  // Opens the pick window over the room, keeping the guardian still until it closes.
  #withPanel(open: () => void): void {
    this.holdStill(true);
    pickPanel().onClosed = () => {
      this.holdStill(false);
    };
    open();
  }

  #rested(r: RestResult): void {
    const dish = this.#dish;
    const quiet = this.#quiet;
    this.#dish = null;
    this.#quiet = null;
    if (quiet !== null) {
      if (r.reason === 'healed' || r.reason === 'full') {
        audio.play('chirp');
        const healed = r.reason === 'healed';
        this.onToast(t(QUIET_TOASTS[quiet][healed ? 0 : 1]));
      }
      return;
    }
    if (dish !== null) {
      if (r.reason === 'healed' || r.reason === 'full') {
        audio.play('chirp');
        this.onToast(t(r.reason === 'healed' ? 'cook.made' : 'cook.enjoyed', { dish: t(dish).toLowerCase() }));
      }
      return;
    }
    const inHospital = doorBySeed(this.scene.inside)?.room === 'hospital';
    if (r.reason === 'healed') {
      audio.play('chirp');
      this.onToast(t(inHospital ? 'city.patchedUp' : 'city.rested'));
    } else if (r.reason === 'full') this.onToast(t(inHospital ? 'city.patchedFull' : 'city.restFull'));
  }

  async #openShop(): Promise<void> {
    const shop = this.#shopHere();
    const inside = this.scene.inside;
    if (shop === null || shopPanel().isOpen) return;
    this.input.enabled = false;
    this.#use.hidden = true;
    const profile = await this.profiles.profile();
    if (this.#room === null) return;
    shopPanel().open(shop, profile, {
      profiles: this.profiles,
      title: buildingName(inside),
      onProfile: (p) => {
        this.onProfile(p);
      },
      onToast: (text) => {
        this.onToast(text);
      },
      onClose: () => {
        if (this.#room !== null) this.input.enabled = !this.#held && !this.scene.meDown;
      },
      seat: this.#room.state.players.get(this.#room.sessionId)?.seat ?? 0,
      onTry: (wear) => {
        this.scene.dressMe(wear);
      },
      onWorn: () => {
        this.lookChanged();
      },
    });
  }

  #useDoor(): void {
    if (this.#door.hidden || this.#door.disabled) return;
    this.#door.disabled = true;
    this.#room?.send(this.scene.inside === 0 ? 'enter' : 'exit');
    window.setTimeout(() => {
      this.#door.disabled = false;
    }, DOOR_RETRY_MS);
  }

  #doorAnswered(r: DoorResult): void {
    this.#door.disabled = false;
    if (r.ok) {
      audio.play('click');
      const door = r.inside === 0 ? null : doorBySeed(r.inside);
      if (door?.room === 'shop' || door?.room === 'fishMarket') this.onToast(t('city.welcomeShop', { name: buildingName(r.inside) }));
      else if (door !== null) this.onToast(t(WELCOME[door.room]));
      return;
    }
    const why: Record<Exclude<DoorResult['reason'], 'in' | 'out'>, PlainKey> = {
      notAtDoor: 'city.doorNotHere',
      full: 'city.doorFull',
      tooSoon: 'city.doorTooSoon',
      inCar: 'city.doorInCar',
      down: 'city.doorDown',
      fighting: 'city.doorFighting',
    };
    if (r.reason !== 'in' && r.reason !== 'out') this.onToast(t(why[r.reason]));
  }

  // Pocket, knockout and driving state for this client's own guardian.
  #mine(player: CityPlayer): void {
    this.#setDriving(player.car !== '');
    const coins = player.pocket ?? 0;
    if (coins !== this.#coins) {
      if (coins > this.#coins) audio.play('coin');
      this.#coins = coins;
      this.#pocket.textContent = formatNumber(coins);
    }
    if (this.#down.hidden === player.down) {
      this.#down.hidden = !player.down;
      if (player.down) this.input.enabled = false;
      else this.input.enabled = this.#room !== null && !this.#held && !shopPanel().isOpen;
    }
  }

  #setDriving(on: boolean): void {
    if (on === this.#inCar) return;
    this.#inCar = on;
    this.scene.driving = on;
    window.clearInterval(this.#driveLoop);
    if (!on) return;
    audio.play('chirp');
    this.onToast(t('city.driving'));
    this.#driveLoop = window.setInterval(() => {
      const pedals = this.input.pedals();
      if (pedals !== null) {
        this.#room?.send('drive', pedals);
        return;
      }
      const d = this.input.direction();
      this.#room?.send('drive', { dx: Math.max(-1, Math.min(1, d.x)), dy: Math.max(-1, Math.min(1, d.y)) });
    }, 50);
  }

  #vault(): void {
    if (this.#deposit.hidden || this.#deposit.disabled) return;
    this.#deposit.disabled = true;
    this.#room?.send('deposit');
  }

  #deposited(r: DepositResult): void {
    this.#deposit.disabled = false;
    const left = t('city.moreToday', { n: String(r.limit - r.today) });
    if (r.reason === 'paid') {
      audio.play('coin');
      this.scene.celebrate(VAULT_DOOR);
      this.onToast(r.kept > 0 ? t('city.vaultedLimit', { paid: String(r.paid), kept: String(r.kept) }) : t('city.vaulted', { paid: String(r.paid), left }));
      void this.profiles.profile().then((p) => {
        if (p !== null) this.onProfile(p);
      });
      return;
    }
    const why: Record<Exclude<DepositResult['reason'], 'paid'>, PlainKey> = {
      empty: 'city.vaultNoCoins',
      notAtVault: 'city.vaultNotHere',
      dailyLimit: 'city.vaultDailyLimit',
      walletFull: 'city.vaultWalletFull',
      noProfile: 'city.vaultNoProfile',
      busy: 'city.vaultBusy',
      error: 'city.vaultError',
    };
    this.onToast(t(why[r.reason]));
  }

  #swing(): void {
    if (this.#punch.disabled) return;
    if (this.#rough !== true) {
      const now = Date.now();
      if (now - this.#safeToastAt > 2500) {
        this.#safeToastAt = now;
        this.onToast(t('city.noFighting'));
      }
      return;
    }
    this.#room?.send('punch');
  }

  // Jumps at once on this screen, then tells the room so everyone who can see you sees it too.
  #jump(): void {
    const room = this.#room;
    if (room === null || this.#inCar) return;
    this.scene.jump(room.sessionId);
    room.send('jump');
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
      if (CITY_WALKABLE.includes(row[c] ?? '#') && isRough({ x: c + 0.5, y: r + 0.5 })) {
        ctx.fillStyle = 'rgba(255, 90, 60, 0.35)';
        ctx.fillRect(mapX(c, r) - 1, mapY(c, r), 2, 1);
      }
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

function drawDots(canvas: HTMLCanvasElement, me: { x: number; y: number }, others: readonly { x: number; y: number; npc?: boolean }[]): void {
  canvas.width = CITY_WIDTH + CITY_HEIGHT;
  canvas.height = (CITY_WIDTH + CITY_HEIGHT) / 2;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  for (const o of others) {
    ctx.fillStyle = o.npc === true ? '#ff6b4a' : '#fff1de';
    ctx.fillRect(mapX(o.x, o.y) - 1.5, mapY(o.x, o.y) - 1.5, 3, 3);
  }
  ctx.fillStyle = '#2a1a33';
  ctx.beginPath();
  ctx.arc(mapX(me.x, me.y), mapY(me.x, me.y), 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd27a';
  ctx.beginPath();
  ctx.arc(mapX(me.x, me.y), mapY(me.x, me.y), 3, 0, Math.PI * 2);
  ctx.fill();
}
