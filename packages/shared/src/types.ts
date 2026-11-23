// Server-issued opaque player id.
export type PlayerId = string;

export type Role = 'honest' | 'byzantine';

// rotatedOut = key removed by the council; disconnected = temporarily frozen.
export type GuardianStatus = 'active' | 'disconnected' | 'rotatedOut';

export interface Guardian {
  readonly id: PlayerId;
  readonly role: Role;
  readonly status: GuardianStatus;
}
