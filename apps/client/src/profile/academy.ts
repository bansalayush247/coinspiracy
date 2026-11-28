// The Academy, client side: pick a level, read what it teaches, solve its drills, earn stars.
// The server runs the drills and decides the stars; this only shows them.
import { ISLAND_DRILL_MIN_MS, TASK_TIMING, isTaskKind, type DrillAnswer, type DrillKind } from '@byzantine-council/shared';
import { ACADEMY_LEVELS, ACADEMY_MAX_STARS, ACADEMY_MESSAGES, AcademyDoneSchema, AcademyDrillSchema, AcademyRefusedSchema, AcademyResultSchema, ISLANDS, type AcademyDone, type AcademyDrill } from '@byzantine-council/shared/progression';
import type { Room } from '@colyseus/sdk';
import { audio } from '../audio/engine.js';
import { el, h } from '../ui/dom.js';
import { t, tn, type PlainKey } from '../i18n/index.js';
import { depositGame } from '../ui/tasks/deposit.js';
import { ledgerGame } from '../ui/tasks/ledger.js';
import { routeGame } from '../ui/tasks/route.js';
import { button, type MinigameHost } from '../ui/tasks/types.js';
import { watchtowerGame } from '../ui/tasks/watchtower.js';
import { ISLAND_DRILL_TITLES, councilGame, partitionGame, quorumGame, thresholdGame, type DrillHost } from '../ui/tasks/islandDrills.js';
import { TASK_COPY } from '../ui/tasks/copy.js';
import type { ProfileSummary } from './api.js';

// Answers wait out the server's minimum solve time, plus a margin for clock jitter.
const SEND_MARGIN_MS = 150;

const REFUSED: Readonly<Record<string, PlainKey>> = {
  unknownLevel: 'academy.unknownLevel',
  locked: 'academy.locked',
  busy: 'academy.busy',
  timedOut: 'academy.timedOut',
};

function stars(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, ACADEMY_MAX_STARS - n));
}

function seconds(ms: number): string {
  return `${String(Math.round(ms / 1000))}s`;
}

export class AcademyPanel {
  readonly #root = el('academy', HTMLElement);
  readonly #body = el('academy-body', HTMLDivElement);
  readonly #status = el('academy-status', HTMLParagraphElement);
  #room: Room | null = null;
  #profile: ProfileSummary | null = null;
  #drill: { id: string; kind: DrillKind; openedAt: number } | null = null;
  #timer = 0;
  // Opens a solo room on the server; the caller owns the session.
  connect: () => Promise<Room> = () => Promise.reject(new Error('not connected'));
  onFinished: () => void = () => undefined;
  /** Called each time the Academy closes. */
  onClosed: () => void = () => undefined;

  constructor() {
    el('academy-close', HTMLButtonElement).addEventListener('click', () => {
      this.close();
    });
    this.#root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  setProfile(p: ProfileSummary): void {
    this.#profile = p;
  }

  open(): void {
    audio.setMood('academy');
    this.#root.hidden = false;
    this.#levels();
    this.#root.focus();
  }

  close(): void {
    window.clearTimeout(this.#timer);
    const wasOpen = !this.#root.hidden;
    if (wasOpen) audio.setMood('menu');
    this.#root.hidden = true;
    this.#drill = null;
    const room = this.#room;
    this.#room = null;
    void room?.leave();
    if (wasOpen) this.onClosed();
  }

  #setStatus(text: string, tone: '' | 'good' | 'bad' = ''): void {
    this.#status.textContent = text;
    this.#status.dataset['tone'] = tone;
  }

  #levels(): void {
    this.#setStatus('');
    const progress = this.#profile?.progress.academy;
    // One heading and list per island, in the order the islands open on the world map.
    const groups: HTMLElement[] = [];
    const ordered = ISLANDS.flatMap((isle) => ACADEMY_LEVELS.filter((l) => l.island === isle.id).map((l) => ({ level: l, isle: isle.name })));
    let list: HTMLElement | null = null;
    let island = '';
    for (const { level, isle } of ordered) {
      if (level.island !== island || list === null) {
        island = level.island;
        list = h('ol', 'academy-levels');
        groups.push(h('h4', 'academy-island', isle), list);
      }
      const mine = progress?.find((a) => a.level === level.level);
      // Without a profile nothing is saved, so every level is open.
      const open = mine?.open ?? true;
      const li = h('li', open ? 'level' : 'level locked');
      // The medallion takes the colour of the level's station; mixed levels are violet.
      const kinds = new Set(level.drills);
      const only = level.drills[0];
      li.dataset['kind'] = kinds.size === 1 && only !== undefined && isTaskKind(only) ? only : 'mixed';
      const medal = h('span', 'medal', String(level.level));
      medal.setAttribute('aria-hidden', 'true');
      const pick = button(t(open ? 'academy.play' : 'progress.locked'), open ? 'cta' : '');
      pick.disabled = !open;
      pick.setAttribute('aria-label', t(open ? 'academy.playAria' : 'academy.lockedAria', { n: String(level.level), name: level.name }));
      pick.addEventListener('click', () => {
        this.#intro(level.level);
      });
      li.append(medal, h('b', '', `${String(level.level)}. ${level.name}`), h('span', 'teaches', level.teaches), h('span', 'stars', stars(mine?.stars ?? 0)), pick);
      list.append(li);
    }
    const lead = t(this.#profile === null ? 'academy.leadGuest' : 'academy.lead');
    this.#body.replaceChildren(h('p', 'concept', lead), ...groups);
  }

  #intro(n: number): void {
    const level = ACADEMY_LEVELS.find((l) => l.level === n);
    if (level === undefined) return;
    const start = button(t('academy.start'), 'cta');
    const back = button(t('academy.backToLevels'));
    back.addEventListener('click', () => {
      this.#levels();
    });
    start.addEventListener('click', () => {
      void this.#start(n);
    });
    this.#body.replaceChildren(
      h('h3', '', `${String(level.level)}. ${level.name}`),
      h('p', 'concept', level.intro),
      h('p', 'hint', t('academy.drills', { n: String(level.drills.length), par: seconds(level.parMs) })),
      h('div', 'academy-actions'),
    );
    this.#body.lastElementChild?.append(start, back);
    start.focus();
  }

  async #start(n: number): Promise<void> {
    this.#setStatus(t('academy.opening'));
    try {
      if (this.#room === null) {
        const room = await this.connect();
        this.#room = room;
        room.onMessage(ACADEMY_MESSAGES.DRILL, (p: unknown) => {
          const d = AcademyDrillSchema.safeParse(p);
          if (d.success) this.#show(d.data);
        });
        room.onMessage(ACADEMY_MESSAGES.RESULT, (p: unknown) => {
          const r = AcademyResultSchema.safeParse(p);
          if (!r.success) return;
          this.#setStatus(r.data.ok ? t('academy.correct') : t('academy.notQuite', { wait: seconds(r.data.retryInMs ?? 0) }), r.data.ok ? 'good' : 'bad');
        });
        room.onMessage(ACADEMY_MESSAGES.DONE, (p: unknown) => {
          const d = AcademyDoneSchema.safeParse(p);
          if (d.success) this.#done(d.data);
        });
        room.onMessage(ACADEMY_MESSAGES.REFUSED, (p: unknown) => {
          const r = AcademyRefusedSchema.safeParse(p);
          if (r.success) this.#setStatus(t(REFUSED[r.data.reason] ?? 'academy.failed'), 'bad');
        });
        room.onLeave(() => {
          if (this.#room === room) this.#room = null;
        });
      }
      this.#room.send('start', { level: n });
      this.#setStatus('');
    } catch {
      this.#setStatus(t('academy.unreachable'), 'bad');
    }
  }

  #show(d: AcademyDrill): void {
    window.clearTimeout(this.#timer);
    const kind = d.challenge.kind;
    this.#drill = { id: d.id, kind, openedAt: performance.now() };
    const host: MinigameHost & DrillHost = {
      submit: (answer: DrillAnswer) => {
        this.#submit(d.id, answer);
      },
    };
    const game = h('div', 'task-body academy-game');
    const header = h('div', 'academy-drill');
    header.append(h('b', '', isTaskKind(kind) ? t(TASK_COPY[kind].title) : ISLAND_DRILL_TITLES[kind]), h('span', 'hint', t('academy.drillOf', { n: String(d.index + 1), total: String(d.total) })));
    this.#body.replaceChildren(header, game);
    const c = d.challenge;
    if (c.kind === 'deposit') depositGame(game, c, host);
    else if (c.kind === 'ledger') ledgerGame(game, c, host);
    else if (c.kind === 'route') routeGame(game, c, host);
    else if (c.kind === 'watchtower') watchtowerGame(game, c, host);
    else if (c.kind === 'threshold') thresholdGame(game, c, host);
    else if (c.kind === 'quorum') quorumGame(game, c, host);
    else if (c.kind === 'council') councilGame(game, c, host);
    else partitionGame(game, c, host);
  }

  #submit(id: string, answer: DrillAnswer): void {
    const drill = this.#drill;
    if (drill?.id !== id) return;
    this.#setStatus(t('academy.checking'));
    const minMs = isTaskKind(drill.kind) ? TASK_TIMING.minSolveMs[drill.kind] : ISLAND_DRILL_MIN_MS[drill.kind];
    const wait = Math.max(0, minMs + SEND_MARGIN_MS - (performance.now() - drill.openedAt));
    this.#timer = window.setTimeout(() => {
      if (this.#drill?.id === id) this.#room?.send('answer', { id, answer });
    }, wait);
  }

  #done(d: AcademyDone): void {
    this.#drill = null;
    const level = ACADEMY_LEVELS.find((l) => l.level === d.level);
    // The next level on the same island; the island's last level offers none.
    const nextLevel = ACADEMY_LEVELS.find((l) => l.island === level?.island && l.level > d.level);
    const parts: HTMLElement[] = [
      h('h3', '', t('academy.cleared', { name: level?.name ?? t('academy.level') })),
      h('p', 'academy-stars', stars(d.stars)),
      h('p', 'hint', tn('academy.result', d.mistakes, { time: seconds(d.timeMs), par: seconds(d.parMs) })),
    ];
    if (d.award !== null && d.award.xpAfter > d.award.xpBefore) parts.push(h('p', 'concept', t('academy.award', { xp: String(d.award.xpAfter - d.award.xpBefore), sats: String(d.award.sats) })));
    if (d.award === null) parts.push(h('p', 'hint', t('academy.notSaved')));
    const actions = h('div', 'academy-actions');
    if (nextLevel !== undefined) {
      const next = button(t('academy.next', { name: nextLevel.name }), 'cta');
      next.addEventListener('click', () => {
        this.#intro(nextLevel.level);
      });
      actions.append(next);
    }
    const again = button(t('cases.again'));
    again.addEventListener('click', () => {
      this.#intro(d.level);
    });
    const back = button(t('academy.backToLevels'));
    back.addEventListener('click', () => {
      this.#levels();
    });
    actions.append(again, back);
    parts.push(actions);
    this.#body.replaceChildren(...parts);
    this.#setStatus(t(d.stars === ACADEMY_MAX_STARS ? 'academy.perfect' : 'academy.clearedShort'), 'good');
    this.onFinished();
  }
}
