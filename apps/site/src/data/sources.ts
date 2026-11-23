// Primary sources cited by the Codex. Source-code links are pinned to the commit that was read.

export interface Source {
  // Anchor id on the page ("source-<id>").
  readonly id: string;
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
}

const FEDIMINT = 'https://github.com/fedimint/fedimint/blob/2448a1d296e0c3013bf30fb023f354f92082c1b3';
const BITCOIN_CORE = 'https://github.com/bitcoin/bitcoin/blob/19128e8b77553e4362fcbf3cb8f3f7dc5a2e4253';
const LNBOOK = 'https://github.com/lnbook/lnbook/blob/54453c7b1cf82186614ab929b80876ba18bdc65d';

export const SOURCES = {
  lsp: {
    id: 'lsp-1982',
    title: 'The Byzantine Generals Problem',
    publisher: 'Leslie Lamport, Robert Shostak and Marshall Pease, ACM Transactions on Programming Languages and Systems 4(3), July 1982',
    url: 'https://lamport.azurewebsites.net/pubs/byz.pdf',
  },
  pbft: {
    id: 'pbft-1999',
    title: 'Practical Byzantine Fault Tolerance, section 3: Service Properties',
    publisher: 'Miguel Castro and Barbara Liskov, OSDI 1999',
    url: 'https://www.usenix.org/legacy/events/osdi99/full_papers/castro/castro_html/node3.html',
  },
  aleph: {
    id: 'alephbft',
    title: 'AlephBFT: overview and implementation status',
    publisher: 'Cardinal Cryptography, AlephBFT repository',
    url: 'https://github.com/Cardinal-Cryptography/AlephBFT',
  },
  fmGuardians: {
    id: 'fedimint-guardians',
    title: 'Becoming a Guardian',
    publisher: 'fedimint.org',
    url: 'https://fedimint.org/guardians/intro',
  },
  fmFederations: {
    id: 'fedimint-federations',
    title: 'How Federations Work',
    publisher: 'fedimint.org',
    url: 'https://fedimint.org/guardians/how-federations-work',
  },
  fmFounding: {
    id: 'fedimint-founding',
    title: 'Founding a Federation',
    publisher: 'fedimint.org',
    url: 'https://fedimint.org/guardians/founding',
  },
  fmHowItWorks: {
    id: 'fedimint-how-it-works',
    title: 'How Fedimint Works',
    publisher: 'fedimint.org',
    url: 'https://fedimint.org/users/how-it-works',
  },
  fmTrust: {
    id: 'fedimint-trust',
    title: 'Privacy and Trust',
    publisher: 'fedimint.org',
    url: 'https://fedimint.org/users/privacy-and-trust',
  },
  fmNumPeers: {
    id: 'fedimint-numpeers',
    title: 'NumPeers::max_evil and NumPeers::threshold',
    publisher: 'Fedimint source code, fedimint-core/src/peer_id.rs',
    url: `${FEDIMINT}/fedimint-core/src/peer_id.rs#L93-L115`,
  },
  fmArchitecture: {
    id: 'fedimint-architecture',
    title: 'Fedimint Architecture',
    publisher: 'Fedimint repository, docs/architecture.md',
    url: `${FEDIMINT}/docs/architecture.md`,
  },
  fmTbs: {
    id: 'fedimint-tbs',
    title: 'Threshold Blind Signatures (fedimint-tbs)',
    publisher: 'Fedimint technical reference',
    url: 'https://docs.fedimint.org/crypto/tbs.html',
  },
  chaum: {
    id: 'chaum-1983',
    title: 'Blind Signatures for Untraceable Payments',
    publisher: 'David Chaum, Advances in Cryptology: Proceedings of Crypto 82, Springer, 1983',
    url: 'https://doi.org/10.1007/978-1-4757-0602-4_18',
  },
  fmDenominations: {
    id: 'fedimint-denominations',
    title: 'Mint module: default denomination base and maximum',
    publisher: 'Fedimint source code, modules/fedimint-mint-server/src/lib.rs',
    url: `${FEDIMINT}/modules/fedimint-mint-server/src/lib.rs#L159-L171`,
  },
  fmTiered: {
    id: 'fedimint-tiered',
    title: 'Tiered::gen_denominations',
    publisher: 'Fedimint source code, fedimint-core/src/tiered.rs',
    url: `${FEDIMINT}/fedimint-core/src/tiered.rs#L91-L101`,
  },
  fmSpentIndex: {
    id: 'fedimint-spent-index',
    title: 'Mint database: the spent-note index (NonceKey)',
    publisher: 'Fedimint source code, modules/fedimint-mint-server/src/db.rs',
    url: `${FEDIMINT}/modules/fedimint-mint-server/src/db.rs#L25-L28`,
  },
  fmMintInput: {
    id: 'fedimint-mint-input',
    title: 'Mint module: verify_input and process_input',
    publisher: 'Fedimint source code, modules/fedimint-mint-server/src/lib.rs',
    url: `${FEDIMINT}/modules/fedimint-mint-server/src/lib.rs#L561-L592`,
  },
  whitepaper: {
    id: 'bitcoin-whitepaper',
    title: 'Bitcoin: A Peer-to-Peer Electronic Cash System',
    publisher: 'Satoshi Nakamoto, 2008',
    url: 'https://bitcoin.org/bitcoin.pdf',
  },
  fmGateway: {
    id: 'fedimint-gateway',
    title: 'Fedimint Lightning Gateway',
    publisher: 'Fedimint repository, docs/gateway.md',
    url: `${FEDIMINT}/docs/gateway.md`,
  },
  lnbook: {
    id: 'lnbook-pathfinding',
    title: 'Mastering the Lightning Network, chapter 12: Path Finding and Payment Delivery',
    publisher: 'Andreas M. Antonopoulos, Olaoluwa Osuntokun and René Pickhardt, O’Reilly Media, 2021 (CC BY-SA 4.0)',
    url: `${LNBOOK}/12_path_finding.asciidoc`,
  },
  fmBlockVotes: {
    id: 'fedimint-block-votes',
    title: 'Wallet module: consensus_block_count',
    publisher: 'Fedimint source code, modules/fedimint-wallet-server/src/lib.rs',
    url: `${FEDIMINT}/modules/fedimint-wallet-server/src/lib.rs#L1426-L1445`,
  },
  fmFinality: {
    id: 'fedimint-finality',
    title: 'Wallet module: default_finality_delay',
    publisher: 'Fedimint source code, modules/fedimint-wallet-server/src/lib.rs',
    url: `${FEDIMINT}/modules/fedimint-wallet-server/src/lib.rs#L293-L299`,
  },
  fmWalletDoc: {
    id: 'fedimint-wallet-doc',
    title: 'Wallet Module',
    publisher: 'Fedimint repository, docs/wallet_module.md',
    url: `${FEDIMINT}/docs/wallet_module.md`,
  },
  btcGlossary: {
    id: 'bitcoin-glossary',
    title: 'Glossary: block height',
    publisher: 'Bitcoin developer documentation',
    url: 'https://developer.bitcoin.org/glossary.html',
  },
  btcSpacing: {
    id: 'bitcoin-core-spacing',
    title: 'Mainnet consensus parameters: nPowTargetSpacing and nPowTargetTimespan',
    publisher: 'Bitcoin Core source code, src/kernel/chainparams.cpp',
    url: `${BITCOIN_CORE}/src/kernel/chainparams.cpp#L127-L128`,
  },
  beach: {
    id: 'bitcoin-beach',
    title: 'Bitcoin Beach: the project’s home page',
    publisher: 'bitcoinbeach.com',
    url: 'https://www.bitcoinbeach.com/',
  },
  beachWork: {
    id: 'bitcoin-beach-work',
    title: 'Our Work',
    publisher: 'bitcoinbeach.com',
    url: 'https://www.bitcoinbeach.com/en/our-work',
  },
  beachPaper: {
    id: 'bitcoin-beach-whitepaper',
    title: 'Basis Underlying Bitcoin Beach-Like Efforts (BUBBLEs), the project’s whitepaper',
    publisher: 'bitcoinbeach.com',
    url: 'https://www.bitcoinbeach.com/en/whitepaper',
  },
  imf2021: {
    id: 'imf-2021',
    title: 'El Salvador: Staff Concluding Statement of the 2021 Article IV Mission',
    publisher: 'International Monetary Fund, 22 November 2021',
    url: 'https://www.imf.org/en/News/Articles/2021/11/22/mcs-el-salvador-staff-concluding-statement-of-the-2021-article-iv-mission',
  },
  imf2025: {
    id: 'imf-2025',
    title: 'IMF Executive Board Approves New 40-month US$1.4 billion Extended Fund Facility Arrangement for El Salvador',
    publisher: 'International Monetary Fund, Press Release 25/043, 26 February 2025',
    url: 'https://www.imf.org/en/news/articles/2025/02/26/pr25043-el-salvador-imf-approves-new-40-month-us1-bn-eff-arr',
  },
} as const satisfies Record<string, Source>;

export type SourceKey = keyof typeof SOURCES;
