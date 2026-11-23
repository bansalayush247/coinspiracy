import { createGameServer } from './app.js';
import { loadConfig } from './config.js';
import { log } from './logger.js';
import { openProfiles } from './profile/index.js';
import { createScaling, loadScalingConfig } from './scaling/index.js';

const config = loadConfig(process.env);

// Room failures are isolated by onUncaughtException; a stray rejection should not end every match.
process.on('unhandledRejection', (reason) => {
  log.error('unhandled promise rejection', reason);
});

const profiles = await openProfiles(process.env);
// Redis-backed presence, room listing and limits when REDIS_URL is set; this process alone otherwise.
const scalingConfig = loadScalingConfig(process.env, config.production);
const scaling = createScaling(scalingConfig);
await scaling.start();
log.info('scaling', { mode: scaling.mode });

const { listen } = createGameServer({
  profiles,
  scaling,
  allowedOrigins: config.allowedOrigins,
  ipPolicy: { trustedProxies: config.trustedProxies },
  maxSeatsPerIp: config.maxSeatsPerIp,
  chainTipUrl: config.chainTipUrl,
  ...(config.bots ? { bots: {} } : {}),
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
