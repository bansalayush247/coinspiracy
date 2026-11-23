// Plain-language text for quick-chat lines; names come from the synced roster.
import type { ChatMessage, RoomId, SimplePhrase } from '@byzantine-council/shared';

export const ROOM_NAMES: Readonly<Record<RoomId, string>> = {
  plaza: 'the Plaza',
  vault: 'the Vault',
  ledgerArchive: 'the Ledger Archive',
  watchtower: 'the Watchtower',
  signingHall: 'the Signing Hall',
  depositGate: 'the Deposit Gate',
  gatewayDock: 'the Gateway Dock',
};

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
      return `I saw ${nameOf(chat.playerId)} in ${ROOM_NAMES[chat.room]}.`;
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
      return `I was in ${ROOM_NAMES[chat.room]}.`;
    default:
      return SIMPLE_TEXT[chat.phrase];
  }
}
