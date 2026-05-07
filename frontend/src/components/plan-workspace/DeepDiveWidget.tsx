'use client';

import { Fragment, useState } from 'react';
import { AlertCircle, Zap } from 'lucide-react';
import { ChatPanelWidgetShell } from '@/components/core-chat/ChatPanelWidgetShell';
import { PageLoader } from '@/components/ui/PageLoader';

import { DeepDiveSourcesMenu } from './DeepDiveSourcesMenu';
import type {
  PlanWorkspaceInspectorCitationSource,
  PlanWorkspaceInspectorDocumentSource,
  PlanWorkspaceInspectorState,
} from './types';

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

function fallbackCitationSources(result: PlanWorkspaceInspectorState['result']): PlanWorkspaceInspectorCitationSource[] {
  if (!result) return [];
  return [
    ...result.documentSources.map((source, idx) => ({
      key: `doc:${source.evidenceDocId}:${source.chunkId ?? source.title}`,
      label: source.title,
      type: 'document' as const,
      citationNumber: idx + 1,
      ...source,
    })),
    ...result.linkSources.map((source, idx) => ({
      key: `link:${source.title}:${source.url ?? ''}`,
      label: source.title,
      type: 'link' as const,
      citationNumber: result.documentSources.length + idx + 1,
      ...source,
    })),
  ];
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
  const citationSources = result?.citationSources ?? fallbackCitationSources(result);

  const setCollapsed = (nextValue: boolean | ((value: boolean) => boolean)) => {
    const next = typeof nextValue === 'function' ? nextValue(collapsed) : nextValue;
    if (collapsedProp === undefined) {
      setInternalCollapsed(next);
    }
    onCollapsedChange?.(next);
  };
  const isPanelLayout = layoutMode === 'panel' && !collapsed;

  return (
    <ChatPanelWidgetShell
      icon={<Zap className="h-3 w-3 text-accent" />}
      eyebrow={groupName}
      title={item.title}
      collapsed={collapsed}
      layoutMode={layoutMode}
      onCollapsedChange={(nextCollapsed) => setCollapsed(nextCollapsed)}
      onClose={onClose}
      headerActions={result && citationSources.length > 0 ? (
        <DeepDiveSourcesMenu sources={citationSources} onOpenDocument={onOpenDocument} />
      ) : null}
      bodyClassName={
        loading && isPanelLayout
          ? 'flex-1 min-h-0 flex items-start justify-center px-4 pt-[33%]'
          : undefined
      }
    >
          {!result && !loading && !error && (
            <p className="text-xs text-text-tertiary italic py-1">
              This item was added manually. Research details are only available for generated items.
            </p>
          )}

          {loading && (
            <div className="flex items-center justify-center py-2">
              <PageLoader
                variant={isPanelLayout ? 'art' : 'icon'}
                size={isPanelLayout ? 220 : 40}
                label=""
              />
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
                    {result.summaryTitle ?? 'Overview'}
                  </h4>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    {result.summary.map((sentence, sentenceIdx) => (
                      <Fragment key={`${sentenceIdx}-${sentence}`}>
                        {sentenceIdx > 0 ? ' ' : null}
                        <InlineBold text={sentence} />
                        {(result.summaryCitations?.[sentenceIdx] ?? []).map((citationNumber) => {
                          const citation = citationSources.find((source) => source.citationNumber === citationNumber);
                          if (!citation) return null;
                          const tag = `[${citationNumber}]`;
                          if (citation.type === 'document') {
                            return (
                              <button
                                key={`${sentenceIdx}-${citation.key}`}
                                type="button"
                                title={citation.label}
                                onClick={() => onOpenDocument?.(citation)}
                                className="ml-1 text-xs text-accent hover:underline"
                              >
                                {tag}
                              </button>
                            );
                          }
                          if (citation.url) {
                            return (
                              <a
                                key={`${sentenceIdx}-${citation.key}`}
                                href={citation.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={citation.label}
                                className="ml-1 text-xs text-accent hover:underline"
                              >
                                {tag}
                              </a>
                            );
                          }
                          return (
                            <span
                              key={`${sentenceIdx}-${citation.key}`}
                              title={citation.label}
                              className="ml-1 text-xs text-text-tertiary"
                            >
                              {tag}
                            </span>
                          );
                        })}
                      </Fragment>
                    ))}
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
    </ChatPanelWidgetShell>
  );
}
