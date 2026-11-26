import { ArenaIdSchema, MAX_PLAYERS, MIN_PLAYERS, TIER_IDS, formatRoomCode, isRoomCode, tierPickable, type ArenaId, type Role, type TierId } from '@byzantine-council/shared';
import type { MatchPhase } from '@byzantine-council/shared/state';
import { cssColor, seatColors } from '../game/palette.js';
import { inviteLink } from '../net/invite.js';
import { onLocaleChange, t } from '../i18n/index.js';
import { el, h } from './dom.js';
import { tierName, tierSummary } from './tierText.js';

export interface RosterEntry {
  readonly id: string;
  readonly name: string;
  readonly seat: number;
  readonly active: boolean;
  readonly isHost: boolean;
  readonly isMe: boolean;
  // A practice bot run by the server.
  readonly bot: boolean;
  // Only roles this client may know: its own, fellow Byzantines', or everyone's after a match.
  readonly role: Role | undefined;
}

export interface LobbyInfo {
  readonly phase: MatchPhase;
  readonly amHost: boolean;
  readonly hostName: string;
  // False once the server said practice bots are off.
  readonly botsAvailable: boolean;
  // Private lobbies pick their map; quick-match rooms always play the Citadel.
  readonly isPrivate: boolean;
  readonly arena: ArenaId;
  // Someone in the room has opened Lightning Reef, or Watchtower Peaks.
  readonly reefOpen: boolean;
  readonly peaksOpen: boolean;
  /** The room's rule tier; the host of a private lobby picks it. */
  readonly tier: TierId;
  /** A story signing ceremony, which keeps its withdrawals. */
  readonly ceremony: boolean;
}

export type ConnectionState = 'connected' | 'reconnecting';

const TOAST_MS = 3200;
const MAX_TOASTS = 4;

export class Hud {
  readonly #root = el('hud', HTMLElement);
  readonly #kind = el('room-kind', HTMLSpanElement);
  readonly #codeText = el('room-code-text', HTMLElement);
  readonly #copy = el('copy-invite', HTMLButtonElement);
  readonly #inviteField = el('invite-field', HTMLInputElement);
  readonly #conn = el('conn', HTMLDivElement);
  readonly #connText = el('conn-text', HTMLSpanElement);
  readonly #roster = el('roster', HTMLUListElement);
  readonly #count = el('roster-count', HTMLSpanElement);
  readonly #hint = el('lobby-hint', HTMLParagraphElement);
  readonly #leave = el('leave', HTMLButtonElement);
  readonly #start = el('start-match', HTMLButtonElement);
  readonly #addBot = el('add-bot', HTMLButtonElement);
  readonly #arenaPick = el('arena-pick', HTMLDivElement);
  readonly #arenaNote = el('arena-note', HTMLParagraphElement);
  readonly #tierBadge = el('tier-badge', HTMLSpanElement);
  readonly #tierPick = el('tier-pick', HTMLDivElement);
  readonly #tierNote = el('tier-note', HTMLParagraphElement);
  readonly #tierButtons: readonly HTMLButtonElement[];
  #lastLobby: LobbyInfo | null = null;
  readonly #toasts = el('toasts', HTMLDivElement);
  #code = '';
  #ping: number | null = null;
  #state: ConnectionState = 'connected';
  onLeave: () => void = () => undefined;
  onStart: () => void = () => undefined;
  onAddBot: () => void = () => undefined;
  onArena: (arena: ArenaId) => void = () => undefined;
  onTier: (tier: TierId) => void = () => undefined;
  onRemoveBot: (id: string) => void = () => undefined;

  constructor() {
    this.#leave.addEventListener('click', () => {
      this.onLeave();
    });
    this.#copy.addEventListener('click', () => {
      void this.#copyInvite();
    });
    this.#start.addEventListener('click', () => {
      this.#start.disabled = true;
      this.onStart();
    });
    this.#addBot.addEventListener('click', () => {
      this.onAddBot();
    });
    for (const b of this.#arenaButtons()) {
      b.addEventListener('click', () => {
        const parsed = ArenaIdSchema.safeParse(b.dataset['arena']);
        if (parsed.success) this.onArena(parsed.data);
      });
    }
    const choices = el('tier-choices', HTMLDivElement);
    this.#tierButtons = TIER_IDS.map((tier) => {
      const b = h('button', undefined, tierName(tier));
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        this.onTier(tier);
      });
      return b;
    });
    choices.replaceChildren(...this.#tierButtons);
    this.#labelTiers();
    onLocaleChange(() => {
      this.refreshStreamerMode();
      this.#renderConnection();
      this.#labelTiers();
      if (this.#lastLobby !== null) this.#renderTier(this.#lastLobby);
    });
  }

  #labelTiers(): void {
    const label = t('tier.label');
    el('tier-label', HTMLSpanElement).textContent = label;
    el('tier-choices', HTMLDivElement).setAttribute('aria-label', label);
    this.#tierButtons.forEach((b, i) => {
      b.textContent = tierName(TIER_IDS[i] ?? 'full');
    });
  }

  // Everyone sees the room's rules on a badge; the host of a private lobby picks them.
  #renderTier(lobby: LobbyInfo): void {
    this.#lastLobby = lobby;
    this.#tierBadge.hidden = false;
    this.#tierBadge.textContent = tierName(lobby.tier);
    this.#tierBadge.title = lobby.isPrivate ? tierSummary(lobby.tier) : `${tierSummary(lobby.tier)} ${t('tier.quickMatch')}`;
    this.#tierPick.hidden = lobby.phase !== 'lobby' || !lobby.isPrivate;
    if (this.#tierPick.hidden) return;
    this.#tierButtons.forEach((b, i) => {
      const tier = TIER_IDS[i] ?? 'full';
      b.setAttribute('aria-pressed', String(tier === lobby.tier));
      b.disabled = !lobby.amHost || !tierPickable(tier, lobby.ceremony);
    });
    const note = lobby.amHost ? tierSummary(lobby.tier) : t('tier.hostPicks', { host: lobby.hostName });
    this.#tierNote.textContent = lobby.ceremony ? `${note} ${t('tier.ceremony')}` : note;
  }

  #arenaButtons(): HTMLButtonElement[] {
    return [...this.#arenaPick.querySelectorAll<HTMLButtonElement>('button[data-arena]')];
  }

  // The host of a private lobby picks the map; everyone else sees which one is set.
  #renderArena(lobby: LobbyInfo): void {
    this.#arenaPick.hidden = lobby.phase !== 'lobby' || !lobby.isPrivate;
    if (this.#arenaPick.hidden) return;
    for (const b of this.#arenaButtons()) {
      const id = b.dataset['arena'];
      b.setAttribute('aria-pressed', String(id === lobby.arena));
      b.disabled = !lobby.amHost || (id === 'reef' && !lobby.reefOpen) || (id === 'peaks' && !lobby.peaksOpen);
    }
    this.#arenaNote.textContent = !lobby.amHost
      ? t('hud.arenaHostPicks', { name: lobby.hostName })
      : t(lobby.arena === 'reef' ? 'hud.arenaReef' : lobby.arena === 'peaks' ? 'hud.arenaPeaks' : !lobby.peaksOpen || !lobby.reefOpen ? 'hud.arenaLocked' : 'hud.arenaPick');
  }

  show(): void {
    this.#root.hidden = false;
  }

  hide(): void {
    this.#root.hidden = true;
    this.#inviteField.hidden = true;
    this.#tierBadge.hidden = true;
    this.#roster.replaceChildren();
    this.#code = '';
    this.#ping = null;
  }

  setRoom(code: string, isPrivate: boolean): void {
    this.#code = isRoomCode(code) ? code : '';
    this.#isPrivate = isPrivate;
    this.#renderCode();
    this.#kind.textContent = t(isPrivate ? 'hud.privateRoom' : 'hud.publicRoom');
    this.#copy.disabled = this.#code === '';
  }

  // Streamer mode masks the room code on screen, so viewers cannot join a private room from a stream.
  #isPrivate = false;
  #renderCode(): void {
    const streaming = document.documentElement.dataset['streamer'] === 'on';
    this.#codeText.textContent = this.#code === '' ? '······' : streaming ? '•••-•••' : formatRoomCode(this.#code);
    this.#codeText.title = streaming ? t('hud.codeHidden') : '';
    if (streaming) this.#inviteField.hidden = true;
  }

  refreshStreamerMode(): void {
    this.#renderCode();
    this.#kind.textContent = t(this.#isPrivate ? 'hud.privateRoom' : 'hud.publicRoom');
  }

  setConnection(state: ConnectionState): void {
    this.#state = state;
    this.#renderConnection();
  }

  setPing(ms: number | null): void {
    this.#ping = ms;
    this.#renderConnection();
  }

  renderRoster(entries: readonly RosterEntry[], lobby: LobbyInfo): void {
    const items = [...entries]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => {
        const li = h('li', ['guardian', p.active ? '' : 'away', p.isMe ? 'me' : ''].filter(Boolean).join(' '));
        const dot = h('span', 'seat');
        dot.style.background = cssColor(seatColors(p.seat).lit);
        const name = h('span', 'name', p.name);
        li.append(dot, name);
        if (p.isMe) li.append(h('span', 'tag me', t('tag.you')));
        if (p.isHost) li.append(h('span', 'tag host', t('tag.host')));
        if (p.bot) li.append(h('span', 'tag bot', t('tag.bot')));
        if (p.role === 'byzantine') li.append(h('span', 'tag byzantine', t('tag.byzantine')));
        else if (p.role === 'honest' && lobby.phase === 'ended') li.append(h('span', 'tag honest', t('tag.honest')));
        if (!p.active) li.append(h('span', 'tag away', t('tag.away')));
        if (p.bot && lobby.amHost && lobby.phase === 'lobby') {
          const remove = h('button', 'remove-bot', '×');
          remove.type = 'button';
          remove.setAttribute('aria-label', t('hud.removeBot', { name: p.name }));
          remove.addEventListener('click', () => {
            remove.disabled = true;
            this.onRemoveBot(p.id);
          });
          li.append(remove);
        }
        return li;
      });
    this.#roster.replaceChildren(...items);
    this.#count.textContent = `${String(entries.length)}/${String(MAX_PLAYERS)}`;
    const missing = MIN_PLAYERS - entries.length;
    const everyoneHere = entries.every((p) => p.active);
    const inLobby = lobby.phase === 'lobby';
    // The room is locked during a match, so an invite would only bounce.
    this.#copy.hidden = !inLobby;
    if (!inLobby) this.#inviteField.hidden = true;
    this.#start.hidden = !inLobby || !lobby.amHost;
    this.#addBot.hidden = !inLobby || !lobby.amHost || !lobby.botsAvailable || entries.length >= MAX_PLAYERS;
    this.#renderArena(lobby);
    this.#renderTier(lobby);
    this.#start.disabled = missing > 0 || !everyoneHere;
    this.#hint.textContent = !inLobby
      ? t(lobby.phase === 'playing' ? 'hud.inProgress' : 'hud.matchOver')
      : missing > 0
        ? t(lobby.amHost && lobby.botsAvailable ? 'hud.needMoreBots' : 'hud.needMore', { min: String(MIN_PLAYERS), missing: String(missing) })
        : !everyoneHere
          ? t('hud.reconnectWait')
          : lobby.amHost
            ? t('hud.ready')
            : t('hud.waitHost', { name: lobby.hostName });
  }

  toast(message: string): void {
    const item = h('div', 'toast', message);
    this.#toasts.append(item);
    while (this.#toasts.children.length > MAX_TOASTS) this.#toasts.firstElementChild?.remove();
    window.setTimeout(() => {
      item.remove();
    }, TOAST_MS);
  }

  #renderConnection(): void {
    this.#conn.dataset['state'] = this.#state;
    this.#connText.textContent =
      this.#state === 'reconnecting'
        ? t('hud.reconnecting')
        : this.#ping === null
          ? t('hud.connected')
          : t('hud.connectedPing', { ms: String(Math.round(this.#ping)) });
  }

  async #copyInvite(): Promise<void> {
    if (this.#code === '') return;
    const link = inviteLink(window.location.href, this.#code);
    try {
      await navigator.clipboard.writeText(link);
      this.toast(t('hud.copied'));
    } catch {
      // Clipboard refused: show the link selected so it can be copied by hand (never on stream).
      if (document.documentElement.dataset['streamer'] === 'on') {
        this.toast(t('hud.copyFailedStreamer'));
        return;
      }
      this.#inviteField.value = link;
      this.#inviteField.hidden = false;
      this.#inviteField.select();
      this.toast(t('hud.copyManual'));
    }
  }
}
