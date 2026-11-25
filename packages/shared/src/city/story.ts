// What every act of "The Cold Key" is made of, so one mission room and one client can play any of them: steps,
// the scene each step opens, where the crew walks next, the places to work (heaps to dig, guardians to ask), the
// script, what characters remember, and what finishing pays.
import type { Vec2 } from '../map.js';
import type { Mark, Script } from './script.js';

export const ACT_IDS = ['dump', 'ransom', 'insider', 'founder'] as const;
export type ActId = (typeof ACT_IDS)[number];

export interface StorySpot {
  readonly at: Vec2;
  readonly label: string;
  // A spot that is worked but never counts towards the goal: a guardian who won't sign.
  readonly refuses?: boolean;
}

export interface Arrival {
  readonly at: Vec2;
  readonly range: number;
  // The step that starts when anyone in the crew gets there.
  readonly to: string;
}

export interface StoryAct {
  readonly id: ActId;
  readonly number: string;
  readonly title: string;
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
  readonly workVerb: string;
  // How the client marks the spots: dug heaps with signs, badges over guardians once asked, or labelled places.
  readonly markers: 'heaps' | 'badges' | 'labels';
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
