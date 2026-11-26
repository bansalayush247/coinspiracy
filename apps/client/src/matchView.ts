// In-match UI for one joined room: role card, task list, consensus, stations and the result screen.
// Everything shown comes from synced state or validated server messages; the server decides outcomes.
import { audio, type Mood } from './audio/engine.js';
import {
  AuditSchema,
  CeremonyRefusedSchema,
  ChatLineSchema,
  CouncilRefusedSchema,
  FREEZE_RANGE,
  SabotageReadySchema,
  SabotageRefusedSchema,
  ForgedSchema,
  SERVER_MESSAGES,
  STATION_PROMPT_RANGE,
  TASK_KINDS,
  TaskClosedSchema,
  TaskOpenedSchema,
  TaskRefusedSchema,
  TaskResultSchema,
  arenaById,
  atAuditDesk,
  atCouncilSeal,
  hasTask,
  inSigningHall,
  stationNear,
  tierRules,
  TierIdSchema,
  type Arena,
  type CeremonyRefused,
  type CouncilRefused,
  type SabotageRefused,
  type Role,
  type TaskKind,
} from '@byzantine-council/shared';
import type { MatchPhase } from '@byzantine-council/shared/state';
import type { CitadelScene } from './game/CitadelScene.js';
import type { PlayerInput } from './game/input.js';
import type { GameRoom } from './net/session.js';
import { MatchHud } from './ui/matchHud.js';
import { AwardSchema } from '@byzantine-council/shared/progression';
import { Achievements } from './profile/achievements.js';
import { Coach } from './ui/coach.js';
import { RewardsPanel } from './profile/rewards.js';
import { chatText } from './ui/chatText.js';
import { placeName, setPlaces } from './ui/places.js';
import { CouncilPanel, type CouncilMember } from './ui/council.js';
import { el } from './ui/dom.js';
import { ResultCard, RoleCard } from './ui/overlays.js';
import { ProposalsPanel, type PlayerRef } from './ui/proposals.js';
import { TaskPanel } from './ui/tasks/panel.js';
import { t } from './i18n/index.js';

const PROXIMITY_MS = 100;
// Pause after a forgery before the button offers another; the server enforces the real cooldown.
const FORGE_PAUSE_MS = 3000;

type CeremonyAction = 'respond' | 'forge' | 'audit';

function retryWait(retryInMs: number | undefined): string {
  return retryInMs === undefined ? '' : t('refusal.wait', { seconds: String(Math.ceil(retryInMs / 1000)) });
}

function sabotageRefusalText(r: SabotageRefused): string {
  const wait = retryWait(r.retryInMs);
  switch (r.reason) {
    case 'cannotAct':
      return t('refusal.cannotAct');
    case 'notYet':
      return t('sabotage.notYet', { wait });
    case 'cooldown':
      return t('sabotage.cooldown', { wait });
    case 'active':
      return t('sabotage.active');
    case 'notHere':
      return t('sabotage.notHere');
    case 'invalidTarget':
      return t('sabotage.invalidTarget');
    case 'offTier':
      return t('tier.offTier');
  }
}

function councilRefusalText(r: CouncilRefused): string {
  const wait = retryWait(r.retryInMs);
  switch (r.reason) {
    case 'notHere':
      return t('councilRefused.notHere');
    case 'notYet':
      return t('councilRefused.notYet');
    case 'cooldown':
      return t('councilRefused.cooldown', { wait });
    case 'usedUp':
      return t('councilRefused.usedUp');
    case 'cannotAct':
      return t('refusal.cannotAct');
    case 'votingClosed':
      return t('councilRefused.votingClosed');
    case 'alreadyVoted':
      return t('councilRefused.alreadyVoted');
    case 'selfVote':
      return t('councilRefused.selfVote');
    case 'invalidTarget':
      return t('councilRefused.invalidTarget');
    case 'chatLimit':
      return t('councilRefused.chatLimit');
  }
}

function refusalText(r: CeremonyRefused, action: CeremonyAction): string {
  const wait = retryWait(r.retryInMs);
  switch (r.reason) {
    case 'notOpen':
      return t('ceremonyRefused.notOpen');
    case 'alreadyResponded':
      return t('ceremonyRefused.alreadyResponded');
    case 'cannotAct':
      return t('refusal.cannotAct');
    case 'notHere':
      return action === 'forge' ? t('ceremonyRefused.forgeHere', { place: placeName('signingHall') }) : t('ceremonyRefused.auditHere', { place: placeName('ledgerArchive') });
    case 'cooldown':
      return t(action === 'forge' ? 'ceremonyRefused.forgeCooldown' : 'ceremonyRefused.auditCooldown', { wait });
    case 'busy':
      return t('ceremonyRefused.busy');
    case 'tooMany':
      return t('ceremonyRefused.tooMany');
    case 'notYet':
      return t('ceremonyRefused.notYet');
    case 'audited':
      return t('ceremonyRefused.audited');
    case 'partitioned':
      return t('ceremonyRefused.partitioned');
    case 'offTier':
      return t('tier.offTier');
  }
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
}

export class MatchView {
  readonly #hud = new MatchHud();
  readonly #panel = new TaskPanel();
  readonly #roleCard = new RoleCard();
  readonly #result = new ResultCard();
  readonly #proposals = new ProposalsPanel();
  readonly #council = new CouncilPanel();
  // Which arena's place names are showing.
  #placesFor = '';
  readonly #rewards = new RewardsPanel();
  readonly #achievements = new Achievements();
  readonly #coach = new Coach();
  // Called after this player's rewards arrive, so the profile can be refreshed.
  onRewards: () => void = () => undefined;
  readonly #callCouncil = el('call-council', HTMLButtonElement);
  readonly #outNote = el('out-note', HTMLParagraphElement);
  // This player's vote in the council with this number, remembered locally until the result.
  #myVote: { number: number; target: string } | null = null;
  readonly #cut = el('cut', HTMLButtonElement);
  readonly #freezeButton = el('freeze', HTMLButtonElement);
  readonly #frozenNote = el('frozen-note', HTMLParagraphElement);
  readonly #partitionBanner = el('partition-banner', HTMLDivElement);
  readonly #partitionTime = el('partition-time', HTMLElement);
  readonly #partitionText = el('partition-text', HTMLParagraphElement);
  readonly #repairFill = el('repair-fill', HTMLDivElement);
  // Byzantine only: when this player's sabotage is ready again (performance.now time).
  #cutReadyAt = Infinity;
  #freezeReadyAt = Infinity;
  #freezeTarget: string | null = null;
  #lastPartition = 0;
  #lastOutages = 0;
  #lastAct = '';
  // Signatures and refusals already shown, so each one stamps once.
  readonly #stamped = new Set<string>();
  #stampsPrimed = false;
  #celebrated = false;
  #councilStage = '';
  readonly #forgeBox = el('forge-box', HTMLDivElement);
  readonly #forge = el('forge', HTMLButtonElement);
  readonly #forgeHint = el('forge-hint', HTMLParagraphElement);
  // What this player privately knows; cleared at every match start.
  readonly #audits = new Map<string, boolean>();
  readonly #forgedByTeam = new Set<string>();
  #auditing: string | null = null;
  #atDesk = false;
  #inHall = false;
  #forgeWaitUntil = 0;
  #lastAction: CeremonyAction = 'respond';
  onToast: (message: string) => void = () => undefined;
  #room: GameRoom | null = null;
  #phase: MatchPhase | null = null;
  #roleShown = false;
  #timer = 0;
  #unsubscribe: (() => void)[] = [];

  constructor(
    private readonly scene: CitadelScene,
    private readonly input: PlayerInput,
  ) {
    this.#result.onShared = (outcome) => {
      if (outcome === 'saved') this.onToast(t('share.saved'));
      else if (outcome === 'failed') this.onToast(t('share.failed'));
    };
    this.#hud.onInteract = (kind) => {
      this.#open(kind);
    };
    // The SDK queues sends while reconnecting; the server has dropped the challenge by then, so skip them.
    this.#panel.onAnswer = (id, answer) => {
      if (this.#room?.connection.isOpen === true) this.#room.send('taskAnswer', { id, answer });
    };
    this.#panel.onCancel = () => {
      if (this.#room?.connection.isOpen === true) this.#room.send('closeTask');
    };
    this.#proposals.onSign = (id) => {
      this.#lastAction = 'respond';
      this.#room?.send('signProposal', { proposalId: id });
    };
    this.#proposals.onRefuse = (id) => {
      this.#lastAction = 'respond';
      this.#room?.send('refuseProposal', { proposalId: id });
    };
    this.#proposals.onAudit = (id) => {
      this.#lastAction = 'audit';
      this.#room?.send('auditProposal', { proposalId: id });
    };
    this.#council.onVote = (target) => {
      const number = this.#room?.state.council.number ?? 0;
      this.#myVote = { number, target };
      this.#room?.send('castVote', { target });
      this.refresh();
    };
    this.#council.onChat = (chat) => {
      this.#room?.send('quickChat', { chat });
    };
    this.#callCouncil.addEventListener('click', () => {
      this.#room?.send('callCouncil');
    });
    this.#cut.addEventListener('click', () => {
      this.#room?.send('partition');
    });
    this.#freezeButton.addEventListener('click', () => {
      if (this.#freezeTarget !== null) this.#room?.send('freeze', { targetId: this.#freezeTarget });
    });
    this.#forge.addEventListener('click', () => {
      this.#lastAction = 'forge';
      this.#forgeWaitUntil = performance.now() + FORGE_PAUSE_MS;
      this.#room?.send('forgeProposal');
      this.#updateForge();
    });
    this.#panel.onHidden = () => {
      this.scene.stationBusy(null);
      if (this.#room !== null) this.input.enabled = true;
    };
    window.addEventListener('keydown', (e) => {
      if (this.#room === null || isEditable(e.target) || e.repeat) return;
      if (e.code === 'KeyE' && !this.#panel.isOpen && this.#hud.interactKind !== null) {
        e.preventDefault();
        this.#open(this.#hud.interactKind);
      } else if (e.key === 'Escape') {
        if (this.#panel.isOpen) this.#panel.cancel();
        else this.#roleCard.hide();
      }
    });
  }

  attach(room: GameRoom): void {
    this.detach();
    this.#room = room;
    // Server messages are validated like any other untrusted input before they reach the DOM.
    this.#unsubscribe = [
      room.onMessage(SERVER_MESSAGES.TASK_OPENED, (payload: unknown) => {
        const msg = TaskOpenedSchema.safeParse(payload);
        if (!msg.success) return;
        this.#panel.opened(msg.data);
        this.scene.stationBusy(msg.data.challenge.kind);
      }),
      room.onMessage(SERVER_MESSAGES.TASK_RESULT, (payload: unknown) => {
        const msg = TaskResultSchema.safeParse(payload);
        if (!msg.success) return;
        const kind = this.#panel.kind;
        this.#panel.result(msg.data);
        if (msg.data.ok && kind !== null) this.scene.taskDone(kind);
        if (!msg.data.ok) audio.play('taskFail');
      }),
      room.onMessage(SERVER_MESSAGES.TASK_REFUSED, (payload: unknown) => {
        const msg = TaskRefusedSchema.safeParse(payload);
        if (msg.success) this.#panel.refused(msg.data);
      }),
      room.onMessage(SERVER_MESSAGES.TASK_CLOSED, (payload: unknown) => {
        const msg = TaskClosedSchema.safeParse(payload);
        if (msg.success) this.#panel.closed(msg.data);
      }),
      room.onMessage(SERVER_MESSAGES.FORGED, (payload: unknown) => {
        const msg = ForgedSchema.safeParse(payload);
        if (!msg.success) return;
        this.#forgedByTeam.add(msg.data.proposalId);
        this.onToast(t('match.forged', { id: msg.data.proposalId }));
        this.refresh();
      }),
      room.onMessage(SERVER_MESSAGES.AUDIT, (payload: unknown) => {
        const msg = AuditSchema.safeParse(payload);
        if (!msg.success) return;
        const a = msg.data;
        if (a.status === 'started') {
          this.#auditing = a.proposalId;
        } else if (a.status === 'cancelled') {
          this.#auditing = null;
          this.onToast(t('match.auditStopped', { id: a.proposalId }));
        } else {
          this.#auditing = null;
          this.#audits.set(a.proposalId, a.forged);
          this.onToast(t(a.forged ? 'match.auditForged' : 'match.auditReal', { id: a.proposalId }));
        }
        this.refresh();
      }),
      room.onMessage(SERVER_MESSAGES.MATCH_REWARDS, (payload: unknown) => {
        const msg = AwardSchema.safeParse(payload);
        if (!msg.success) return;
        this.#rewards.onAchievement = (kind, name) => {
          this.#achievements.announce(kind, name);
        };
        this.#rewards.show(msg.data);
        this.onRewards();
      }),
      room.onMessage(SERVER_MESSAGES.SABOTAGE_READY, (payload: unknown) => {
        const msg = SabotageReadySchema.safeParse(payload);
        if (!msg.success) return;
        const now = performance.now();
        this.#cutReadyAt = now + msg.data.partitionInMs;
        this.#freezeReadyAt = now + msg.data.freezeInMs;
        this.#updateForge();
      }),
      room.onMessage(SERVER_MESSAGES.SABOTAGE_REFUSED, (payload: unknown) => {
        const msg = SabotageRefusedSchema.safeParse(payload);
        if (msg.success) this.onToast(sabotageRefusalText(msg.data));
      }),
      room.onMessage(SERVER_MESSAGES.CHAT, (payload: unknown) => {
        const msg = ChatLineSchema.safeParse(payload);
        if (!msg.success) return;
        const from = room.state.players.get(msg.data.from);
        const text = `${from?.name ?? t('match.someone')}: ${chatText(msg.data.chat, (id) => this.#nameOf(id))}`;
        if (this.#council.isOpen) this.#council.addLine(text, from?.seat ?? null);
        else this.onToast(text);
      }),
      room.onMessage(SERVER_MESSAGES.COUNCIL_REFUSED, (payload: unknown) => {
        const msg = CouncilRefusedSchema.safeParse(payload);
        if (!msg.success) return;
        // A refused vote did not count, so the buttons come back.
        if (msg.data.reason !== 'chatLimit') this.#myVote = null;
        this.onToast(councilRefusalText(msg.data));
        this.refresh();
      }),
      room.onMessage(SERVER_MESSAGES.CEREMONY_REFUSED, (payload: unknown) => {
        const msg = CeremonyRefusedSchema.safeParse(payload);
        if (!msg.success) return;
        if (this.#lastAction === 'forge') this.#forgeWaitUntil = 0;
        this.onToast(refusalText(msg.data, this.#lastAction));
        this.#updateForge();
      }),
    ];
    // A dropped connection closes the challenge on the server, so close the panel to match.
    const onDrop = (): void => {
      this.#panel.closed({ reason: 'offline' });
    };
    room.onDrop(onDrop);
    this.#unsubscribe.push(() => {
      room.onDrop.remove(onDrop);
    });
    this.#timer = window.setInterval(() => {
      this.#checkProximity();
    }, PROXIMITY_MS);
  }

  detach(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
    this.#stamped.clear();
    this.#stampsPrimed = false;
    this.scene.setDaylight('day');
    audio.setMood('menu');
    document.documentElement.dataset['phase'] = 'menu';
    window.clearInterval(this.#timer);
    this.#room = null;
    this.#phase = null;
    this.#roleShown = false;
    this.#panel.hide();
    this.#roleCard.hide();
    this.#result.hide();
    this.#hud.show(false);
    this.#proposals.show(false);
    this.#forgeBox.hidden = true;
    this.#council.hide();
    this.#rewards.hide();
    this.#callCouncil.hidden = true;
    this.#outNote.hidden = true;
    this.#councilStage = '';
    this.#resetPrivate();
    this.#resetReadiness();
  }

  #nameOf(id: string): string {
    return this.#room?.state.players.get(id)?.name ?? t('match.guardianLeft');
  }

  // Shows the council while one runs; the map holds still underneath.
  #renderCouncil(): void {
    const room = this.#room;
    if (room === null) return;
    const state = room.state;
    const c = state.council;
    const stage = state.phase === 'playing' ? c.stage : '';
    if (stage !== this.#councilStage) {
      if (stage === 'voting' && this.#councilStage === '') {
        this.onToast(t('match.councilCalled', { name: this.#nameOf(c.calledBy) }));
        this.scene.councilCalled();
        this.#coach.tip('council');
        this.#panel.hide();
        this.#roleCard.hide();
      }
      if (stage === '') this.#council.hide();
      this.#councilStage = stage;
      this.input.enabled = stage === '' && !this.#panel.isOpen;
    }
    if (stage === '') return;
    const me = state.players.get(room.sessionId);
    const voted = new Set(c.voted);
    const members: CouncilMember[] = [...state.players]
      .map(([id, p]) => ({ id, name: p.name, seat: p.seat, voted: voted.has(id), out: p.out, isMe: id === room.sessionId }))
      .sort((a, b) => a.seat - b.seat);
    const myVote = this.#myVote?.number === c.number ? this.#myVote.target : null;
    this.#council.show(
      {
        stage,
        number: c.number,
        calledBy: c.calledBy,
        secondsLeft: c.secondsLeft,
        members,
        myVote: myVote ?? (voted.has(room.sessionId) ? 'skip' : null),
        canVote: me?.status === 'active' && !me.out && room.connection.isOpen,
        ballots: new Map(c.ballots),
        ejected: c.ejected,
        proposals: Array.from(state.proposals, (p) => p.id),
      },
      (id) => this.#nameOf(id),
    );
  }

  // Sabotage readiness arrives with the match start, so it is cleared when a match ends, not when one begins.
  #resetReadiness(): void {
    this.#cutReadyAt = Infinity;
    this.#freezeReadyAt = Infinity;
  }

  #resetPrivate(): void {
    this.#freezeTarget = null;
    this.#lastPartition = 0;
    this.#lastOutages = 0;
    this.#audits.clear();
    this.#forgedByTeam.clear();
    this.#auditing = null;
    this.#forgeWaitUntil = 0;
    this.#proposals.reset();
  }

  // Re-reads the room state; cheap, and called once per patch at most.
  // The arena the room is on: names in prompts and chat, and where stations and the seal are.
  #arena(): Arena {
    return arenaById(this.#room?.state.arena);
  }

  refresh(): void {
    const room = this.#room;
    if (room === null) return;
    const state = room.state;
    const arena = this.#arena();
    if (arena.id !== this.#placesFor) {
      this.#placesFor = arena.id;
      setPlaces(arena);
      this.#council.relabelPlaces();
    }
    const me = state.players.get(room.sessionId);
    const phase = state.phase;
    const roles = new Map<string, Role>();
    for (const [id, p] of state.players) if (p.role !== undefined) roles.set(id, p.role);
    const myRole = me?.role;
    const fellows = [...state.players]
      .filter(([id, p]) => id !== room.sessionId && p.role === 'byzantine' && myRole === 'byzantine')
      .map(([, p]) => p.name);

    if (phase !== this.#phase) {
      const previous = this.#phase;
      this.#phase = phase;
      if (phase === 'playing') {
        this.#result.hide();
        this.#rewards.hide();
        this.#roleShown = false;
        this.#resetPrivate();
      } else {
        this.#resetReadiness();
        this.#panel.hide();
        this.#roleCard.hide();
        this.#hud.setInteract(null);
        this.scene.setFocusStation(null);
      }
      if (phase === 'lobby' && previous !== null) this.#result.hide();
    }
    // Re-rendered while it shows, in case the recap lands after the phase change.
    if (phase === 'ended' && !this.#celebrated) {
      this.#celebrated = true;
      this.scene.celebrate(state.winner === 'byzantine' ? 'byzantine' : 'honest');
    }
    if (phase !== 'ended') this.#celebrated = false;
    if (phase === 'ended') {
      this.#result.show(
        state.winner === 'byzantine' ? 'byzantine' : 'honest',
        state.winReason,
        myRole,
        Array.from(state.recap, (e) => ({ name: e.name, role: e.role, isMe: e.id === room.sessionId, left: e.left })),
      );
    }
    if (phase === 'playing' && !this.#roleShown && myRole !== undefined) {
      this.#roleShown = true;
      this.#roleCard.show(myRole, fellows, state.byzantines);
      this.#coach.tip(myRole === 'byzantine' ? 'byzantine' : 'firstMatch');
    }

    this.scene.setRoles(roles);
    this.#hud.show(phase !== 'lobby');
    this.#hud.setConsensus(state.consensus);
    this.#hud.setRole(myRole, fellows);
    const assigned = me?.tasks ?? 0;
    const done = me?.tasksDone ?? 0;
    this.#hud.setTasks(assigned, done, myRole === 'byzantine');
    this.#hud.setChain(state.blockHeight, state.chainLive);
    const act = phase === 'playing' ? state.act : '';
    this.#hud.setClock(act, state.blocksLeft);
    if (act !== this.#lastAct) {
      // The light follows the match: afternoon, then sunset with the withdrawals, then dusk for the final blocks.
      this.scene.setDaylight(act === 'proposals' ? 'sunset' : act === 'final' ? 'dusk' : 'day');
      if (act === 'proposals' && this.#lastAct === 'calm' && this.#rules().ceremonies) {
        this.onToast(t('match.withdrawalsStart'));
        this.#coach.tip('withdrawals');
      }
      if (act === 'final') this.onToast(t('match.finalBlocks'));
      this.#lastAct = act;
    }
    const todo = new Set<TaskKind>(phase === 'playing' ? TASK_KINDS.filter((k) => hasTask(assigned, k) && !hasTask(done, k)) : []);
    this.scene.setTaskMarkers(todo);
    this.#renderProposals();
    this.#updateForge();
    this.#renderCouncil();
    const out = phase === 'playing' && me?.out === true;
    this.#outNote.hidden = !out;
    this.#renderPartition();
    const frozen = phase === 'playing' ? (me?.frozen ?? 0) : 0;
    this.#frozenNote.hidden = frozen === 0;
    this.#frozenNote.textContent = frozen === 0 ? '' : t('match.frozen', { seconds: String(frozen) });
    this.#syncInput();
    audio.setMood(this.#moodFor(phase, act, myRole));
    document.documentElement.dataset['phase'] = phase;
  }

  // Music follows the moment: the lobby, each act of the block clock, a council, and how the match ended for me.
  #moodFor(phase: string, act: string, myRole: string | undefined): Mood {
    const state = this.#room?.state;
    if (state === undefined || phase === 'lobby') return 'menu';
    if (phase === 'ended') return state.winner === (myRole === 'byzantine' ? 'byzantine' : 'honest') ? 'victory' : 'defeat';
    if (state.council.stage !== '') return 'council';
    return act === 'final' ? 'final' : act === 'proposals' ? 'proposals' : 'calm';
  }

  // Movement is allowed only in open play: no task, council, freeze or rotated-out key.
  #syncInput(): void {
    const room = this.#room;
    if (room === null) return;
    const me = room.state.players.get(room.sessionId);
    const playing = room.state.phase === 'playing';
    const held = playing && (room.state.council.stage !== '' || (me?.frozen ?? 0) > 0 || me?.out === true);
    this.input.enabled = !held && !this.#panel.isOpen;
  }

  #renderPartition(): void {
    const room = this.#room;
    if (room === null) return;
    const s = room.state;
    const left = s.phase === 'playing' ? s.partition : 0;
    this.#partitionBanner.hidden = left === 0;
    if (left > 0) this.#coach.tip('partition');
    this.scene.setRelays(left > 0, s.relays);
    if (left > 0) {
      const held = [0, 1].filter((i) => (s.relays & (1 << i)) !== 0).length;
      this.#partitionTime.textContent = `${String(left)}s`;
      this.#partitionText.textContent = s.repair > 0 ? t('match.repairing') : t('match.partitionHelp', { held: String(held) });
      this.#repairFill.style.width = `${String(s.repair)}%`;
    }
    if (s.phase === 'playing') {
      if (left > 0 && this.#lastPartition === 0) this.onToast(t('match.partitioned'));
      if (left === 0 && this.#lastPartition > 0 && s.outages === this.#lastOutages) this.onToast(t('match.repaired'));
      if (s.outages > this.#lastOutages) this.onToast(t('match.partitionTimedOut'));
    }
    this.#lastPartition = left;
    this.#lastOutages = s.outages;
  }

  #renderProposals(): void {
    const room = this.#room;
    if (room === null) return;
    const state = room.state;
    const playing = state.phase === 'playing';
    this.#proposals.show(playing);
    if (!playing) {
      this.#stamped.clear();
      this.#stampsPrimed = false;
      return;
    }
    // Each new signature or refusal stamps a seal over the guardian who gave it.
    for (const p of state.proposals) {
      for (const [list, signed] of [[p.signers, true], [p.refusers, false]] as const) {
        for (const id of list) {
          const key = `${p.id}:${id}`;
          if (this.#stamped.has(key)) continue;
          this.#stamped.add(key);
          if (this.#stampsPrimed) this.scene.stamp(id, signed);
        }
      }
    }
    this.#stampsPrimed = true;
    const players = new Map<string, PlayerRef>();
    for (const [id, p] of state.players) players.set(id, { name: p.name, seat: p.seat });
    const me = state.players.get(room.sessionId);
    this.#proposals.render(
      Array.from(state.proposals, (p) => ({
        id: p.id,
        amount: p.amount,
        status: p.status,
        secondsLeft: p.secondsLeft,
        signers: Array.from(p.signers),
        refusers: Array.from(p.refusers),
        verdict: p.verdict,
      })),
      {
        me: room.sessionId,
        needed: state.signaturesNeeded,
        strikes: state.livenessStrikes,
        // Frozen guardians and a partitioned network cannot sign; the server refuses too.
        canAct: me?.status === 'active' && !me.out && me.frozen === 0 && state.partition === 0 && state.council.stage === '' && room.connection.isOpen,
        atDesk: this.#atDesk,
        players,
        audits: this.#audits,
        auditing: this.#auditing,
        forgedByTeam: this.#forgedByTeam,
      },
    );
  }

  // The joined room's rule tier; anything unexpected shows every control and leaves the refusals to the server.
  #rules(): ReturnType<typeof tierRules> {
    return tierRules(TierIdSchema.catch('full').parse(this.#room?.state.tier));
  }

  // Byzantines only: the forge control, usable inside the Signing Hall.
  #updateForge(): void {
    const room = this.#room;
    const me = room?.state.players.get(room.sessionId);
    const rules = this.#rules();
    const show = room !== null && room.state.phase === 'playing' && me?.role === 'byzantine' && !me.out && (rules.forging || rules.partition || rules.freeze);
    this.#forgeBox.hidden = !show;
    if (!show) return;
    this.#forge.hidden = !rules.forging;
    this.#forgeHint.hidden = !rules.forging;
    this.#cut.hidden = !rules.partition;
    const now = performance.now();
    const resting = now < this.#forgeWaitUntil;
    const able = me.status === 'active' && me.frozen === 0 && room.state.council.stage === '';
    this.#forge.disabled = !this.#inHall || resting || !able;
    const cutIn = Math.ceil((this.#cutReadyAt - now) / 1000);
    this.#cut.disabled = !able || room.state.partition > 0 || cutIn > 0;
    this.#cut.textContent = room.state.partition > 0 ? t('match.networkCut') : cutIn > 0 && Number.isFinite(cutIn) ? t('match.cutIn', { seconds: String(cutIn) }) : t('match.cut');
    const target = this.#freezeTarget === null ? undefined : room.state.players.get(this.#freezeTarget);
    const freezeIn = Math.ceil((this.#freezeReadyAt - now) / 1000);
    this.#freezeButton.hidden = target === undefined || !rules.freeze;
    this.#freezeButton.disabled = !able || freezeIn > 0;
    if (target !== undefined) this.#freezeButton.textContent = freezeIn > 0 && Number.isFinite(freezeIn) ? t('match.freezeIn', { name: target.name, seconds: String(freezeIn) }) : t('match.freeze', { name: target.name });
    this.#forgeHint.textContent = !this.#inHall ? t('match.goForge', { place: placeName('signingHall') }) : t(resting ? 'match.filing' : 'match.seen');
  }

  // Offers the station the player is standing at, if its task is still to do.
  #checkProximity(): void {
    const room = this.#room;
    if (room === null) return;
    const me = room.state.players.get(room.sessionId);
    const pos = this.scene.predictedPosition();
    let kind: TaskKind | null = null;
    const free = room.state.phase === 'playing' && me?.status === 'active' && !me.out && me.frozen === 0 && room.state.council.stage === '';
    // Byzantines: the closest guardian within reach can be disconnected.
    let target: string | null = null;
    if (free && pos !== null && me.role === 'byzantine') {
      let best = FREEZE_RANGE;
      for (const [id, p] of room.state.players) {
        if (id === room.sessionId || p.out || p.frozen > 0 || p.status !== 'active') continue;
        const d = Math.hypot(p.x - pos.x, p.y - pos.y);
        if (d <= best) {
          best = d;
          target = id;
        }
      }
    }
    this.#freezeTarget = target;
    if (free && pos !== null && !this.#panel.isOpen) {
      const near = stationNear(pos, STATION_PROMPT_RANGE, this.#arena().stations);
      if (near !== null && hasTask(me.tasks ?? 0, near) && !hasTask(me.tasksDone ?? 0, near)) kind = near;
    }
    this.#hud.setInteract(kind);
    this.scene.setFocusStation(kind);
    this.#callCouncil.hidden = !(free && pos !== null && atCouncilSeal(pos, this.#arena().seal) && !this.#panel.isOpen);
    const playing = room.state.phase === 'playing' && pos !== null;
    const atDesk = playing && atAuditDesk(pos, this.#arena().stations);
    const inHall = playing && inSigningHall(pos, this.#arena().regions);
    if (atDesk !== this.#atDesk || inHall !== this.#inHall) {
      this.#atDesk = atDesk;
      this.#inHall = inHall;
      this.#renderProposals();
    }
    this.#updateForge();
  }

  #open(kind: TaskKind): void {
    const room = this.#room;
    if (room === null || this.#panel.isOpen || !room.connection.isOpen) return;
    const me = room.state.players.get(room.sessionId);
    this.#roleCard.hide();
    this.#hud.setInteract(null);
    // Standing still while a task is open; walking away would close it anyway.
    this.input.enabled = false;
    this.#panel.opening(kind, me?.role === 'byzantine');
    room.send('openTask', { kind });
  }
}
