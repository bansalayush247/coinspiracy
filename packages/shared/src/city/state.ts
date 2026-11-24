// Synced Port Concord state. The players map is per-viewer: each client only receives the players near it.
import { schema, t, type SchemaType } from '@colyseus/schema';
import { VIEW_TAGS } from '../state.js';

export const CityPlayer = schema(
  {
    name: t.string().default(''),
    seat: t.uint8().default(0),
    x: t.float64().default(0),
    y: t.float64().default(0),
    hat: t.string().default(''),
    shades: t.string().default(''),
    outfit: t.string().default(''),
    ack: t.uint32().view(VIEW_TAGS.OWNER).optional(),
  },
  'CityPlayer',
);
export type CityPlayer = SchemaType<typeof CityPlayer>;

export const CityState = schema(
  {
    players: t.map(CityPlayer).view(),
    // Everyone in this region, near or far, for the HUD.
    population: t.uint16().default(0),
  },
  'CityState',
);
export type CityState = SchemaType<typeof CityState>;
