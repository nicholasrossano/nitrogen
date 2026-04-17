import { useEffect, useRef } from 'react';
import { X, ExternalLink, AlertCircle, Zap, HelpCircle, PenLine } from 'lucide-react';

import { SnippetCard } from '@/components/core-chat/ResearchPanel';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import { Tooltip } from '@/components/ui/Tooltip';
import { PageLoader } from '@/components/ui/PageLoader';

import type { PlanWorkspaceInspectorDocumentSource, PlanWorkspaceInspectorState } from './types';

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
                  {result.summaryTitle ?? 'What this is'}
                </h3>
                <p className="text-sm text-text-secondary leading-snug">
                  <InlineBold text={result.summary.join(' ')} />
                </p>
              </section>
            )}

            {result.detailFields && result.detailFields.length > 0 && (
              <section>
                <h3 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                  {result.detailFieldsTitle ?? 'Details'}
                </h3>
                <div className="space-y-2">
                  {result.detailFields.map((field, idx) => (
                    <div key={`${field.label}-${idx}`} className="rounded border border-stroke-subtle bg-surface px-3 py-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                        {field.label}
                      </p>
                      <p className="mt-1 text-sm leading-snug text-text-secondary">{field.value}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {result.requirements.length > 0 && (
              <section>
                <h3 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                  {result.requirementsTitle ?? 'Requirements'}
                </h3>
                <div className="space-y-2">
                  {result.requirements.map((requirement, idx) => (
                    <div
                      key={`${requirement.title}-${idx}`}
                      className="border border-stroke-subtle rounded px-3 py-2.5 flex items-center gap-2"
                    >
                      <span className="text-sm font-medium text-text-primary flex-1 min-w-0 leading-snug">
                        {requirement.title}
                      </span>
                      <Tooltip content={requirement.description}>
                        <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 bg-surface-subtle text-text-tertiary hover:bg-surface-hover hover:text-text-secondary cursor-help transition-colors">
                          <HelpCircle className="w-3 h-3" />
                        </span>
                      </Tooltip>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {result.dependencies.length > 0 && (
              <section>
                <h3 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                  {result.dependenciesTitle ?? 'Dependencies'}
                </h3>
                <div className="space-y-2">
                  {result.dependencies.map((dependency, idx) => {
                    const condition = dependency.condition.charAt(0).toUpperCase() + dependency.condition.slice(1);
                    return (
                      <div key={`${dependency.condition}-${idx}`} className="text-xs text-text-secondary leading-relaxed bg-surface-subtle rounded px-3 py-2">
                        <span className="font-semibold text-text-primary block">{condition}</span>
                        <span className="block mt-1">{dependency.effect}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {result.documentSources.length > 0 && (
              <section>
                <h3 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                  {result.documentSourcesTitle ?? 'Project documents'}
                </h3>
                <div className="space-y-2">
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
                <h3 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                  {result.linkSourcesTitle ?? 'Sources'}
                </h3>
                <div className="space-y-1.5">
                  {result.linkSources.map((source, idx) => (
                    <div key={`${source.title}-${idx}`} className="flex items-start gap-2 min-w-0">
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
