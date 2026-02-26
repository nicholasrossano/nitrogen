'use client';

import { useEffect, useMemo, useRef } from 'react';
import { ChatMessage } from '@/lib/api';
import { ChatInput } from '@/components/chat/ChatInput';
import ReactMarkdown from 'react-markdown';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// Interactive widgets that should appear in chat
import { ConfirmationWidget } from '@/components/widgets/ConfirmationWidget';
import { DocumentRequestWidget } from '@/components/widgets/DocumentRequestWidget';
import { EvidenceInputWidget } from '@/components/widgets/EvidenceInputWidget';
import { GenerateOptionsWidget } from '@/components/widgets/GenerateOptionsWidget';
import { ToolChecklistWidget } from '@/components/widgets/ToolChecklistWidget';
import { DeliverablesOverviewWidget } from '@/components/widgets/DeliverablesOverviewWidget';
import { AlignmentWidget } from '@/components/widgets/AlignmentWidget';
import { ProjectPlanWidget } from '@/components/widgets/ProjectPlanWidget';

interface ChatPanelProps {
  messages: ChatMessage[];
  sending: boolean;
  generating: boolean;
  initiativeId: string;
  onSendMessage: (content: string) => void;
  fullWidth?: boolean;
}

// Widget types that should render in the chat (interactive/decisioning)
const CHAT_WIDGET_TYPES = [
  'confirmation',
  'evidence_input', 
  'generate_options',
  'tool_checklist',
  'deliverables_overview',
  'alignment',
  'project_plan',
];

// Widget that should render above the input bar
const ABOVE_INPUT_WIDGET_TYPE = 'document_request';

export function ChatPanel({
  messages,
  sending,
  generating,
  initiativeId,
  onSendMessage,
  fullWidth = false,
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef<number>(0);
  const prevLastMessageIdRef = useRef<string | null>(null);
  const lastSeenCountRef = useRef<number>(0);
  const isInitialLoadRef = useRef<boolean>(true);

  // Ensure messages is always an array
  const safeMessages = useMemo(() => messages || [], [messages]);
  
  // Debug logging
  useEffect(() => {
    console.log('ChatPanel: mounted/messages changed', { 
      count: safeMessages.length,
      lastMessage: safeMessages[safeMessages.length - 1]?.content?.substring(0, 50)
    });
    
    return () => {
      console.log('ChatPanel: UNMOUNTING!');
    };
  }, [safeMessages]);
  
  // Log every render
  console.log('ChatPanel: rendering', { messageCount: safeMessages.length });

  // Scroll to bottom when messages change (new message added or content reloaded)
  useEffect(() => {
    const lastMessage = safeMessages[safeMessages.length - 1];
    const lastMessageId = lastMessage?.id || null;
    
    // Scroll if message count increased OR if the last message ID changed (content reload)
    const shouldScroll = 
      safeMessages.length > prevMessageCountRef.current ||
      (lastMessageId && lastMessageId !== prevLastMessageIdRef.current);
    
    if (shouldScroll && scrollContainerRef.current) {
      // Use setTimeout to ensure DOM has fully rendered
      setTimeout(() => {
        if (scrollContainerRef.current) {
          // Scroll to bottom of container
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
          console.log('ChatPanel: scrolled to bottom', {
            scrollTop: scrollContainerRef.current.scrollTop,
            scrollHeight: scrollContainerRef.current.scrollHeight,
            clientHeight: scrollContainerRef.current.clientHeight
          });
        }
      }, 100);
    }
    
    prevMessageCountRef.current = safeMessages.length;
    prevLastMessageIdRef.current = lastMessageId;
  }, [safeMessages]);

  // Track which messages to animate (only newly sent/received, not on initial load)
  useEffect(() => {
    if (safeMessages.length > 0 && isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
    }
    lastSeenCountRef.current = safeMessages.length;
  }, [safeMessages.length]);

  // Check if the latest message has a widget that should hide the text input
  const latestMessage = safeMessages[safeMessages.length - 1];
  const showDocumentRequest = latestMessage?.widget_type === ABOVE_INPUT_WIDGET_TYPE;
  const showAlignmentWidget = latestMessage?.widget_type === 'alignment';
  
  // Hide input when document request or alignment widget is active (to prevent branching conversation)
  const hideTextInput = showDocumentRequest || showAlignmentWidget;

  return (
    <div className={`flex flex-col h-full overflow-hidden ${fullWidth ? '' : 'border-r border-divider'}`}>
      {/* Messages - use absolute positioning to prevent flex issues */}
      <div className="flex-1 relative">
        <div ref={scrollContainerRef} className="absolute inset-0 overflow-y-auto px-4 py-4 space-y-4">
        {safeMessages.length === 0 ? (
          <div className="text-center text-text-tertiary py-8">
            No messages yet. Start a conversation!
          </div>
        ) : (
          safeMessages.map((message, index) => (
            <ErrorBoundary key={message.id || `msg-${index}`}>
              <ChatMessageItem 
                message={message}
                initiativeId={initiativeId}
                isLatest={index === safeMessages.length - 1}
                animate={!isInitialLoadRef.current && index >= lastSeenCountRef.current}
              />
            </ErrorBoundary>
          ))
        )}
        
        <div ref={messagesEndRef} className="h-1" />
        </div>
      </div>

      {/* Document Request Widget (above input) - when visible, hide text input */}
      {showDocumentRequest && (
        <DocumentRequestWidget
          initiativeId={initiativeId}
          isActive={true}
          data={latestMessage.widget_data ?? undefined}
        />
      )}

      {/* Input - hidden while document request or alignment widget is shown */}
      {!hideTextInput && (
        <div className="flex-shrink-0 p-4 border-t border-divider">
          <ChatInput
            onSend={onSendMessage}
            disabled={sending || generating}
            placeholder="Ask anything"
          />
        </div>
      )}
    </div>
  );
}

function ChatMessageItem({ 
  message,
  initiativeId,
  isLatest,
  animate = false
}: { 
  message: ChatMessage;
  initiativeId: string;
  isLatest: boolean;
  animate?: boolean;
}) {
  // Defensive: ensure message is valid
  if (!message) {
    console.warn('ChatMessageItem: received null/undefined message');
    return null;
  }

  const isUser = message.role === 'user';
  const shouldShowWidget = message.widget_type && 
    message.widget_data && 
    CHAT_WIDGET_TYPES.includes(message.widget_type);

  // Show message but not widget for document_request (widget shown above input instead)
  const isDocumentRequest = message.widget_type === ABOVE_INPUT_WIDGET_TYPE;

  const enterClass = animate ? (isUser ? 'message-enter' : 'message-enter-bot') : '';

  return (
    <div className={`flex ${enterClass} ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex flex-col ${isUser ? 'max-w-[90%] items-end' : 'w-full items-start'}`}>
        <div
          className={`
            rounded-lg px-3 py-2 text-sm
            ${isUser
              ? 'bg-zinc-700 text-white'
              : 'bg-white text-text-primary'
            }
          `}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="prose-sm prose-memo">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* Interactive widgets render in chat (but not document_request) */}
        {shouldShowWidget && !isDocumentRequest && (
          <div className={`mt-3 w-full ${animate ? (isUser ? 'message-widget-enter' : 'message-widget-enter-bot') : ''}`}>
            <ChatWidget 
              type={message.widget_type!}
              data={message.widget_data!}
              initiativeId={initiativeId}
              isActive={isLatest}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ChatWidget({ 
  type, 
  data, 
  initiativeId,
  isActive
}: { 
  type: string; 
  data: Record<string, any>;
  initiativeId: string;
  isActive: boolean;
}) {
  console.log('ChatWidget render:', { type, isActive, hasData: !!data });
  
  // Defensive check for missing data
  if (!data) {
    console.warn(`ChatWidget: Missing data for widget type "${type}"`);
    return null;
  }

  switch (type) {
    case 'confirmation':
      return (
        <ErrorBoundary>
          <ConfirmationWidget data={data} initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      );
    case 'evidence_input':
      return (
        <ErrorBoundary>
          <EvidenceInputWidget initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      );
    case 'generate_options':
      return (
        <ErrorBoundary>
          <GenerateOptionsWidget data={data} initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      );
    case 'tool_checklist':
      return (
        <ErrorBoundary>
          <ToolChecklistWidget data={data} initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      );
    case 'deliverables_overview':
      return (
        <ErrorBoundary>
          <DeliverablesOverviewWidget data={data} initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      );
    case 'alignment':
      if (!data.alignment || !data.tool) {
        console.warn('ChatWidget: Missing alignment or tool data for alignment widget');
        return null;
      }
      return (
        <ErrorBoundary>
          <AlignmentWidget data={data} initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      );
    case 'project_plan':
      return (
        <ErrorBoundary>
          <ProjectPlanWidget data={data} initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      );
    default:
      console.warn(`ChatWidget: Unknown widget type "${type}"`);
      return null;
  }
}
