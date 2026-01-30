'use client';

import { useRef, useEffect } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { Loader2 } from 'lucide-react';

interface ChatContainerProps {
  initiativeId: string;
}

export function ChatContainer({ initiativeId }: ChatContainerProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { messages, sending, generating, stageStatus } = useInitiativeStore();

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.map((message, index) => (
            <ChatMessage 
              key={message.id} 
              message={message}
              initiativeId={initiativeId}
              isLatest={index === messages.length - 1}
            />
          ))}
          
          {/* Loading indicator */}
          {(sending || generating) && (
            <div className="flex items-center gap-3 text-brown/60">
              <div className="flex items-center gap-2 px-4 py-2 bg-blush rounded-pill">
                <Loader2 className="w-4 h-4 animate-spin text-primary-600" />
                <span className="text-sm font-medium">
                  {generating ? 'Generating memo...' : 'Thinking...'}
                </span>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area - no container/border */}
      <div className="flex-shrink-0 pb-4">
        <div className="max-w-3xl mx-auto px-4">
          <ChatInput 
            initiativeId={initiativeId}
            disabled={sending || generating}
            stage={stageStatus?.stage || 'intake'}
          />
        </div>
      </div>
    </div>
  );
}
