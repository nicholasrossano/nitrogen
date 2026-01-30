'use client';

import ReactMarkdown from 'react-markdown';
import { ChatMessage as ChatMessageType } from '@/lib/api';
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
    <div className={`flex message-enter ${isUser ? 'justify-end' : 'justify-start'}`}>
      {/* Message content */}
      <div className={`flex flex-col ${isUser ? 'max-w-[75%] items-end' : 'max-w-[90%] items-start'}`}>
        {isUser ? (
          // User message - bubble with cream color, plain text
          <div className="px-4 py-3 rounded-card shadow-subtle bg-cream border border-beige/50 text-brown">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
          </div>
        ) : (
          // Bot message - no bubble, markdown rendered
          <div className="text-brown prose-chat">
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="text-sm leading-relaxed mb-2 last:mb-0">{children}</p>,
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                em: ({ children }) => <em className="italic">{children}</em>,
                ul: ({ children }) => <ul className="text-sm list-disc pl-5 mb-2 space-y-1">{children}</ul>,
                ol: ({ children }) => <ol className="text-sm list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
                li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                h1: ({ children }) => <h1 className="text-lg font-semibold mb-2">{children}</h1>,
                h2: ({ children }) => <h2 className="text-base font-semibold mb-2">{children}</h2>,
                h3: ({ children }) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
                code: ({ children }) => <code className="text-xs bg-blush px-1.5 py-0.5 rounded">{children}</code>,
                pre: ({ children }) => <pre className="text-xs bg-blush p-3 rounded-widget overflow-x-auto mb-2">{children}</pre>,
                a: ({ href, children }) => <a href={href} className="text-primary-600 hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                blockquote: ({ children }) => <blockquote className="border-l-2 border-beige pl-3 italic text-brown/70 mb-2">{children}</blockquote>,
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {/* Widget - always show, pass isLatest to control buttons */}
        {message.widget_type && message.widget_data && (
          <div className="mt-3 w-full">
            <MessageWidget 
              type={message.widget_type}
              data={message.widget_data}
              initiativeId={initiativeId}
              isActive={isLatest}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function MessageWidget({ 
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
    case 'memo_viewer':
      return <MemoViewerWidget data={data} initiativeId={initiativeId} isActive={isActive} />;
    default:
      return null;
  }
}
