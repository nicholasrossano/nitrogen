'use client';

import { useEffect, useRef } from 'react';
import { X, ExternalLink, AlertCircle, Zap, HelpCircle, FileCheck2, Calculator, PenLine } from 'lucide-react';
import { DeepDiveResult, ProjectPlanItem, ProjectPlanPillar } from '@/lib/api';
import { Tooltip } from '@/components/ui/Tooltip';
import { PageLoader } from '@/components/ui/PageLoader';
import { SnippetCard } from '@/components/core-chat/ResearchPanel';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';

interface DeepDivePanelProps {
  initiativeId: string;
  item: ProjectPlanItem;
  pillar: ProjectPlanPillar;
  result: DeepDiveResult | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
  onOpenFullDoc?: (citation: ResearchPanelCitation) => void;
}

type Classification = 'required' | 'optional' | 'unknown';

function InlineBold({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i} className="font-semibold text-text-primary">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  );
}

const CLS_BADGE: Record<Classification, { badge: string; label: string }> = {
  required: { badge: 'bg-accent/10 text-accent', label: 'REQ' },
  optional: { badge: 'bg-surface-subtle text-text-tertiary', label: 'OPT' },
  unknown: { badge: 'bg-indicator-orange/10 text-indicator-orange', label: 'UNK' },
};


function ClassificationBadge({ cls }: { cls: string }) {
  const safe = (cls as Classification) in CLS_BADGE ? (cls as Classification) : 'unknown';
  const { badge, label } = CLS_BADGE[safe];
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-sm font-semibold uppercase tracking-wide leading-none flex-shrink-0 ${badge}`}>
      {label}
    </span>
  );
}

function ItemTypeBadge({ itemType }: { itemType?: string }) {
  const isAssessment = itemType === 'assessment';
  const Icon = isAssessment ? Calculator : FileCheck2;
  const label = isAssessment ? 'Assessment' : 'Deliverable';
  const style = isAssessment
    ? 'bg-indicator-green/10 text-indicator-green'
    : 'bg-accent-secondary-wash text-accent-secondary';
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-sm font-semibold tracking-wide leading-none flex-shrink-0 inline-flex items-center gap-1 ${style}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

export function DeepDivePanel({
  item,
  pillar,
  result,
  loading,
  error,
  onClose,
  onRetry,
  onOpenFullDoc,
}: DeepDivePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Trap focus inside panel
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const pillarLabel =
    result?.pillar_name ?? pillar.name;

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Deep dive: ${item.title}`}
      className="w-full h-full flex-shrink-0 bg-white border-l border-divider flex flex-col outline-none"
      style={{ animation: 'slideInRight 0.2s ease-out forwards' }}
    >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-stroke-subtle flex-shrink-0">
          <div className="flex flex-col items-center gap-1 flex-shrink-0">
            <div className="w-full aspect-square min-w-0 bg-accent/10 rounded flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-accent" />
            </div>
            <ClassificationBadge cls={item.classification} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-text-tertiary font-medium uppercase tracking-wide">
                {pillarLabel}
              </span>
              <ItemTypeBadge itemType={item.item_type} />
            </div>
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {/* Disclaimer — shown whenever the panel has nothing to display.
              This covers user-added items (skipped by runDeepDive) regardless
              of whether the user_added flag survived serialisation. */}
          {!result && !loading && !error && (
            <div className="flex flex-col items-center justify-center gap-4 px-6 py-10 text-center">
              <div className="w-10 h-10 rounded-full bg-surface-subtle flex items-center justify-center flex-shrink-0">
                <PenLine className="w-5 h-5 text-text-tertiary" />
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-text-secondary">No deep dive available</p>
                <p className="text-xs text-text-tertiary leading-relaxed max-w-xs">
                  This item was added manually. Deep dive research is only available for items generated by Nitrogen.
                </p>
              </div>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <PageLoader label="" />
              <p className="text-sm text-text-secondary">Researching requirements...</p>
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center justify-center h-48 gap-3 px-6 text-center">
              <AlertCircle className="w-5 h-5 text-indicator-orange" />
              <p className="text-sm text-text-secondary">{error}</p>
              <button
                onClick={onRetry}
                className="text-xs text-accent hover:underline"
              >
                Try again
              </button>
            </div>
          )}

          {result && !loading && (
            <div className="px-5 py-4 space-y-5">

              {/* What this is */}
              {result.what_this_is.length > 0 && (
                <section>
                  <h3 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                    What this is
                  </h3>
                  <p className="text-sm text-text-secondary leading-snug">
                    <InlineBold text={result.what_this_is.join(' ')} />
                  </p>
                </section>
              )}

              {/* Requirements */}
              {result.elements.length > 0 && (
                <section>
                  <h3 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                    Requirements
                  </h3>
                  <div className="space-y-2">
                    {result.elements.map((el, i) => (
                      <div
                        key={i}
                        className="border border-stroke-subtle rounded px-3 py-2.5 flex items-center gap-2"
                      >
                        <span className="text-sm font-medium text-text-primary flex-1 min-w-0 leading-snug">
                          {el.title}
                        </span>
                        <Tooltip content={el.description}>
                          <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 bg-surface-subtle text-text-tertiary hover:bg-surface-hover hover:text-text-secondary cursor-help transition-colors">
                            <HelpCircle className="w-3 h-3" />
                          </span>
                        </Tooltip>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Dependencies */}
              {result.dependencies.length > 0 && (
                <section>
                  <h3 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                    Dependencies
                  </h3>
                  <div className="space-y-2">
                    {result.dependencies.map((dep, i) => {
                      const conditionCapitalized =
                        dep.condition.charAt(0).toUpperCase() + dep.condition.slice(1);
                      return (
                        <div key={i} className="text-xs text-text-secondary leading-relaxed bg-surface-subtle rounded px-3 py-2">
                          <span className="font-semibold text-text-primary block">
                            {conditionCapitalized}
                          </span>
                          <span className="block mt-1">{dep.effect}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Project documents (evidence sources) */}
              {result.sources.some(s => s.source_type === 'evidence' && s.evidence_doc_id) && (
                <section>
                  <h3 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                    Project documents
                  </h3>
                  <div className="space-y-2">
                    {result.sources
                      .filter(s => s.source_type === 'evidence' && s.evidence_doc_id)
                      .map((src, i) => {
                        const citation: ResearchPanelCitation = {
                          evidence_doc_id: src.evidence_doc_id!,
                          chunk_id: src.chunk_id ?? null,
                          source_title: src.title,
                        };
                        return (
                          <SnippetCard
                            key={i}
                            citation={citation}
                            textOnly
                            onOpenFull={onOpenFullDoc ? () => onOpenFullDoc(citation) : undefined}
                          />
                        );
                      })}
                  </div>
                </section>
              )}

              {/* Web sources */}
              {result.sources.some(s => s.source_type !== 'evidence') && (
                <section>
                  <h3 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                    Sources
                  </h3>
                  <div className="space-y-1.5">
                    {result.sources
                      .filter(s => s.source_type !== 'evidence')
                      .map((src, i) => (
                        <div key={i} className="flex items-start gap-2 min-w-0">
                          <ExternalLink className="w-3 h-3 text-text-tertiary flex-shrink-0 mt-0.5" />
                          {src.url ? (
                            <a
                              href={src.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-accent hover:underline leading-snug min-w-0 break-words line-clamp-2 flex-1"
                            >
                              {src.title}
                              {src.publisher && (
                                <span className="text-text-tertiary"> · {src.publisher}</span>
                              )}
                            </a>
                          ) : (
                            <span className="text-xs text-text-secondary leading-snug min-w-0 break-words line-clamp-2 flex-1">
                              {src.title}
                              {src.publisher && (
                                <span className="text-text-tertiary"> · {src.publisher}</span>
                              )}
                            </span>
                          )}
                        </div>
                      ))}
                  </div>
                </section>
              )}

              {/* No sources note */}
              {result.sources.length === 0 && !loading && (
                <p className="text-xs text-text-tertiary italic">
                  The provided information was derived from generally available information.
                  Validate requirements against official sources.
                </p>
              )}

            </div>
          )}
        </div>

        {/* Footer — latency */}
        {result && !loading && (
          <div className="px-5 py-2.5 border-t border-stroke-subtle flex-shrink-0">
            <p className="text-[11px] text-text-tertiary">
              Research completed in {(result.latency_ms / 1000).toFixed(1)}s
            </p>
          </div>
        )}
      </div>
  );
}
