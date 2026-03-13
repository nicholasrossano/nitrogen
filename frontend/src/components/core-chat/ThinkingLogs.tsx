'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Check, Loader2 } from 'lucide-react';
import { CompletionMeta } from '@/stores/chatStore';
import type { ResearchStep } from '@/lib/api';
import { track } from '@/lib/analytics';

interface ThinkingLogsProps {
  lines: string[];
  researchSteps?: ResearchStep[];
  completionMeta: CompletionMeta | null | undefined;
  isThinking: boolean;
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
      .join(' + ') || 'model knowledge'
  );
}

function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

interface TimelineItem {
  key: string;
  label: string;
  done: boolean;
  active: boolean;
}

function buildTimeline(steps: ResearchStep[], lines: string[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const seen = new Set<string>();

  for (const step of steps) {
    items.push({
      key: `step-${step.id}`,
      label: step.label,
      done: step.status === 'done' || step.status === 'error',
      active: step.status === 'running',
    });
    seen.add(step.label);
  }

  for (let i = 0; i < lines.length; i++) {
    if (seen.has(lines[i])) continue;
    items.push({
      key: `line-${i}`,
      label: lines[i],
      done: i < lines.length - 1,
      active: i === lines.length - 1,
    });
  }

  return items;
}

function TimelineRow({ item }: { item: TimelineItem }) {
  return (
    <div className="flex items-center gap-2 text-xs thinking-stage-enter">
      <span className="w-3 h-3 flex items-center justify-center shrink-0">
        {item.active ? (
          <Loader2 className="w-3 h-3 animate-spin text-accent" />
        ) : item.done ? (
          <Check className="w-3 h-3 text-indicator-green" />
        ) : (
          <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary/40" />
        )}
      </span>
      <span className={`leading-relaxed ${
        item.active ? 'text-text-primary' : item.done ? 'text-text-secondary' : 'text-text-tertiary'
      }`}>
        {item.label}
      </span>
    </div>
  );
}

export function ThinkingLogs({ lines, researchSteps, completionMeta, isThinking, isStreaming }: ThinkingLogsProps) {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (isThinking && !startRef.current) {
      startRef.current = Date.now();
    }
    if (!isThinking && startRef.current) {
      setElapsed(Date.now() - startRef.current);
      startRef.current = null;
    }
  }, [isThinking]);

  useEffect(() => {
    if (!isThinking) return;
    const id = setInterval(() => {
      if (startRef.current) setElapsed(Date.now() - startRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, [isThinking]);

  useEffect(() => {
    if (isStreaming) setExpanded(false);
  }, [isStreaming]);

  const steps = researchSteps ?? [];
  const timeline = buildTimeline(steps, lines);

  if (timeline.length === 0 && !isThinking) return null;

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    track(next ? 'thinking_log_expanded' : 'thinking_log_collapsed');
  };

  const finalElapsed = completionMeta?.latency_ms ?? elapsed;

  // ── Active thinking ──
  if (isThinking) {
    return (
      <div className="mb-3 space-y-1.5">
        <div className="flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent shrink-0" />
          <span className="text-[13px] font-medium text-text-primary">Thinking</span>
          <span className="text-xs text-text-tertiary tabular-nums">{formatElapsed(elapsed)}</span>
        </div>
        {timeline.map((item) => (
          <TimelineRow key={item.key} item={item} />
        ))}
      </div>
    );
  }

  // ── Summary line ──
  const summaryParts: string[] = [];
  if (finalElapsed > 0) summaryParts.push(formatElapsed(finalElapsed));
  if (completionMeta) {
    summaryParts.push(tierLabel(completionMeta.tiers_used));
    if (completionMeta.citation_count > 0) {
      summaryParts.push(
        `${completionMeta.citation_count} source${completionMeta.citation_count !== 1 ? 's' : ''}`
      );
    }
  }
  const summary = summaryParts.length > 0 ? summaryParts.join(' · ') : 'Done';

  // Collapsed
  if (!expanded) {
    return (
      <button
        onClick={toggleExpanded}
        className="group flex items-center gap-2 text-[13px] text-text-tertiary hover:text-text-secondary transition-colors mb-3 py-1"
      >
        <Check className="w-3.5 h-3.5 shrink-0 text-indicator-green" />
        <span className="font-medium">Thought</span>
        <span>{summary}</span>
        <ChevronRight className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    );
  }

  // Expanded
  return (
    <div className="mb-3 space-y-1.5">
      <button
        onClick={toggleExpanded}
        className="group flex items-center gap-2 text-[13px] text-text-tertiary hover:text-text-secondary transition-colors py-1 mb-0.5"
      >
        <Check className="w-3.5 h-3.5 shrink-0 text-indicator-green" />
        <span className="font-medium">Thought</span>
        <span>{summary}</span>
        <ChevronRight className="w-3 h-3 shrink-0 rotate-90 transition-transform" />
      </button>
      {timeline.map((item) => (
        <TimelineRow key={item.key} item={{ ...item, done: true, active: false }} />
      ))}
    </div>
  );
}
