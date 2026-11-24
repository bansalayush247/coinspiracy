// The council overlay: vote to rotate a guardian's key out, and talk in quick-chat phrases.
// Choices stay hidden until the result; the server decides the outcome.
import { ROOMS, SIMPLE_PHRASES, type ChatMessage, type RoomId } from '@byzantine-council/shared';
import { cssColor, seatColors } from '../game/palette.js';
import { SIMPLE_TEXT } from './chatText.js';
import { placeName } from './places.js';
import { el, h } from './dom.js';
import { button } from './tasks/types.js';

export interface CouncilMember {
  readonly id: string;
  readonly name: string;
  readonly seat: number;
  readonly voted: boolean;
  readonly out: boolean;
  readonly isMe: boolean;
}

export interface CouncilView {
  readonly stage: 'voting' | 'result';
  readonly number: number;
  readonly calledBy: string;
  readonly secondsLeft: number;
  readonly members: readonly CouncilMember[];
  // This player's own vote, remembered locally; null until they vote.
  readonly myVote: string | null;
  readonly canVote: boolean;
  // Voter id to target id or 'skip'; only at the result.
  readonly ballots: ReadonlyMap<string, string>;
  readonly ejected: string;
  // Proposal ids that quick chat may mention.
  readonly proposals: readonly string[];
}

const MAX_LOG = 60;

function option(value: string, text: string): HTMLOptionElement {
  const o = h('option', '', text);
  o.value = value;
  return o;
}

function select(label: string): HTMLSelectElement {
  const s = h('select', 'chat-select');
  s.setAttribute('aria-label', label);
  return s;
}

export class CouncilPanel {
  readonly #root = el('council', HTMLElement);
  readonly #kind = el('council-kind', HTMLParagraphElement);
  readonly #title = el('council-title', HTMLHeadingElement);
  readonly #timer = el('council-timer', HTMLElement);
  readonly #lead = el('council-lead', HTMLParagraphElement);
  readonly #members = el('council-members', HTMLUListElement);
  readonly #skip = el('council-skip', HTMLButtonElement);
  readonly #outcome = el('council-outcome', HTMLParagraphElement);
  readonly #log = el('chat-log', HTMLOListElement);
  readonly #compose = el('chat-compose', HTMLDivElement);
  readonly #who = select('Guardian');
  readonly #proposal = select('Withdrawal');
  readonly #room = select('Place');
  readonly #phraseButtons: HTMLButtonElement[] = [];
  #key = '';
  #shownNumber = 0;
  #canChat = false;
  onVote: (target: string) => void = () => undefined;
  onChat: (chat: ChatMessage) => void = () => undefined;

  // Place options follow the arena being played.
  relabelPlaces(): void {
    this.#room.replaceChildren(...ROOMS.map((r) => option(r, placeName(r))));
  }

  constructor() {
    this.#skip.addEventListener('click', () => {
      this.onVote('skip');
    });
    this.relabelPlaces();
    this.#buildCompose();
  }

  get isOpen(): boolean {
    return !this.#root.hidden;
  }

  #buildCompose(): void {
    const say = (text: string, make: () => ChatMessage | null): HTMLButtonElement => {
      const b = button(text, 'phrase');
      b.addEventListener('click', () => {
        const chat = make();
        if (chat !== null) this.onChat(chat);
      });
      this.#phraseButtons.push(b);
      return b;
    };
    const simple = h('div', 'phrases');
    for (const phrase of SIMPLE_PHRASES) simple.append(say(SIMPLE_TEXT[phrase], () => ({ phrase })));

    const about = h('div', 'phrases');
    const who = (): string | null => (this.#who.value === '' ? null : this.#who.value);
    about.append(
      this.#who,
      say('I suspect them', () => {
        const id = who();
        return id === null ? null : { phrase: 'suspect', playerId: id };
      }),
      say('I trust them', () => {
        const id = who();
        return id === null ? null : { phrase: 'trust', playerId: id };
      }),
      say('I saw them in…', () => {
        const id = who();
        return id === null ? null : { phrase: 'sawAt', playerId: id, room: this.#room.value as RoomId };
      }),
    );

    const place = h('div', 'phrases');
    place.append(
      this.#room,
      say('I was there', () => ({ phrase: 'iWasIn', room: this.#room.value as RoomId })),
    );

    const withdrawal = h('div', 'phrases');
    const pid = (): string | null => (this.#proposal.value === '' ? null : this.#proposal.value);
    withdrawal.append(
      this.#proposal,
      say('Don’t sign it', () => {
        const id = pid();
        return id === null ? null : { phrase: 'dontSign', proposalId: id };
      }),
      say('Sign it', () => {
        const id = pid();
        return id === null ? null : { phrase: 'signIt', proposalId: id };
      }),
      say('I audited: forged', () => {
        const id = pid();
        return id === null ? null : { phrase: 'audited', proposalId: id, forged: true };
      }),
      say('I audited: real', () => {
        const id = pid();
        return id === null ? null : { phrase: 'audited', proposalId: id, forged: false };
      }),
    );
    this.#compose.append(simple, about, place, withdrawal);
  }

  show(view: CouncilView, nameOf: (id: string) => string): void {
    const opening = this.#root.hidden;
    if (view.number !== this.#shownNumber) {
      this.#shownNumber = view.number;
      this.#log.replaceChildren();
    }
    this.#root.hidden = false;
    this.#root.dataset['stage'] = view.stage;
    this.#kind.textContent = `Council #${String(view.number)}`;
    this.#title.textContent = `Called by ${nameOf(view.calledBy)}`;
    this.#timer.textContent = `${String(view.secondsLeft)}s`;
    this.#lead.textContent =
      view.stage === 'voting'
        ? 'Vote to rotate a guardian’s key out, or skip. A key is rotated out only if one guardian gets more votes than anyone else and more than the skips.'
        : 'The votes are in.';

    const key = JSON.stringify([view.stage, view.members, view.myVote, view.canVote, [...view.ballots], view.ejected, view.proposals]);
    if (key !== this.#key) {
      this.#key = key;
      this.#renderMembers(view, nameOf);
      this.#renderCompose(view);
      this.#skip.hidden = view.stage !== 'voting';
      this.#skip.disabled = !view.canVote || view.myVote !== null;
      this.#outcome.hidden = view.stage !== 'result';
      this.#outcome.style.setProperty('--n', String(view.members.length));
      this.#outcome.textContent =
        view.stage !== 'result' ? '' : view.ejected === '' ? 'No key was rotated out.' : `${nameOf(view.ejected)}’s key was rotated out. Their role stays secret until the match ends.`;
    }
    if (opening) this.#root.focus();
  }

  hide(): void {
    this.#root.hidden = true;
    this.#key = '';
  }

  addLine(text: string, seat: number | null): void {
    const li = h('li', '');
    const dot = h('span', 'seat');
    if (seat !== null) dot.style.background = cssColor(seatColors(seat).lit);
    li.append(dot, h('span', '', text));
    this.#log.append(li);
    while (this.#log.childElementCount > MAX_LOG) this.#log.firstElementChild?.remove();
    li.scrollIntoView({ block: 'nearest' });
  }

  #renderMembers(view: CouncilView, nameOf: (id: string) => string): void {
    const items = view.members.map((m, i) => {
      const li = h('li', ['member', m.out ? 'out' : '', m.isMe ? 'me' : '', view.ejected === m.id ? 'ejected' : ''].filter(Boolean).join(' '));
      li.dataset['id'] = m.id;
      const dot = h('span', 'seat');
      dot.style.background = cssColor(seatColors(m.seat).lit);
      li.append(dot, h('span', 'name', m.isMe ? `${m.name} (you)` : m.name));
      if (m.out) {
        li.append(h('span', 'tag left', 'Rotated out'));
      } else if (view.stage === 'voting') {
        if (m.voted) li.append(h('span', 'tag honest', 'Voted'));
        if (!m.isMe) {
          const vote = button(view.myVote === m.id ? 'Your vote' : 'Vote', 'vote');
          vote.disabled = !view.canVote || view.myVote !== null;
          vote.setAttribute('aria-label', `Vote to rotate out ${m.name}`);
          vote.addEventListener('click', () => {
            this.onVote(m.id);
          });
          li.append(vote);
        }
      } else {
        const target = view.ballots.get(m.id);
        // Ballots turn over one after another, like cards on a table.
        li.style.setProperty('--i', String(i));
        li.classList.add('revealed');
        li.append(h('span', 'ballot', target === undefined ? 'did not vote' : target === 'skip' ? 'skipped' : `→ ${nameOf(target)}`));
        if (view.ejected === m.id) li.append(h('span', 'rotated-stamp', 'Key rotated'));
      }
      return li;
    });
    this.#members.replaceChildren(...items);
  }

  #renderCompose(view: CouncilView): void {
    this.#canChat = view.stage === 'voting' && view.canVote;
    const keepWho = this.#who.value;
    this.#who.replaceChildren(...view.members.filter((m) => !m.isMe).map((m) => option(m.id, m.name)));
    if (view.members.some((m) => m.id === keepWho)) this.#who.value = keepWho;
    const keepProposal = this.#proposal.value;
    this.#proposal.replaceChildren(...view.proposals.map((id) => option(id, `#${id}`)));
    if (view.proposals.includes(keepProposal)) this.#proposal.value = keepProposal;
    this.#proposal.disabled = view.proposals.length === 0;
    for (const b of this.#phraseButtons) b.disabled = !this.#canChat;
    this.#compose.hidden = view.stage !== 'voting';
  }
}
