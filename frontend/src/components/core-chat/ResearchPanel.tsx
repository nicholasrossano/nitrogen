'use client';

import { useEffect, useState, useMemo } from 'react';
import { X, FileText, Loader2, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import type { EvidenceChunkDetail } from '@/lib/api';
import DOMPurify from 'dompurify';

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

function MiniPdfPage({ evidenceDocId, pageNumber }: { evidenceDocId: string; pageNumber: number }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;

    (async () => {
      try {
        const bytes = await api.getEvidenceFileBytes(evidenceDocId);
        if (cancelled) return;
        const blob = new Blob([bytes], { type: 'application/pdf' });
        url = URL.createObjectURL(blob);
        const page = pageNumber > 1 ? `#page=${pageNumber}` : '';
        setBlobUrl(url + page);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [evidenceDocId, pageNumber]);

  if (error) {
    return <p className="text-xs text-text-tertiary py-2">Could not load PDF page</p>;
  }

  return (
    <div className="overflow-hidden rounded border border-stroke-subtle bg-white">
      {loading && (
        <div className="flex items-center gap-2 py-4 justify-center">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
          <span className="text-xs text-text-tertiary">Loading page {pageNumber}…</span>
        </div>
      )}
      {blobUrl && (
        <iframe
          src={blobUrl}
          className="w-full h-48 border-0"
          title={`PDF page ${pageNumber}`}
        />
      )}
    </div>
  );
}

function RichHtmlContent({ html }: { html: string }) {
  // Patch orphaned <tr> fragments (legacy chunks split at row level):
  // if the trimmed HTML starts with <tr but has no wrapping <table>, wrap it.
  const patched = /^\s*<tr[\s>]/i.test(html) && !/<table[\s>]/i.test(html)
    ? `<table>${html}</table>`
    : html;

  const sanitized = DOMPurify.sanitize(patched, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody',
      'tr', 'th', 'td', 'blockquote', 'code', 'pre', 'sup', 'sub', 'span',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
  });

  return (
    <div
      className="rich-snippet text-[13px] leading-relaxed text-text-secondary"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

export function SnippetCard({
  citation,
  onOpenFull,
  textOnly = false,
}: {
  citation: ResearchPanelCitation;
  onOpenFull?: () => void;
  textOnly?: boolean;
}) {
  const [chunk, setChunk] = useState<EvidenceChunkDetail | null>(null);
  const [fileType, setFileType] = useState<string | null>(null);
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
        setFileType(res.file_type || null);

        let match: EvidenceChunkDetail | undefined;
        if (citation.chunk_id) {
          match = res.chunks.find((c: EvidenceChunkDetail) => c.id === citation.chunk_id);
        }
        setChunk(match || res.chunks[0] || null);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [citation.evidence_doc_id, citation.chunk_id]);

  const renderContent = () => {
    if (!chunk) return null;

    // Always render rich HTML when available (tables, formatted DOCX/XLSX content)
    if (chunk.content_html) {
      return <RichHtmlContent html={chunk.content_html} />;
    }

    // PDF page preview — suppressed in textOnly mode (e.g. deep dive panel)
    if (!textOnly && fileType === 'pdf' && chunk.page_number) {
      return (
        <MiniPdfPage
          evidenceDocId={citation.evidence_doc_id}
          pageNumber={chunk.page_number}
        />
      );
    }

    const text = chunk.content;
    const truncated = text.length > 400 ? text.slice(0, 400).trimEnd() + '\u2026' : text;
    return (
      <p className="text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap">
        {truncated}
      </p>
    );
  };

  return (
    <div className="rounded-lg border border-stroke-subtle bg-surface overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-subtle border-b border-stroke-subtle">
        <FileText className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
        <span className="text-xs font-medium text-text-primary truncate flex-1">
          {filename}
        </span>
      </div>

      <div className="px-3 py-2.5">
        {loading ? (
          <div className="flex items-center gap-2 py-3">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
            <span className="text-xs text-text-tertiary">Loading…</span>
          </div>
        ) : error ? (
          <p className="text-xs text-text-tertiary py-2">Could not load passage</p>
        ) : (
          renderContent()
        )}
      </div>

      {onOpenFull && !loading && !error && (
        <button
          onClick={onOpenFull}
          className="flex items-center justify-end gap-1 px-3 py-2 w-full text-xs text-text-tertiary enabled:hover:text-accent border-t border-stroke-subtle transition-colors"
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
