// Plain-language text for quick-chat lines; names come from the synced roster.
import type { ChatMessage, SimplePhrase } from '@byzantine-council/shared';
import { placeName } from './places.js';

export const SIMPLE_TEXT: Readonly<Record<SimplePhrase, string>> = {
  whereWereYou: 'Where were you?',
  iAgree: 'I agree.',
  showEvidence: 'Show your evidence.',
  fixPartition: 'Fix the partition!',
  skipVote: 'Let’s skip this vote.',
};

export function chatText(chat: ChatMessage, nameOf: (id: string) => string): string {
  switch (chat.phrase) {
    case 'sawAt':
      return `I saw ${nameOf(chat.playerId)} in ${placeName(chat.room)}.`;
    case 'suspect':
      return `I suspect ${nameOf(chat.playerId)}.`;
    case 'trust':
      return `I trust ${nameOf(chat.playerId)}.`;
    case 'dontSign':
      return `Don’t sign #${chat.proposalId}!`;
    case 'signIt':
      return `#${chat.proposalId} is real. Sign it.`;
    case 'audited':
      return `I audited #${chat.proposalId}: it’s ${chat.forged ? 'forged' : 'real'}.`;
    case 'iWasIn':
      return `I was in ${placeName(chat.room)}.`;
    default:
      return SIMPLE_TEXT[chat.phrase];
  }
}
