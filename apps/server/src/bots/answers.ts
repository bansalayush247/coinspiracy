// Task answers for bots: the solution, or a believable slip that still passes the answer schema.
import {
  LEDGER_NOTES,
  MAX_BLOCK_HEIGHT,
  ROUTE_PATHS,
  ROUTE_SOURCE,
  ROUTE_TARGET,
  isValidRoute,
  median,
  solveChallenge,
  type TaskAnswer,
  type TaskChallenge,
} from '@byzantine-council/shared';

export function botAnswer(challenge: TaskChallenge, mistake: boolean): TaskAnswer {
  const right = solveChallenge(challenge);
  return mistake ? slip(challenge, right) : right;
}

function slip(challenge: TaskChallenge, right: TaskAnswer): TaskAnswer {
  switch (challenge.kind) {
    case 'deposit':
      // Forgets the smallest note; every deposit needs at least two.
      return right.kind === 'deposit' ? { kind: 'deposit', notes: right.notes.slice(0, -1) } : right;
    case 'ledger': {
      if (right.kind !== 'ledger') return right;
      const [keep = 0] = right.reject;
      const other = Array.from({ length: LEDGER_NOTES }, (_, i) => i).find((i) => !right.reject.includes(i)) ?? 0;
      return { kind: 'ledger', reject: [keep, other] };
    }
    case 'route': {
      // Picks a route with a channel too small for the payment.
      const wrong = ROUTE_PATHS.find((p) => !isValidRoute(challenge, p));
      return { kind: 'route', path: wrong === undefined ? [ROUTE_SOURCE, 0, 0, 0, ROUTE_TARGET] : [...wrong] };
    }
    case 'watchtower': {
      // Trusts the highest report, which is always one of the faulty ones.
      const middle = median(challenge.reports);
      const highest = Math.max(...challenge.reports);
      return { kind: 'watchtower', height: highest !== middle ? highest : Math.min(MAX_BLOCK_HEIGHT, middle + 1) };
    }
  }
}
