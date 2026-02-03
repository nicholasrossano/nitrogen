'use client';

import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChatMessage as ChatMessageType, SourceCitation } from '@/lib/api';
import { ConfirmationWidget } from '@/components/widgets/ConfirmationWidget';
import { EvidenceInputWidget } from '@/components/widgets/EvidenceInputWidget';
import { GenerateOptionsWidget } from '@/components/widgets/GenerateOptionsWidget';
import { MemoViewerWidget } from '@/components/widgets/MemoViewerWidget';
import { ToolChecklistWidget } from '@/components/widgets/ToolChecklistWidget';
import { DeliverablesOverviewWidget } from '@/components/widgets/DeliverablesOverviewWidget';
import { ChecklistViewerWidget } from '@/components/widgets/ChecklistViewerWidget';
import { DeliverablesListWidget } from '@/components/widgets/DeliverablesListWidget';
import { AlignmentWidget } from '@/components/widgets/AlignmentWidget';
import { DocumentRequestWidget } from '@/components/widgets/DocumentRequestWidget';
import { BookOpen, Globe, FileText, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

interface ChatMessageProps {
  message: ChatMessageType;
  initiativeId: string;
  isLatest: boolean;
  animate?: boolean;
  isStreaming?: boolean;
  className?: string;
}

function StreamingText({ content }: { content: string }) {
  const [renderedWords, setRenderedWords] = useState<Array<{word: string, id: string}>>([]);
  const words = content.split(' ').filter(w => w.length > 0);

  useEffect(() => {
    // Add any new words that aren't already rendered
    if (words.length > renderedWords.length) {
      const newWords = words.slice(renderedWords.length).map((word, idx) => ({
        word,
        id: `word-${Date.now()}-${renderedWords.length + idx}`
      }));
      setRenderedWords(prev => [...prev, ...newWords]);
    }
  }, [words.length, renderedWords.length, words]);

  return (
    <span>
      {renderedWords.map((item, index) => (
        <span
          key={item.id}
          className="inline-block word-fade-in"
          style={{ opacity: 0 }}
        >
          {item.word}
          {index < renderedWords.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  );
}

export function ChatMessage({ message, initiativeId, isLatest, animate = false, isStreaming = false, className = '' }: ChatMessageProps) {
  const isUser = message.role === 'user';

  const enterClass = animate ? (isUser ? 'message-enter' : 'message-enter-bot') : '';

  return (
    <div
      className={`flex ${enterClass} ${isUser ? 'justify-end' : 'justify-start'} ${className}`.trim()}
    >
      {/* Message content */}
      <div className={`flex flex-col ${isUser ? 'max-w-[75%] items-end' : 'max-w-[90%] items-start'}`}>
        {isUser ? (
          // User message - accent background
          <div className="px-4 py-3 rounded bg-accent text-white">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
          </div>
        ) : (
          // Bot message - no bubble, markdown rendered with streaming text
          <div className="text-text-primary prose-chat">
            {isStreaming ? (
              <p className="text-sm leading-relaxed mb-2">
                <StreamingText content={message.content} />
              </p>
            ) : (
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
                  code: ({ children }) => <code className="text-xs bg-surface-subtle px-1.5 py-0.5 rounded-sm border border-stroke-subtle">{children}</code>,
                  pre: ({ children }) => <pre className="text-xs bg-surface-subtle p-3 rounded border border-stroke-subtle overflow-x-auto mb-2">{children}</pre>,
                  a: ({ href, children }) => <a href={href} className="text-accent hover:text-accent-anchor hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                  blockquote: ({ children }) => <blockquote className="border-l border-divider pl-3 text-text-secondary mb-2">{children}</blockquote>,
                }}
              >
                {message.content}
              </ReactMarkdown>
            )}
          </div>
        )}

        {/* Sources/Citations - show for assistant messages with sources */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <SourcesDisplay sources={message.sources} />
        )}

        {/* Widget - always show, pass isLatest to control buttons */}
        {message.widget_type && message.widget_data && (
          <div className={`mt-2 w-full ${animate ? (isUser ? 'message-widget-enter' : 'message-widget-enter-bot') : ''}`}>
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

function SourcesDisplay({ sources }: { sources: SourceCitation[] }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Filter out llm_estimate sources for display
  const verifiedSources = sources.filter(s => s.source_type !== 'llm_estimate');
  const hasUnverified = sources.some(s => s.source_type === 'llm_estimate');
  
  if (verifiedSources.length === 0 && !hasUnverified) {
    return null;
  }

  const getSourceIcon = (type: string) => {
    switch (type) {
      case 'corpus':
        return <BookOpen className="w-3 h-3" />;
      case 'evidence':
        return <FileText className="w-3 h-3" />;
      case 'web':
        return <Globe className="w-3 h-3" />;
      default:
        return <AlertCircle className="w-3 h-3" />;
    }
  };

  const getSourceLabel = (type: string) => {
    switch (type) {
      case 'corpus':
        return 'Case Study';
      case 'evidence':
        return 'Uploaded';
      case 'web':
        return 'Web';
      default:
        return 'Estimate';
    }
  };

  return (
    <div className="mt-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
      >
        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        <span>
          {verifiedSources.length > 0 
            ? `${verifiedSources.length} source${verifiedSources.length > 1 ? 's' : ''}`
            : 'Sources'}
        </span>
        {hasUnverified && (
          <span className="text-yellow-600 ml-1">(includes estimates)</span>
        )}
      </button>
      
      {isExpanded && (
        <div className="mt-2 space-y-1.5 pl-2 border-l border-stroke-subtle">
          {verifiedSources.map((source, idx) => (
            <div key={idx} className="flex items-start gap-2 text-xs text-text-secondary">
              <span className="flex items-center gap-1 text-text-tertiary shrink-0">
                {getSourceIcon(source.source_type)}
                <span className="text-[10px] uppercase tracking-wide">{getSourceLabel(source.source_type)}</span>
              </span>
              {source.source_url ? (
                <a 
                  href={source.source_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-accent hover:underline truncate"
                >
                  {source.source_title}
                </a>
              ) : (
                <span className="truncate">{source.source_title}</span>
              )}
            </div>
          ))}
          {hasUnverified && (
            <div className="flex items-center gap-2 text-xs text-yellow-600">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span>Some information is based on general knowledge and should be verified</span>
            </div>
          )}
        </div>
      )}
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
    case 'document_request':
      return <DocumentRequestWidget data={data} initiativeId={initiativeId} isActive={isActive} />;
    case 'generate_options':
      return <GenerateOptionsWidget data={data} initiativeId={initiativeId} isActive={isActive} />;
    case 'memo_viewer':
      return <MemoViewerWidget data={data} initiativeId={initiativeId} isActive={isActive} />;
    case 'tool_checklist':
      return <ToolChecklistWidget data={data} initiativeId={initiativeId} isActive={isActive} />;
    case 'deliverables_overview':
      return <DeliverablesOverviewWidget data={data} initiativeId={initiativeId} isActive={isActive} />;
    case 'checklist_viewer':
      return <ChecklistViewerWidget data={data} initiativeId={initiativeId} isActive={isActive} />;
    case 'deliverables_list':
      return <DeliverablesListWidget data={data} initiativeId={initiativeId} isActive={isActive} />;
    case 'alignment':
      return <AlignmentWidget data={data} initiativeId={initiativeId} isActive={isActive} />;
    default:
      return null;
  }
}
