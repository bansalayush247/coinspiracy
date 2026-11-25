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
    health: t.uint8().default(100),
    down: t.boolean().default(false),
    shielded: t.boolean().default(false),
    // A street tough run by the server, not a person.
    npc: t.boolean().default(false),
    // The car this guardian is driving, '' on foot.
    car: t.string().default(''),
    pocket: t.uint32().view(VIEW_TAGS.OWNER).optional(),
    ack: t.uint32().view(VIEW_TAGS.OWNER).optional(),
  },
  'CityPlayer',
);
export type CityPlayer = SchemaType<typeof CityPlayer>;

// A pile of coins on the ground: dropped by a knocked-out player, or loose on a rough street.
export const CityDrop = schema(
  {
    x: t.float64().default(0),
    y: t.float64().default(0),
    amount: t.uint32().default(0),
  },
  'CityDrop',
);
export type CityDrop = SchemaType<typeof CityDrop>;

// A car anyone can drive. heading is radians in map space; driver is the session at the wheel, '' when parked.
export const CityCar = schema(
  {
    x: t.float64().default(0),
    y: t.float64().default(0),
    heading: t.float32().default(0),
    color: t.uint8().default(0),
    driver: t.string().default(''),
  },
  'CityCar',
);
export type CityCar = SchemaType<typeof CityCar>;

export const CityState = schema(
  {
    players: t.map(CityPlayer).view(),
    drops: t.map(CityDrop).view(),
    cars: t.map(CityCar).view(),
    // Everyone in this region, near or far, for the HUD.
    population: t.uint16().default(0),
  },
  'CityState',
);
export type CityState = SchemaType<typeof CityState>;
