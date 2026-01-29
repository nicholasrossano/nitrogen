'use client';

import { ChatMessage as ChatMessageType } from '@/lib/api';
import { User, Bot } from 'lucide-react';
import { ConfirmationWidget } from '@/components/widgets/ConfirmationWidget';
import { EvidenceInputWidget } from '@/components/widgets/EvidenceInputWidget';
import { GenerateOptionsWidget } from '@/components/widgets/GenerateOptionsWidget';
import { MemoViewerWidget } from '@/components/widgets/MemoViewerWidget';

interface ChatMessageProps {
  message: ChatMessageType;
  initiativeId: string;
  isLatest: boolean;
}

export function ChatMessage({ message, initiativeId, isLatest }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 message-enter ${isUser ? 'justify-end' : ''}`}>
      {/* Avatar */}
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
          <Bot className="w-5 h-5 text-primary-600" />
        </div>
      )}

      {/* Message content */}
      <div className={`flex flex-col max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`
            px-4 py-3 rounded-2xl
            ${isUser 
              ? 'bg-primary-600 text-white rounded-br-md' 
              : 'bg-gray-100 text-gray-800 rounded-bl-md'
            }
          `}
        >
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>

        {/* Widget */}
        {message.widget_type && message.widget_data && isLatest && (
          <div className="mt-3 w-full">
            <MessageWidget 
              type={message.widget_type}
              data={message.widget_data}
              initiativeId={initiativeId}
            />
          </div>
        )}

        {/* Timestamp */}
        <span className="text-xs text-gray-400 mt-1">
          {new Date(message.created_at).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
          })}
        </span>
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
          <User className="w-5 h-5 text-gray-600" />
        </div>
      )}
    </div>
  );
}

function MessageWidget({ 
  type, 
  data, 
  initiativeId 
}: { 
  type: string; 
  data: Record<string, any>;
  initiativeId: string;
}) {
  switch (type) {
    case 'confirmation':
      return <ConfirmationWidget data={data} initiativeId={initiativeId} />;
    case 'evidence_input':
      return <EvidenceInputWidget initiativeId={initiativeId} />;
    case 'generate_options':
      return <GenerateOptionsWidget data={data} initiativeId={initiativeId} />;
    case 'memo_viewer':
      return <MemoViewerWidget data={data} initiativeId={initiativeId} />;
    default:
      return null;
  }
}
