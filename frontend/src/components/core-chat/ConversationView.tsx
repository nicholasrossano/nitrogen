'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  ArrowUp,
  BookOpen,
  GraduationCap,
  Globe,
  AlertCircle,
  FileText,
  ChevronDown,
  ChevronUp,
  X,
  Paperclip,
} from 'lucide-react';
import type { CoreChatMessage } from '@/stores/chatStore';
import { SourceCitation } from '@/lib/api';
import { ThinkingLogs } from './ThinkingLogs';
import { EDITOR_WIDGET_TYPES } from '@/components/editor/EditorSidePanel';
import { track } from '@/lib/analytics';
import { UserMessageToolbar, AssistantMessageToolbar } from '@/components/chat/MessageToolbar';
import { ProposedValueWidget } from '@/components/widgets/ProposedValueWidget';
import { CoverLetterProposedValueWidget } from '@/components/widgets/CoverLetterProposedValueWidget';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export interface ConversationViewProps {
  messages: CoreChatMessage[];
  sending: boolean;
  thinkingLines: string[];
  streamingContent: string;
  error: string | null;
  onSendMessage: (content: string, toolHint?: string) => void;
  onEditMessage: (messageId: string, newContent: string) => void;
  onRetryMessage: (messageId: string) => void;
  messageFeedback: Record<string, 'like' | 'dislike' | null>;
  onSetFeedback: (messageId: string, feedback: 'like' | 'dislike' | null) => void;
  retryingMessageId: string | null;
  onBack?: () => void;
  /** Required for rendering initiative-specific widgets (alignment, etc.) */
  initiativeId?: string;
}

function preprocessMath(content: string): string {
  // Convert proper LaTeX block delimiters to KaTeX-compatible $ notation
  let result = content
    .replace(/\\\[([\s\S]*?)\\\]/g, (_: string, math: string) => `$$${math}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_: string, math: string) => `$${math}$`);

  // Strip bare LaTeX commands outside of $ delimiters.
  // Split on properly-delimited math blocks, only touch the non-math segments.
  const segments = result.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/);
  return segments.map((seg, i) => {
    if (i % 2 === 1) return seg; // inside delimiters — leave KaTeX alone
    return seg
      .replace(/\\text\{([^}]*)\}/g, '$1')                   // \text{X}  → X
      .replace(/\\mathrm\{([^}]*)\}/g, '$1')                 // \mathrm{X} → X
      .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2')     // \frac{a}{b} → a/b
      .replace(/\\times/g, '×')
      .replace(/\\cdot/g, '·')
      .replace(/\\,/g, '\u202f')   // thin space
      .replace(/\\!/g, '')
      .replace(/\\quad/g, '  ')
      .replace(/\\:/g, ' ');
  }).join('');
}

export function ConversationView({
  messages,
  sending,
  thinkingLines,
  streamingContent,
  error,
  onSendMessage,
  onEditMessage,
  onRetryMessage,
  messageFeedback,
  onSetFeedback,
  retryingMessageId,
  onBack,
  initiativeId,
}: ConversationViewProps) {

  const [input, setInput] = useState('');
  const [draftTag, setDraftTag] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevCount = useRef(0);
  const wasStreaming = useRef(false);

  // Scroll when a new message bubble is added
  useEffect(() => {
    if (messages.length > prevCount.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevCount.current = messages.length;
  }, [messages.length]);

  // Scroll once when streaming begins; do NOT scroll on every word update
  useEffect(() => {
    if (sending && !wasStreaming.current) {
      wasStreaming.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else if (!sending) {
      wasStreaming.current = false;
    }
  }, [sending]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      const text = detail.text;
      const label = detail.label ?? null;
      if (text) {
        setInput(text);
        setDraftTag(label);
        setTimeout(() => textareaRef.current?.focus(), 0);
      }
    };
    window.addEventListener('nitrogen:draft', handler);
    return () => window.removeEventListener('nitrogen:draft', handler);
  }, []);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 150)}px`;
    }
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;
    onSendMessage(input.trim());
    setInput('');
    setDraftTag(null);
    setAttachedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) setAttachedFiles((prev) => [...prev, ...files]);
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // True while we're still in the planning/retrieval phase (no words yet)
  const isThinking = sending && !streamingContent;
  // True once words are coming in
  const isStreaming = sending && !!streamingContent;

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-4">
        <div className="max-w-[52rem] mx-auto">
        <div className="w-[90%] mx-auto space-y-8">
          {messages.map((msg, idx) => {
            // Compute consecutive-assistant-run info
            const isAssistant = msg.role !== 'user';
            const nextIsAssistant = idx < messages.length - 1 && messages[idx + 1].role !== 'user';
            // Only show toolbar on the last message of a consecutive assistant run
            const showToolbar = !isAssistant || !nextIsAssistant;

            // For grouped toolbar actions, find the start of this assistant run
            let groupContent: string | undefined;
            let groupRetryId = msg.id;
            if (isAssistant) {
              let start = idx;
              while (start > 0 && messages[start - 1].role !== 'user') start--;
              if (start < idx) {
                groupContent = messages.slice(start, idx + 1).map(m => m.content).join('\n\n');
                groupRetryId = messages[start].id;
              }
            }

            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                animate={idx >= messages.length - 2}
                isLatest={idx === messages.length - 1}
                initiativeId={initiativeId}
                feedback={messageFeedback[msg.id] ?? null}
                onFeedback={(f) => onSetFeedback(msg.id, f)}
                onEdit={(newContent) => onEditMessage(msg.id, newContent)}
                onRetry={() => onRetryMessage(groupRetryId)}
                retrying={retryingMessageId === msg.id}
                showToolbar={showToolbar}
                groupContent={groupContent}
              />
            );
          })}

          {/* Active response: thinking log + streaming content, both inline */}
          {sending && (
            <div className="flex justify-start">
              <div className="max-w-[90%] flex flex-col items-start">
                <ThinkingLogs
                  lines={thinkingLines}
                  completionMeta={null}
                  isThinking={isThinking}
                  isStreaming={isStreaming}
                />
                {streamingContent && (
                  <div className="prose-chat">
                    <ReactMarkdown
                      remarkPlugins={[remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={streamingMarkdownComponents}
                    >
                      {preprocessMath(streamingContent)}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="flex justify-start">
              <div className="px-4 py-3 text-sm text-indicator-orange bg-surface-subtle border border-stroke-subtle rounded-lg">
                {error}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
        </div>
      </div>

      {/* Composer */}
      <div className="relative">
        <div className="pointer-events-none absolute -top-12 inset-x-0 h-12 bg-gradient-to-t from-white to-transparent" />
        <div className="max-w-[52rem] mx-auto w-full pb-4 px-4">
        <form onSubmit={handleSubmit} className="relative">
          <div
            className="rounded-[10px] border border-stroke-subtle bg-white overflow-hidden"
          >
            {draftTag && (
              <div className="px-4 pt-2.5 pb-1 flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent/10 border border-accent/20 text-[11px] font-medium text-accent leading-none">
                  {draftTag}
                  <button
                    type="button"
                    onClick={() => { setDraftTag(null); setInput(''); }}
                    className="hover:opacity-60 transition-opacity"
                    aria-label="Remove"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              </div>
            )}

            {attachedFiles.length > 0 && (
              <div className="px-4 pt-2.5 pb-1 flex flex-wrap gap-1.5">
                {attachedFiles.map((file, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-subtle border border-stroke-subtle text-[11px] font-medium text-text-secondary leading-none max-w-[160px]"
                  >
                    <Paperclip className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachedFile(i)}
                      className="hover:opacity-60 transition-opacity shrink-0"
                      aria-label="Remove file"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything"
                disabled={sending}
                rows={1}
                className="w-full resize-none bg-transparent px-5 py-3 pb-8 pr-5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:text-text-tertiary overflow-hidden"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              />
              {/* Bottom-right: attach + send */}
              <div className="absolute right-3 bottom-2.5 flex items-center gap-1.5 pointer-events-none [&>*]:pointer-events-auto">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                  aria-label="Attach files"
                />
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-5 h-5 flex items-center justify-center rounded-full transition-colors duration-150 text-text-tertiary hover:text-text-secondary disabled:opacity-40 disabled:cursor-default"
                  aria-label="Attach files"
                >
                  <Paperclip className="w-[13px] h-[13px]" />
                </button>
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  className="w-5 h-5 flex items-center justify-center rounded-full transition-colors duration-150 disabled:cursor-default disabled:bg-stroke-subtle enabled:bg-accent"
                >
                  <ArrowUp className="w-[11px] h-[11px] text-white" />
                </button>
              </div>
            </div>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline citation chip                                               */
/* ------------------------------------------------------------------ */

// Matches [OpenAlex: Title], [Web: Title], [Corpus: Title], etc.
const INLINE_CITATION_RE = /\[([^\]:]+):\s*([^\]]{4,200})\]/g;

function CitationChip({
  sourceType,
  title,
  sources,
}: {
  sourceType: string;
  title: string;
  sources: SourceCitation[];
}) {
  const type = sourceType.toLowerCase().trim();

  // Fuzzy-match the cited title to a source so we can get the URL + publisher
  const trimmedTitle = title.trim().toLowerCase();
  const matched = sources.find((s) => {
    const a = s.source_title.toLowerCase();
    return (
      a.includes(trimmedTitle.slice(0, 50)) ||
      trimmedTitle.includes(a.slice(0, 50))
    );
  });

  const url = matched?.source_url;
  const publisher = matched?.publisher;

  let label: string;
  let icon: React.ReactNode;

  if (type === 'openalex' || type === 'scholarly') {
    icon = <GraduationCap className="w-3 h-3 shrink-0" />;
    label = publisher || 'OpenAlex';
  } else if (type === 'web') {
    icon = <Globe className="w-3 h-3 shrink-0" />;
    if (publisher) {
      label = publisher;
    } else if (url) {
      try { label = new URL(url).hostname.replace(/^www\./, ''); }
      catch { label = 'Web'; }
    } else {
      label = 'Web';
    }
  } else if (type === 'corpus' || type === 'curated') {
    icon = <BookOpen className="w-3 h-3 shrink-0" />;
    label = 'Curated';
  } else if (type === 'evidence' || type === 'uploaded') {
    icon = <FileText className="w-3 h-3 shrink-0" />;
    label = 'Uploaded';
  } else {
    icon = <FileText className="w-3 h-3 shrink-0" />;
    label = sourceType;
  }

  const chip = (
    <span
      title={title.trim()}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded border text-[10px] font-medium leading-none align-[0.1em] bg-surface-subtle border-stroke-subtle text-text-secondary hover:bg-accent/[0.07] hover:border-accent/30 hover:text-accent transition-colors cursor-pointer select-none"
    >
      {icon}
      {label}
    </span>
  );

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="no-underline"
        onClick={() => track('citation_chip_clicked', { source_type: type, publisher: label })}
      >
        {chip}
      </a>
    );
  }
  return chip;
}

/** Walk React children and replace citation patterns in string nodes with chips. */
function injectCitationChips(
  children: React.ReactNode,
  sources: SourceCitation[],
  keyPrefix = '0',
): React.ReactNode {
  if (typeof children === 'string') {
    return splitOnCitations(children, sources, keyPrefix);
  }
  if (Array.isArray(children)) {
    return children.map((child, i) =>
      typeof child === 'string'
        ? splitOnCitations(child, sources, `${keyPrefix}-${i}`)
        : child
    );
  }
  return children;
}

function splitOnCitations(
  text: string,
  sources: SourceCitation[],
  keyPrefix: string,
): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = new RegExp(INLINE_CITATION_RE.source, 'g');
  let last = 0;
  let partIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<span key={`${keyPrefix}-t${partIdx++}`}>{text.slice(last, m.index)}</span>);
    }
    const [, sourceType, title] = m;
    parts.push(
      <CitationChip
        key={`${keyPrefix}-c${m.index}`}
        sourceType={sourceType}
        title={title}
        sources={sources}
      />
    );
    last = re.lastIndex;
  }
  if (last < text.length) {
    parts.push(<span key={`${keyPrefix}-t${partIdx}`}>{text.slice(last)}</span>);
  }
  if (parts.length === 0) return text;
  if (parts.length === 1) return parts[0];
  return <>{parts}</>;
}

/* ------------------------------------------------------------------ */
/*  Markdown component factory (sources injected per-message)         */
/* ------------------------------------------------------------------ */

function makeMarkdownComponents(sources: SourceCitation[]) {
  const wrap = (Tag: string, className: string) => {
    const Wrapped = ({ children }: any) =>
      // @ts-expect-error dynamic tag
      <Tag className={className}>{injectCitationChips(children, sources)}</Tag>;
    Wrapped.displayName = `Wrapped_${Tag}`;
    return Wrapped;
  };

  return {
    p: ({ children }: any) => (
      <p className="text-sm leading-relaxed">
        {injectCitationChips(children, sources, 'p')}
      </p>
    ),
    li: ({ children }: any) => (
      <li className="leading-relaxed">
        {injectCitationChips(children, sources, 'li')}
      </li>
    ),
    strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }: any) => <em className="italic">{children}</em>,
    ul: ({ children }: any) => <ul className="text-sm list-disc">{children}</ul>,
    ol: ({ children }: any) => <ol className="text-sm list-decimal">{children}</ol>,
    h1: ({ children }: any) => <h1 className="text-xl font-semibold leading-snug">{children}</h1>,
    h2: ({ children }: any) => <h2 className="text-lg font-semibold leading-snug">{children}</h2>,
    h3: ({ children }: any) => <h3 className="text-base font-semibold leading-snug">{children}</h3>,
    code: ({ children }: any) => (
      <code className="text-xs bg-surface-subtle px-1.5 py-0.5 rounded-sm border border-stroke-subtle">
        {children}
      </code>
    ),
    pre: ({ children }: any) => (
      <pre className="text-xs bg-surface-subtle p-3 border border-stroke-subtle overflow-x-auto">
        {children}
      </pre>
    ),
    a: ({ href, children }: any) => (
      <a
        href={href}
        className="text-accent hover:text-accent-anchor hover:underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ),
    blockquote: ({ children }: any) => (
      <blockquote className="border-l border-divider pl-3 text-text-secondary">
        {children}
      </blockquote>
    ),
  };
}

// Streaming content has no sources yet; chips will render label-only until complete
const streamingMarkdownComponents = makeMarkdownComponents([]);

function MessageBubble({
  message,
  animate,
  isLatest,
  initiativeId,
  feedback,
  onFeedback,
  onEdit,
  onRetry,
  retrying,
  showToolbar = true,
  groupContent,
}: {
  message: CoreChatMessage;
  animate: boolean;
  isLatest?: boolean;
  initiativeId?: string;
  feedback: 'like' | 'dislike' | null;
  onFeedback: (f: 'like' | 'dislike' | null) => void;
  onEdit: (newContent: string) => void;
  onRetry: () => void;
  retrying: boolean;
  showToolbar?: boolean;
  groupContent?: string;
}) {
  const isUser = message.role === 'user';
  const enterClass = animate ? (isUser ? 'message-enter' : 'message-enter-bot') : '';
  const mdComponents = isUser
    ? streamingMarkdownComponents
    : makeMarkdownComponents(message.sources ?? []);

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [bubbleWidth, setBubbleWidth] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const handleEditStart = useCallback(() => {
    if (bubbleRef.current) {
      setBubbleWidth(bubbleRef.current.offsetWidth);
    }
    setEditValue(message.content);
    setIsEditing(true);
  }, [message.content]);

  const handleEditSave = useCallback(() => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === message.content) { setIsEditing(false); return; }
    setIsEditing(false);
    onEdit(trimmed);
  }, [editValue, message.content, onEdit]);

  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
    setEditValue(message.content);
  }, [message.content]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);

  return (
    <div className={`group flex ${enterClass} ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`relative flex flex-col ${isUser ? 'max-w-[75%] items-end' : 'max-w-[90%] items-start'}`}>

        {/* Floating toolbar */}
        {!isEditing && showToolbar && (
          <div className={`absolute z-10 flex items-center transition-opacity ${isUser ? 'right-0 -bottom-5 opacity-0 group-hover:opacity-100' : 'left-0 -bottom-5'}`}>
            {isUser ? (
              <UserMessageToolbar content={message.content} onEdit={handleEditStart} />
            ) : (
              <AssistantMessageToolbar
                content={groupContent ?? message.content}
                feedback={feedback}
                onFeedback={onFeedback}
                onRetry={onRetry}
                retrying={retrying}
              />
            )}
          </div>
        )}

        {/* Thinking log sits above the assistant message it belongs to */}
        {!isUser && message.thinkingLines && message.thinkingLines.length > 0 && (
          <ThinkingLogs
            lines={message.thinkingLines}
            completionMeta={message.completionMeta}
            isThinking={false}
            isStreaming={false}
          />
        )}

        {isUser && isEditing ? (
          <div style={bubbleWidth ? { minWidth: bubbleWidth } : undefined}>
            <textarea
              ref={textareaRef}
              value={editValue}
              onChange={e => {
                setEditValue(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditSave(); }
                if (e.key === 'Escape') handleEditCancel();
              }}
              className="w-full text-sm leading-relaxed px-4 py-3 rounded-2xl border border-zinc-400 bg-transparent text-text-primary resize-none outline-none focus:border-zinc-500"
            />
            <div className="flex items-center gap-2 mt-1.5 justify-end">
              <button onClick={handleEditCancel} className="text-xs text-text-tertiary hover:text-text-secondary transition-colors">Cancel</button>
              <button onClick={handleEditSave} className="text-xs text-accent hover:text-accent-anchor font-medium transition-colors">Save & regenerate</button>
            </div>
          </div>
        ) : isUser ? (
          <div ref={bubbleRef} className="px-4 py-3 rounded-2xl bg-zinc-700 text-white">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
          </div>
        ) : (
          <div className="prose-chat">
            <ReactMarkdown
              remarkPlugins={[remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={mdComponents}
            >
              {preprocessMath(message.content)}
            </ReactMarkdown>
          </div>
        )}

        {!isUser && message.widget_type && message.widget_data &&
          !(EDITOR_WIDGET_TYPES as readonly string[]).includes(message.widget_type) && (
          <div className="mt-3 w-full">
            <ComplianceChatWidget
              type={message.widget_type}
              data={message.widget_data}
              messageId={message.id}
              initiativeId={initiativeId}
              isActive={isLatest}
            />
          </div>
        )}

        {!isUser && message.sources && message.sources.length > 0 && (
          <CitationsDisplay sources={message.sources} />
        )}
      </div>
    </div>
  );
}

function ComplianceChatWidget({
  type,
  data,
  messageId,
  initiativeId,
  isActive,
}: {
  type: string;
  data: Record<string, any>;
  messageId?: string;
  initiativeId?: string;
  isActive?: boolean;
}) {
  switch (type) {
    case 'proposed_value':
      return <ProposedValueWidget data={data as any} messageId={messageId} />;
    case 'gs_proposed_field':
      return <CoverLetterProposedValueWidget data={data as any} messageId={messageId} />;
    default:
      return null;
  }
}

function CitationsDisplay({ sources }: { sources: SourceCitation[] }) {
  const [expanded, setExpanded] = useState(false);

  const verified = sources.filter((s) => s.source_type !== 'llm_estimate');
  const hasUnverified = sources.some((s) => s.source_type === 'llm_estimate');

  if (verified.length === 0 && !hasUnverified) return null;

  const getIcon = (type: string) => {
    switch (type) {
      case 'corpus':   return <BookOpen className="w-3 h-3" />;
      case 'evidence': return <FileText className="w-3 h-3" />;
      case 'openalex': return <GraduationCap className="w-3 h-3" />;
      case 'web':      return <Globe className="w-3 h-3" />;
      default:         return <AlertCircle className="w-3 h-3" />;
    }
  };

  const getLabel = (type: string) => {
    switch (type) {
      case 'corpus':   return 'Curated';
      case 'evidence': return 'Uploaded';
      case 'openalex': return 'OpenAlex';
      case 'web':      return 'Web';
      default:         return 'Estimate';
    }
  };

  return (
    <div className="mt-2">
      <button
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          if (next && verified.length > 0) {
            track('citation_clicked', {
              tier: verified[0].source_type,
              source_id: verified[0].chunk_id || verified[0].source_title,
            });
          }
        }}
        className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
      >
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        <span>
          {verified.length > 0
            ? `${verified.length} source${verified.length !== 1 ? 's' : ''}`
            : 'Sources'}
        </span>
        {hasUnverified && (
          <span className="text-indicator-yellow ml-1">(includes estimates)</span>
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5 pl-2 border-l border-stroke-subtle">
          {verified.map((source, idx) => (
            <div key={idx} className="flex items-start gap-2 text-xs text-text-secondary min-w-0">
              <span className="flex items-center gap-1 text-text-tertiary shrink-0">
                {getIcon(source.source_type)}
                <span className="text-[10px] uppercase tracking-wide">
                  {getLabel(source.source_type)}
                </span>
              </span>
              {source.source_url ? (
                <a
                  href={source.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline truncate"
                  onClick={() =>
                    track('citation_clicked', {
                      tier: source.source_type,
                      source_id: source.chunk_id || source.source_title,
                    })
                  }
                >
                  {source.source_title}
                </a>
              ) : (
                <span className="truncate">{source.source_title}</span>
              )}
            </div>
          ))}
          {hasUnverified && (
            <div className="flex items-center gap-2 text-xs text-indicator-yellow">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span>Some information is based on general knowledge and should be verified</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
