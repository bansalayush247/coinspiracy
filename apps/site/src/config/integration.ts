// Astro integration: validates the environment, sets `site`, and exposes the public settings as a virtual module.
import type { AstroIntegration } from 'astro';
import { resolveSiteSettings, type SiteSettings } from './env.js';

export const VIRTUAL_MODULE_ID = 'virtual:site-config';
const RESOLVED_ID = `\0${VIRTUAL_MODULE_ID}`;

// Source of `virtual:site-config`; values are JSON-encoded, so they cannot break out of the string literals.
export function siteConfigModule(settings: Pick<SiteSettings, 'playUrl' | 'analyticsSrc'>): string {
  return [
    `export const playUrl = ${JSON.stringify(settings.playUrl)};`,
    `export const analyticsSrc = ${JSON.stringify(settings.analyticsSrc)};`,
    '',
  ].join('\n');
}

export function siteConfig(env: Readonly<Record<string, string | undefined>> = process.env): AstroIntegration {
  return {
    name: 'byzantine-council-site-config',
    hooks: {
      'astro:config:setup': ({ command, updateConfig, logger }) => {
        const settings = resolveSiteSettings(env, command);
        for (const warning of settings.warnings) logger.warn(warning);
        if (command === 'build') logger.info(`canonical origin ${settings.site}; Play links go to ${settings.playUrl}`);
        const source = siteConfigModule(settings);
        updateConfig({
          site: settings.site,
          vite: {
            plugins: [
              {
                name: 'byzantine-council-site-config',
                resolveId(id: string) {
                  return id === VIRTUAL_MODULE_ID ? RESOLVED_ID : undefined;
                },
                load(id: string) {
                  return id === RESOLVED_ID ? source : undefined;
                },
              },
            ],
          },
        });
      },
    },
  };
}
