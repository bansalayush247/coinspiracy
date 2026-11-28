// Synced Beach Town state: who is in town, where, and what they wear.
import { schema, t, type SchemaType } from '@colyseus/schema';
import { VIEW_TAGS } from '../state.js';

export const HubPlayer = schema(
  {
    name: t.string().default(''),
    // Colour slot, as in matches.
    seat: t.uint8().default(0),
    x: t.float64().default(0),
    y: t.float64().default(0),
    hat: t.string().default(''),
    shades: t.string().default(''),
    outfit: t.string().default(''),
    hair: t.string().default(''),
    dye: t.string().default(''),
    beard: t.string().default(''),
    board: t.string().default(''),
    // Carrying a parcel: public, so others see the box in their arms.
    carrying: t.boolean().default(false),
    ack: t.uint32().view(VIEW_TAGS.OWNER).optional(),
  },
  'HubPlayer',
);
export type HubPlayer = SchemaType<typeof HubPlayer>;

export const HubState = schema({ players: t.map(HubPlayer) }, 'HubState');
export type HubState = SchemaType<typeof HubState>;
