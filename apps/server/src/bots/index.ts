// Practice bots: the surface app.ts and CitadelRoom wire in (see docs/lanes/bots.md, Integration).
import { isIP } from 'node:net';
import { BotManager, type BotManagerOptions } from './manager.js';

export { BotManager, DEFAULT_MAX_BOTS_PER_PROCESS, MAX_BOTS_PER_PROCESS, MAX_BOTS_PER_ROOM } from './manager.js';
export type { BotManagerOptions, SpawnRefusal, SpawnResult } from './manager.js';
export { BOT_NAMES, BOT_NAME_PREFIX } from './names.js';
export { HUMANLIKE_PROFILE, type BotProfile } from './profile.js';
export { BotSeatTickets, botSeatTickets, claimBotSeat, isLoopbackAddress } from './seats.js';
export {
  QUIET_SOCIAL,
  byzantineStrategy,
  defaultStrategies,
  honestStrategy,
  type BotSocialHooks,
  type BotStrategy,
  type BotView,
  type ChatTrigger,
  type ProposalChoice,
  type ProposalSeen,
  type StrategySet,
} from './strategy.js';

let current: BotManager | null = null;

// Creates the process-wide manager CitadelRoom asks for; replaces one that was shut down.
export function installBotManager(options: BotManagerOptions): BotManager {
  if (current !== null && !current.stopped) throw new Error('a bot manager is already running');
  current = new BotManager(options);
  return current;
}

// The running manager, or null while practice bots are off.
export function botManager(): BotManager | null {
  return current !== null && !current.stopped ? current : null;
}

export async function shutdownBotManager(): Promise<void> {
  const manager = current;
  current = null;
  await manager?.shutdown();
}

// Where bots dial a server listening on `host`; null when that is not reachable on loopback.
export function loopbackEndpoint(host: string, port: number): string | null {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  const at = (ip: string): string => `ws://${isIP(ip) === 6 ? `[${ip}]` : ip}:${String(port)}`;
  if (host === '' || host === '0.0.0.0') return at('127.0.0.1');
  if (host === '::' || host === '::1') return at('::1');
  return isIP(host) === 4 && host.startsWith('127.') ? at(host) : null;
}
