'use client';

import { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, ExternalLink, HelpCircle, X, Zap } from 'lucide-react';

import { SnippetCard } from '@/components/core-chat/ResearchPanel';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import { PageLoader } from '@/components/ui/PageLoader';
import { Tooltip } from '@/components/ui/Tooltip';

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
                  </p>
                </section>
              )}

              {result.detailFields && result.detailFields.length > 0 && (
                <section>
                  <h4 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">
                    {result.detailFieldsTitle ?? 'Details'}
                  </h4>
                  <div className="space-y-1.5">
                    {result.detailFields.map((field, idx) => (
                      <div key={`${field.label}-${idx}`} className="rounded border border-stroke-subtle bg-white px-2.5 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                          {field.label}
                        </p>
                        <p className="mt-0.5 text-xs text-text-secondary">{field.value}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {result.requirements.length > 0 && (
                <section>
                  <h4 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">
                    {result.requirementsTitle ?? 'Requirements'}
                  </h4>
                  <div className="space-y-1.5">
                    {result.requirements.map((req, idx) => (
                      <div
                        key={`${req.title}-${idx}`}
                        className="border border-stroke-subtle rounded px-2.5 py-1.5 flex items-center gap-1.5"
                      >
                        <span className="text-xs text-text-primary flex-1 min-w-0 leading-snug">{req.title}</span>
                        <Tooltip content={req.description}>
                          <span className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 bg-surface-subtle text-text-tertiary hover:bg-surface-hover hover:text-text-secondary cursor-help transition-colors">
                            <HelpCircle className="w-2.5 h-2.5" />
                          </span>
                        </Tooltip>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {result.dependencies.length > 0 && (
                <section>
                  <h4 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">
                    {result.dependenciesTitle ?? 'Dependencies'}
                  </h4>
                  <div className="space-y-1.5">
                    {result.dependencies.map((dep, idx) => {
                      const condition = dep.condition.charAt(0).toUpperCase() + dep.condition.slice(1);
                      return (
                        <div key={`${dep.condition}-${idx}`} className="text-xs text-text-secondary bg-white rounded border border-stroke-subtle px-2.5 py-1.5">
                          <span className="font-semibold text-text-primary block">{condition}</span>
                          <span className="block mt-0.5">{dep.effect}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {result.documentSources.length > 0 && (
                <section>
                  <h4 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">
                    {result.documentSourcesTitle ?? 'Project documents'}
                  </h4>
                  <div className="space-y-1.5">
                    {result.documentSources.map((source, idx) => {
                      const citation: ResearchPanelCitation = {
                        evidence_doc_id: source.evidenceDocId,
                        chunk_id: source.chunkId ?? null,
                        source_title: source.title,
                      };
                      return (
                        <SnippetCard
                          key={`${source.evidenceDocId}-${idx}`}
                          citation={citation}
                          textOnly
                          onOpenFull={onOpenDocument ? () => onOpenDocument(source) : undefined}
                        />
                      );
                    })}
                  </div>
                </section>
              )}

              {result.linkSources.length > 0 && (
                <section>
                  <h4 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">
                    {result.linkSourcesTitle ?? 'Sources'}
                  </h4>
                  <div className="space-y-1">
                    {result.linkSources.map((source, idx) => (
                      <div key={`${source.title}-${idx}`} className="flex items-start gap-1.5 min-w-0">
                        <ExternalLink className="w-3 h-3 text-text-tertiary flex-shrink-0 mt-0.5" />
                        {source.url ? (
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-accent hover:underline leading-snug min-w-0 break-words line-clamp-2 flex-1"
                          >
                            {source.title}
                            {source.publisher && <span className="text-text-tertiary"> · {source.publisher}</span>}
                          </a>
                        ) : (
                          <span className="text-xs text-text-secondary leading-snug min-w-0 break-words line-clamp-2 flex-1">
                            {source.title}
                            {source.publisher && <span className="text-text-tertiary"> · {source.publisher}</span>}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
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
