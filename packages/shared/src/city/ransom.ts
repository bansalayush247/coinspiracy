// Act two of "The Cold Key": The Ransom Call. A warm voice on Teo's phone wants the twelve words by midnight. Rook
// takes them to Ivy, the crew gets three guardians to sign them into the Concord Mint federation (so nobody,
// Rook included, can hand them over alone), then creeps past the lookouts at the old lighthouse to find Teo
// unharmed, unbound, and holding the remote. Nobody is hurt: the Locksmith only ever sells fear.
import type { Vec2 } from '../map.js';
import { GATE_SPOT } from './dump.js';
import type { Mark, Script } from './script.js';
import type { StoryAct, StorySpot } from './story.js';
import { VAULT_DOOR } from './vault.js';

export const RANSOM_STEPS = ['call', 'toIvy', 'ivy', 'sign', 'locked', 'toLighthouse', 'breakwater', 'sneak', 'door', 'done'] as const;
export type RansomStep = (typeof RANSOM_STEPS)[number];

export const RANSOM_START: Vec2 = Object.freeze({ x: GATE_SPOT.x, y: GATE_SPOT.y });
export const IVY_SPOT: Vec2 = Object.freeze({ x: VAULT_DOOR.x, y: VAULT_DOOR.y });
export const BREAKWATER: Vec2 = Object.freeze({ x: 15.5, y: 76.5 });
export const LIGHTHOUSE_DOOR: Vec2 = Object.freeze({ x: 3.5, y: 75.5 });
export const DOOR_RANGE = 1.2;

// The morning shift round Mint Hall. Three signatures lock anything into the federation; Wren won't sign.
export const SIGNATURES_NEEDED = 3;
export const GUARDIANS: readonly (StorySpot & { readonly note: string })[] = Object.freeze([
  { at: { x: 74.5, y: 20.5 }, label: 'Osei', note: 'Osei signs. “One key of three. On its own, worth exactly nothing. That’s the point.”' },
  { at: { x: 74.5, y: 24.5 }, label: 'Pike', note: 'Pike checks your face against the photo Ivy sent, then signs. “Never sign for a voice. Only for a face you know.”' },
  { at: { x: 84.5, y: 20.5 }, label: 'Hollis', note: 'Hollis signs and stamps it twice for luck. “Two of us can’t move it. Three can. Four is showing off.”' },
  { at: { x: 84.5, y: 24.5 }, label: 'Marta', note: 'Marta reads every word, then signs. “If one of us ever goes bad, the others still say no.”' },
  { at: { x: 79.5, y: 16.5 }, label: 'Wren', refuses: true, note: 'Wren doesn’t sign. “Not at this hour, and not for a stranger.” He watches you all the way down the steps.' },
]);
export const SIGN_REACH = 1.6;
export const SIGN_MS = 1_500;

// The Locksmith's lads keep watch at the lighthouse. Hearing the ferry horn on the call gets the crew there before
// the second one turns up.
export const LOOKOUT_ROUTES: readonly (readonly Vec2[])[] = Object.freeze([
  [{ x: 9.5, y: 77 }, { x: 5.5, y: 77 }, { x: 5.5, y: 73 }, { x: 5.6, y: 77 }],
  [{ x: 6.5, y: 73 }, { x: 6.5, y: 75.5 }, { x: 2.5, y: 75.6 }, { x: 6.4, y: 75.5 }],
]);
export const LOOKOUT_SPEED = 1.6;

export const RANSOM_OBJECTIVES: Readonly<Record<RansomStep, string>> = Object.freeze({
  call: 'A voice on Teo’s phone.',
  toIvy: 'Get to the Concord Mint. Ivy will be on the steps.',
  ivy: 'Talk to Ivy.',
  sign: 'Get three of the five guardians round Mint Hall to sign.',
  locked: 'Locked in the federation.',
  toLighthouse: 'Get to the old breakwater at the Docks.',
  breakwater: 'The old lighthouse.',
  sneak: 'Reach the lighthouse door. Stay behind the lookouts’ torches.',
  door: 'Inside the lighthouse.',
  done: 'Act two complete.',
});

export const RANSOM_MARKS: Readonly<Record<string, Mark>> = Object.freeze({
  agreedLocksmith: { who: 'rook', text: 'you agreed to his deadline' },
  threatenedLocksmith: { who: 'voice', text: 'you threatened him' },
  clueRecording: { text: 'Teo’s line was a recording: same ferry horn, same breath. That horn only sounds at the old breakwater.', clue: true },
  wouldPay: { who: 'ivy', text: 'you thought about paying' },
  askedIvy: { who: 'ivy', text: 'you asked how it works', honest: true },
  wrenRefused: { text: 'Wren wouldn’t sign, and watched you leave.', clue: true },
  thankedBrannigan: { who: 'brannigan', text: 'you thanked him', honest: true },
  liedBrannigan: { who: 'brannigan', text: 'you lied to a detective' },
  huggedTeo: { who: 'teo', text: 'you hugged him' },
  angryTeo: { who: 'teo', text: 'you told him what it cost' },
  clueTwoForks: { text: 'Two forks in the chip paper. Who orders for two when they’re alone?', clue: true },
});

export const RANSOM_REWARD_SATS = 300;

export const RANSOM_SCRIPT: Script = Object.freeze({
  ransom: {
    slug: 'EXT. GULLMOOR TIP — DAWN · PHONE CALL',
    action: 'Mist on the mounds. Teo’s name is still on Rook’s screen. The voice in Rook’s ear isn’t his.',
    lines: [
      { who: 'voice', paren: 'warm, unhurried', text: 'Let’s start again, properly. Teodor is safe. Warm. On his second bowl of soup. I’d like that to continue.' },
      { who: 'voice', text: 'You have twelve words. I’d like them by midnight.' },
      { who: 'rook', text: 'Who is this?' },
      { who: 'voice', text: 'A locksmith, of sorts. I don’t break locks, Rook. I wait for people to open them.' },
    ],
    choices: [
      { id: 'proof', tag: 'Proof', text: 'Put Teo on. Now.', go: 'proof' },
      { id: 'deal', tag: 'Deal', text: 'Fine. Midnight. Just don’t touch him.', go: 'ransomDeal', mark: 'agreedLocksmith' },
      { id: 'threat', tag: 'Threat', text: 'I’ll find you. I always find the cheap ones.', go: 'ransomThreat', mark: 'threatenedLocksmith' },
    ],
    seconds: 10,
    timeout: 'ransomSilence',
  },
  proof: {
    action: 'A rustle. Somewhere behind the voice, a ferry horn: two short blasts.',
    lines: [
      { who: 'teo', paren: 'strained', text: 'Rook — just do what he says, okay? Please.' },
      { who: 'voice', text: 'There. Satisfied?' },
    ],
    choices: [
      { id: 'again', tag: 'Again', text: 'Put him on again. I want to hear him breathe.', go: 'proofAgain' },
      { id: 'fold', tag: 'Fold', text: 'Okay. Okay. Midnight.', go: 'ransomDeal', mark: 'agreedLocksmith' },
    ],
    seconds: 9,
    timeout: 'proofSilence',
  },
  proofAgain: {
    action: 'A rustle. The ferry horn again: two short blasts, at exactly the same moment as before.',
    lines: [{ who: 'teo', paren: 'strained, the breath catching in the same place', text: 'Rook — just do what he says, okay? Please.' }],
    choices: [
      { id: 'catch', tag: 'Catch it', text: 'Same horn. Same breath. That’s a recording.', go: 'caught', mark: 'clueRecording' },
      { id: 'beg', tag: 'Beg', text: 'Teo, hang on. I’m coming.', go: 'proofMissed' },
    ],
    seconds: 8,
    timeout: 'proofMissed',
  },
  caught: {
    lines: [
      { who: 'voice', paren: 'a pause you can hear him smile through', text: 'Clever. Clever is expensive, Rook. Midnight still stands.' },
      { who: 'rook', paren: 'to self', text: 'Two short blasts. That’s the Shallows ferry. It only sounds like that passing the old breakwater.' },
    ],
    next: 'callEnd',
  },
  proofMissed: { lines: [{ who: 'voice', text: 'He misses you too. Midnight.' }], next: 'callEnd' },
  proofSilence: { lines: [{ who: 'voice', text: 'Lost for words? Save them. You only need twelve.' }], next: 'callEnd' },
  ransomDeal: { lines: [{ who: 'voice', text: 'Good. Reasonable people are my favourite people.' }], next: 'callEnd' },
  ransomThreat: { lines: [{ who: 'voice', paren: 'amused', text: 'Cheap? I’ve never charged anyone a penny. They insist on paying.' }], next: 'callEnd' },
  ransomSilence: { lines: [{ who: 'voice', text: 'Silence. Teodor said you’d do that.' }], next: 'callEnd' },
  callEnd: {
    action: 'The line goes dead. In Rook’s pocket, a grease-spotted receipt: IMPORTANT, twelve words, and now a deadline.',
    lines: [
      { who: 'rook', text: 'If he scares me enough, I’ll hand them over. So I need to make sure I can’t.' },
      { who: 'rook', text: 'Ivy. The Mint.' },
    ],
    then: 'toIvy',
  },

  ivy: {
    slug: 'EXT. CONCORD MINT, THE STEPS — MORNING',
    action: 'IVY MARCHETTI, guardian of the Concord Mint, is already on the steps with two coffees. Neither is for Rook.',
    lines: [
      { who: 'ivy', text: 'Rook. You look like someone who found money and then a problem.' },
      { who: 'rook', text: 'Someone has Teo. They want the twelve words by midnight.' },
      { who: 'ivy', text: 'Then the worst thing you can be at midnight is someone who can hand them over.' },
    ],
    choices: [
      { id: 'trust', tag: 'Trust', text: 'Just keep the paper for me. I trust you.', go: 'ivyTrust' },
      { id: 'pay', tag: 'Pay', text: 'Or I give him the words and get Teo back.', go: 'ivyPay', mark: 'wouldPay' },
      { id: 'ask', tag: 'Ask', text: 'What does a federation actually do with it?', go: 'ivyHow', mark: 'askedIvy' },
    ],
    seconds: 12,
    timeout: 'ivySilence',
  },
  ivyTrust: {
    lines: [
      { who: 'ivy', text: 'That’s the nicest thing anyone’s said to me this year, and the most dangerous.' },
      { who: 'ivy', text: 'Trust is a single point of failure. If I hold it alone, he only has to frighten me instead.' },
    ],
    next: 'ivyPlan',
  },
  ivyPay: {
    lines: [
      { who: 'ivy', paren: 'flat', text: 'People who pay these calls get a thank-you and a second call.' },
      { who: 'ivy', text: 'Nobody who asks by phone ever stops at one.' },
    ],
    next: 'ivyPlan',
  },
  ivyHow: {
    lines: [
      { who: 'ivy', text: 'Five guardians, five keys. Moving anything takes three of us signing together.' },
      { who: 'ivy', text: 'Nobody can be bribed, tricked or frightened into it alone. Not you. Not me.' },
    ],
    next: 'ivyPlan',
  },
  ivySilence: { lines: [{ who: 'ivy', text: 'You’re thinking. Good. Think about this.' }], next: 'ivyPlan' },
  ivyPlan: {
    lines: [
      { who: 'ivy', text: 'We lock it into the federation. After that you can’t hand it over, so there’s nothing to ransom.' },
      { who: 'ivy', text: 'The guardians are on the morning shift round the Hall. Get three of them to sign before anyone panics.' },
      { who: 'ivy', if: 'wouldPay', text: 'And Rook? When a call comes with a deadline, hang up and call back on a number you already know.' },
    ],
    then: 'sign',
  },

  locked: {
    slug: 'INT. CONCORD MINT, SIGNING ROOM — MORNING',
    action: 'Three signatures land on Ivy’s screen. A small green light. That’s all locking a fortune looks like.',
    lines: [
      { who: 'ivy', text: 'Done. It’s in the federation. Nobody can move it alone now. Not you, not me, not him.' },
      { who: 'rook', text: 'So what do I tell the man with Teo?' },
      { who: 'ivy', text: 'The truth. It’s the one thing he can’t do anything with.' },
      { who: 'ivy', if: 'wrenRefused', text: 'And don’t mind Wren. He’s never signed anything before lunch.' },
    ],
    next: 'brannigan',
    jump: { if: 'clueRecording', to: 'lockedClue' },
  },
  lockedClue: {
    lines: [
      { who: 'rook', text: 'The ferry horn on the call. Two short blasts. The Shallows ferry only does that passing the breakwater.' },
      { who: 'ivy', text: 'The old lighthouse. Nobody’s lit it in thirty years.' },
      { who: 'ivy', text: 'Go. And Rook: don’t do anything brave. Do something clever.' },
    ],
    then: 'toLighthouse',
  },
  brannigan: {
    action: 'A tired man in a raincoat leans on the Mint railings as if he’s been there since they were built. DETECTIVE HAL BRANNIGAN.',
    lines: [
      { who: 'brannigan', text: 'Teodor Lisk’s phone pinged the mast by the old breakwater an hour ago.' },
      { who: 'brannigan', text: 'Third family this month to get that call. We call him the Locksmith. Never touches anyone. Never needs to.' },
      { who: 'rook', text: 'And you’re telling me because…?' },
      { who: 'brannigan', text: 'Because you’re going there anyway, and I’d rather you were in front of me than behind me.' },
    ],
    choices: [
      { id: 'thank', tag: 'Thank', text: 'Thanks, detective. Really.', go: 'branThank', mark: 'thankedBrannigan' },
      { id: 'dodge', tag: 'Dodge', text: 'Never heard of a Teo.', go: 'branDodge', mark: 'liedBrannigan' },
    ],
    seconds: 9,
    timeout: 'branSilence',
  },
  branThank: { lines: [{ who: 'brannigan', text: 'Don’t. It makes the paperwork emotional.' }], next: 'branEnd' },
  branDodge: { lines: [{ who: 'brannigan', text: 'Course not. And I’ve never heard of coffee.' }], next: 'branEnd' },
  branSilence: { lines: [{ who: 'brannigan', text: 'Strong, silent type. My favourite kind of witness. Never contradicts the report.' }], next: 'branEnd' },
  branEnd: {
    lines: [{ who: 'brannigan', text: 'Two of his lads keep watch out there. Torches, big coats, strict no-touching policy. Don’t get spotted.' }],
    then: 'toLighthouse',
  },

  breakwater: {
    slug: 'EXT. THE OLD BREAKWATER — NIGHT',
    action: 'The tide sucks at the stones. At the far end stands the dead lighthouse, and a torch beam swings along the breakwater.',
    lines: [
      { who: 'lookout', paren: 'bored, carrying on the wind', text: 'Seven hours. He said one night. He said bring a flask.' },
      { who: 'rook', paren: 'whispering', unless: 'clueRecording', text: 'Two of them. One on the breakwater, one by the door.' },
      { who: 'rook', paren: 'whispering', if: 'clueRecording', text: 'Just the one. We beat the shift change.' },
      { who: 'rook', paren: 'whispering', text: 'Stay behind the torch. Get to the door.' },
    ],
    then: 'sneak',
  },

  door: {
    slug: 'INT. THE OLD LIGHTHOUSE — NIGHT',
    action: 'The door isn’t locked. Inside: a camping lamp, a heater, football on a big telly, and TEO LISK, unbound, feet up, eating chips out of the paper.',
    lines: [
      { who: 'teo', paren: 'mouth full', text: 'Rook! You came! He let me go! Just now! I was literally about to ring you.' },
      { who: 'rook', text: 'You’re eating chips.' },
      { who: 'teo', text: 'Hostages get hungry, Rook. It’s a whole thing.' },
    ],
    choices: [
      { id: 'hug', tag: 'Hug', text: 'Come here, you idiot.', go: 'doorHug', mark: 'huggedTeo' },
      { id: 'anger', tag: 'Anger', text: 'I locked a fortune in a vault for you today.', go: 'doorAngry', mark: 'angryTeo' },
      { id: 'look', tag: 'Look', text: '(look around the room)', go: 'doorLook', mark: 'clueTwoForks' },
    ],
    seconds: 10,
    timeout: 'doorSilence',
  },
  doorHug: { action: 'Teo hugs back, a second too late.', lines: [{ who: 'teo', text: 'Yeah. Yeah, mate. Course.' }], next: 'brannDoor' },
  doorAngry: {
    lines: [
      { who: 'teo', text: 'Locked it? Like, properly? Nobody can move it?' },
      { who: 'teo', paren: 'a beat too long', text: 'That’s… great. That’s great, Rook.' },
    ],
    next: 'brannDoor',
  },
  doorLook: {
    action: 'Two forks in the chip paper. Two cans. One remote, in Teo’s hand.',
    lines: [{ who: 'rook', paren: 'to self', text: 'Who orders for two when they’re on their own?' }],
    next: 'brannDoor',
  },
  doorSilence: { lines: [{ who: 'teo', text: 'Say something. You’re doing the face.' }], next: 'brannDoor' },
  brannDoor: {
    action: 'Footsteps on the spiral stairs. BRANNIGAN, out of breath, fills the doorway. He takes in the lamp, the chips, the telly.',
    lines: [
      { who: 'brannigan', if: 'clueRecording', text: 'Followed the same ferry horn you did. Took me longer. I had to finish my sandwich.' },
      { who: 'brannigan', text: 'Funny kind of kidnapping.' },
      { who: 'brannigan', paren: 'nodding at Teo’s hand', text: 'The hostage has the remote.' },
    ],
    after: 'Teo laughs. Nobody else does. On the table his phone lights up, and he turns it face down a little too fast.',
    then: 'done',
  },
});

export const RANSOM_ACT: StoryAct = Object.freeze({
  id: 'ransom',
  number: 'Act two',
  title: 'The Ransom Call',
  steps: RANSOM_STEPS,
  scenes: Object.freeze({ call: 'ransom', ivy: 'ivy', locked: 'locked', breakwater: 'breakwater', door: 'door' }),
  objectives: RANSOM_OBJECTIVES,
  targets: Object.freeze({ toIvy: IVY_SPOT, toLighthouse: BREAKWATER, sneak: LIGHTHOUSE_DOOR }),
  arrivals: Object.freeze({
    toIvy: { at: IVY_SPOT, range: 2.5, to: 'ivy' },
    toLighthouse: { at: BREAKWATER, range: 2.5, to: 'breakwater' },
    sneak: { at: LIGHTHOUSE_DOOR, range: DOOR_RANGE, to: 'door' },
  }),
  closed: ['door', 'done'],
  workStep: 'sign',
  spots: GUARDIANS,
  workReach: SIGN_REACH,
  workMs: SIGN_MS,
  workGoal: SIGNATURES_NEEDED,
  goalLabel: 'Signatures',
  workVerb: 'Ask {} to sign',
  markers: 'badges',
  start: RANSOM_START,
  script: RANSOM_SCRIPT,
  marks: RANSOM_MARKS,
  rewardSats: RANSOM_REWARD_SATS,
  lesson:
    'You can’t hand over what you don’t hold alone. A federation splits a key between guardians, so no single person, not even you, can be frightened or fooled into giving it away. And when a call comes with a deadline, hang up and check, on a number you already know.',
  next: 'Next: act three, The Insider.',
});
