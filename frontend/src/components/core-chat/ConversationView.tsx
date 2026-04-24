'use client';

import { Fragment, useRef, useEffect, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  ArrowUp,
  BookOpen,
  GraduationCap,
  Globe,
  FileText,
  Loader2,
  X,
  Paperclip,
} from 'lucide-react';
import type { CoreChatMessage } from '@/stores/chatStore';
import { FieldContext, SourceCitation, ResearchStep } from '@/lib/api';
import { ThinkingLogs } from './ThinkingLogs';
import { EDITOR_WIDGET_TYPES } from '@/components/editor/EditorSidePanel';
import { track } from '@/lib/analytics';
import { ABOVE_INPUT_WIDGET_TYPE, ChatWidgetRenderer } from '@/components/chat/ChatWidgetRenderer';
import { UserMessageToolbar, AssistantMessageToolbar } from '@/components/chat/MessageToolbar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { sanitizeHref } from '@/lib/sanitizeHref';
import { debugChatFlow } from '@/lib/chatDebug';
import { SnippetCard } from './ResearchPanel';
import type { ResearchPanelCitation } from './ResearchPanel';

export interface ConversationViewProps {
  messages: CoreChatMessage[];
  sending: boolean;
  thinkingLines: string[];
  researchSteps: ResearchStep[];
  streamingContent: string;
  error: string | null;
  onSendMessage: (
    content: string,
    toolHint?: string,
    fieldContext?: FieldContext | null,
    modelInputsContext?: string | null,
  ) => void;
  onUploadFile?: (file: File) => Promise<void>;
  onEditMessage: (messageId: string, newContent: string) => void;
  onRetryMessage: (messageId: string) => void;
  messageFeedback: Record<string, 'like' | 'dislike' | null>;
  onSetFeedback: (messageId: string, feedback: 'like' | 'dislike' | null) => void;
  retryingMessageId: string | null;
  /** Required for rendering initiative-specific widgets (alignment, etc.) */
  initiativeId?: string;
  /** Called when user opens an internal citation document */
  onOpenDocument?: (citation: ResearchPanelCitation) => void;
  /** Extra action buttons rendered in the composer toolbar (before paperclip) */
  extraInputActions?: React.ReactNode;
  /** Attached tray rendered above and visually connected to the composer */
  topComposerContent?: React.ReactNode;
  /** Chips rendered above the textarea (e.g. compare project chip) */
  inputChips?: React.ReactNode;
  /** Fixed content rendered above the messages area (e.g. a deep-dive context widget) */
  topContent?: React.ReactNode;
  /** How top content should be laid out when present */
  topContentMode?: 'inline' | 'panel';
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
  researchSteps,
  streamingContent,
  error,
  onSendMessage,
  onUploadFile,
  onEditMessage,
  onRetryMessage,
  messageFeedback,
  onSetFeedback,
  retryingMessageId,
  initiativeId,
  onOpenDocument,
  extraInputActions,
  topComposerContent,
  inputChips,
  topContent,
  topContentMode = 'inline',
}: ConversationViewProps) {

  const [input, setInput] = useState('');
  const [draftTag, setDraftTag] = useState<string | null>(null);
  const [draftFieldContext, setDraftFieldContext] = useState<FieldContext | null>(null);
  const [draftModelInputsContext, setDraftModelInputsContext] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
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
      const detail = (e as CustomEvent).detail as {
        text?: string;
        label?: string | null;
        fieldContext?: FieldContext | null;
        modelInputsContext?: string | null;
      } | null;
      const text = detail?.text;
      const label = detail?.label ?? null;
      if (text) {
        setInput(text);
        setDraftTag(label);
        setDraftFieldContext(detail?.fieldContext ?? null);
        setDraftModelInputsContext(detail?.modelInputsContext ?? null);
        debugChatFlow('draft-received', {
          surface: 'conversation-view',
          field_name: detail?.fieldContext?.field_name ?? null,
          model_type: detail?.fieldContext?.model_type ?? null,
          has_field_context: Boolean(detail?.fieldContext),
          has_model_inputs_context: Boolean(detail?.modelInputsContext),
        });
        setTimeout(() => textareaRef.current?.focus(), 0);
      }
    };
    window.addEventListener('nitrogen:draft', handler);
    return () => window.removeEventListener('nitrogen:draft', handler);
  }, []);

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 150)}px`;
    }
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [input, adjustHeight]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const ro = new ResizeObserver(() => adjustHeight());
    ro.observe(ta);
    return () => ro.disconnect();
  }, [adjustHeight]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending || uploading) return;

    if (attachedFiles.length > 0 && onUploadFile) {
      setUploading(true);
      for (const file of attachedFiles) {
        try {
          await onUploadFile(file);
        } catch (err) {
          console.error('Failed to upload attachment:', file.name, err);
        }
      }
      setUploading(false);
    }

    debugChatFlow('composer-send', {
      surface: 'conversation-view',
      field_name: draftFieldContext?.field_name ?? null,
      model_type: draftFieldContext?.model_type ?? null,
      has_field_context: Boolean(draftFieldContext),
      has_model_inputs_context: Boolean(draftModelInputsContext),
    });
    onSendMessage(input.trim(), undefined, draftFieldContext, draftModelInputsContext);
    setInput('');
    setDraftTag(null);
    setDraftFieldContext(null);
    setDraftModelInputsContext(null);
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
  const latestMessage = messages[messages.length - 1];
  const showDocumentRequest = latestMessage?.widget_type === ABOVE_INPUT_WIDGET_TYPE;
  const hideTextInput = showDocumentRequest;
  const showTopContentAsPanel = Boolean(topContent) && topContentMode === 'panel';

  const composer = !hideTextInput ? (
    <div className="flex-shrink-0 relative">
      <div className="pointer-events-none absolute -top-12 inset-x-0 h-12 bg-gradient-to-t from-white to-transparent" />
      <div className="max-w-[52rem] mx-auto w-full pb-4 px-4">
        {topComposerContent ? (
          <div className="relative z-10 mx-3 mb-[-1px]">
            {topComposerContent}
          </div>
        ) : null}
        <form onSubmit={handleSubmit} className="relative">
          <div
            className="rounded-[10px] border border-stroke-subtle bg-white overflow-hidden"
          >
            {(draftTag || inputChips || attachedFiles.length > 0) && (
              <div className="px-4 pt-2.5 pb-1 flex items-center gap-1.5 flex-wrap">
                {draftTag && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent/10 border border-accent/20 text-[11px] font-medium text-accent leading-none">
                    {draftTag}
                    <button
                      type="button"
                      onClick={() => {
                        setDraftTag(null);
                        setDraftFieldContext(null);
                        setDraftModelInputsContext(null);
                        setInput('');
                      }}
                      className="hover:opacity-60 transition-opacity"
                      aria-label="Remove"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                )}
                {inputChips}
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

            <textarea
              ref={textareaRef}
              value={input.replace(/\n?\[TEMPLATE_CONTEXT\][\s\S]*?\[\/TEMPLATE_CONTEXT\]/g, '')}
              onChange={(e) => {
                const ctx = input.match(/\n?\[TEMPLATE_CONTEXT\][\s\S]*?\[\/TEMPLATE_CONTEXT\]/)?.[0] || '';
                setInput(ctx ? e.target.value + ctx : e.target.value);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything"
              disabled={sending}
              rows={1}
              className="w-full resize-none bg-transparent px-5 pt-3 pb-4 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:text-text-tertiary overflow-hidden"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', minHeight: '2.25rem' }}
            />

            <div className="flex items-center justify-between gap-2 px-4 pb-2.5">
              <div className="flex items-center gap-1.5 min-w-0">
                {extraInputActions}
              </div>
              <div className="flex items-center gap-1.5">
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
                  className="w-5 h-5 flex items-center justify-center rounded-full transition-colors duration-150 text-text-tertiary enabled:hover:text-text-secondary disabled:opacity-40 disabled:cursor-default"
                  aria-label="Attach files"
                >
                  <Paperclip className="w-[13px] h-[13px]" />
                </button>
                <button
                  type="submit"
                  disabled={sending || uploading || !input.trim()}
                  className="w-5 h-5 flex items-center justify-center rounded-full transition-colors duration-150 disabled:cursor-default disabled:bg-stroke-subtle enabled:bg-accent"
                >
                  {uploading ? (
                    <Loader2 className="w-[11px] h-[11px] text-white animate-spin" />
                  ) : (
                    <ArrowUp className="w-[11px] h-[11px] text-white" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  ) : null;

  return (
    <div className="flex flex-col h-full">
      {showTopContentAsPanel ? (
        <div className="relative flex-1 min-h-0">
          <div className="absolute inset-0">
            {topContent}
          </div>
          <div className="absolute inset-x-0 bottom-0 z-10">
            {composer}
          </div>
        </div>
      ) : (
        <>
      {topContent && (
        <div className="flex-shrink-0">
          {topContent}
        </div>
      )}
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
                onOpenDocument={onOpenDocument}
              />
            );
          })}

          {/* Active response: thinking log + streaming content, both inline */}
          {sending && (
            <div className="flex justify-start">
              <div className="max-w-[90%] flex flex-col items-start">
                <ThinkingLogs
                  lines={thinkingLines}
                  researchSteps={researchSteps}
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

      {showDocumentRequest && latestMessage?.widget_data && initiativeId && (
        <div className="flex-shrink-0 px-4 pb-4">
          <div className="max-w-[52rem] mx-auto w-full">
            <ChatWidgetRenderer
              type={latestMessage.widget_type!}
              data={latestMessage.widget_data}
              initiativeId={initiativeId}
              messageId={latestMessage.id}
              isActive={true}
              onDocumentRequestMessage={(content) => onSendMessage(content)}
            />
          </div>
        </div>
      )}

      {composer}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline citation chip                                               */
/* ------------------------------------------------------------------ */

// Matches citations with optional project prefix for compare mode:
// [Evidence: file.pdf, p3], [A-Evidence: file.pdf, p3], [B-Web: Title]
const INLINE_CITATION_RE = /\[(?:([AB])-)?([\w\s]+):\s*([^\],]{4,200})(?:,\s*p(\d+))?\]/g;
const LEADING_CITATION_PUNCTUATION_RE = /^[.,!?;:]+/;

function CitationChip({
  sourceType,
  title,
  chunkIndex,
  sources,
  onExpand,
  selectedCitationKeys,
  projectLabel,
}: {
  sourceType: string;
  title: string;
  chunkIndex?: number;
  sources: SourceCitation[];
  onExpand?: (citation: SourceCitation) => void;
  selectedCitationKeys?: Set<string>;
  projectLabel?: string;
}) {
  const type = sourceType.toLowerCase().trim();

  // Fuzzy-match the cited title to a source; prefer chunk_index match when available
  const trimmedTitle = title.trim().toLowerCase();
  const titleCandidates = sources.filter((s) => {
    // In compare mode, only match sources with the same project label
    if (projectLabel && s.project_label && projectLabel !== s.project_label) return false;
    const a = s.source_title.toLowerCase();
    return (
      a.includes(trimmedTitle.slice(0, 50)) ||
      trimmedTitle.includes(a.slice(0, 50))
    );
  });
  const matched = (
    chunkIndex != null
      ? titleCandidates.find((s) => s.chunk_index === chunkIndex)
      : undefined
  ) ?? titleCandidates[0];

  const url = matched?.source_url;
  const publisher = matched?.publisher;
  const isSelected = Boolean(matched && selectedCitationKeys?.has(citationSelectionKey(matched)));
  const isInternal = matched && (
    matched.source_type === 'corpus' || matched.source_type === 'evidence'
  ) && matched.evidence_doc_id;

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
    label = title.trim().length > 30 ? title.trim().slice(0, 28) + '…' : title.trim() || 'Curated';
  } else if (type === 'evidence' || type === 'uploaded') {
    icon = <FileText className="w-3 h-3 shrink-0" />;
    label = title.trim().length > 30 ? title.trim().slice(0, 28) + '…' : title.trim() || 'Document';
  } else {
    icon = <FileText className="w-3 h-3 shrink-0" />;
    label = sourceType;
  }

  const chip = (
    <span
      title={title.trim()}
      className={[
        'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded border text-[10px] font-medium leading-none align-[0.1em] transition-colors cursor-pointer select-none',
        isSelected
          ? 'bg-accent/[0.12] border-accent/40 text-accent'
          : 'bg-surface-subtle border-stroke-subtle text-text-secondary hover:bg-accent/[0.07] hover:border-accent/30 hover:text-accent',
      ].join(' ')}
    >
      {icon}
      {label}
    </span>
  );

  if (isInternal && matched && onExpand) {
    return (
      <span
        role="button"
        tabIndex={0}
        className="no-underline"
        onClick={() => {
          track('citation_chip_clicked', { source_type: type, publisher: label, internal: true });
          onExpand(matched);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') onExpand(matched); }}
      >
        {chip}
      </span>
    );
  }

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
  onExpand?: (citation: SourceCitation) => void,
  selectedCitationKeys?: Set<string>,
): React.ReactNode {
  if (typeof children === 'string') {
    return splitOnCitations(children, sources, keyPrefix, onExpand, selectedCitationKeys);
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => (
      <Fragment key={`${keyPrefix}-arr-${i}`}>
        {typeof child === 'string'
          ? splitOnCitations(child, sources, `${keyPrefix}-${i}`, onExpand, selectedCitationKeys)
          : child}
      </Fragment>
    ));
  }
  return children;
}

function splitOnCitations(
  text: string,
  sources: SourceCitation[],
  keyPrefix: string,
  onExpand?: (citation: SourceCitation) => void,
  selectedCitationKeys?: Set<string>,
): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = new RegExp(INLINE_CITATION_RE.source, 'g');
  let last = 0;
  let partIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const suffix = text.slice(re.lastIndex);
    const punctuationMatch = suffix.match(LEADING_CITATION_PUNCTUATION_RE);
    const punctuation = punctuationMatch?.[0] ?? '';

    if (m.index > last) {
      let beforeCitationText = text.slice(last, m.index);
      if (punctuation) {
        // When punctuation is moved before the chip, avoid rendering "word ."
        beforeCitationText = beforeCitationText.replace(/[ \t]+$/, '');
      }
      if (beforeCitationText.length > 0) {
        parts.push(<span key={`${keyPrefix}-t${partIdx++}`}>{beforeCitationText}</span>);
      }
    }
    const [, projectLabel, sourceType, title, chunkIdxStr] = m;
    const chunkIdx = chunkIdxStr ? parseInt(chunkIdxStr, 10) : undefined;
    if (punctuation) {
      parts.push(<span key={`${keyPrefix}-p${partIdx++}`}>{punctuation}</span>);
    }
    parts.push(
      <CitationChip
        key={`${keyPrefix}-c${m.index}`}
        sourceType={sourceType}
        title={title}
        chunkIndex={chunkIdx}
        onExpand={onExpand}
        selectedCitationKeys={selectedCitationKeys}
        sources={sources}
        projectLabel={projectLabel || undefined}
      />
    );
    last = re.lastIndex + punctuation.length;
  }
  if (last < text.length) {
    parts.push(<span key={`${keyPrefix}-t${partIdx}`}>{text.slice(last)}</span>);
  }
  if (parts.length === 0) return text;
  if (parts.length === 1) return parts[0];
  return <>{parts}</>;
}

function citationSelectionKey(citation: SourceCitation): string {
  return `${citation.evidence_doc_id ?? ''}:${citation.chunk_id ?? citation.source_title}`;
}

function toResearchPanelCitation(citation: SourceCitation): ResearchPanelCitation | null {
  if (
    (citation.source_type === 'corpus' || citation.source_type === 'evidence') &&
    citation.evidence_doc_id
  ) {
    return {
      evidence_doc_id: citation.evidence_doc_id,
      chunk_id: citation.chunk_id ?? null,
      source_title: citation.source_title,
    };
  }
  return null;
}

function CitationInlineDrawer({
  citations,
  onOpenDocument,
  className,
}: {
  citations: SourceCitation[];
  onOpenDocument?: (citation: ResearchPanelCitation) => void;
  className?: string;
}) {
  return (
    <div className={['mt-2', className ?? ''].join(' ').trim()}>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {citations.map((citation) => {
          const panelCitation = toResearchPanelCitation(citation);
          const cardKey = `${citation.evidence_doc_id ?? 'external'}-${citation.chunk_id ?? citation.source_title}`;
          return (
            <div
              key={cardKey}
              className="w-full min-w-full h-56 flex-shrink-0"
            >
              {panelCitation ? (
                <SnippetCard
                  citation={panelCitation}
                  textOnly={true}
                  maxLines={10}
                  onOpenFull={onOpenDocument ? () => onOpenDocument(panelCitation) : undefined}
                />
              ) : (
                <div className="h-full rounded-lg border border-stroke-subtle bg-surface p-3 text-xs text-text-tertiary">
                  Citation preview unavailable for this source.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Markdown component factory (sources injected per-message)         */
/* ------------------------------------------------------------------ */

function makeMarkdownComponents(
  sources: SourceCitation[],
  selectedParagraphKey?: string | null,
  selectedCitation?: SourceCitation | null,
  selectedCitationKeys?: Set<string>,
  onCitationExpand?: (citation: SourceCitation, paragraphKey: string) => void,
  onOpenDocument?: (citation: ResearchPanelCitation) => void,
) {
  let _keySeq = 0;

  return {
    p: ({ children }: any) => {
      const prefix = `p-${_keySeq++}`;
      return (
        <div>
          <p className="text-sm leading-relaxed">
            {injectCitationChips(
              children,
              sources,
              prefix,
              onCitationExpand ? (citation) => onCitationExpand(citation, prefix) : undefined,
              selectedCitationKeys,
            )}
          </p>
          {selectedCitation && selectedParagraphKey === prefix && (
            <CitationInlineDrawer
              citations={[selectedCitation]}
              onOpenDocument={onOpenDocument}
            />
          )}
        </div>
      );
    },
    li: ({ children, node, ...rest }: any) => {
      const prefix = `li-${_keySeq++}`;
      return (
        <li className="leading-relaxed" {...rest}>
          {injectCitationChips(
            children,
            sources,
            prefix,
            onCitationExpand ? (citation) => onCitationExpand(citation, prefix) : undefined,
            selectedCitationKeys,
          )}
          {selectedCitation && selectedParagraphKey === prefix && (
            <CitationInlineDrawer
              citations={[selectedCitation]}
              onOpenDocument={onOpenDocument}
              className="-ml-8 w-[calc(100%+2rem)]"
            />
          )}
        </li>
      );
    },
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
        href={sanitizeHref(href)}
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
  onOpenDocument,
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
  onOpenDocument?: (citation: ResearchPanelCitation) => void;
}) {
  const isUser = message.role === 'user';
  const enterClass = animate ? (isUser ? 'message-enter' : 'message-enter-bot') : '';
  const [selectedCitationState, setSelectedCitationState] = useState<{
    paragraphKey: string;
    citation: SourceCitation;
  } | null>(null);
  const handleCitationExpand = useCallback((citation: SourceCitation, paragraphKey: string) => {
    setSelectedCitationState((prev) => {
      if (
        prev &&
        prev.paragraphKey === paragraphKey &&
        citationSelectionKey(prev.citation) === citationSelectionKey(citation)
      ) {
        return null;
      }
      return { paragraphKey, citation };
    });
  }, []);
  const selectedCitation = selectedCitationState?.citation ?? null;
  const selectedParagraphKey = selectedCitationState?.paragraphKey ?? null;
  const selectedCitationKeys = selectedCitation
    ? new Set<string>([citationSelectionKey(selectedCitation)])
    : undefined;
  const mdComponents = isUser
    ? streamingMarkdownComponents
    : makeMarkdownComponents(
      message.sources ?? [],
      selectedParagraphKey,
      selectedCitation,
      selectedCitationKeys,
      handleCitationExpand,
      onOpenDocument,
    );

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
      <div className={`relative flex flex-col ${isUser ? 'max-w-[75%] items-end' : 'max-w-[90%] items-start pb-2'}`}>

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
                sources={message.sources ?? undefined}
                onOpenDocument={onOpenDocument}
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
          <div ref={bubbleRef} className="px-4 py-3 rounded-2xl bg-zinc-700 text-white prose-user">
            <ReactMarkdown components={streamingMarkdownComponents}>
              {message.content.replace(/\n?\[TEMPLATE_CONTEXT\][\s\S]*?\[\/TEMPLATE_CONTEXT\]/g, '').trim()}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="prose-chat w-full">
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
          message.widget_type !== ABOVE_INPUT_WIDGET_TYPE &&
          !(EDITOR_WIDGET_TYPES as readonly string[]).includes(message.widget_type) && (
          <div className="mt-3 w-full">
            <ChatWidget
              type={message.widget_type}
              data={message.widget_data}
              messageId={message.id}
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
  return (
    <ChatWidgetRenderer
      type={type}
      data={data}
      messageId={messageId}
      initiativeId={initiativeId}
      isActive={isActive}
    />
  );
}

