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
  const prevMessageCountRef = useRef<number>(0);
  const lastSeenCountRef = useRef<number>(0);
  const isInitialLoadRef = useRef<boolean>(true);
  const { messages, sending, generating, stageStatus, streamingMessageId, messageVariants } = useInitiativeStore();

  // Track which messages to animate (only newly sent/received, not on initial load)
  useEffect(() => {
    if (messages.length > 0 && isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
    }
    lastSeenCountRef.current = messages.length;
  }, [messages.length]);

  // Auto-scroll to bottom only when new messages are added
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length]);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Messages area - contains all scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-6 relative">
        <div className="max-w-3xl mx-auto">
          {messages.map((message, index) => {
            const prevRole = index > 0 ? messages[index - 1].role : null;
            const isUserFollowingBot = prevRole === 'assistant' && message.role === 'user';
            const marginClass = index === 0 ? '' : isUserFollowingBot ? 'mt-1' : 'mt-3';
            const animate = !isInitialLoadRef.current && index >= lastSeenCountRef.current;
            const isStreaming = message.id === streamingMessageId;
            const hasOutputWidget =
              (message.widget_type === 'lcoe_inputs' &&
                messages.slice(index + 1).some(m => m.widget_type === 'lcoe_output')) ||
              (message.widget_type === 'carbon_inputs' &&
                messages.slice(index + 1).some(m => m.widget_type === 'carbon_output'));

            // For messages that are the "current" variant of a retry, find its variant entry
            // The variant entry is keyed by the original (first) message ID
            const variantEntry = messageVariants[message.id] ?? null;

            // Only show toolbar on the last message of a consecutive assistant run
            const isAssistant = message.role !== 'user';
            const nextIsAssistant = index < messages.length - 1 && messages[index + 1].role !== 'user';
            const showToolbar = !isAssistant || !nextIsAssistant;

            // For grouped toolbar actions, find the start of this assistant run
            let groupContent: string | undefined;
            let groupFirstId: string | undefined;
            if (isAssistant) {
              let start = index;
              while (start > 0 && messages[start - 1].role !== 'user') start--;
              if (start < index) {
                groupContent = messages.slice(start, index + 1).map(m => m.content).join('\n\n');
                groupFirstId = messages[start].id;
              }
            }

            return (
              <ChatMessage
                key={message.id}
                message={message}
                initiativeId={initiativeId}
                isLatest={index === messages.length - 1}
                animate={animate}
                isStreaming={isStreaming}
                className={marginClass}
                hasOutputWidget={hasOutputWidget}
                variantEntry={variantEntry}
                showToolbar={showToolbar}
                groupContent={groupContent}
                groupFirstId={groupFirstId}
              />
            );
          })}
          
          {/* Loading indicator */}
          {(sending || generating) && (
            <div className={`flex items-center gap-3 text-text-secondary ${messages.length > 0 ? 'mt-3' : ''}`}>
              <div className="flex items-center gap-2 px-4 py-2 bg-surface-subtle rounded border border-stroke-subtle">
                <Loader2 className="w-4 h-4 animate-spin text-accent" />
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
      <div className="flex-shrink-0 pb-4 relative">
        <div className="pointer-events-none absolute -top-12 inset-x-0 h-12 bg-gradient-to-t from-white to-transparent" />
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
