// Plain-language text for quick-chat lines; names come from the synced roster.
import type { ChatMessage, SimplePhrase } from '@byzantine-council/shared';
import { t, type PlainKey } from '../i18n/index.js';
import { placeName } from './places.js';

export const SIMPLE_TEXT: Readonly<Record<SimplePhrase, PlainKey>> = {
  whereWereYou: 'chat.whereWereYou',
  iAgree: 'chat.iAgree',
  showEvidence: 'chat.showEvidence',
  fixPartition: 'chat.fixPartition',
  skipVote: 'chat.skipVote',
};

export function chatText(chat: ChatMessage, nameOf: (id: string) => string): string {
  switch (chat.phrase) {
    case 'sawAt':
      return t('chat.sawAt', { name: nameOf(chat.playerId), place: placeName(chat.room) });
    case 'suspect':
      return t('chat.suspect', { name: nameOf(chat.playerId) });
    case 'trust':
      return t('chat.trust', { name: nameOf(chat.playerId) });
    case 'dontSign':
      return t('chat.dontSign', { id: chat.proposalId });
    case 'signIt':
      return t('chat.signIt', { id: chat.proposalId });
    case 'audited':
      return t(chat.forged ? 'chat.auditedForged' : 'chat.auditedReal', { id: chat.proposalId });
    case 'iWasIn':
      return t('chat.iWasIn', { place: placeName(chat.room) });
    default:
      return t(SIMPLE_TEXT[chat.phrase]);
  }
}
