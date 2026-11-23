// The page registry: one entry per Codex page, plus the home and index pages.
import type { QA } from '../lib/jsonld.js';
import { SOURCES, type Source, type SourceKey } from './sources.js';

export const PUBLISHED = '2026-11-23';

export interface CodexPage {
  readonly slug: string;
  // <title> and og:title; at most 60 characters.
  readonly title: string;
  readonly h1: string;
  // Meta description; 70 to 160 characters.
  readonly description: string;
  readonly published: string;
  readonly modified: string;
  readonly about: readonly string[];
  // In citation order: the first key is [1] on the page.
  readonly sources: readonly SourceKey[];
  readonly related: readonly string[];
  // Where the idea shows up in a match.
  readonly inGame: string;
  readonly faq: readonly QA[];
}

export const CODEX: readonly CodexPage[] = [
  {
    slug: 'byzantine-fault-tolerance',
    title: 'Byzantine fault tolerance, explained by a game',
    h1: 'Byzantine fault tolerance',
    description: 'How a group agrees when some members lie or fail: the Byzantine Generals Problem, why it matters for federations, and how the game turns it into play.',
    published: PUBLISHED,
    modified: PUBLISHED,
    about: ['Byzantine fault tolerance', 'Consensus', 'Byzantine Generals Problem'],
    sources: ['lsp', 'pbft', 'aleph', 'fmArchitecture'],
    related: ['one-third-rule', 'federations-and-guardians', 'block-height-consensus'],
    inGame: 'One or two guardians are secretly Byzantine. They look like everyone else, forge withdrawals and sabotage the citadel. The council can rotate a suspect out, but every honest guardian you remove by mistake weakens the federation.',
    faq: [
      { q: 'What does “Byzantine” mean here?', a: 'A Byzantine fault is any behaviour at all, including lying, sending different stories to different peers or going silent. It is the worst case a system can face, so a protocol that survives it survives simpler crashes too.' },
      { q: 'Is a Byzantine guardian always malicious?', a: 'No. A buggy server, a wrong clock or a stolen key look the same from outside. The protocol does not need to know why a member misbehaves, only that not too many of them do.' },
    ],
  },
  {
    slug: 'one-third-rule',
    title: 'The one-third rule: why f < n/3',
    h1: 'The one-third rule',
    description: 'Why a federation of n guardians tolerates at most ⌊(n−1)/3⌋ faulty ones, and why it needs n − f signatures to act. With a table for 4 to 10 guardians.',
    published: PUBLISHED,
    modified: PUBLISHED,
    about: ['Byzantine fault tolerance', 'Quorum', 'Threshold signatures'],
    sources: ['lsp', 'pbft', 'fmNumPeers'],
    related: ['byzantine-fault-tolerance', 'federations-and-guardians', 'ecash-blind-signatures'],
    inGame: 'Role counts follow the rule: 1 Byzantine guardian in a 5 or 6 player match, 2 in a 7 to 9 player match. A withdrawal needs n − f signatures. If the Byzantines ever make up a third of the guardians still seated, the federation halts and they win.',
    faq: [
      { q: 'Why not just use a simple majority?', a: 'A majority is enough when members can only crash. When they can lie, two honest guardians may hear different stories from the same liar. Quorums of n − f guarantee that any two quorums share at least one honest guardian, which is what keeps everyone consistent.' },
      { q: 'How many guardians does a federation need to survive one failure?', a: 'Four. With n = 4, f = ⌊3/3⌋ = 1, and actions need 3 signatures. Three guardians tolerate no Byzantine faults at all.' },
    ],
  },
  {
    slug: 'federations-and-guardians',
    title: 'Federations and guardians in Fedimint',
    h1: 'Federations and guardians',
    description: 'A Fedimint federation is a group of guardians who run a mint together. What guardians do, what you trust them with, and what they cannot see.',
    published: PUBLISHED,
    modified: PUBLISHED,
    about: ['Fedimint', 'Federation', 'Guardian', 'Custody'],
    sources: ['fmHowItWorks', 'fmFederations', 'fmGuardians', 'fmFounding', 'fmTrust', 'fmArchitecture'],
    related: ['one-third-rule', 'ecash-blind-signatures', 'lightning-gateways'],
    inGame: 'Every player is a guardian of the Mint Citadel. Honest guardians finish tasks to fill the Consensus bar and sign only real withdrawals; the federation succeeds when enough of them agree.',
    faq: [
      { q: 'Do guardians know how much ecash I hold?', a: 'No. Notes are issued with blind signatures, so guardians sign without seeing what they sign and cannot link a note back to the deposit that created it.' },
      { q: 'Can guardians run off with the funds?', a: 'A threshold of them acting together could, because they jointly hold the bitcoin. That is the trust you place in a federation, which is why guardians are usually people or groups who know their users.' },
    ],
  },
  {
    slug: 'ecash-blind-signatures',
    title: 'Ecash and blind signatures',
    h1: 'Ecash and blind signatures',
    description: 'How a mint can sign a note without seeing it, why that makes ecash private, and how Fedimint splits the signing key across guardians.',
    published: PUBLISHED,
    modified: PUBLISHED,
    about: ['Ecash', 'Blind signature', 'Chaumian ecash', 'Threshold signatures'],
    sources: ['chaum', 'fmTbs', 'fmHowItWorks', 'fmTrust'],
    related: ['power-of-two-notes', 'double-spending', 'federations-and-guardians'],
    inGame: 'At the Deposit Gate you split a deposit into notes, blind each one, collect the guardians’ signatures and unblind them. The server checks every step.',
    faq: [
      { q: 'If the mint cannot see the note, how does it know the note is valid?', a: 'It knows the note is worth exactly the amount of the key it used, because each denomination has its own key. It does not need to see the note’s contents to vouch for its value.' },
      { q: 'Is blinding the same as encryption?', a: 'No. Encryption hides data from everyone without the key. Blinding hides the note from the signer only, and the person who blinded it can remove the blinding afterwards while keeping the signature valid.' },
    ],
  },
  {
    slug: 'power-of-two-notes',
    title: 'Why ecash notes come in powers of two',
    h1: 'Power-of-two notes',
    description: 'Fedimint notes come in power-of-two denominations. How any amount splits into a few notes, and why standard sizes help privacy.',
    published: PUBLISHED,
    modified: PUBLISHED,
    about: ['Ecash', 'Denominations', 'Binary representation'],
    sources: ['fmDenominations', 'fmTiered', 'fmTbs'],
    related: ['ecash-blind-signatures', 'double-spending'],
    inGame: 'The Deposit Gate shows note buttons from 64 down to 1. Paying 45 means picking 32, 8, 4 and 1: the same notes as the binary digits of 45.',
    faq: [
      { q: 'What if I need change?', a: 'Your wallet trades notes it holds for new notes in the sizes it needs. Each new note is blinded again, so the swap does not link old notes to new ones.' },
      { q: 'Why not let people pick any amount for a note?', a: 'An unusual amount would stand out and could be linked to the person who asked for it. With a small set of standard sizes, every note of a size looks like every other.' },
    ],
  },
  {
    slug: 'double-spending',
    title: 'Double-spending and the spent-note ledger',
    h1: 'Double-spending',
    description: 'Digital notes can be copied, so a mint must refuse the same note twice. How Fedimint keeps a ledger of spent notes, and what makes a note invalid.',
    published: PUBLISHED,
    modified: PUBLISHED,
    about: ['Double-spending', 'Ecash', 'Ledger'],
    sources: ['whitepaper', 'fmSpentIndex', 'fmMintInput', 'chaum'],
    related: ['ecash-blind-signatures', 'power-of-two-notes', 'byzantine-fault-tolerance'],
    inGame: 'At the Ledger Archive you check a batch of notes and reject the bad ones: a seal that does not verify, or a serial already in the spent list. Byzantine guardians try to slip forged notes in.',
    faq: [
      { q: 'Does the spent list reveal who spent what?', a: 'No. It holds note serials, which the mint saw for the first time when the note was spent. Because notes were signed blind, a serial cannot be traced back to a deposit.' },
      { q: 'Why can’t I spend a note twice if I send both copies at the same moment?', a: 'Guardians order every transaction through consensus first, so one of the two always comes first. The second one finds the serial already marked spent.' },
    ],
  },
  {
    slug: 'lightning-gateways',
    title: 'Lightning gateways and route liquidity',
    h1: 'Lightning gateways',
    description: 'How a Fedimint gateway pays Lightning invoices for ecash users, and why a Lightning payment needs a route with enough liquidity at every hop.',
    published: PUBLISHED,
    modified: PUBLISHED,
    about: ['Lightning Network', 'Gateway', 'Pathfinding', 'Liquidity'],
    sources: ['fmGateway', 'lnbook', 'fmHowItWorks'],
    related: ['federations-and-guardians', 'ecash-blind-signatures'],
    inGame: 'At the Gateway Dock you route a payment across a small network. Every channel on the path must have enough balance on the sending side, or the payment fails.',
    faq: [
      { q: 'Does a gateway learn who I am?', a: 'It learns the invoice it pays and the ecash it receives, not which ecash user sent it. It is paid a fee for the service.' },
      { q: 'What happens if the gateway takes the ecash but never pays?', a: 'The ecash is locked in a contract that releases to the gateway only when it shows proof the invoice was paid. If it never pays, the user can reclaim the funds after a timeout.' },
    ],
  },
  {
    slug: 'block-height-consensus',
    title: 'How a federation agrees on the block height',
    h1: 'Agreeing on the block height',
    description: 'Each guardian sees its own Bitcoin node. How a federation turns their different reports into one block height that faulty guardians cannot steer.',
    published: PUBLISHED,
    modified: PUBLISHED,
    about: ['Block height', 'Median', 'Consensus', 'Bitcoin'],
    sources: ['btcGlossary', 'btcSpacing', 'fmBlockVotes', 'fmFinality', 'fmWalletDoc'],
    related: ['byzantine-fault-tolerance', 'one-third-rule'],
    inGame: 'At the Watchtower seven guardians report a block height, and one or two of them are wrong. You find the height the federation would agree on. The HUD shows the real block height, fetched by the game server.',
    faq: [
      { q: 'Why not take the highest report?', a: 'Then a single lying guardian could claim any height and the federation would believe it. A median ignores the extremes on both sides.' },
      { q: 'Why wait for extra confirmations?', a: 'The newest blocks can be replaced by a competing chain. Waiting a few blocks before counting a deposit makes that very unlikely.' },
    ],
  },
  {
    slug: 'circular-economies',
    title: 'Circular Bitcoin economies and Bitcoin Beach',
    h1: 'Circular economies',
    description: 'In a circular economy people earn and spend bitcoin locally without converting it. What the Bitcoin Beach project in El Zonte tried, and what happened next.',
    published: PUBLISHED,
    modified: PUBLISHED,
    about: ['Circular economy', 'Bitcoin Beach', 'El Salvador'],
    sources: ['beach', 'beachWork', 'beachPaper', 'imf2021', 'imf2025'],
    related: ['federations-and-guardians', 'lightning-gateways'],
    inGame: 'Beach Town, a hub island coming in a later update, has shops and courier jobs paid in play sats. Nothing in the game uses real money.',
    faq: [
      { q: 'Does the game use real bitcoin?', a: 'No. Play sats are points inside the game. They cannot be bought, sold or withdrawn.' },
      { q: 'Is bitcoin still legal tender in El Salvador?', a: 'In early 2025, as part of an IMF arrangement, El Salvador made accepting bitcoin voluntary for businesses. Read the IMF statement linked below for the details.' },
    ],
  },
];

export const CODEX_SLUGS: readonly string[] = CODEX.map((p) => p.slug);

export function codexPage(slug: string): CodexPage {
  const page = CODEX.find((p) => p.slug === slug);
  if (page === undefined) throw new Error(`no Codex page ${slug}`);
  return page;
}

export function pageSources(page: CodexPage): readonly Source[] {
  return page.sources.map((key) => SOURCES[key]);
}

// 1-based citation number of a source on a page.
export function citationNumber(page: CodexPage, key: SourceKey): number {
  const index = page.sources.indexOf(key);
  if (index < 0) throw new Error(`${page.slug} does not list source ${key}`);
  return index + 1;
}

export const HOME = {
  title: 'Byzantine Council: a social-deduction game about ecash',
  description: 'Guard a federated mint with friends while hidden Byzantine guardians try to forge withdrawals. Free in your browser, 5 to 9 players, play money only.',
  modified: PUBLISHED,
} as const;

export const CODEX_INDEX = {
  title: 'The Codex: how federated ecash works',
  description: 'Short, sourced lessons on Byzantine fault tolerance, ecash, blind signatures, Lightning gateways and the other ideas behind Byzantine Council.',
  modified: PUBLISHED,
} as const;

// Sitemap lastmod for a path; null when the page has no registry entry.
export function lastModifiedFor(pathname: string): string | null {
  if (pathname === '/') return HOME.modified;
  if (pathname === '/codex/') return CODEX_INDEX.modified;
  const match = /^\/codex\/([a-z0-9-]+)\/$/.exec(pathname);
  const page = match?.[1] === undefined ? undefined : CODEX.find((p) => p.slug === match[1]);
  return page === undefined ? null : page.modified;
}
