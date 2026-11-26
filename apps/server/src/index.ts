import { createGameServer } from './app.js';
import { loadConfig } from './config.js';
import { discordConfig } from './discord/config.js';
import { log } from './logger.js';
import { openProfiles } from './profile/index.js';
import { createScaling, loadScalingConfig } from './scaling/index.js';
import { fileFeedbackSink } from './feedback.js';

const EX_CONFIG = 78;

// Exits with sysexits EX_CONFIG, which systemd does not restart; config errors never echo values, so they are logged.
function configured<T>(load: () => T): T {
  try {
    return load();
  } catch (error) {
    log.error('configuration error, not starting', undefined, { reason: error instanceof Error ? error.message : 'invalid configuration' });
    process.exit(EX_CONFIG);
  }
}

const config = configured(() => loadConfig(process.env));

// Room failures are isolated by onUncaughtException; a stray rejection should not end every match.
process.on('unhandledRejection', (reason) => {
  log.error('unhandled promise rejection', reason);
});

const profiles = await openProfiles(process.env);
// Redis-backed presence, room listing and limits when REDIS_URL is set; this process alone otherwise.
const scaling = configured(() => createScaling(loadScalingConfig(process.env, config.production)));
await scaling.start();
log.info('scaling', { mode: scaling.mode });

// A partial Discord setup must not stop the web game: the token route answers 503 and the log names what is missing.
const discord = discordConfig(process.env);
if (discord.state === 'broken') log.warn('Discord Activity sign-in is misconfigured', { problems: discord.problems.join('; ') });
else log.info('Discord Activity sign-in', { on: discord.state === 'on' });

const { listen } = createGameServer({
  profiles,
  scaling,
  allowedOrigins: config.allowedOrigins,
  ipPolicy: { trustedProxies: config.trustedProxies },
  maxSeatsPerIp: config.maxSeatsPerIp,
  chainTipUrl: config.chainTipUrl,
  ...(config.bots ? { bots: {} } : {}),
  frameAncestors: config.frameAncestors,
  discord: { config: discord },
  ...(config.feedbackDir === null ? {} : { feedback: { sink: fileFeedbackSink(config.feedbackDir) } }),
  gracefullyShutdown: true,
});

// Colyseus drains rooms on SIGTERM/SIGINT and exits 0; this caps a drain that hangs.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    setTimeout(() => {
      log.error('shutdown timed out');
      process.exit(1);
    }, 10_000).unref();
  });
}

await listen(config.port, config.host);
log.info('listening', { host: config.host, port: config.port, production: config.production });
