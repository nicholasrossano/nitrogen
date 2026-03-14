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
  const sanitized = DOMPurify.sanitize(html, {
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

function SnippetCard({
  citation,
  onOpenFull,
}: {
  citation: ResearchPanelCitation;
  onOpenFull?: () => void;
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

    if (chunk.content_html) {
      return <RichHtmlContent html={chunk.content_html} />;
    }

    if (fileType === 'pdf' && chunk.page_number) {
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
          className="flex items-center gap-1 px-3 py-2 w-full text-xs text-text-tertiary enabled:hover:text-accent border-t border-stroke-subtle transition-colors"
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

      <style jsx global>{`
        .rich-snippet strong,
        .rich-snippet b {
          font-weight: 600;
          color: var(--text-primary, #1C1C1E);
        }
        .rich-snippet em,
        .rich-snippet i {
          font-style: italic;
        }
        .rich-snippet a {
          color: var(--accent, #005e72);
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .rich-snippet a:hover {
          opacity: 0.8;
        }
        .rich-snippet ul,
        .rich-snippet ol {
          padding-left: 1.25em;
          margin: 0.35em 0;
        }
        .rich-snippet li {
          margin-bottom: 0.15em;
        }
        .rich-snippet ul { list-style-type: disc; }
        .rich-snippet ol { list-style-type: decimal; }
        .rich-snippet h1,
        .rich-snippet h2,
        .rich-snippet h3,
        .rich-snippet h4 {
          font-weight: 600;
          color: var(--text-primary, #1C1C1E);
          margin: 0.5em 0 0.25em;
        }
        .rich-snippet h1 { font-size: 1.1em; }
        .rich-snippet h2 { font-size: 1.05em; }
        .rich-snippet h3 { font-size: 1em; }
        .rich-snippet table {
          width: 100%;
          border-collapse: collapse;
          margin: 0.35em 0;
          font-size: 0.9em;
        }
        .rich-snippet th,
        .rich-snippet td {
          border: 1px solid var(--stroke-subtle, #e5e3df);
          padding: 4px 6px;
          text-align: left;
        }
        .rich-snippet th {
          background: var(--surface-subtle, #F7F5F2);
          font-weight: 600;
        }
        .rich-snippet p {
          margin: 0.3em 0;
        }
        .rich-snippet blockquote {
          border-left: 2px solid var(--stroke-subtle, #e5e3df);
          padding-left: 0.75em;
          margin: 0.35em 0;
          color: var(--text-secondary, #5A5A60);
        }
      `}</style>
    </div>
  );
}
