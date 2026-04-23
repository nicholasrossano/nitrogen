'use client';

import { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, X, Zap } from 'lucide-react';
import { PageLoader } from '@/components/ui/PageLoader';

import type { PlanWorkspaceInspectorDocumentSource, PlanWorkspaceInspectorState } from './types';

interface DeepDiveWidgetProps {
  state: PlanWorkspaceInspectorState;
  collapsed?: boolean;
  layoutMode?: 'inline' | 'panel';
  onCollapsedChange?: (collapsed: boolean) => void;
  onClose?: () => void;
  onRetry?: () => void;
  onOpenDocument?: (source: PlanWorkspaceInspectorDocumentSource) => void;
}

function InlineBold({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, idx) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={idx} className="font-semibold text-text-primary">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function DeepDiveWidget({
  state,
  collapsed: collapsedProp,
  layoutMode = 'inline',
  onCollapsedChange,
  onClose,
  onRetry,
  onOpenDocument,
}: DeepDiveWidgetProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const { item, groupName, result, loading, error } = state;
  const collapsed = collapsedProp ?? internalCollapsed;
  const inlineCitations = result
    ? [
        ...result.documentSources.map((source) => ({
          key: `doc:${source.evidenceDocId}:${source.chunkId ?? source.title}`,
          label: source.title,
          type: 'document' as const,
          source,
        })),
        ...result.linkSources.map((source) => ({
          key: `link:${source.title}:${source.url ?? ''}`,
          label: source.title,
          type: 'link' as const,
          source,
        })),
      ]
    : [];

  const setCollapsed = (nextValue: boolean | ((value: boolean) => boolean)) => {
    const next = typeof nextValue === 'function' ? nextValue(collapsed) : nextValue;
    if (collapsedProp === undefined) {
      setInternalCollapsed(next);
    }
    onCollapsedChange?.(next);
  };
  const isPanelLayout = layoutMode === 'panel' && !collapsed;

  return (
    <div
      className={
        isPanelLayout
          ? 'flex h-full min-h-0 flex-col bg-surface-subtle/40'
          : 'border-b border-divider bg-surface-subtle/40'
      }
    >
      {/* Header */}
      <div
        className={
          isPanelLayout
            ? 'flex items-center gap-2.5 border-b border-divider px-4 py-2.5'
            : 'flex items-center gap-2.5 px-4 py-2.5'
        }
      >
        <div className="w-6 h-6 flex-shrink-0 bg-accent/10 rounded flex items-center justify-center">
          <Zap className="w-3 h-3 text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] text-text-tertiary font-medium uppercase tracking-wide leading-none">
            {groupName}
          </span>
          <p className="text-xs font-semibold text-text-primary leading-snug truncate">
            {item.title}
          </p>
        </div>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-hover transition-colors text-text-tertiary hover:text-text-secondary flex-shrink-0"
          aria-label={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-hover transition-colors text-text-tertiary hover:text-text-secondary flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Body */}
      {!collapsed && (
        <div
          className={
            isPanelLayout
              ? 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 pb-36 pt-3'
              : 'max-h-64 overflow-y-auto overflow-x-hidden px-4 pb-3'
          }
        >
          {!result && !loading && !error && (
            <p className="text-xs text-text-tertiary italic py-1">
              This item was added manually. Research details are only available for generated items.
            </p>
          )}

          {loading && (
            <div className="flex items-center gap-2 py-2">
              <PageLoader label="" />
              <p className="text-xs text-text-secondary">
                {result?.loadingLabel ?? 'Researching...'}
              </p>
            </div>
          )}

          {error && !loading && (
            <div className="flex items-center gap-2 py-1">
              <AlertCircle className="w-3.5 h-3.5 text-indicator-orange flex-shrink-0" />
              <p className="text-xs text-text-secondary flex-1 min-w-0">{error}</p>
              {onRetry && (
                <button onClick={onRetry} className="text-xs text-accent hover:underline flex-shrink-0">
                  Retry
                </button>
              )}
            </div>
          )}

          {result && !loading && (
            <div className="space-y-3">
              {result.summary.length > 0 && (
                <section>
                  <h4 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">
                    {result.summaryTitle ?? 'What this is'}
                  </h4>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    <InlineBold text={result.summary.join(' ')} />
                    {inlineCitations.length > 0 && (
                      <span className="ml-1 inline-flex flex-wrap items-center gap-1 align-baseline">
                        {inlineCitations.map((citation, idx) => {
                          const tag = `[${idx + 1}]`;
                          if (citation.type === 'document') {
                            return (
                              <button
                                key={citation.key}
                                type="button"
                                title={citation.label}
                                onClick={() => onOpenDocument?.(citation.source)}
                                className="text-xs text-accent hover:underline"
                              >
                                {tag}
                              </button>
                            );
                          }
                          if (citation.source.url) {
                            return (
                              <a
                                key={citation.key}
                                href={citation.source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={citation.label}
                                className="text-xs text-accent hover:underline"
                              >
                                {tag}
                              </a>
                            );
                          }
                          return (
                            <span key={citation.key} title={citation.label} className="text-xs text-text-tertiary">
                              {tag}
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </p>
                </section>
              )}

              {result.documentSources.length === 0 && result.linkSources.length === 0 && (
                <p className="text-xs text-text-tertiary italic">
                  {result.emptySourcesMessage
                    ?? 'Derived from generally available information. Validate requirements against official sources.'}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
