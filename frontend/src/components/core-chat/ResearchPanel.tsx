'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { X, FileText, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { SourceCitation, EvidenceChunkDetail } from '@/lib/api';

export interface ResearchPanelCitation {
  evidence_doc_id: string;
  chunk_id: string | null;
  source_title: string;
}

interface ResearchPanelProps {
  citation: ResearchPanelCitation;
  onClose: () => void;
}

export function ResearchPanel({ citation, onClose }: ResearchPanelProps) {
  const [chunks, setChunks] = useState<EvidenceChunkDetail[]>([]);
  const [filename, setFilename] = useState(citation.source_title || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!citation.evidence_doc_id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.getEvidenceChunks(citation.evidence_doc_id)
      .then((res) => {
        if (cancelled) return;
        setChunks(res.chunks);
        if (res.filename) setFilename(res.filename);
      })
      .catch(() => {
        if (cancelled) return;
        api.getEvidenceContent(citation.evidence_doc_id)
          .then((res) => {
            if (cancelled) return;
            setChunks([{ id: 'full', chunk_index: 0, content: res.content }]);
            if (res.filename) setFilename(res.filename);
          })
          .catch(() => {
            if (!cancelled) setError('Could not load document');
          });
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [citation.evidence_doc_id]);

  const scrollToHighlight = useCallback(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  useEffect(() => {
    if (!loading && citation.chunk_id) {
      const timer = setTimeout(scrollToHighlight, 150);
      return () => clearTimeout(timer);
    }
  }, [loading, citation.chunk_id, scrollToHighlight]);

  return (
    <div className="h-full flex flex-col bg-surface border-l border-divider">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-divider flex-shrink-0">
        <FileText className="w-4 h-4 text-text-tertiary flex-shrink-0" />
        <h3 className="text-sm font-medium text-text-primary truncate flex-1">{filename}</h3>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-subtle transition-colors text-text-tertiary hover:text-text-secondary flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-accent" />
              <span className="text-xs text-text-tertiary">Loading document…</span>
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-text-tertiary">{error}</p>
          </div>
        ) : (
          <div className="space-y-0">
            {chunks.map((chunk) => {
              const isHighlighted = citation.chunk_id && chunk.id === citation.chunk_id;
              return (
                <div
                  key={chunk.id}
                  ref={isHighlighted ? highlightRef : undefined}
                  className={`text-sm leading-relaxed whitespace-pre-wrap transition-colors duration-300 ${
                    isHighlighted
                      ? 'bg-accent-wash border-l-2 border-accent pl-3 py-2 -ml-3 rounded-r'
                      : 'text-text-primary'
                  }`}
                >
                  {chunk.content}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
