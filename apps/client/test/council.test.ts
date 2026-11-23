// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@byzantine-council/shared';
import page from '../index.html?raw';
import { chatText } from '../src/ui/chatText.js';
import { CouncilPanel, type CouncilView } from '../src/ui/council.js';

function loadPage(): void {
  const doc = new DOMParser().parseFromString(page, 'text/html');
  for (const script of doc.querySelectorAll('script')) script.remove();
  document.body.replaceChildren(...Array.from(doc.body.childNodes, (n) => document.importNode(n, true)));
}

const NAMES: Record<string, string> = { 'player-a1': 'Alice', 'player-b2': 'Bob', 'player-c3': 'Cara' };
const nameOf = (id: string): string => NAMES[id] ?? '?';

function view(over: Partial<CouncilView> = {}): CouncilView {
  return {
    stage: 'voting',
    number: 1,
    calledBy: 'player-b2',
    secondsLeft: 42,
    members: [
      { id: 'player-a1', name: 'Alice', seat: 0, voted: false, out: false, isMe: true },
      { id: 'player-b2', name: 'Bob', seat: 1, voted: true, out: false, isMe: false },
      { id: 'player-c3', name: 'Cara', seat: 2, voted: false, out: true, isMe: false },
    ],
    myVote: null,
    canVote: true,
    ballots: new Map(),
    ejected: '',
    proposals: ['3', '4'],
    ...over,
  };
}

function member(id: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`#council-members [data-id="${id}"]`);
  if (node === null) throw new Error(`no member ${id}`);
  return node;
}

let panel: CouncilPanel;
let votes: string[];
let chats: ChatMessage[];

beforeEach(() => {
  loadPage();
  panel = new CouncilPanel();
  votes = [];
  chats = [];
  panel.onVote = (t) => votes.push(t);
  panel.onChat = (c) => chats.push(c);
});

describe('council panel', () => {
  it('opens with who called it and the time left, and offers votes for others only', () => {
    panel.show(view(), nameOf);
    expect(panel.isOpen).toBe(true);
    expect(document.getElementById('council-title')?.textContent).toBe('Called by Bob');
    expect(document.getElementById('council-timer')?.textContent).toBe('42s');
    expect(member('player-a1').querySelector('button')).toBeNull();
    expect(member('player-b2').textContent).toContain('Voted');
    expect(member('player-c3').textContent).toContain('Rotated out');
    expect(member('player-c3').querySelector('button')).toBeNull();
    member('player-b2').querySelector('button')?.click();
    document.getElementById('council-skip')?.click();
    expect(votes).toEqual(['player-b2', 'skip']);
  });

  it('locks the vote once cast', () => {
    panel.show(view({ myVote: 'player-b2' }), nameOf);
    expect(member('player-b2').querySelector('button')?.disabled).toBe(true);
    expect(member('player-b2').querySelector('button')?.textContent).toBe('Your vote');
    expect((document.getElementById('council-skip') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the ballots and the outcome at the result, without revealing roles', () => {
    panel.show(view({ stage: 'result', ballots: new Map([['player-a1', 'player-b2'], ['player-b2', 'skip']]), ejected: 'player-b2' }), nameOf);
    expect(member('player-a1').textContent).toContain('→ Bob');
    expect(member('player-b2').textContent).toContain('skipped');
    const outcome = document.getElementById('council-outcome');
    expect(outcome?.hidden).toBe(false);
    expect(outcome?.textContent).toContain('Bob’s key was rotated out');
    expect(outcome?.textContent).not.toMatch(/Byzantine|honest/i);
    expect(document.getElementById('council-skip')?.hidden).toBe(true);
    expect(document.getElementById('chat-compose')?.hidden).toBe(true);
  });

  it('sends quick-chat phrases built from the pickers', () => {
    panel.show(view(), nameOf);
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#chat-compose button'));
    const press = (label: string): void => {
      buttons.find((b) => b.textContent === label)?.click();
    };
    press('Where were you?');
    press('I suspect them');
    press('I audited: forged');
    expect(chats).toEqual([
      { phrase: 'whereWereYou' },
      { phrase: 'suspect', playerId: 'player-b2' },
      { phrase: 'audited', proposalId: '3', forged: true },
    ]);
  });

  it('cannot chat after being rotated out', () => {
    panel.show(view({ canVote: false }), nameOf);
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('#chat-compose button')).every((b) => b.disabled)).toBe(true);
  });

  it('keeps a bounded chat log that starts fresh each council', () => {
    panel.show(view(), nameOf);
    for (let i = 0; i < 80; i++) panel.addLine(`line ${String(i)}`, 1);
    expect(document.querySelectorAll('#chat-log li')).toHaveLength(60);
    panel.show(view({ number: 2 }), nameOf);
    expect(document.querySelectorAll('#chat-log li')).toHaveLength(0);
  });
});

describe('chat text', () => {
  it('reads every phrase in plain words', () => {
    expect(chatText({ phrase: 'sawAt', playerId: 'player-c3', room: 'signingHall' }, nameOf)).toBe('I saw Cara in the Signing Hall.');
    expect(chatText({ phrase: 'audited', proposalId: '7', forged: false }, nameOf)).toBe('I audited #7: it’s real.');
    expect(chatText({ phrase: 'dontSign', proposalId: '7' }, nameOf)).toBe('Don’t sign #7!');
    expect(chatText({ phrase: 'iWasIn', room: 'vault' }, nameOf)).toBe('I was in the Vault.');
    expect(chatText({ phrase: 'skipVote' }, nameOf)).toBe('Let’s skip this vote.');
  });
});
