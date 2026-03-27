'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ChatMessage as ChatMessageType, SourceCitation } from '@/lib/api';
import { ConfirmationWidget } from '@/components/widgets/ConfirmationWidget';
import { EvidenceInputWidget } from '@/components/widgets/EvidenceInputWidget';
import { GenerateOptionsWidget } from '@/components/widgets/GenerateOptionsWidget';
import { MemoViewerWidget } from '@/components/widgets/MemoViewerWidget';
import { ModuleChecklistWidget } from '@/components/widgets/ModuleChecklistWidget';
import { DeliverablesOverviewWidget } from '@/components/widgets/DeliverablesOverviewWidget';
import { ChecklistViewerWidget } from '@/components/widgets/ChecklistViewerWidget';
import { DeliverablesListWidget } from '@/components/widgets/DeliverablesListWidget';
import { AlignmentWidget } from '@/components/widgets/AlignmentWidget';
import { DocumentRequestWidget } from '@/components/widgets/DocumentRequestWidget';
import { ProjectPlanWidget } from '@/components/widgets/ProjectPlanWidget';
import { LCOEInputsWidget } from '@/components/widgets/LCOEInputsWidget';
import { LCOEOutputWidget } from '@/components/widgets/LCOEOutputWidget';
import { CarbonInputsWidget } from '@/components/widgets/CarbonInputsWidget';
import { CarbonOutputWidget } from '@/components/widgets/CarbonOutputWidget';
import { ProposedValueWidget } from '@/components/widgets/ProposedValueWidget';
import { BookOpen, Globe, FileText, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { UserMessageToolbar, AssistantMessageToolbar } from './MessageToolbar';
import { MessageVariants } from './MessageVariants';
import { ThinkingLogs } from '@/components/core-chat/ThinkingLogs';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { sanitizeHref } from '@/lib/sanitizeHref';

function preprocessMath(content: string): string {
  return content
    .replace(/\\\[([\s\S]*?)\\\]/g, (_: string, math: string) => `$$${math}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_: string, math: string) => `$${math}$`);
}

interface ChatMessageProps {
  message: ChatMessageType;
  initiativeId: string;
  isLatest: boolean;
  animate?: boolean;
  isStreaming?: boolean;
  className?: string;
  hasOutputWidget?: boolean;
  variantEntry?: { versions: ChatMessageType[]; currentIndex: number } | null;
  showToolbar?: boolean;
  groupContent?: string;
  groupFirstId?: string;
}

function StreamingText({ content }: { content: string }) {
  const [renderedWords, setRenderedWords] = useState<Array<{word: string, id: string}>>([]);
  const words = content.split(' ').filter(w => w.length > 0);

  useEffect(() => {
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

export function ChatMessage({
  message,
  initiativeId,
  isLatest,
  animate = false,
  isStreaming = false,
  className = '',
  hasOutputWidget = false,
  variantEntry = null,
  showToolbar = true,
  groupContent,
  groupFirstId,
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const enterClass = animate ? (isUser ? 'message-enter' : 'message-enter-bot') : '';

  const {
    messageFeedback,
    retryingMessageId,
    editMessage,
    retryMessage,
    setMessageFeedback,
    setVariantIndex,
  } = useInitiativeStore();

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const feedback = messageFeedback[message.id] ?? null;
  const isRetrying = retryingMessageId === message.id;

  const handleEditStart = useCallback(() => {
    setEditValue(message.content);
    setIsEditing(true);
  }, [message.content]);

  const handleEditSave = useCallback(async () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === message.content) {
      setIsEditing(false);
      return;
    }
    setIsEditing(false);
    await editMessage(initiativeId, message.id, trimmed);
  }, [editValue, message.content, message.id, initiativeId, editMessage]);

  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
    setEditValue(message.content);
  }, [message.content]);

  const handleRetry = useCallback(() => {
    retryMessage(initiativeId, groupFirstId ?? message.id);
  }, [initiativeId, message.id, groupFirstId, retryMessage]);

  const handleFeedback = useCallback((f: 'like' | 'dislike' | null) => {
    setMessageFeedback(message.id, f);
  }, [message.id, setMessageFeedback]);

  // Auto-resize textarea
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [isEditing]);

  const originalMessageId = variantEntry
    ? variantEntry.versions[0]?.id
    : null;
  const completionMeta = message.completion_meta
    ? {
        latency_ms: message.completion_meta.latency_ms ?? 0,
        citation_count: message.completion_meta.citation_count,
        tiers_used: message.completion_meta.tiers_used,
      }
    : null;

  return (
    <div
      className={`flex ${enterClass} ${isUser ? 'justify-end' : 'justify-start'} ${className}`.trim()}
    >
      {/* Message content */}
      <div className={`flex flex-col ${isUser ? 'max-w-[75%] items-end' : 'max-w-[90%] items-start'}`}>

        {isUser ? (
          isEditing ? (
            // Inline edit mode
            <div className="w-full">
              <textarea
                ref={textareaRef}
                value={editValue}
                onChange={e => {
                  setEditValue(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleEditSave();
                  }
                  if (e.key === 'Escape') handleEditCancel();
                }}
                className="w-full text-sm leading-relaxed px-4 py-1.5 rounded-2xl bg-zinc-700 text-white resize-none outline-none focus:ring-1 focus:ring-accent min-w-[200px]"
                rows={1}
              />
              <div className="flex items-center gap-2 mt-1.5 justify-end">
                <button
                  onClick={handleEditCancel}
                  className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditSave}
                  className="text-xs text-accent hover:text-accent-anchor font-medium transition-colors"
                >
                  Save & regenerate
                </button>
              </div>
            </div>
          ) : (
            // Normal user bubble
            <div className="px-4 py-1.5 rounded-2xl bg-zinc-700 text-white">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
            </div>
          )
        ) : (
          // Bot message
          <>
          {(message.thinking_lines?.length || 0) > 0 && (
            <ThinkingLogs
              lines={message.thinking_lines || []}
              completionMeta={completionMeta}
              isThinking={isStreaming && !message.content}
              isStreaming={isStreaming}
            />
          )}
          <div className="prose-chat">
            {isStreaming ? (
              <p className="text-sm leading-relaxed">
                <StreamingText content={message.content} />
              </p>
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  p: ({ children }) => <p className="text-sm leading-relaxed">{children}</p>,
                  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                  em: ({ children }) => <em className="italic">{children}</em>,
                  ul: ({ children }) => <ul className="text-sm list-disc">{children}</ul>,
                  ol: ({ children }) => <ol className="text-sm list-decimal">{children}</ol>,
                  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                  h1: ({ children }) => <h1 className="text-lg font-semibold">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-base font-semibold">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-sm font-semibold">{children}</h3>,
                  code: ({ children }) => <code className="text-xs bg-surface-subtle px-1.5 py-0.5 rounded-sm border border-stroke-subtle">{children}</code>,
                  pre: ({ children }) => <pre className="text-xs bg-surface-subtle p-3 rounded border border-stroke-subtle overflow-x-auto">{children}</pre>,
                  a: ({ href, children }) => <a href={sanitizeHref(href)} className="text-accent hover:text-accent-anchor hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                  blockquote: ({ children }) => <blockquote className="border-l border-divider pl-3 text-text-secondary">{children}</blockquote>,
                }}
              >
                {preprocessMath(message.content)}
              </ReactMarkdown>
            )}
          </div>
          </>
        )}

        {/* Variant switcher (shown for retried assistant messages) */}
        {!isUser && variantEntry && variantEntry.versions.length > 1 && originalMessageId && (
          <MessageVariants
            currentIndex={variantEntry.currentIndex}
            total={variantEntry.versions.length}
            onPrev={() => setVariantIndex(originalMessageId, variantEntry.currentIndex - 1)}
            onNext={() => setVariantIndex(originalMessageId, variantEntry.currentIndex + 1)}
          />
        )}

        {/* Sources/Citations */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <SourcesDisplay sources={message.sources} />
        )}

        {/* Widget */}
        {message.widget_type && message.widget_data && (
          <div className={`mt-2 w-full ${animate ? (isUser ? 'message-widget-enter' : 'message-widget-enter-bot') : ''}`}>
            <MessageWidget
              type={message.widget_type}
              data={message.widget_data}
              initiativeId={initiativeId}
              isActive={isLatest}
              hasOutputWidget={hasOutputWidget}
              messageId={message.id}
            />
          </div>
        )}

        {/* Toolbar — shown below all content with consistent spacing */}
        {!isStreaming && !isEditing && showToolbar && (
          <div className={`${isUser ? 'mt-2' : 'mt-4'} flex items-center relative ${isUser ? 'self-end' : 'self-start'}`}>
            {isUser ? (
              <UserMessageToolbar
                content={message.content}
                onEdit={handleEditStart}
              />
            ) : (
              <AssistantMessageToolbar
                content={groupContent ?? message.content}
                feedback={feedback}
                onFeedback={handleFeedback}
                onRetry={handleRetry}
                retrying={isRetrying}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SourcesDisplay({ sources }: { sources: SourceCitation[] }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
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
  isActive,
  hasOutputWidget = false,
  messageId,
}: {
  type: string;
  data: Record<string, any>;
  initiativeId: string;
  isActive: boolean;
  hasOutputWidget?: boolean;
  messageId?: string;
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
      return <ModuleChecklistWidget data={data} initiativeId={initiativeId} isActive={isActive} />;
    case 'deliverables_overview':
      return <DeliverablesOverviewWidget data={data} initiativeId={initiativeId} isActive={isActive} />;
    case 'checklist_viewer':
      return <ChecklistViewerWidget data={data} initiativeId={initiativeId} isActive={isActive} />;
    case 'deliverables_list':
      return <DeliverablesListWidget data={data} initiativeId={initiativeId} isActive={isActive} />;
    case 'alignment':
      return <AlignmentWidget data={data} initiativeId={initiativeId} isActive={isActive} />;
    case 'project_plan':
      return <ProjectPlanWidget data={data} initiativeId={initiativeId} isActive={isActive} />;
    case 'lcoe_inputs':
      return <LCOEInputsWidget data={data} initiativeId={initiativeId} isActive={isActive} hasOutputWidget={hasOutputWidget} messageId={messageId} />;
    case 'lcoe_output':
      return <LCOEOutputWidget data={data} initiativeId={initiativeId} isActive={isActive} messageId={messageId} />;
    case 'carbon_inputs':
      return <CarbonInputsWidget data={data} initiativeId={initiativeId} isActive={isActive} hasOutputWidget={hasOutputWidget} messageId={messageId} />;
    case 'carbon_output':
      return <CarbonOutputWidget data={data} initiativeId={initiativeId} isActive={isActive} messageId={messageId} />;
    case 'proposed_value':
      return <ProposedValueWidget data={data as any} messageId={messageId} />;
    default:
      return null;
  }
}
