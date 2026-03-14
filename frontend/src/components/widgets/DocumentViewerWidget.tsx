'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { EvidenceChunkDetail } from '@/lib/api';

interface DocumentViewerWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
}

export function DocumentViewerWidget({ data, isActive }: DocumentViewerWidgetProps) {
  const evidenceDocId = data.evidence_doc_id as string | undefined;
  const chunkId = data.chunk_id as string | null | undefined;
  const sourceTitle = data.source_title as string | undefined;

  const [chunks, setChunks] = useState<EvidenceChunkDetail[]>([]);
  const [filename, setFilename] = useState(sourceTitle || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!evidenceDocId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.getEvidenceChunks(evidenceDocId)
      .then((res) => {
        if (cancelled) return;
        setChunks(res.chunks);
        if (res.filename) setFilename(res.filename);
      })
      .catch(() => {
        if (cancelled) return;
        api.getEvidenceContent(evidenceDocId)
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
  }, [evidenceDocId]);

  const scrollToHighlight = useCallback(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  useEffect(() => {
    if (!loading && chunkId) {
      const timer = setTimeout(scrollToHighlight, 150);
      return () => clearTimeout(timer);
    }
  }, [loading, chunkId, scrollToHighlight]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-accent" />
          <span className="text-xs text-text-tertiary">Loading document…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <p className="text-sm text-text-tertiary">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-divider flex-shrink-0">
        <FileText className="w-4 h-4 text-text-tertiary flex-shrink-0" />
        <h3 className="text-sm font-medium text-text-primary truncate">{filename}</h3>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-4">
          {chunks.map((chunk) => {
            const isHighlighted = chunkId && chunk.id === chunkId;
            const paragraphs = chunk.content.split(/\n{2,}/);
            return (
              <div
                key={chunk.id}
                ref={isHighlighted ? highlightRef : undefined}
                className={`transition-colors duration-300 ${
                  isHighlighted
                    ? 'bg-accent-wash border-l-2 border-accent pl-4 py-3 -ml-4 rounded-r'
                    : ''
                }`}
              >
                {paragraphs.map((para, i) => (
                  <p
                    key={i}
                    className={`text-sm leading-[1.7] text-text-primary ${i > 0 ? 'mt-3' : ''}`}
                  >
                    {para.trim()}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
