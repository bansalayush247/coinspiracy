import { MAX_PLAYERS, MIN_PLAYERS, formatRoomCode, isRoomCode, type Role } from '@byzantine-council/shared';
import type { MatchPhase } from '@byzantine-council/shared/state';
import { cssColor, seatColors } from '../game/palette.js';
import { inviteLink } from '../net/invite.js';
import { el, h } from './dom.js';

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
  readonly #toasts = el('toasts', HTMLDivElement);
  #code = '';
  #ping: number | null = null;
  #state: ConnectionState = 'connected';
  onLeave: () => void = () => undefined;
  onStart: () => void = () => undefined;
  onAddBot: () => void = () => undefined;
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
  }

  show(): void {
    this.#root.hidden = false;
  }

  hide(): void {
    this.#root.hidden = true;
    this.#inviteField.hidden = true;
    this.#roster.replaceChildren();
    this.#code = '';
    this.#ping = null;
  }

  setRoom(code: string, isPrivate: boolean): void {
    this.#code = isRoomCode(code) ? code : '';
    this.#isPrivate = isPrivate;
    this.#renderCode();
    this.#kind.textContent = isPrivate ? 'Private room' : 'Public room';
    this.#copy.disabled = this.#code === '';
  }

  // Streamer mode masks the room code on screen, so viewers cannot join a private room from a stream.
  #isPrivate = false;
  #renderCode(): void {
    const streaming = document.documentElement.dataset['streamer'] === 'on';
    this.#codeText.textContent = this.#code === '' ? '······' : streaming ? '•••-•••' : formatRoomCode(this.#code);
    this.#codeText.title = streaming ? 'Hidden in streamer mode. Copy the invite to share it privately.' : '';
    if (streaming) this.#inviteField.hidden = true;
  }

  refreshStreamerMode(): void {
    this.#renderCode();
    this.#kind.textContent = this.#isPrivate ? 'Private room' : 'Public room';
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
        if (p.isMe) li.append(h('span', 'tag me', 'You'));
        if (p.isHost) li.append(h('span', 'tag host', 'Host'));
        if (p.bot) li.append(h('span', 'tag bot', 'Bot'));
        if (p.role === 'byzantine') li.append(h('span', 'tag byzantine', 'Byzantine'));
        else if (p.role === 'honest' && lobby.phase === 'ended') li.append(h('span', 'tag honest', 'Honest'));
        if (!p.active) li.append(h('span', 'tag away', 'Away'));
        if (p.bot && lobby.amHost && lobby.phase === 'lobby') {
          const remove = h('button', 'remove-bot', '×');
          remove.type = 'button';
          remove.setAttribute('aria-label', `Remove ${p.name}`);
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
    this.#start.disabled = missing > 0 || !everyoneHere;
    this.#hint.textContent = !inLobby
      ? lobby.phase === 'playing'
        ? 'Match in progress.'
        : 'Match over.'
      : missing > 0
        ? `A match needs ${String(MIN_PLAYERS)} guardians. Invite ${String(missing)} more${lobby.amHost && lobby.botsAvailable ? ', or add practice bots' : ''}.`
        : !everyoneHere
          ? 'Waiting for everyone to reconnect.'
          : lobby.amHost
            ? 'Everyone’s here. Start when you’re ready.'
            : `Waiting for ${lobby.hostName} to start the match.`;
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
        ? 'Reconnecting…'
        : this.#ping === null
          ? 'Connected'
          : `Connected · ${String(Math.round(this.#ping))} ms`;
  }

  async #copyInvite(): Promise<void> {
    if (this.#code === '') return;
    const link = inviteLink(window.location.href, this.#code);
    try {
      await navigator.clipboard.writeText(link);
      this.toast('Invite link copied. Send it to your friends.');
    } catch {
      // Clipboard refused: show the link selected so it can be copied by hand (never on stream).
      if (document.documentElement.dataset['streamer'] === 'on') {
        this.toast('Copying failed. Turn off streamer mode to see the invite link.');
        return;
      }
      this.#inviteField.value = link;
      this.#inviteField.hidden = false;
      this.#inviteField.select();
      this.toast('Copy the highlighted link and send it to your friends.');
    }
  }
}
