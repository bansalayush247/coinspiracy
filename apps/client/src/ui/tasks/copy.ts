import type { TaskKind } from '@byzantine-council/shared';

export interface TaskCopy {
  // Station name, as on the map.
  readonly station: string;
  // What the player does here, used on the task list and the panel title.
  readonly title: string;
  // One line on the real idea behind the task.
  readonly concept: string;
}

export const TASK_COPY: Readonly<Record<TaskKind, TaskCopy>> = {
  deposit: {
    station: 'Deposit Gate',
    title: 'Blind-sign a deposit',
    concept: 'Fedimint issues ecash as power-of-two notes. Guardians sign them blinded, so they never learn which notes are yours.',
  },
  ledger: {
    station: 'Ledger Archive',
    title: 'Check the notes',
    concept: 'A note is only good with the federation’s signature, and the mint remembers every note already spent.',
  },
  route: {
    station: 'Gateway Dock',
    title: 'Route a Lightning payment',
    concept: 'Gateways pay out ecash over Lightning. Every channel on the route needs enough liquidity for the payment.',
  },
  watchtower: {
    station: 'Watchtower',
    title: 'Agree on the block height',
    concept: 'Each guardian reports the Bitcoin block height it sees. The federation takes the median, so a few faulty reports can’t move it.',
  },
};
