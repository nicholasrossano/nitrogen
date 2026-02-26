'use client';

import { useRef, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Send,
  BookOpen,
  GraduationCap,
  Globe,
  AlertCircle,
  FileText,
  ChevronDown,
  ChevronUp,
  SquarePen,
} from 'lucide-react';
import { useChatStore, ComplianceChatMessage } from '@/stores/chatStore';
import { SourceCitation } from '@/lib/api';
import { ThinkingLogs } from './ThinkingLogs';
import { LCOEInputsWidget } from '@/components/widgets/LCOEInputsWidget';
import { LCOEOutputWidget } from '@/components/widgets/LCOEOutputWidget';
import { CarbonInputsWidget } from '@/components/widgets/CarbonInputsWidget';
import { CarbonOutputWidget } from '@/components/widgets/CarbonOutputWidget';
import { track } from '@/lib/analytics';

export function ConversationView() {
  const {
    messages,
    sending,
    thinkingLines,
    streamingContent,
    error,
    sendMessage,
    reset,
  } = useChatStore();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevCount = useRef(0);

  useEffect(() => {
    if (messages.length > prevCount.current || streamingContent) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevCount.current = messages.length;
  }, [messages.length, streamingContent]);

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
    sendMessage(input.trim());
    setInput('');
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
      {/* Top bar */}
      <div className="flex-shrink-0 flex justify-end px-4 pt-3 pb-1">
        <button
          onClick={reset}
          disabled={sending}
          title="New chat"
          className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary disabled:opacity-40 transition-colors duration-150 px-2 py-1.5 rounded-lg hover:bg-surface-subtle"
        >
          <SquarePen className="w-3.5 h-3.5" />
          New chat
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.map((msg, idx) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              animate={idx >= messages.length - 2}
            />
          ))}

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
                    <ReactMarkdown components={streamingMarkdownComponents}>
                      {streamingContent}
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

      {/* Composer */}
      <div className="flex-shrink-0 pb-4">
        <div className="max-w-3xl mx-auto px-4">
          <form onSubmit={handleSubmit} className="relative flex items-center">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything"
              disabled={sending}
              rows={1}
              className="w-full resize-none rounded-[28px] border border-stroke-subtle bg-white px-5 py-3 pr-12 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none disabled:bg-surface-subtle disabled:text-text-tertiary transition-colors duration-150 overflow-hidden"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            />
            <div className="absolute right-3 top-0 bottom-0 flex items-center pointer-events-none [&>*]:pointer-events-auto">
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="flex items-center justify-center text-text-tertiary enabled:text-accent transition-colors duration-150 disabled:cursor-default"
              >
                <Send className="w-[18px] h-[18px]" />
              </button>
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
    h1: ({ children }: any) => <h1 className="text-lg font-semibold">{children}</h1>,
    h2: ({ children }: any) => <h2 className="text-base font-semibold">{children}</h2>,
    h3: ({ children }: any) => <h3 className="text-sm font-semibold">{children}</h3>,
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
}: {
  message: ComplianceChatMessage;
  animate: boolean;
}) {
  const isUser = message.role === 'user';
  const enterClass = animate ? (isUser ? 'message-enter' : 'message-enter-bot') : '';
  const mdComponents = isUser
    ? streamingMarkdownComponents
    : makeMarkdownComponents(message.sources ?? []);

  return (
    <div className={`flex ${enterClass} ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex flex-col ${isUser ? 'max-w-[75%] items-end' : 'max-w-[90%] items-start'}`}>
        {/* Thinking log sits above the assistant message it belongs to */}
        {!isUser && message.thinkingLines && message.thinkingLines.length > 0 && (
          <ThinkingLogs
            lines={message.thinkingLines}
            completionMeta={message.completionMeta}
            isThinking={false}
            isStreaming={false}
          />
        )}

        {isUser ? (
          <div className="px-4 py-3 rounded-2xl bg-zinc-700 text-white">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
          </div>
        ) : (
          <div className="prose-chat">
            <ReactMarkdown components={mdComponents}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {(() => {
          if (!isUser && message.widget_type) {
            console.log('[MessageBubble] widget_type:', message.widget_type, 'has_data:', !!message.widget_data);
          }
          return null;
        })()}
        {!isUser && message.widget_type && message.widget_data && (
          <div className="mt-3 w-full">
            <ComplianceChatWidget
              type={message.widget_type}
              data={message.widget_data}
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
}: {
  type: string;
  data: Record<string, any>;
}) {
  console.log('[ComplianceChatWidget] type:', type, 'data keys:', Object.keys(data || {}));
  switch (type) {
    case 'lcoe_inputs':
      return <LCOEInputsWidget data={data} initiativeId="" isActive />;
    case 'lcoe_output':
      return <LCOEOutputWidget data={data} initiativeId="" isActive />;
    case 'carbon_inputs':
      return <CarbonInputsWidget data={data} initiativeId="" isActive />;
    case 'carbon_output':
      return <CarbonOutputWidget data={data} initiativeId="" isActive />;
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
            <div key={idx} className="flex items-start gap-2 text-xs text-text-secondary">
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
