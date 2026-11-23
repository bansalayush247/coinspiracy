// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { LIVENESS_LIMIT } from '@byzantine-council/shared';
import page from '../index.html?raw';
import { ProposalsPanel, type ProposalView, type ProposalsContext } from '../src/ui/proposals.js';

function loadPage(): void {
  const doc = new DOMParser().parseFromString(page, 'text/html');
  for (const script of doc.querySelectorAll('script')) script.remove();
  document.body.replaceChildren(...Array.from(doc.body.childNodes, (n) => document.importNode(n, true)));
}

const ME = 'player-me-01';
const OTHER = 'player-ot-02';

function view(over: Partial<ProposalView> = {}): ProposalView {
  return { id: '3', amount: 12_400, status: 'open', secondsLeft: 30, signers: [], refusers: [], verdict: '', ...over };
}

function ctx(over: Partial<ProposalsContext> = {}): ProposalsContext {
  return {
    me: ME,
    needed: 4,
    strikes: 0,
    canAct: true,
    atDesk: false,
    players: new Map([
      [ME, { name: 'Alice', seat: 0 }],
      [OTHER, { name: 'Bob', seat: 1 }],
    ]),
    audits: new Map(),
    auditing: null,
    forgedByTeam: new Set(),
    ...over,
  };
}

function card(id = '3'): HTMLElement {
  const node = document.querySelector<HTMLElement>(`.proposal[data-id="${id}"]`);
  if (node === null) throw new Error(`no card ${id}`);
  return node;
}

function buttonIn(node: HTMLElement, label: string): HTMLButtonElement | null {
  return Array.from(node.querySelectorAll('button')).find((b) => b.textContent === label) ?? null;
}

let panel: ProposalsPanel;
let sent: [string, string][];

beforeEach(() => {
  loadPage();
  panel = new ProposalsPanel();
  sent = [];
  panel.onSign = (id) => sent.push(['sign', id]);
  panel.onRefuse = (id) => sent.push(['refuse', id]);
  panel.onAudit = (id) => sent.push(['audit', id]);
});

describe('proposals panel', () => {
  it('shows an empty hint until a withdrawal arrives', () => {
    panel.render([], ctx());
    expect(document.getElementById('proposals-empty')?.hidden).toBe(false);
    panel.render([view()], ctx());
    expect(document.getElementById('proposals-empty')?.hidden).toBe(true);
    expect(card().textContent).toContain('Withdraw 12,400 sats');
    expect(card().textContent).toContain('0/4 signed');
    expect(card().textContent).toContain('30s');
  });

  it('sends sign and refuse, then disables both once this player answered', () => {
    panel.render([view()], ctx());
    buttonIn(card(), 'Sign')?.click();
    buttonIn(card(), 'Refuse')?.click();
    expect(sent).toEqual([
      ['sign', '3'],
      ['refuse', '3'],
    ]);
    panel.render([view({ signers: [ME] })], ctx());
    expect(buttonIn(card(), 'Sign')?.disabled).toBe(true);
    expect(buttonIn(card(), 'Refuse')?.disabled).toBe(true);
    expect(card().textContent).toContain('You signed');
  });

  it('keeps the same buttons, and so keyboard focus, while only the timer changes', () => {
    panel.render([view()], ctx());
    const sign = buttonIn(card(), 'Sign');
    sign?.focus();
    panel.render([view({ secondsLeft: 29 })], ctx());
    expect(buttonIn(card(), 'Sign')).toBe(sign);
    expect(document.activeElement).toBe(sign);
    expect(card().querySelector('.timer')?.textContent).toBe('29s');
  });

  it('offers an audit only at the desk, and only once per proposal', () => {
    panel.render([view()], ctx());
    expect(buttonIn(card(), 'Audit')).toBeNull();
    panel.render([view()], ctx({ atDesk: true }));
    buttonIn(card(), 'Audit')?.click();
    expect(sent).toEqual([['audit', '3']]);
    panel.render([view()], ctx({ atDesk: true, auditing: '3' }));
    expect(buttonIn(card(), 'Audit')).toBeNull();
    expect(card().textContent).toContain('Auditing');
    panel.render([view()], ctx({ atDesk: true, audits: new Map([['3', true]]) }));
    expect(buttonIn(card(), 'Audit')).toBeNull();
    expect(card().textContent).toContain('You checked: forged');
  });

  it('marks the team’s forgeries for Byzantines only through private knowledge', () => {
    panel.render([view()], ctx());
    expect(card().textContent).not.toContain('forgery');
    panel.render([view()], ctx({ forgedByTeam: new Set(['3']) }));
    expect(card().textContent).toContain('Your team’s forgery');
  });

  it('shows the truth and outcome once a proposal closes, without buttons', () => {
    panel.render([view({ status: 'rejected', verdict: 'forged', refusers: [OTHER] })], ctx());
    expect(card().textContent).toContain('Forged');
    expect(card().textContent).toContain('Blocked');
    expect(card().querySelectorAll('button')).toHaveLength(0);
    expect(card().querySelector('.who.refused')?.getAttribute('aria-label')).toBe('Bob refused');
  });

  it('shows liveness as pips that turn as real withdrawals fail', () => {
    panel.render([], ctx({ strikes: 2 }));
    const pips = document.querySelectorAll('#liveness .pip');
    expect(pips).toHaveLength(LIVENESS_LIMIT);
    expect(document.querySelectorAll('#liveness .pip.lost')).toHaveLength(2);
  });

  it('drops cards that left the list and keeps order', () => {
    panel.render([view({ id: '1' }), view({ id: '2' })], ctx());
    panel.render([view({ id: '2' })], ctx());
    expect(Array.from(document.querySelectorAll('.proposal'), (n) => (n as HTMLElement).dataset['id'])).toEqual(['2']);
  });
});
