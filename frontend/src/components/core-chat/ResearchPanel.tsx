'use client';

import { useEffect, useState, useMemo } from 'react';
import { FileText, Loader2, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import type { EvidenceChunkDetail } from '@/lib/api';
import DOMPurify from 'dompurify';

export interface ResearchPanelCitation {
  evidence_doc_id: string;
  chunk_id: string | null;
  source_title: string;
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

function hasTableMarkup(html?: string | null): boolean {
  return Boolean(html && /<table[\s>]/i.test(html));
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function findSpreadsheetPreviewHtml(
  fileType: string | null,
  selected: EvidenceChunkDetail | null,
  chunks: EvidenceChunkDetail[],
): string | null {
  if (!selected || (fileType !== 'xlsx' && fileType !== 'xls')) return null;

  if (hasTableMarkup(selected.content_html)) {
    return selected.content_html ?? null;
  }

  const selectedIdx = chunks.findIndex((c) => c.id === selected.id);
  if (selectedIdx < 0) return selected.content_html ?? null;

  const maxDistance = 2;
  const neighbors = [];
  for (let offset = 1; offset <= maxDistance; offset += 1) {
    const left = chunks[selectedIdx - offset];
    const right = chunks[selectedIdx + offset];
    if (left) neighbors.push(left);
    if (right) neighbors.push(right);
  }

  const tableNeighbor = neighbors.find((c) => hasTableMarkup(c.content_html));
  if (!tableNeighbor?.content_html) {
    return selected.content_html ?? null;
  }

  if (selected.content_html?.trim()) {
    return `${selected.content_html}\n${tableNeighbor.content_html}`;
  }
  return tableNeighbor.content_html;
}

function SpreadsheetTextContent({ text }: { text: string }) {
  const rows = useMemo(() => {
    return text
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .filter((line) => !/^\[Sheet:/i.test(line))
      .map((line) => line.split('\t').map((cell) => cell.trim()))
      .filter((row) => row.length > 1 || row[0]?.length > 0)
      .slice(0, 8);
  }, [text]);

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const safeColumnCount = Math.min(columnCount, 8);
  const looksTabular = safeColumnCount > 1 && rows.length > 0;

  if (!looksTabular) {
    return (
      <p className="text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap">
        {text}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={`${rowIdx}-${row.join('|')}`}>
              {Array.from({ length: safeColumnCount }, (_, cellIdx) => {
                const value = row[cellIdx] ?? '';
                const isHeader = rowIdx === 0;
                return (
                  <td
                    key={cellIdx}
                    className={[
                      'border border-stroke-subtle px-2 py-1.5 align-top',
                      isHeader ? 'bg-surface-subtle font-medium text-text-primary' : 'text-text-secondary',
                    ].join(' ')}
                  >
                    {value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SnippetCard({
  citation,
  onOpenFull,
  textOnly = false,
  maxLines,
}: {
  citation: ResearchPanelCitation;
  onOpenFull?: () => void;
  textOnly?: boolean;
  maxLines?: number;
}) {
  const [chunk, setChunk] = useState<EvidenceChunkDetail | null>(null);
  const [chunks, setChunks] = useState<EvidenceChunkDetail[]>([]);
  const [fileType, setFileType] = useState<string | null>(null);
  const [filename, setFilename] = useState(citation.source_title || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const constrained = Boolean(maxLines);

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
        setChunks(res.chunks);

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
    const spreadsheetHtml = findSpreadsheetPreviewHtml(fileType, chunk, chunks);
    const isSpreadsheet = fileType === 'xlsx' || fileType === 'xls';
    const spreadsheetText = stripHtml(chunk.content);

    // Always render rich HTML when available (tables, formatted DOCX/XLSX content)
    if (spreadsheetHtml) {
      return <RichHtmlContent html={spreadsheetHtml} />;
    }
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

    if (isSpreadsheet) {
      return <SpreadsheetTextContent text={spreadsheetText} />;
    }

    const text = chunk.content;
    const maxChars = 400;
    const truncated = text.length > maxChars ? text.slice(0, maxChars).trimEnd() + '\u2026' : text;
    const lineClampStyle = maxLines ? { WebkitLineClamp: maxLines } : undefined;
    return (
      <p
        className={maxLines
          ? 'text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical]'
          : 'text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap'}
        style={lineClampStyle}
      >
        {maxLines ? text : truncated}
      </p>
    );
  };

  return (
    <div
      className={[
        'rounded-lg border border-stroke-subtle bg-surface overflow-hidden shadow-sm',
        constrained ? 'h-full flex flex-col' : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-subtle border-b border-stroke-subtle">
        <FileText className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
        <span className="text-xs font-medium text-text-primary truncate flex-1">
          {filename}
        </span>
      </div>

      <div className={constrained ? 'px-3 py-2.5 flex-1 min-h-0 overflow-y-auto overflow-x-hidden' : 'px-3 py-2.5'}>
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
