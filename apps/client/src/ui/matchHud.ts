import { TASK_KINDS, hasTask, type Act, type Role, type TaskKind } from '@byzantine-council/shared';
import { formatNumber, t, tn } from '../i18n/index.js';
import { el, h } from './dom.js';
import { stationName } from './places.js';
import { TASK_COPY } from './tasks/copy.js';

export class MatchHud {
  readonly #consensus = el('consensus', HTMLDivElement);
  readonly #consensusValue = el('consensus-value', HTMLElement);
  readonly #consensusBar = el('consensus-bar', HTMLDivElement);
  readonly #consensusFill = el('consensus-fill', HTMLDivElement);
  readonly #panel = el('match-panel', HTMLElement);
  readonly #badge = el('role-badge', HTMLDivElement);
  readonly #tasks = el('task-list', HTMLUListElement);
  readonly #note = el('task-note', HTMLParagraphElement);
  readonly #interact = el('interact', HTMLButtonElement);
  readonly #chain = el('chain', HTMLDivElement);
  readonly #chainHeight = el('chain-height', HTMLElement);
  readonly #clock = el('clock', HTMLDivElement);
  readonly #actName = el('act-name', HTMLElement);
  readonly #blocksLeft = el('blocks-left', HTMLElement);
  #interactKind: TaskKind | null = null;
  onInteract: (kind: TaskKind) => void = () => undefined;

  constructor() {
    this.#interact.addEventListener('click', () => {
      if (this.#interactKind !== null) this.onInteract(this.#interactKind);
    });
  }

  get interactKind(): TaskKind | null {
    return this.#interactKind;
  }

  show(on: boolean): void {
    this.#consensus.hidden = !on;
    this.#panel.hidden = !on;
    if (!on) this.setInteract(null);
  }

  setConsensus(percent: number): void {
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    this.#consensusValue.textContent = `${String(p)}%`;
    this.#consensusBar.setAttribute('aria-valuenow', String(p));
    this.#consensusFill.style.width = `${String(p)}%`;
  }

  setRole(role: Role | undefined, fellows: readonly string[]): void {
    this.#badge.dataset['role'] = role ?? '';
    this.#badge.replaceChildren(h('span', 'eyebrow', t('match.yourRole')), h('b', '', role === 'byzantine' ? t('match.byzGuardian') : role === 'honest' ? t('match.honestGuardian') : '…'));
    if (role === 'byzantine' && fellows.length > 0) this.#badge.append(h('span', 'team', t('match.with', { names: fellows.join(', ') })));
  }

  setTasks(assigned: number, done: number, fake: boolean): void {
    const items = TASK_KINDS.filter((kind) => hasTask(assigned, kind)).map((kind) => {
      const finished = hasTask(done, kind);
      const li = h('li', finished ? 'done' : '');
      li.dataset['kind'] = kind;
      li.append(h('span', 'check', finished ? '✓' : ''), h('span', '', t(TASK_COPY[kind].title)), h('span', 'where', stationName(kind)));
      return li;
    });
    this.#tasks.replaceChildren(...items);
    this.#note.textContent = t(fake ? 'match.fakeNote' : 'match.taskNote');
  }

  // The block clock under the Consensus bar.
  setClock(act: Act | '', left: number): void {
    this.#clock.hidden = act === '';
    this.#clock.dataset['act'] = act;
    this.#actName.textContent = act === 'calm' ? t('act.calm') : act === 'proposals' ? t('act.proposals') : act === 'final' ? t('act.final') : '';
    this.#blocksLeft.textContent = tn('match.blocksLeft', left);
  }

  setChain(height: number, live: boolean): void {
    this.#chain.hidden = height <= 0;
    this.#chainHeight.textContent = `${live ? '' : '≈'}${formatNumber(height)}`;
    this.#chain.title = t(live ? 'match.chainLive' : 'match.chainEstimated');
  }

  setInteract(kind: TaskKind | null): void {
    if (kind === this.#interactKind) return;
    this.#interactKind = kind;
    this.#interact.hidden = kind === null;
    if (kind !== null) this.#interact.textContent = t('match.use', { station: stationName(kind) });
  }
}
