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

interface SpreadsheetSheetPreview {
  name: string;
  rows: string[][];
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

function extractFirstTableHtml(html: string): string {
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
  return tableMatch ? tableMatch[0] : html;
}

function normalizeSpreadsheetText(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function hasTabularRows(text: string): boolean {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.some((line) => line.includes('\t') && line.split('\t').length > 1);
}

function pickSpreadsheetPreviewChunk(
  fileType: string | null,
  selected: EvidenceChunkDetail | null,
  chunks: EvidenceChunkDetail[],
): EvidenceChunkDetail | null {
  if (!selected || (fileType !== 'xlsx' && fileType !== 'xls')) return selected;

  const selectedIdx = chunks.findIndex((c) => c.id === selected.id);
  if (selectedIdx < 0) return selected;

  const isTabularChunk = (chunk: EvidenceChunkDetail) => (
    hasTableMarkup(chunk.content_html) || hasTabularRows(normalizeSpreadsheetText(chunk.content))
  );

  if (isTabularChunk(selected)) return selected;

  const candidates = chunks
    .map((chunk, idx) => ({ chunk, idx }))
    .filter(({ chunk }) => isTabularChunk(chunk));

  if (candidates.length === 0) return selected;

  candidates.sort((a, b) => Math.abs(a.idx - selectedIdx) - Math.abs(b.idx - selectedIdx));
  return candidates[0].chunk;
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

function SpreadsheetGridContent({ rows }: { rows: string[][] }) {
  if (!rows.length) return null;

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const safeColumnCount = Math.min(columnCount, 8);
  const previewRows = rows.slice(0, 10);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <tbody>
          {previewRows.map((row, rowIdx) => (
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

function scoreRowAgainstNeedle(rowText: string, needleTokens: string[]): number {
  if (!needleTokens.length || !rowText) return 0;
  let score = 0;
  for (const token of needleTokens) {
    if (token.length < 3) continue;
    if (rowText.includes(token)) score += token.length;
  }
  return score;
}

function buildSpreadsheetSlice(
  sheets: SpreadsheetSheetPreview[],
  chunkText: string,
): string[][] | null {
  const normalizedNeedle = normalizeSpreadsheetText(chunkText).toLowerCase();
  const needleTokens = normalizedNeedle
    .split(/[\s,.;:()/_-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .slice(0, 24);

  type BestMatch = { sheet: SpreadsheetSheetPreview; rowIndex: number; score: number } | null;
  let best: BestMatch = null;

  for (const sheet of sheets) {
    const rowTexts = sheet.rows.map((row) => row.join(' ').toLowerCase());
    rowTexts.forEach((rowText, rowIndex) => {
      const score = scoreRowAgainstNeedle(rowText, needleTokens);
      if (!best || score > best.score) {
        best = { sheet, rowIndex, score };
      }
    });
  }

  if (!best || best.score <= 0) {
    const fallback = sheets.find((s) => s.rows.length > 0);
    return fallback ? fallback.rows.slice(0, 10) : null;
  }

  const start = Math.max(0, best.rowIndex - 1);
  const end = Math.min(best.sheet.rows.length, best.rowIndex + 9);
  return best.sheet.rows.slice(start, end);
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
  const [spreadsheetSheets, setSpreadsheetSheets] = useState<SpreadsheetSheetPreview[] | null>(null);
  const [spreadsheetLoading, setSpreadsheetLoading] = useState(false);
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

  useEffect(() => {
    const isSpreadsheet = fileType === 'xlsx' || fileType === 'xls';
    if (!isSpreadsheet || !citation.evidence_doc_id) {
      setSpreadsheetSheets(null);
      setSpreadsheetLoading(false);
      return;
    }

    let cancelled = false;
    setSpreadsheetLoading(true);
    setSpreadsheetSheets(null);

    (async () => {
      try {
        const bytes = await api.getEvidenceFileBytes(citation.evidence_doc_id);
        if (cancelled) return;

        const XLSX = await import('xlsx');
        const wb = XLSX.read(bytes, { type: 'array', cellText: true, raw: false });
        const parsedSheets = wb.SheetNames
          .map((name: string) => ({
            name,
            sheet: wb.Sheets[name],
          }))
          .map(({ name, sheet }: { name: string; sheet: any }) => ({
            name,
            rows: XLSX.utils.sheet_to_json(sheet, {
              header: 1,
              defval: '',
              blankrows: false,
              raw: false,
            }) as any[][]
          }))
          .map(({ name, rows }: { name: string; rows: any[][] }) => ({
            name,
            rows: rows
              .map((row) => row.map((cell) => String(cell ?? '').trim()))
              .filter((row) => row.some((cell) => cell.length > 0)),
          }))
          .filter((sheet: SpreadsheetSheetPreview) => sheet.rows.length > 0);

        if (!cancelled) {
          setSpreadsheetSheets(parsedSheets);
        }
      } catch {
        if (!cancelled) {
          setSpreadsheetSheets(null);
        }
      } finally {
        if (!cancelled) {
          setSpreadsheetLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileType, citation.evidence_doc_id]);

  const renderContent = () => {
    if (!chunk) return null;
    const isSpreadsheet = fileType === 'xlsx' || fileType === 'xls';
    const spreadsheetChunk = pickSpreadsheetPreviewChunk(fileType, chunk, chunks) ?? chunk;
    const spreadsheetText = normalizeSpreadsheetText(spreadsheetChunk.content);
    const spreadsheetHtml = spreadsheetChunk.content_html;
    const spreadsheetRows =
      isSpreadsheet && spreadsheetSheets
        ? buildSpreadsheetSlice(spreadsheetSheets, spreadsheetChunk.content)
        : null;

    // Spreadsheet citations: prioritize tabular slices over sheet-title chunks.
    if (isSpreadsheet && spreadsheetRows && spreadsheetRows.length > 0) {
      return <SpreadsheetGridContent rows={spreadsheetRows} />;
    }
    if (isSpreadsheet && spreadsheetLoading) {
      return (
        <div className="flex items-center gap-2 py-3">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
          <span className="text-xs text-text-tertiary">Loading table preview…</span>
        </div>
      );
    }
    if (isSpreadsheet && spreadsheetHtml && hasTableMarkup(spreadsheetHtml)) {
      return <RichHtmlContent html={extractFirstTableHtml(spreadsheetHtml)} />;
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

  const isSpreadsheetFile = fileType === 'xlsx' || fileType === 'xls';

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

      <div
        className={
          constrained
            ? isSpreadsheetFile
              ? 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden'
              : 'px-3 py-2.5 flex-1 min-h-0 overflow-y-auto overflow-x-hidden'
            : isSpreadsheetFile
              ? 'overflow-x-hidden'
              : 'px-3 py-2.5'
        }
      >
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
