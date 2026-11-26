// The council overlay: vote to rotate a guardian's key out, and talk in quick-chat phrases.
// Choices stay hidden until the result; the server decides the outcome.
import { ROOMS, SIMPLE_PHRASES, type ChatMessage, type RoomId } from '@byzantine-council/shared';
import { cssColor, seatColors } from '../game/palette.js';
import { SIMPLE_TEXT } from './chatText.js';
import { placeName } from './places.js';
import { onLocaleChange, t, type PlainKey } from '../i18n/index.js';
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

function select(label: PlainKey): HTMLSelectElement {
  const s = h('select', 'chat-select');
  s.dataset['label'] = label;
  s.setAttribute('aria-label', t(label));
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
  readonly #who = select('council.who');
  readonly #proposal = select('council.proposal');
  readonly #room = select('council.place');
  readonly #phraseKeys = new Map<HTMLButtonElement, PlainKey>();
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
    onLocaleChange(() => {
      this.relabelPlaces();
      for (const s of [this.#who, this.#proposal, this.#room]) s.setAttribute('aria-label', t(s.dataset['label'] as PlainKey));
      for (const [b, key] of this.#phraseKeys) b.textContent = t(key);
      this.#key = '';
    });
  }

  get isOpen(): boolean {
    return !this.#root.hidden;
  }

  #buildCompose(): void {
    const say = (key: PlainKey, make: () => ChatMessage | null): HTMLButtonElement => {
      const b = button(t(key), 'phrase');
      this.#phraseKeys.set(b, key);
      b.addEventListener('click', () => {
        const chat = make();
        if (chat !== null) this.onChat(chat);
      });
      return b;
    };
    const simple = h('div', 'phrases');
    for (const phrase of SIMPLE_PHRASES) simple.append(say(SIMPLE_TEXT[phrase], () => ({ phrase })));

    const about = h('div', 'phrases');
    const who = (): string | null => (this.#who.value === '' ? null : this.#who.value);
    about.append(
      this.#who,
      say('council.suspect', () => {
        const id = who();
        return id === null ? null : { phrase: 'suspect', playerId: id };
      }),
      say('council.trust', () => {
        const id = who();
        return id === null ? null : { phrase: 'trust', playerId: id };
      }),
      say('council.sawThem', () => {
        const id = who();
        return id === null ? null : { phrase: 'sawAt', playerId: id, room: this.#room.value as RoomId };
      }),
    );

    const place = h('div', 'phrases');
    place.append(
      this.#room,
      say('council.wasThere', () => ({ phrase: 'iWasIn', room: this.#room.value as RoomId })),
    );

    const withdrawal = h('div', 'phrases');
    const pid = (): string | null => (this.#proposal.value === '' ? null : this.#proposal.value);
    withdrawal.append(
      this.#proposal,
      say('council.dontSign', () => {
        const id = pid();
        return id === null ? null : { phrase: 'dontSign', proposalId: id };
      }),
      say('council.signIt', () => {
        const id = pid();
        return id === null ? null : { phrase: 'signIt', proposalId: id };
      }),
      say('council.auditedForged', () => {
        const id = pid();
        return id === null ? null : { phrase: 'audited', proposalId: id, forged: true };
      }),
      say('council.auditedReal', () => {
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
    this.#kind.textContent = t('council.number', { n: String(view.number) });
    this.#title.textContent = t('council.calledBy', { name: nameOf(view.calledBy) });
    this.#timer.textContent = `${String(view.secondsLeft)}s`;
    this.#lead.textContent = t(view.stage === 'voting' ? 'council.leadVoting' : 'council.leadResult');

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
        view.stage !== 'result' ? '' : view.ejected === '' ? t('council.noneOut') : t('council.ejected', { name: nameOf(view.ejected) });
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
      li.append(dot, h('span', 'name', m.isMe ? t('council.you', { name: m.name }) : m.name));
      if (m.out) {
        li.append(h('span', 'tag left', t('council.rotatedOut')));
      } else if (view.stage === 'voting') {
        if (m.voted) li.append(h('span', 'tag honest', t('council.voted')));
        if (!m.isMe) {
          const vote = button(t(view.myVote === m.id ? 'council.yourVote' : 'council.vote'), 'vote');
          vote.disabled = !view.canVote || view.myVote !== null;
          vote.setAttribute('aria-label', t('council.voteAria', { name: m.name }));
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
        li.append(h('span', 'ballot', target === undefined ? t('council.didNotVote') : target === 'skip' ? t('council.skipped') : `→ ${nameOf(target)}`));
        if (view.ejected === m.id) li.append(h('span', 'rotated-stamp', t('council.keyRotated')));
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
    for (const b of this.#phraseKeys.keys()) b.disabled = !this.#canChat;
    this.#compose.hidden = view.stage !== 'voting';
  }
}
