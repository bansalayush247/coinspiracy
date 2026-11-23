// Screenshots from the end-to-end test, converted to WebP by scripts/render-screens.ts.

export interface Screen {
  readonly name: string;
  // PNG in .scratch/e2e/ that the script converts.
  readonly from: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
}

export const SCREEN_WIDTH = 960;

export const SCREENS = {
  match: { name: 'match', from: 'match-hud.png', alt: 'A guardian in the Mint Citadel with the task list, Consensus bar, block height and a withdrawal waiting for signatures', width: 960, height: 600 },
  deposit: { name: 'deposit', from: 'task-deposit.png', alt: 'The Deposit Gate task: splitting a deposit into power-of-two notes before blinding them', width: 960, height: 600 },
  ledger: { name: 'ledger', from: 'task-ledger.png', alt: 'The Ledger Archive task: a batch of notes to check for bad seals and spent serials', width: 960, height: 600 },
  route: { name: 'route', from: 'task-route.png', alt: 'The Gateway Dock task: a small Lightning network with channel balances and a payment to route', width: 960, height: 600 },
  watchtower: { name: 'watchtower', from: 'task-watchtower.png', alt: 'The Watchtower task: seven guardians report a block height and you pick the agreed one', width: 960, height: 600 },
  council: { name: 'council', from: 'council.png', alt: 'A council meeting with quick-chat messages and a vote on which guardian to rotate out', width: 960, height: 600 },
  rewards: { name: 'rewards', from: 'rewards.png', alt: 'The rewards panel after a match with XP lines, a rank-up and a new seal', width: 960, height: 600 },
} as const satisfies Record<string, Screen>;

export function screenPath(screen: Screen): string {
  return `/screens/${screen.name}.webp`;
}
