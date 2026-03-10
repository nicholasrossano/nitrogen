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
  ExternalLink,
  FileText
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

  // State for editable content and headers
  const [editableContent, setEditableContent] = useState<Record<string, string>>(() => {
    const content = data.content as MemoContent;
    const initial: Record<string, string> = {};
    if ((content as any).sections) {
      (content as any).sections.forEach((section: { id: string; title: string; content: string }, index: number) => {
        const sectionId = section.id || `section-${index}`;
        initial[sectionId] = section.content;
        initial[`${sectionId}-title`] = section.title;
      });
    } else {
      initial['executive_summary'] = content.executive_summary || '';
      initial['recommendation_rationale'] = content.recommendation_rationale || '';
      initial['evidence_summary'] = content.evidence_summary || '';
      initial['risks_and_assumptions'] = content.risks_and_assumptions || '';
      initial['executive_summary-title'] = 'Executive Summary';
      initial['recommendation_rationale-title'] = 'Recommendation Rationale';
      initial['evidence_summary-title'] = 'Evidence Summary';
      initial['risks_and_assumptions-title'] = 'Risks and Assumptions';
      initial['open_questions-title'] = 'Open Questions';
      // Store open questions
      if (content.open_questions) {
        content.open_questions.forEach((q, i) => {
          initial[`open_question-${i}`] = q;
        });
      }
    }
    return initial;
  });

  const handleContentEdit = (sectionId: string, e: React.FormEvent<HTMLParagraphElement>) => {
    const newContent = e.currentTarget.textContent || '';
    setEditableContent(prev => ({ ...prev, [sectionId]: newContent }));
  };

  const handleTitleEdit = (sectionId: string, e: React.FormEvent<HTMLHeadingElement>) => {
    const newTitle = e.currentTarget.textContent || '';
    setEditableContent(prev => ({ ...prev, [`${sectionId}-title`]: newTitle }));
  };

  const handleQuestionEdit = (questionIdx: number, e: React.FormEvent<HTMLLIElement>) => {
    const newQuestion = e.currentTarget.textContent || '';
    setEditableContent(prev => ({ ...prev, [`open_question-${questionIdx}`]: newQuestion }));
  };

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
        const citation = content.citations?.find(c => c.number === num);
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
    <div className="card-elevated overflow-hidden h-full rounded-none flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 bg-surface-header border-b border-divider flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-accent-wash rounded flex items-center justify-center flex-shrink-0">
            <FileText className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Investment Memo</h3>
            <p className="text-sm text-text-secondary mt-0.5">{projectName}</p>
          </div>
        </div>
        {content.date && <p className="text-sm text-text-secondary whitespace-nowrap self-start">{formatHeaderDate(content.date)}</p>}
      </div>

      {/* Content */}
          <div className="p-6 space-y-6 prose-memo flex-1 min-h-0 overflow-y-auto bg-white">
            {/* Dynamic sections from alignment OR legacy hardcoded sections */}
            {(content as any).sections ? (
              // Dynamic sections format
              <>
                {(content as any).sections.map((section: { id: string; title: string; content: string }, index: number) => {
                  const sectionId = section.id || `section-${index}`;
                  return (
                    <section key={sectionId}>
                      <h2
                        contentEditable
                        suppressContentEditableWarning
                        onBlur={(e) => handleTitleEdit(sectionId, e)}
                        className="editable-content"
                      >
                        {editableContent[`${sectionId}-title`] || section.title}
                      </h2>
                      <p
                        contentEditable
                        suppressContentEditableWarning
                        onBlur={(e) => handleContentEdit(sectionId, e)}
                        className="editable-content"
                      >
                        {editableContent[sectionId] || section.content}
                      </p>
                    </section>
                  );
                })}
              </>
            ) : (
              // Legacy hardcoded format
              <>
                {/* Executive Summary */}
                <section>
                  <h2
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => handleTitleEdit('executive_summary', e)}
                    className="editable-content"
                  >
                    {editableContent['executive_summary-title']}
                  </h2>
                  <p
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => handleContentEdit('executive_summary', e)}
                    className="editable-content"
                  >
                    {editableContent['executive_summary']}
                  </p>
                </section>

                {/* Recommendation Rationale */}
                <section>
                  <h2
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => handleTitleEdit('recommendation_rationale', e)}
                    className="editable-content"
                  >
                    {editableContent['recommendation_rationale-title']}
                  </h2>
                  <p
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => handleContentEdit('recommendation_rationale', e)}
                    className="editable-content"
                  >
                    {editableContent['recommendation_rationale']}
                  </p>
                </section>

                {/* Evidence Summary */}
                <section>
                  <h2
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => handleTitleEdit('evidence_summary', e)}
                    className="editable-content"
                  >
                    {editableContent['evidence_summary-title']}
                  </h2>
                  <p
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => handleContentEdit('evidence_summary', e)}
                    className="editable-content"
                  >
                    {editableContent['evidence_summary']}
                  </p>
                </section>

                {/* Risks and Assumptions */}
                <section>
                  <h2
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => handleTitleEdit('risks_and_assumptions', e)}
                    className="editable-content"
                  >
                    {editableContent['risks_and_assumptions-title']}
                  </h2>
                  <p
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => handleContentEdit('risks_and_assumptions', e)}
                    className="editable-content"
                  >
                    {editableContent['risks_and_assumptions']}
                  </p>
                </section>

                {/* Open Questions */}
                {content.open_questions?.length > 0 && (
                  <section>
                    <h2
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => handleTitleEdit('open_questions', e)}
                      className="editable-content"
                    >
                      {editableContent['open_questions-title']}
                    </h2>
                    <ul>
                      {content.open_questions.map((q, i) => (
                        <li 
                          key={i}
                          contentEditable
                          suppressContentEditableWarning
                          onBlur={(e) => handleQuestionEdit(i, e)}
                          className="editable-content"
                        >
                          {editableContent[`open_question-${i}`] || q}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}

            {/* Citations */}
            {content.citations?.length > 0 && (
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
                        <span className="text-sm font-semibold text-text-primary">[{citation.number}]</span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            {citation.source_type === 'corpus' ? (
                              <BookOpen className="w-4 h-4 text-accent" />
                            ) : (
                              <ExternalLink className="w-4 h-4 text-text-secondary" />
                            )}
                            <span className={`text-sm uppercase font-semibold tracking-wide ${
                              citation.source_type === 'corpus' ? 'text-accent' : 'text-text-secondary'
                            }`}>
                              {citation.source_type === 'corpus' ? 'Case Study' : 'Your Evidence'}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-text-primary mt-1">{citation.source_title}</p>
                          {selectedCitation?.number === citation.number && (
                            <p className="text-sm text-text-secondary mt-3 border-l border-divider pl-3">
                              &quot;{citation.excerpt}&quot;
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
          <div className="flex-shrink-0 p-4 border-t border-divider bg-surface-header">
            <button
              onClick={handleExport}
              disabled={loading}
              className="btn-primary w-full !py-3"
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
