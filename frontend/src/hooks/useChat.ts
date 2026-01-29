import { useCallback } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';

export function useChat(initiativeId: string) {
  const { 
    messages, 
    sending, 
    sendMessage: storeSendMessage 
  } = useInitiativeStore();

  const sendMessage = useCallback(
    (content: string) => storeSendMessage(initiativeId, content),
    [initiativeId, storeSendMessage]
  );

  return {
    messages,
    sending,
    sendMessage,
  };
}
