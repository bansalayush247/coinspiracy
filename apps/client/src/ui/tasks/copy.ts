import type { TaskKind } from '@byzantine-council/shared';
import type { PlainKey } from '../../i18n/index.js';

// Station names depend on the arena: see stationName() in ../places.ts.
export interface TaskCopy {
  // What the player does here, used on the task list and the panel title.
  readonly title: PlainKey;
  // One line on the real idea behind the task.
  readonly concept: PlainKey;
}

export const TASK_COPY: Readonly<Record<TaskKind, TaskCopy>> = {
  deposit: { title: 'taskCopy.deposit.title', concept: 'taskCopy.deposit.concept' },
  ledger: { title: 'taskCopy.ledger.title', concept: 'taskCopy.ledger.concept' },
  route: { title: 'taskCopy.route.title', concept: 'taskCopy.route.concept' },
  watchtower: { title: 'taskCopy.watchtower.title', concept: 'taskCopy.watchtower.concept' },
};
