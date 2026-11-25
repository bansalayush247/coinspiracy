// Act four of "The Cold Key": The Founder's Coins, the end of season one. The little stick from pizza night holds a
// sentence signed with the Founder's key, so Rook is the one person who can prove who the Founder was. The Choir
// blacks out the city; the crew restarts the radio mast's generators past their runners; live on air, Dr Sharpe
// can't sign a single sentence and Rook can. Then the crew decides the ending. What earlier acts and the ceremony
// left behind is carried in from the lead's profile, and every ending closes at the tip gate at dawn.
import type { Vec2 } from '../map.js';
import { DUMP_START } from './dump.js';
import type { Mark, Script } from './script.js';
import type { StoryAct, StorySpot } from './story.js';

export const FOUNDER_STEPS = ['call', 'toMast', 'blackout', 'power', 'radio', 'done'] as const;
export type FounderStep = (typeof FOUNDER_STEPS)[number];

export const FOUNDER_START: Vec2 = Object.freeze({ x: DUMP_START.x, y: DUMP_START.y });
export const MAST_SPOT: Vec2 = Object.freeze({ x: 117, y: 5.5 });

// Four backup generators either side of the mast; any three keep the station on the air.
export const GENERATORS_NEEDED = 3;
export const GENERATORS: readonly StorySpot[] = Object.freeze([
  { at: { x: 105, y: 4.5 }, label: 'west yard' },
  { at: { x: 105, y: 6.5 }, label: 'west gate' },
  { at: { x: 124.2, y: 4.2 }, label: 'east cliff' },
  { at: { x: 118.6, y: 6.6 }, label: 'mast steps' },
]);
export const GENERATOR_REACH = 1.5;
export const GENERATOR_MS = 1_700;

// The Choir's runners comb both sides of the mast with their phone lights, looking for the stick.
export const CHOIR_ROUTES: readonly (readonly Vec2[])[] = Object.freeze([
  [{ x: 106.5, y: 3.6 }, { x: 113.5, y: 3.6 }, { x: 113.5, y: 6.8 }, { x: 106.5, y: 6.8 }],
  [{ x: 118.6, y: 3.6 }, { x: 123.3, y: 3.6 }, { x: 123.3, y: 7.2 }, { x: 123.2, y: 3.7 }],
]);
export const CHOIR_SPEED = 1.5;

export const FOUNDER_OBJECTIVES: Readonly<Record<FounderStep, string>> = Object.freeze({
  call: 'The stick from pizza night.',
  toMast: 'Get to the radio mast on the Heights before Sharpe goes on air.',
  blackout: 'The Choir has turned the city off.',
  power: 'Restart three of the four generators round the mast. Stay out of the Choir’s phone lights.',
  radio: 'On air.',
  done: 'Season one complete.',
});

export const FOUNDER_MARKS: Readonly<Record<string, Mark>> = Object.freeze({
  pastHonest: { text: 'you told the plain truth at least once at the tip' },
  pastCut: { text: 'you once asked Teo for a cut' },
  pastCeremony: { text: 'you sat at the signing ceremony' },
  pastCeremonyHeld: { text: 'the ceremony held' },
  pastCeremonyLost: { text: 'the ceremony fell' },
  temptedQuint: { who: 'quint', text: 'you asked what the people’s money was worth' },
  refusedQuint: { who: 'quint', text: 'you called his insurance fund a spreadsheet', honest: true },
  askedQuint: { who: 'quint', text: 'you asked how he knew' },
  clueChoir: { text: 'Someone told the whole city about the stick an hour ago. The Choir is coming for it.', clue: true },
  chosenGuardian: { who: 'ivy', text: 'you gave the stick to the federation', honest: true },
  chosenBurn: { who: 'dani', text: 'you gave it all away on live radio', honest: true },
  chosenByzantine: { who: 'teo', text: 'you went into business with the Locksmith' },
});

// What earlier acts and the ceremony leave behind for act four, from a profile's saved story.
export interface PastStory {
  readonly dump?: { readonly honest: boolean };
  readonly insider?: { readonly marks: readonly string[] };
  readonly ceremony?: { readonly done: boolean; readonly honest: boolean };
}

export function carriedMarks(story: PastStory | undefined): string[] {
  const marks: string[] = [];
  if (story?.dump?.honest === true) marks.push('pastHonest');
  if (story?.insider?.marks.includes('askedCut') === true) marks.push('pastCut');
  if (story?.ceremony?.done === true) marks.push('pastCeremony', story.ceremony.honest ? 'pastCeremonyHeld' : 'pastCeremonyLost');
  return marks;
}

export const FOUNDER_REWARD_SATS = 500;

export const FOUNDER_SCRIPT: Script = Object.freeze({
  stick: {
    slug: 'INT. ROOK’S FLAT, LOW TIDE — NIGHT',
    action: 'The drawer that never shuts. Under the takeaway menus: a little stick from pizza night, 2010. It blinks. Once.',
    lines: [
      { who: 'rook', text: 'You were a tip. Two large pizzas and a tip.' },
      { who: 'rook', paren: 'plugging it into a laptop older than Nonce', text: 'Come on. Show me something.' },
    ],
    after: 'One file. One sentence: LET’S SEE IF THEY CAN KEEP IT HONEST WITHOUT ME. Under it, a signature made with the Founder’s key.',
    next: 'quintCall',
  },
  quintCall: {
    action: 'The phone buzzes. A number Rook doesn’t know. A voice that somehow sounds like flip-flops.',
    lines: [
      { who: 'quint', text: 'Rook! Ellis Quint. Huge fan. Huger fan of what’s on that stick.' },
      { who: 'quint', text: 'My exchange would love to buy the Founder’s legacy. For the people. With, uh, the people’s money.' },
    ],
    choices: [
      { id: 'sell', tag: 'Tempted', text: 'How much is “the people’s money”?', go: 'quintSell', mark: 'temptedQuint' },
      { id: 'refuse', tag: 'Refuse', text: 'Your insurance fund is a spreadsheet tab, Ellis.', go: 'quintRefuse', mark: 'refusedQuint' },
      { id: 'ask', tag: 'Ask', text: 'How do you even know about it?', go: 'quintAsk', mark: 'askedQuint' },
    ],
    seconds: 10,
    timeout: 'quintSilence',
  },
  quintSell: {
    lines: [
      { who: 'quint', text: 'Ha! Love that. Love you. We’ll talk numbers after the show.' },
      { who: 'quint', text: 'You are listening to the show, right? Sharpe’s on at midnight.' },
    ],
    next: 'sharpeRadio',
  },
  quintRefuse: { lines: [{ who: 'quint', paren: 'a long pause', text: 'Wow. Okay. It’s a tab with a really nice font, though.' }], next: 'sharpeRadio' },
  quintAsk: {
    lines: [
      { who: 'quint', text: 'Everyone knows, Rook. Somebody posted it an hour ago.' },
      { who: 'quint', text: 'Somebody calling themselves the Choir.' },
    ],
    mark: 'clueChoir',
    next: 'sharpeRadio',
  },
  quintSilence: { lines: [{ who: 'quint', text: 'Hello? Did I lose you? I lose a lot of things. Customers, mostly.' }], next: 'sharpeRadio' },
  sharpeRadio: {
    action: 'On the radio, a voice that has never once blinked.',
    lines: [
      { who: 'sharpe', text: 'Tonight, live from the Heights mast, I will prove once and for all that I am the Founder.' },
      { who: 'sharpe', text: 'I don’t need to prove it. I need you to believe it.' },
      { who: 'rook', text: 'One signature would settle it. And I’m holding the only one in town.' },
    ],
    then: 'toMast',
  },

  blackout: {
    slug: 'EXT. THE HEIGHTS, RADIO MAST — MIDNIGHT',
    action: 'Every light in Port Concord goes out at once. Lamps. Windows. The ferry. On every phone, the same words: THE KEY BELONGS TO EVERYONE. — THE CHOIR.',
    lines: [
      { who: 'sharpe', paren: 'over a crackling backup speaker', text: 'Are we still on air? Somebody find the generators!' },
      { who: 'rook', text: 'Four generators round the mast. Three will keep the station on the air.' },
      { who: 'rook', if: 'clueChoir', text: 'And the Choir will have people out here looking for this stick.' },
      { who: 'choir', paren: 'from somewhere in the dark, in perfect unison', text: 'We only want what belongs to everyone.' },
      { who: 'rook', paren: 'whispering', text: 'Stay out of their phone lights.' },
    ],
    then: 'power',
  },

  onAir: {
    slug: 'INT. CONCORD TALK RADIO, THE MAST — MIDNIGHT',
    action: 'The lights stutter back. ON AIR glows red. DR LUCAN SHARPE leans into the microphone like it owes him money.',
    lines: [
      { who: 'sharpe', text: 'As I was saying, before the so-called Choir’s little stunt: I am the Founder. Anyone who says otherwise will hear from my lawyers.' },
      { who: 'rook', paren: 'into the guest microphone', text: 'Then sign one sentence. With the Founder’s key. Live. Right now.' },
      { who: 'sharpe', text: 'That is a deeply unserious request.' },
    ],
    next: 'nineMinutes',
  },
  nineMinutes: {
    action: 'He talks for nine minutes. About courage. About lawyers. About himself. He signs nothing.',
    lines: [{ who: 'rook', text: 'Can’t? Fine. I can.' }],
    after: 'Rook plugs in the stick. On the studio screen the signature checks out against the Founder’s key from 2009. Every phone line lights up at once.',
    next: 'theChoice',
  },
  theChoice: {
    lines: [
      { who: 'ivy', paren: 'on line one', if: 'pastCeremonyHeld', text: 'Rook. The ceremony held. Nobody signed for the Locksmith. Whatever you do next, do it on purpose.' },
      { who: 'ivy', paren: 'on line one', if: 'pastCeremonyLost', text: 'Rook. The ceremony went wrong. He got his signatures. That stick is the last thing he wants.' },
      { who: 'ivy', paren: 'on line one', unless: 'pastCeremony', text: 'Rook. Everyone is listening. Whatever you do next, do it on purpose.' },
      { who: 'rook', text: 'Everybody wants the ghost. So what do I do with it?' },
    ],
    choices: [
      { id: 'guardian', tag: 'Guardian', text: 'Give it to the federation. No one person should hold this.', go: 'endGuardian', mark: 'chosenGuardian' },
      { id: 'burn', tag: 'Burn', text: 'Read the twelve words out, live. Let the city race for them.', go: 'endBurn', mark: 'chosenBurn' },
      { id: 'byzantine', tag: 'Byzantine', text: 'Call Teo. Tell the Locksmith we’re open for business.', go: 'endByzantine', mark: 'chosenByzantine', if: 'pastCut' },
    ],
    seconds: 15,
    timeout: 'endSilence',
  },
  endGuardian: {
    lines: [
      { who: 'ivy', text: 'Five guardians. Five keys. Nobody holds it alone. Not even you.' },
      { who: 'rook', text: 'Good. I’m terrible at holding things.' },
    ],
    after: 'By morning Brannigan has the Locksmith in cuffs, and Teo’s name on a list of its own. Rook visits on Tuesdays.',
    next: 'dawn',
  },
  endBurn: {
    action: 'Rook unfolds a grease-spotted receipt and reads twelve words into the microphone, slowly, so everybody gets them.',
    lines: [
      { who: 'sharpe', text: 'You can’t— that was the Founder’s—' },
      { who: 'rook', text: 'It was a pizza tip. Have it, Port Concord.' },
    ],
    after: 'Across the city, ten thousand people race for the same coins at once. Rook walks out with nothing. Dani is leaning on the ambulance outside.',
    next: 'burnDani',
  },
  burnDani: {
    lines: [
      { who: 'dani', text: 'That was the stupidest thing you’ve ever done.' },
      { who: 'rook', text: 'Is that a yes to dinner?' },
    ],
    next: 'dawn',
  },
  endByzantine: {
    lines: [
      { who: 'teo', paren: 'on line two, delighted', text: 'Rook! My guy! I knew it!' },
      { who: 'voice', paren: 'warm, unhurried', text: 'Welcome to patience, Rook.' },
    ],
    after: 'Rich by morning. Hunted by lunch. Somewhere across town, Dani reads the news and deletes your number.',
    next: 'dawn',
  },
  endSilence: {
    lines: [{ who: 'ivy', text: 'Rook? Rook. Fine. I’m coming up.' }],
    after: 'Ivy takes the stick out of Rook’s hand and locks it into the federation herself.',
    next: 'dawn',
  },
  dawn: {
    slug: 'EXT. GULLMOOR TIP, GATE — DAWN',
    action: 'Mist on the mounds. Gulls. Mags scratches Duncan’s ears. Rook stands at the hatch, empty-handed for once.',
    lines: [
      { who: 'rook', text: 'You could have stopped all of it. One signature.' },
      { who: 'mags', text: 'And then what? They’d have trusted me instead. That’s the thing I built it to stop.' },
      { who: 'mags', paren: 'handing over a mug: WORLD’S OKAYEST BOSS', text: 'Don’t drop it. Duncan’s fond of that one.' },
      { who: 'mags', if: 'pastHonest', paren: 'a second mug from under the counter: FOUNDER', text: 'And this one. Present from a fan. Never used it.' },
    ],
    next: 'voicemail',
  },
  voicemail: {
    action: 'Rook’s phone buzzes. A voicemail recorded on 3 January 2009, never sent, delivered eleven minutes ago.',
    lines: [
      { who: 'founder', paren: 'quietly', text: 'They’ll say it’s a toy. Then they’ll say it’s a crime. Let’s see if they can keep it honest without me.' },
      { who: 'rook', paren: 'looking up at the hatch', text: '…Mags?' },
    ],
    after: 'The hatch is already shut. Behind it, a radio clicks off. END OF SEASON ONE.',
    then: 'done',
  },
});

export const FOUNDER_ACT: StoryAct = Object.freeze({
  id: 'founder',
  kind: 'act',
  number: 'Act four',
  title: 'The Founder’s Coins',
  blurb: 'Inspired by a forger who claimed to be the Founder and could not sign one sentence.',
  steps: FOUNDER_STEPS,
  scenes: Object.freeze({ call: 'stick', blackout: 'blackout', radio: 'onAir' }),
  objectives: FOUNDER_OBJECTIVES,
  targets: Object.freeze({ toMast: MAST_SPOT }),
  arrivals: Object.freeze({ toMast: { at: MAST_SPOT, range: 2.5, to: 'blackout' } }),
  closed: ['radio', 'done'],
  workStep: 'power',
  spots: GENERATORS,
  workReach: GENERATOR_REACH,
  workMs: GENERATOR_MS,
  workGoal: GENERATORS_NEEDED,
  goalLabel: 'Generators',
  workVerb: 'Restart the {} generator',
  markers: 'labels',
  hint: 'Four generators, two each side of the mast. Three get the station back on air. Split up.',
  night: 0.55,
  nights: Object.freeze({ blackout: 0.78, power: 0.78, radio: 0.3, done: 0.3 }),
  catchers: Object.freeze({
    choir: {
      name: 'The Choir',
      where: 'the road',
      lines: [
        'A Choir runner shines a phone in your face. “Not you. We want the stick.” They walk you back to the road.',
        'The Choir, in unison: “Again? The key belongs to everyone. Not you specifically.” Back to the road.',
        'A Choir runner sighs. “Third time. We’re starting to like you, and that’s against the rules.”',
      ],
    },
  }),
  carries: true,
  start: FOUNDER_START,
  script: FOUNDER_SCRIPT,
  marks: FOUNDER_MARKS,
  rewardSats: FOUNDER_REWARD_SATS,
  lesson:
    'A signature proves who holds a key, not who tells the best story. Sharpe talked for nine minutes; one signature would have settled it. And nobody, not even the Founder, should be the one person everyone has to trust.',
  next: 'Season one is complete. Play any act again to change what Port Concord remembers, and which ending you can reach.',
});
