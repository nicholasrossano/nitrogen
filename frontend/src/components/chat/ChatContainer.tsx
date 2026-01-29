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
    <div className="flex flex-col h-full">
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
            <div className="flex items-center gap-2 text-gray-500 pl-12">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">
                {generating ? 'Generating memo...' : 'Thinking...'}
              </span>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-gray-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 py-4">
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
