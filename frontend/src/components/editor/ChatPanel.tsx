'use client';

import { useEffect, useRef } from 'react';
import { ChatMessage } from '@/lib/api';
import { ChatInput } from '@/components/chat/ChatInput';
import ReactMarkdown from 'react-markdown';

// Interactive widgets that should appear in chat
import { ConfirmationWidget } from '@/components/widgets/ConfirmationWidget';
import { DocumentRequestWidget } from '@/components/widgets/DocumentRequestWidget';
import { EvidenceInputWidget } from '@/components/widgets/EvidenceInputWidget';
import { GenerateOptionsWidget } from '@/components/widgets/GenerateOptionsWidget';
import { ToolChecklistWidget } from '@/components/widgets/ToolChecklistWidget';
import { DeliverablesOverviewWidget } from '@/components/widgets/DeliverablesOverviewWidget';

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Check if the latest message has a document_request widget
  const latestMessage = messages[messages.length - 1];
  const showDocumentRequest = latestMessage?.widget_type === ABOVE_INPUT_WIDGET_TYPE;

  return (
    <div className={`flex flex-col h-full ${fullWidth ? '' : 'border-r border-divider'}`}>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((message, index) => (
          <ChatMessageItem 
            key={message.id} 
            message={message}
            initiativeId={initiativeId}
            isLatest={index === messages.length - 1}
          />
        ))}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Document Request Widget (above input) */}
      {showDocumentRequest && (
        <DocumentRequestWidget
          initiativeId={initiativeId}
          isActive={true}
          data={latestMessage.widget_data}
        />
      )}

      {/* Input */}
      <div className="flex-shrink-0 p-4 border-t border-divider">
        <ChatInput
          onSend={onSendMessage}
          disabled={sending || generating}
          placeholder="Ask a question or describe what you need..."
        />
      </div>
    </div>
  );
}

function ChatMessageItem({ 
  message,
  initiativeId,
  isLatest 
}: { 
  message: ChatMessage;
  initiativeId: string;
  isLatest: boolean;
}) {
  const isUser = message.role === 'user';
  const shouldShowWidget = message.widget_type && 
    message.widget_data && 
    CHAT_WIDGET_TYPES.includes(message.widget_type);

  // Show message but not widget for document_request (widget shown above input instead)
  const isDocumentRequest = message.widget_type === ABOVE_INPUT_WIDGET_TYPE;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex flex-col ${isUser ? 'max-w-[90%] items-end' : 'w-full items-start'}`}>
        <div
          className={`
            rounded-lg px-3 py-2 text-sm
            ${isUser
              ? 'bg-accent text-white'
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
          <div className="mt-3 w-full">
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
  switch (type) {
    case 'confirmation':
      return <ConfirmationWidget data={data} initiativeId={initiativeId} isActive={isActive} />;
    case 'evidence_input':
      return <EvidenceInputWidget initiativeId={initiativeId} isActive={isActive} />;
    case 'generate_options':
      return <GenerateOptionsWidget data={data} initiativeId={initiativeId} isActive={isActive} />;
    case 'tool_checklist':
      return <ToolChecklistWidget data={data} initiativeId={initiativeId} isActive={isActive} />;
    case 'deliverables_overview':
      return <DeliverablesOverviewWidget data={data} initiativeId={initiativeId} isActive={isActive} />;
    default:
      return null;
  }
}
