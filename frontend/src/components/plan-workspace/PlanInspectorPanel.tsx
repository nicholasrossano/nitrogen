import { Fragment, useEffect, useRef } from 'react';
import { X, AlertCircle, Zap, PenLine } from 'lucide-react';
import { PageLoader } from '@/components/ui/PageLoader';

import { DeepDiveSourcesMenu } from './DeepDiveSourcesMenu';
import type {
  PlanWorkspaceInspectorCitationSource,
  PlanWorkspaceInspectorDocumentSource,
  PlanWorkspaceInspectorState,
} from './types';

interface PlanInspectorPanelProps {
  state: PlanWorkspaceInspectorState;
  onClose: () => void;
  onRetry: () => void;
  onOpenDocument?: (documentSource: PlanWorkspaceInspectorDocumentSource) => void;
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

export function PlanInspectorPanel({
  state,
  onClose,
  onRetry,
  onOpenDocument,
}: PlanInspectorPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const { item, groupName, result, loading, error } = state;
  const citationSources = result?.citationSources ?? fallbackCitationSources(result);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Plan details: ${item.title}`}
      className="w-full h-full flex-shrink-0 bg-white border-l border-divider flex flex-col outline-none"
      style={{ animation: 'slideInRight 0.2s ease-out forwards' }}
    >
      <div className="flex items-start gap-3 px-5 py-4 border-b border-stroke-subtle flex-shrink-0">
        <div className="w-9 h-9 flex-shrink-0 bg-accent/10 rounded flex items-center justify-center">
          <Zap className="w-3.5 h-3.5 text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[11px] text-text-tertiary font-medium uppercase tracking-wide">
            {groupName}
          </span>
          <h2 className="text-sm font-semibold text-text-primary leading-snug mt-0.5">
            {item.title}
          </h2>
        </div>
        {result && citationSources.length > 0 && (
          <DeepDiveSourcesMenu sources={citationSources} onOpenDocument={onOpenDocument} />
        )}
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-subtle transition-colors flex-shrink-0 text-text-tertiary hover:text-text-secondary"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {!result && !loading && !error && (
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-10 text-center">
            <div className="w-10 h-10 rounded-full bg-surface-subtle flex items-center justify-center flex-shrink-0">
              <PenLine className="w-5 h-5 text-text-tertiary" />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-text-secondary">No details available</p>
              <p className="text-xs text-text-tertiary leading-relaxed max-w-xs">
                This item was added manually. Research details are only available for generated items.
              </p>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <PageLoader label="" />
            <p className="text-sm text-text-secondary">{result?.loadingLabel ?? 'Researching requirements...'}</p>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center justify-center h-48 gap-3 px-6 text-center">
            <AlertCircle className="w-5 h-5 text-indicator-orange" />
            <p className="text-sm text-text-secondary">{error}</p>
            <button onClick={onRetry} className="text-xs text-accent hover:underline">
              Try again
            </button>
          </div>
        )}

        {result && !loading && (
          <div className="px-5 py-4 space-y-5">
            {result.summary.length > 0 && (
              <section>
                <h3 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                  {result.summaryTitle ?? 'Overview'}
                </h3>
                <p className="text-sm text-text-secondary leading-snug">
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
                  ?? 'The provided information was derived from generally available information. Validate requirements against official sources.'}
              </p>
            )}
          </div>
        )}
      </div>

      {result && !loading && (
        <div className="px-5 py-2.5 border-t border-stroke-subtle flex-shrink-0">
          <p className="text-[11px] text-text-tertiary">
            Research completed in {(result.latencyMs / 1000).toFixed(1)}s
          </p>
        </div>
      )}
    </div>
  );
}
