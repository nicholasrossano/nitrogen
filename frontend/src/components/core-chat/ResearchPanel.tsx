'use client';

import { useEffect, useState, useCallback } from 'react';
import { X, FileText, Loader2, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import type { EvidenceChunkDetail } from '@/lib/api';

export interface ResearchPanelCitation {
  evidence_doc_id: string;
  chunk_id: string | null;
  source_title: string;
}

interface ResearchPanelProps {
  citation: ResearchPanelCitation;
  onClose: () => void;
  onOpenFullDoc?: (citation: ResearchPanelCitation) => void;
}

function SnippetCard({
  citation,
  onOpenFull,
}: {
  citation: ResearchPanelCitation;
  onOpenFull?: () => void;
}) {
  const [snippet, setSnippet] = useState<string | null>(null);
  const [filename, setFilename] = useState(citation.source_title || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!citation.evidence_doc_id) return;
    let cancelled = false;
    setLoading(true);
    setError(false);

    api.getEvidenceChunks(citation.evidence_doc_id)
      .then((res) => {
        if (cancelled) return;
        if (res.filename) setFilename(res.filename);

        if (citation.chunk_id) {
          const match = res.chunks.find((c: EvidenceChunkDetail) => c.id === citation.chunk_id);
          if (match) {
            setSnippet(match.content);
            return;
          }
        }
        // Fallback: use first chunk
        if (res.chunks.length > 0) {
          setSnippet(res.chunks[0].content);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [citation.evidence_doc_id, citation.chunk_id]);

  const truncatedSnippet = snippet
    ? snippet.length > 400 ? snippet.slice(0, 400).trimEnd() + '…' : snippet
    : null;

  return (
    <div className="rounded-lg border border-stroke-subtle bg-surface overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-subtle border-b border-stroke-subtle">
        <FileText className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
        <span className="text-xs font-medium text-text-primary truncate flex-1">
          {filename}
        </span>
      </div>

      {/* Content */}
      <div className="px-3 py-2.5">
        {loading ? (
          <div className="flex items-center gap-2 py-3">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
            <span className="text-xs text-text-tertiary">Loading…</span>
          </div>
        ) : error ? (
          <p className="text-xs text-text-tertiary py-2">Could not load passage</p>
        ) : (
          <p className="text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap">
            {truncatedSnippet}
          </p>
        )}
      </div>

      {/* Footer — open full doc */}
      {onOpenFull && !loading && !error && (
        <button
          onClick={onOpenFull}
          className="flex items-center gap-1 px-3 py-2 w-full text-xs text-text-tertiary hover:text-accent border-t border-stroke-subtle transition-colors"
        >
          <span>View full document</span>
          <ChevronRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export function ResearchPanel({ citation, onClose, onOpenFullDoc }: ResearchPanelProps) {
  return (
    <div className="h-full flex flex-col bg-surface border-l border-divider">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider flex-shrink-0">
        <h3 className="text-sm font-medium text-text-primary">Sources</h3>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-subtle transition-colors text-text-tertiary hover:text-text-secondary"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <SnippetCard
          citation={citation}
          onOpenFull={onOpenFullDoc ? () => onOpenFullDoc(citation) : undefined}
        />
      </div>
    </div>
  );
}
