'use client';

import { useState } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { 
  Download, 
  Loader2, 
  CheckCircle,
  AlertCircle,
  PauseCircle,
  BookOpen,
  ExternalLink
} from 'lucide-react';
import { MemoContent, Citation } from '@/lib/api';

interface MemoViewerWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
}

function formatHeaderDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function MemoViewerWidget({ data, initiativeId, isActive = true }: MemoViewerWidgetProps) {
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const { exportMemo, loading, initiative } = useInitiativeStore();

  const content = data.content as MemoContent;
  const projectName =
    initiative?.title ??
    (content.title?.includes(': ') ? content.title.split(': ').slice(1).join(': ') : undefined) ??
    'Project';

  const handleExport = async () => {
    await exportMemo(initiativeId);
  };

  const RecommendationBadge = () => {
    const rec = content.recommendation;
    const config = {
      proceed: { 
        icon: CheckCircle, 
        bg: 'bg-indicator-green/10', 
        text: 'text-indicator-green',
        border: 'border-indicator-green/30'
      },
      hold: { 
        icon: PauseCircle, 
        bg: 'bg-indicator-orange/10', 
        text: 'text-indicator-orange',
        border: 'border-indicator-orange/30'
      },
      reject: { 
        icon: AlertCircle, 
        bg: 'bg-accent-wash', 
        text: 'text-accent',
        border: 'border-accent-tint'
      },
    }[rec] || { icon: CheckCircle, bg: 'bg-surface-subtle', text: 'text-text-secondary', border: 'border-stroke-subtle' };
    
    const Icon = config.icon;

    return (
      <div className={`inline-flex items-center gap-2 px-4 py-2 ${config.bg} ${config.border} border rounded`}>
        <Icon className={`w-5 h-5 ${config.text}`} />
        <span className={`font-semibold uppercase tracking-wide text-sm ${config.text}`}>
          {rec}
        </span>
      </div>
    );
  };

  // Render text with citation links
  const renderWithCitations = (text: string) => {
    // Match [1], [2], etc.
    const parts = text.split(/(\[\d+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/\[(\d+)\]/);
      if (match) {
        const num = parseInt(match[1]);
        const citation = content.citations.find(c => c.number === num);
        if (citation) {
          return (
            <button
              key={i}
              onClick={() => setSelectedCitation(citation)}
              className="citation"
              title={`${citation.source_title}`}
            >
              {part}
            </button>
          );
        }
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="card-elevated overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 bg-surface-header border-b border-divider flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-text-primary">Investment Memo</h3>
          <p className="text-sm text-text-secondary mt-0.5">{projectName}</p>
        </div>
        <p className="text-sm text-text-secondary whitespace-nowrap">{formatHeaderDate(content.date)}</p>
      </div>

      {/* Content */}
          <div className="p-6 space-y-6 prose-memo max-h-[500px] overflow-y-auto bg-white">
            {/* Executive Summary */}
            <section>
              <h2>Executive Summary</h2>
              <p>{renderWithCitations(content.executive_summary)}</p>
            </section>

            {/* Recommendation Rationale */}
            <section>
              <h2>Recommendation Rationale</h2>
              <p>{renderWithCitations(content.recommendation_rationale)}</p>
            </section>

            {/* Evidence Summary */}
            <section>
              <h2>Evidence Summary</h2>
              <p>{renderWithCitations(content.evidence_summary)}</p>
            </section>

            {/* Risks and Assumptions */}
            <section>
              <h2>Risks and Assumptions</h2>
              <p>{renderWithCitations(content.risks_and_assumptions)}</p>
            </section>

            {/* Open Questions */}
            {content.open_questions.length > 0 && (
              <section>
                <h2>Open Questions</h2>
                <ul>
                  {content.open_questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* Citations */}
            {content.citations.length > 0 && (
              <section>
                <h2>References</h2>
                <div className="space-y-3">
                  {content.citations.map((citation) => (
                    <div 
                      key={citation.number}
                      className={`
                        selectable-item p-4 rounded text-sm
                        ${citation.source_type === 'corpus' 
                          ? 'border-accent-tint' 
                          : 'border-stroke-subtle'
                        }
                        ${selectedCitation?.number === citation.number ? 'selected ring-2 ring-accent ring-offset-2 ring-offset-white' : ''}
                      `}
                      onClick={() => setSelectedCitation(
                        selectedCitation?.number === citation.number ? null : citation
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span className="font-semibold text-text-primary">[{citation.number}]</span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            {citation.source_type === 'corpus' ? (
                              <BookOpen className="w-4 h-4 text-accent" />
                            ) : (
                              <ExternalLink className="w-4 h-4 text-text-secondary" />
                            )}
                            <span className={`text-xs uppercase font-semibold tracking-wide ${
                              citation.source_type === 'corpus' ? 'text-accent' : 'text-text-secondary'
                            }`}>
                              {citation.source_type === 'corpus' ? 'Case Study' : 'Your Evidence'}
                            </span>
                          </div>
                          <p className="font-medium text-text-primary mt-1">{citation.source_title}</p>
                          {selectedCitation?.number === citation.number && (
                            <p className="text-text-secondary mt-3 border-l-2 border-divider pl-3">
                              "{citation.excerpt}"
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Actions */}
          <div className="px-5 py-4 bg-surface-header border-t border-divider">
            <button
              onClick={handleExport}
              disabled={loading}
              className="btn-primary w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Export to Word
                </>
              )}
            </button>
          </div>
    </div>
  );
}
