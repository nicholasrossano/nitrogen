'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { CompletionMeta } from '@/stores/chatStore';
import { track } from '@/lib/analytics';

interface ThinkingLogsProps {
  lines: string[];
  completionMeta: CompletionMeta | null | undefined;
  /** True while the planning/retrieval phase is running (no words yet). */
  isThinking: boolean;
  /** True once response words are streaming in. Triggers auto-collapse. */
  isStreaming: boolean;
}

function tierLabel(tiers: string[]): string {
  return (
    tiers
      .filter((t) => t !== 'llm_fallback')
      .map((t) => {
        switch (t) {
          case 'corpus':   return 'Curated';
          case 'openalex': return 'OpenAlex';
          case 'web':      return 'Web';
          default:         return t;
        }
      })
      .join(' + ') || 'general knowledge'
  );
}

export function ThinkingLogs({ lines, completionMeta, isThinking, isStreaming }: ThinkingLogsProps) {
  const [expanded, setExpanded] = useState(false);

  // Auto-collapse the moment words start streaming in
  useEffect(() => {
    if (isStreaming) {
      setExpanded(false);
    }
  }, [isStreaming]);

  if (lines.length === 0 && !isThinking) return null;

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    track(next ? 'thinking_log_expanded' : 'thinking_log_collapsed');
  };

  // ── Phase 1: actively thinking ──────────────────────────────────────────
  if (isThinking) {
    return (
      <div className="mb-3 space-y-1">
        {lines.slice(0, -1).map((line, i) => (
          <div key={i} className="flex items-center gap-2 text-xs text-text-tertiary/60">
            <span className="w-3 h-3 shrink-0 flex items-center justify-center">
              <span className="w-1 h-1 rounded-full bg-text-tertiary/40" />
            </span>
            <span className="leading-relaxed">{line}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          <Loader2 className="w-3 h-3 animate-spin shrink-0 text-accent" />
          <span className="leading-relaxed">
            {lines.length > 0 ? lines[lines.length - 1] : 'Thinking...'}
          </span>
        </div>
      </div>
    );
  }

  // ── Phase 2 & 3: collapsed summary ──────────────────────────────────────
  if (!expanded) {
    const summary = completionMeta
      ? [
          tierLabel(completionMeta.tiers_used),
          completionMeta.citation_count > 0
            ? `${completionMeta.citation_count} source${completionMeta.citation_count !== 1 ? 's' : ''}`
            : null,
          `${(completionMeta.latency_ms / 1000).toFixed(1)}s`,
        ]
          .filter(Boolean)
          .join(' · ')
      : lines.length > 0
        ? lines[lines.length - 1]
        : 'Researching...';

    return (
      <button
        onClick={toggleExpanded}
        className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors mb-3"
      >
        <ChevronDown className="w-3 h-3 shrink-0" />
        <span>{summary}</span>
      </button>
    );
  }

  // ── Phase 2 & 3: expanded log ────────────────────────────────────────────
  return (
    <div className="mb-3">
      <button
        onClick={toggleExpanded}
        className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors mb-1.5"
      >
        <ChevronUp className="w-3 h-3 shrink-0" />
        <span>Hide details</span>
      </button>
      <div className="pl-3 border-l border-stroke-subtle space-y-1">
        {lines.map((line, i) => (
          <p key={i} className="text-xs text-text-tertiary leading-relaxed thinking-stage-enter">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
