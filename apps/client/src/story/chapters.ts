// The Chronicle of Concordia: an original story told in chapters that open with the islands.
// Each chapter ties its plot to the idea its island teaches.

export type Motif = 'fall' | 'seal' | 'hands' | 'scales' | 'storm' | 'reef' | 'town' | 'rise';

export interface Chapter {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  // The island whose opening unlocks this chapter; null for the prologue.
  readonly island: string | null;
  // Extra rank needed beyond the island, for the epilogue.
  readonly rank?: number;
  readonly motif: Motif;
  readonly pages: readonly string[];
  // One line on the real idea behind the chapter, with a Codex page to read more.
  readonly idea: string;
  readonly codex: string;
}

export const NARRATOR = 'Oro, Archivist of the Mint';

export const CHAPTERS: readonly Chapter[] = [
  {
    id: 'prologue',
    number: 0,
    title: 'The Island That Fell',
    island: null,
    motif: 'fall',
    pages: [
      'Long ago the islands of Concordia floated higher than the clouds. Each one was held up by its ledger stone, and a ledger stone stays aloft only while the people who keep it agree on what it says.',
      'The greatest island was the Old Mint. It had one keeper, one key, and one vault. When that keeper made a mistake no one could catch, the stone cracked, and the Old Mint sank into the clouds with everyone’s savings.',
      'The survivors swore that no single hand would ever hold a vault again. They founded the Council: many guardians, many keys, and a rule that enough of them must agree before anything moves.',
      'You have just arrived on Mint Island to take the guardian’s oath. I am Oro, keeper of the archive. Welcome. We need you more than you know.',
    ],
    idea: 'A single custodian is a single point of failure. Federations spread trust over many guardians.',
    codex: 'federations-and-guardians',
  },
  {
    id: 'mint',
    number: 1,
    title: 'Notes in the Dark',
    island: 'mint',
    motif: 'seal',
    pages: [
      'Your first nights at the Deposit Gate are quiet work: islanders hand in their silver, and you seal notes for them without ever seeing what they wrote. That is the oath of the blind seal. A guardian vouches for a note’s value, never for its owner.',
      'Then the Ledger Archive finds a note with a seal that is almost right. The wax is the right colour and the stamp is the right shape, but the mark inside is hollow.',
      'Someone inside the citadel is forging. The forger signs the false notes with a hollow circle, and the archivists have started to call them the Hollow Seal.',
    ],
    idea: 'Blind signatures let a mint sign a note without seeing it, so no one can trace who spends it.',
    codex: 'ecash-blind-signatures',
  },
  {
    id: 'signing',
    number: 2,
    title: 'Many Hands',
    island: 'signing',
    motif: 'hands',
    pages: [
      'On Signing Isle every withdrawal needs the hands of many guardians. One signature is never enough; a threshold must agree, and the threshold is set so that liars alone can never reach it.',
      'A request arrives to move the whole harbour fund. It looks perfect. Three guardians sign before an auditor at the Ledger Archive finds the hollow mark. It is stopped one signature short.',
      'In the morning, the guardian Vell, who signed first, is gone. On their desk lies a single hollow seal pressed into wax.',
    ],
    idea: 'Threshold signatures: a federation of n guardians acts only when n − f of them agree.',
    codex: 'one-third-rule',
  },
  {
    id: 'council',
    number: 3,
    title: 'A Third Is Too Many',
    island: 'council',
    motif: 'scales',
    pages: [
      'Council Isle keeps the oldest law of Concordia, carved around the great seal: while fewer than a third of the keepers lie, the stone stays up. When a third or more lie, it stops.',
      'Fear spreads, and the council starts casting out anyone who looks guilty. Each honest keeper sent away brings the liars closer to a third. You watch the ledger stone tremble after a wrong vote.',
      'The Hollow Seal does not need to win a vote. It only needs us to throw out our own. From now on, we judge by evidence: signatures, audits, and who stood where.',
    ],
    idea: 'Byzantine fault tolerance: f faulty members out of n can be tolerated only while n ≥ 3f + 1.',
    codex: 'byzantine-fault-tolerance',
  },
  {
    id: 'watchtower',
    number: 4,
    title: 'When the Bridges Break',
    island: 'watchtower',
    motif: 'storm',
    pages: [
      'Storms sweep the Watchtower Peaks and the light-bridges between the islands flicker out. Cut off from each other, the guardians can no longer agree on anything, and every signature stalls.',
      'You and a stranger hold the two relays through the storm until the bridges spark back to life. In the clear air the lookout reads the true block height from the stars again.',
      'But the storm had a pattern. Someone switched the relays off from inside the tower. Hollow marks are scratched into the relay housings.',
    ],
    idea: 'A network partition splits a federation; without enough connected guardians it cannot reach consensus.',
    codex: 'block-height-consensus',
  },
  {
    id: 'reef',
    number: 5,
    title: 'Currents of Light',
    island: 'reef',
    motif: 'reef',
    pages: [
      'Below the cliffs the Lightning Reef glows with channels of light that carry payments between islands faster than any boat. Each channel can only carry what is stored on its side.',
      'The reef’s gateway keeper teaches you to read the currents: a payment needs a path where every link is strong enough. Following the strongest currents, you trace the forged notes to one dock.',
      'It is Vell’s dock. Vell is there, frightened, not hiding. The Hollow Seal took their key and forged in their name. The forger is someone who wants the Old Mint back: one vault, one key, and themselves holding it.',
    ],
    idea: 'Lightning routes a payment through channels; every hop needs enough liquidity on the sending side.',
    codex: 'lightning-gateways',
  },
  {
    id: 'beach',
    number: 6,
    title: 'The Town That Pays in Light',
    island: 'beach',
    rank: 10,
    motif: 'town',
    pages: [
      'Beach Town is where it matters. Fishers, cooks and surfers are paid in sealed notes, buy pupusas and coffee with them, and pay each other again. The money goes round the town instead of leaving it.',
      'Every note in their pockets is safe only because the guardians keep agreeing. The townsfolk do not know your name, and that is the point. You keep the mint honest so they never have to think about it.',
      'At the harbour you find the Hollow Seal’s last plan: a fake withdrawal of the whole town fund, timed for the next storm. There is one more council to hold.',
    ],
    idea: 'A circular economy keeps money moving inside a community; a federation can be its local, private bank.',
    codex: 'circular-economies',
  },
  {
    id: 'epilogue',
    number: 7,
    title: 'The Mint Rises',
    island: 'beach',
    rank: 12,
    motif: 'rise',
    pages: [
      'The storm comes and the forged withdrawal arrives, but this time the guardians are ready. Auditors call it out, the council weighs the evidence, and not one honest key is lost.',
      'The Hollow Seal steps forward and puts down a stolen key. Without a single vault to rule, a single key opens nothing. Their plan was never going to work against many hands.',
      'That night the clouds part over the old wreck. Slowly, held up by the agreement of every island, the Old Mint begins to rise. This time it has many keepers. You are one of them.',
    ],
    idea: 'Security that does not depend on trusting any one person: that is what a federation is for.',
    codex: 'federations-and-guardians',
  },
];
