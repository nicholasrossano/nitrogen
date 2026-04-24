'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Copy, Pencil, ThumbsUp, ThumbsDown, RefreshCw, Check, BookMarked, BookOpen, FileText, GraduationCap, Globe, AlertCircle } from 'lucide-react';
import type { SourceCitation } from '@/lib/api';
import { track } from '@/lib/analytics';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';

interface ToolbarIconProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  spinning?: boolean;
}

function ToolbarIcon({ icon, label, onClick, active = false, disabled = false, spinning = false }: ToolbarIconProps) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={[
        'p-0.5 rounded transition-colors',
        active
          ? 'text-accent'
          : 'text-text-tertiary hover:text-text-primary',
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
        spinning ? 'animate-spin' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon}
    </button>
  );
}

interface UserMessageToolbarProps {
  content: string;
  onEdit: () => void;
  hideEdit?: boolean;
}

export function UserMessageToolbar({ content, onEdit, hideEdit = false }: UserMessageToolbarProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable
    }
  }, [content]);

  return (
    <div className="flex items-center gap-1 relative">
      {copied && (
        <span className="absolute -top-6 right-0 text-xs text-text-secondary bg-surface-subtle border border-stroke-subtle rounded px-1.5 py-0.5 whitespace-nowrap pointer-events-none">
          Copied
        </span>
      )}
      <ToolbarIcon
        icon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        label="Copy message"
        onClick={handleCopy}
        active={copied}
      />
      {!hideEdit && (
        <ToolbarIcon
          icon={<Pencil className="w-3.5 h-3.5" />}
          label="Edit message"
          onClick={onEdit}
        />
      )}
    </div>
  );
}

interface AssistantMessageToolbarProps {
  content: string;
  feedback: 'like' | 'dislike' | null;
  onFeedback: (f: 'like' | 'dislike' | null) => void;
  onRetry: () => void;
  retrying: boolean;
  hideRetry?: boolean;
  sources?: SourceCitation[];
  onOpenDocument?: (citation: ResearchPanelCitation) => void;
}

function getSourceIcon(type: string) {
  switch (type) {
    case 'corpus':   return <BookOpen className="w-3 h-3 shrink-0" />;
    case 'evidence': return <FileText className="w-3 h-3 shrink-0" />;
    case 'openalex': return <GraduationCap className="w-3 h-3 shrink-0" />;
    case 'web':      return <Globe className="w-3 h-3 shrink-0" />;
    default:         return <AlertCircle className="w-3 h-3 shrink-0" />;
  }
}

function getSourceLabel(type: string) {
  switch (type) {
    case 'corpus':   return 'Curated';
    case 'evidence': return 'Uploaded';
    case 'openalex': return 'OpenAlex';
    case 'web':      return 'Web';
    default:         return 'Estimate';
  }
}

export function AssistantMessageToolbar({
  content,
  feedback,
  onFeedback,
  onRetry,
  retrying,
  hideRetry = false,
  sources,
  onOpenDocument,
}: AssistantMessageToolbarProps) {
  const [copied, setCopied] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const sourcesRef = useRef<HTMLDivElement>(null);

  const verified = (sources ?? []).filter((s) => s.source_type !== 'llm_estimate');
  const hasUnverified = (sources ?? []).some((s) => s.source_type === 'llm_estimate');
  const hasSources = verified.length > 0 || hasUnverified;

  useEffect(() => {
    if (!sourcesOpen) return;
    const handler = (e: MouseEvent) => {
      if (sourcesRef.current && !sourcesRef.current.contains(e.target as Node)) {
        setSourcesOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sourcesOpen]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable
    }
  }, [content]);

  const handleLike = useCallback(() => {
    onFeedback(feedback === 'like' ? null : 'like');
  }, [feedback, onFeedback]);

  const handleDislike = useCallback(() => {
    onFeedback(feedback === 'dislike' ? null : 'dislike');
  }, [feedback, onFeedback]);

  return (
    <div className="flex items-center gap-1 relative">
      {copied && (
        <span className="absolute -top-6 left-0 text-xs text-text-secondary bg-surface-subtle border border-stroke-subtle rounded px-1.5 py-0.5 whitespace-nowrap pointer-events-none">
          Copied
        </span>
      )}
      <ToolbarIcon
        icon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        label="Copy response"
        onClick={handleCopy}
        active={copied}
      />

      {/* Like — hidden when dislike is active */}
      {feedback !== 'dislike' && (
        <button
          title={feedback === 'like' ? 'Remove helpful rating' : 'Helpful'}
          aria-label={feedback === 'like' ? 'Remove helpful rating' : 'Helpful'}
          onClick={handleLike}
          className="p-0.5 rounded transition-colors cursor-pointer text-text-tertiary hover:text-text-primary"
        >
          <ThumbsUp
            className="w-3.5 h-3.5"
            {...(feedback === 'like' ? { style: { fill: 'currentColor', strokeWidth: 0 } } : {})}
          />
        </button>
      )}

      {/* Dislike — hidden when like is active */}
      {feedback !== 'like' && (
        <button
          title={feedback === 'dislike' ? 'Remove unhelpful rating' : 'Not helpful'}
          aria-label={feedback === 'dislike' ? 'Remove unhelpful rating' : 'Not helpful'}
          onClick={handleDislike}
          className="p-0.5 rounded transition-colors cursor-pointer text-text-tertiary hover:text-text-primary"
        >
          <ThumbsDown
            className="w-3.5 h-3.5"
            {...(feedback === 'dislike' ? { style: { fill: 'currentColor', strokeWidth: 0 } } : {})}
          />
        </button>
      )}

      {!hideRetry && (
        <ToolbarIcon
          icon={<RefreshCw className="w-3.5 h-3.5" />}
          label={retrying ? 'Retrying…' : 'Retry'}
          onClick={onRetry}
          disabled={retrying}
          spinning={retrying}
        />
      )}

      {hasSources && (
        <div ref={sourcesRef} className="relative">
          <button
            title="Sources"
            aria-label="Sources"
            onClick={() => {
              const next = !sourcesOpen;
              setSourcesOpen(next);
              if (next && verified.length > 0) {
                track('citation_clicked', {
                  tier: verified[0].source_type,
                  source_id: verified[0].chunk_id || verified[0].source_title,
                });
              }
            }}
            className={[
              'flex items-center gap-1 pl-1.5 pr-2 py-0.5 rounded transition-colors text-[11px]',
              sourcesOpen
                ? 'text-accent bg-accent/[0.07]'
                : 'text-text-tertiary hover:text-text-primary',
            ].join(' ')}
          >
            <BookMarked className="w-3.5 h-3.5" />
            <span>Sources</span>
          </button>

          {sourcesOpen && (
            <div className="absolute bottom-full mb-1.5 left-0 z-50 bg-white border border-stroke-subtle rounded-lg shadow-lg p-2 min-w-[220px] max-w-[320px]">
              <div className="space-y-0.5">
                {verified.map((source, idx) => {
                  const isInternal = (source.source_type === 'corpus' || source.source_type === 'evidence') && source.evidence_doc_id;
                  return (
                    <div key={idx} className="flex items-center gap-2 min-w-0 rounded-md px-1.5 py-1 hover:bg-surface-subtle transition-colors">
                      <span className="text-text-tertiary shrink-0">
                        {getSourceIcon(source.source_type)}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-text-tertiary shrink-0 w-14">
                        {getSourceLabel(source.source_type)}
                      </span>
                      {isInternal && onOpenDocument ? (
                        <button
                          className="text-xs text-accent hover:underline truncate text-left"
                          onClick={() => {
                            track('citation_clicked', {
                              tier: source.source_type,
                              source_id: source.chunk_id || source.source_title,
                              internal: true,
                            });
                            onOpenDocument({
                              evidence_doc_id: source.evidence_doc_id!,
                              chunk_id: source.chunk_id ?? null,
                              source_title: source.source_title,
                            });
                            setSourcesOpen(false);
                          }}
                        >
                          {source.source_title}
                        </button>
                      ) : source.source_url ? (
                        <a
                          href={source.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-accent hover:underline truncate"
                          onClick={() => {
                            track('citation_clicked', {
                              tier: source.source_type,
                              source_id: source.chunk_id || source.source_title,
                            });
                            setSourcesOpen(false);
                          }}
                        >
                          {source.source_title}
                        </a>
                      ) : (
                        <span className="text-xs text-text-secondary truncate">{source.source_title}</span>
                      )}
                    </div>
                  );
                })}
                {hasUnverified && (
                  <div className="flex items-center gap-2 text-xs text-indicator-yellow px-1.5 py-1">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>Includes estimates — verify before using</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
