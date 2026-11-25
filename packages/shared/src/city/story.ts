// What every story is made of, so one mission room and one client can play any of them: the four acts of "The Cold
// Key" and the side cases "ripped from the ledger". Steps, the scene each step opens, where the crew walks next, the
// places to work (heaps to dig, guardians to ask), the script, who catches the crew, what characters remember, and
// what finishing pays.
import type { Vec2 } from '../map.js';
import type { Mark, Script } from './script.js';

export const ACT_IDS = ['dump', 'ransom', 'insider', 'founder', 'overflow', 'split', 'receipt', 'popcorn', 'number', 'coins', 'deadman', 'password', 'pizza'] as const;
export type ActId = (typeof ACT_IDS)[number];

// Everyone who can catch a crew member and send them back.
export const CATCHER_IDS = ['guard', 'duncan', 'lookout', 'choir', 'keeper', 'gull'] as const;
export type CatcherId = (typeof CATCHER_IDS)[number];

export interface Catcher {
  readonly name: string;
  // Where a catch sends you, as in "back to the gate".
  readonly where: string;
  // Said to the one caught, one per catch, the last repeating.
  readonly lines: readonly string[];
}

export interface StorySpot {
  readonly at: Vec2;
  readonly label: string;
  // A spot that is worked but never counts towards the goal: a guardian who won't sign.
  readonly refuses?: boolean;
  // A scene that plays once this spot has been worked, such as a memory.
  readonly scene?: string;
}

export interface Arrival {
  readonly at: Vec2;
  readonly range: number;
  // The step that starts when anyone in the crew gets there.
  readonly to: string;
}

export interface StoryAct {
  readonly id: ActId;
  // An act of the season, or a side case played on its own.
  readonly kind: 'act' | 'case';
  readonly number: string;
  readonly title: string;
  // One line for the casebook: what the case is inspired by.
  readonly blurb: string;
  readonly steps: readonly string[];
  // The scene each step opens with.
  readonly scenes: Readonly<Record<string, string>>;
  readonly objectives: Readonly<Record<string, string>>;
  // Where the map marker points during a step.
  readonly targets: Readonly<Record<string, Vec2>>;
  readonly arrivals: Readonly<Record<string, Arrival>>;
  // From these steps on, nobody new joins and the crew stands still for the last scenes.
  readonly closed: readonly string[];
  readonly workStep: string;
  readonly spots: readonly StorySpot[];
  readonly workReach: number;
  readonly workMs: number;
  // How many spots must be worked (not counting refusals) to move on; 0 when the act's own rules decide.
  readonly workGoal: number;
  // What the goal counts, e.g. "Signatures: 2 of 3".
  readonly goalLabel?: string;
  // What the clock counts down to, e.g. "Tide turns in", for acts whose rules run one.
  readonly clockLabel?: string;
  readonly workVerb: string;
  // Told to the crew when the work starts.
  readonly hint: string;
  // How the client marks the spots: dug heaps with signs, badges over guardians once asked, or labelled places.
  readonly markers: 'heaps' | 'badges' | 'labels';
  // What a badge says once a spot is won, e.g. "Signed".
  readonly badge?: string;
  // How dark it is, 0 for day to 1 for black, and any step that differs.
  readonly night: number;
  readonly nights?: Readonly<Record<string, number>>;
  readonly catchers: Readonly<Partial<Record<CatcherId, Catcher>>>;
  // Starts the night holding marks the lead's earlier acts (and the ceremony) left behind.
  readonly carries?: boolean;
  readonly start: Vec2;
  readonly script: Script;
  readonly marks: Readonly<Record<string, Mark>>;
  readonly rewardSats: number;
  readonly lesson: string;
  readonly next: string;
  // A button on the end card that starts what comes next, when there is one.
  readonly finale?: string;
}

export const canWork = (who: Vec2, spot: StorySpot, reach: number): boolean => Math.hypot(who.x - spot.at.x, who.y - spot.at.y) <= reach;

export const honestIn = (act: StoryAct, marks: Iterable<string>): boolean => [...marks].some((m) => act.marks[m]?.honest === true);

// The button text for a spot, e.g. "Dig the 2013 · winter heap" or "Ask Osei to sign".
export const workLabel = (act: StoryAct, spot: StorySpot): string => act.workVerb.replace('{}', spot.label);

export const nightAt = (act: StoryAct, step: string): number => act.nights?.[step] ?? act.night;

// The line over the story HUD, e.g. "The Cold Key · Act two · The Ransom Call".
export const storyEyebrow = (act: StoryAct): string => (act.kind === 'case' ? `Ripped from the ledger · ${act.title}` : `The Cold Key · ${act.number} · ${act.title}`);

// Every scene a script can start from: the steps' scenes and the spots' own.
export const sceneStarts = (act: StoryAct): string[] => [...Object.values(act.scenes), ...act.spots.flatMap((s) => (s.scene === undefined ? [] : [s.scene]))];
