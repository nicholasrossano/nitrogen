'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { FileText, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { EvidenceChunkDetail } from '@/lib/api';

const PdfViewer = dynamic(
  () => import('@/components/viewers/PdfViewer').then((m) => m.PdfViewer),
  { ssr: false, loading: () => <ViewerSkeleton label="Loading PDF viewer…" /> },
);
const DocxViewer = dynamic(
  () => import('@/components/viewers/DocxViewer').then((m) => m.DocxViewer),
  { ssr: false, loading: () => <ViewerSkeleton label="Loading document viewer…" /> },
);
const XlsxViewer = dynamic(
  () => import('@/components/viewers/XlsxViewer').then((m) => m.XlsxViewer),
  { ssr: false, loading: () => <ViewerSkeleton label="Loading spreadsheet viewer…" /> },
);

function ViewerSkeleton({ label }: { label: string }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-accent" />
        <span className="text-xs text-text-tertiary">{label}</span>
      </div>
    </div>
  );
}

interface DocumentViewerWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
}

type FileType = 'pdf' | 'docx' | 'xlsx' | 'xls' | 'text' | string;

export function DocumentViewerWidget({ data, isActive }: DocumentViewerWidgetProps) {
  const evidenceDocId = data.evidence_doc_id as string | undefined;
  const chunkId = data.chunk_id as string | null | undefined;
  const sourceTitle = data.source_title as string | undefined;

  const [fileType, setFileType] = useState<FileType | null>(null);
  const [filename, setFilename] = useState(sourceTitle || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Native viewer state
  const [fileData, setFileData] = useState<ArrayBuffer | null>(null);
  const [initialPage, setInitialPage] = useState<number | null>(null);

  // Fallback plain-text state
  const [chunks, setChunks] = useState<EvidenceChunkDetail[]>([]);
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!evidenceDocId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const chunkRes = await api.getEvidenceChunks(evidenceDocId);
        if (cancelled) return;

        const ft = chunkRes.file_type || 'text';
        setFileType(ft);
        if (chunkRes.filename) setFilename(chunkRes.filename);

        if (chunkId) {
          const match = chunkRes.chunks.find((c: EvidenceChunkDetail) => c.id === chunkId);
          if (match?.page_number) {
            setInitialPage(match.page_number);
          }
        }

        const isNative = ['pdf', 'docx', 'xlsx', 'xls'].includes(ft);

        if (isNative) {
          try {
            const bytes = await api.getEvidenceFileBytes(evidenceDocId);
            if (cancelled) return;
            setFileData(bytes);
          } catch {
            if (cancelled) return;
            setChunks(chunkRes.chunks);
          }
        } else {
          setChunks(chunkRes.chunks);
        }
      } catch {
        if (cancelled) return;
        try {
          const res = await api.getEvidenceContent(evidenceDocId);
          if (cancelled) return;
          setFileType(res.file_type || 'text');
          setChunks([{ id: 'full', chunk_index: 0, content: res.content }]);
          if (res.filename) setFilename(res.filename);
        } catch {
          if (!cancelled) setError('Could not load document');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [evidenceDocId, chunkId]);

  const scrollToHighlight = useCallback(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  useEffect(() => {
    if (!loading && chunkId && chunks.length > 0) {
      const timer = setTimeout(scrollToHighlight, 150);
      return () => clearTimeout(timer);
    }
  }, [loading, chunkId, chunks.length, scrollToHighlight]);

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

  // Native viewers
  if (fileData) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-divider flex-shrink-0">
          <FileText className="w-4 h-4 text-text-tertiary flex-shrink-0" />
          <h3 className="text-sm font-medium text-text-primary truncate">{filename}</h3>
        </div>
        <div className="flex-1 min-h-0">
          {fileType === 'pdf' && (
            <PdfViewer fileData={fileData} initialPage={initialPage} />
          )}
          {fileType === 'docx' && (
            <DocxViewer fileData={fileData} />
          )}
          {(fileType === 'xlsx' || fileType === 'xls') && (
            <XlsxViewer fileData={fileData} />
          )}
        </div>
      </div>
    );
  }

  // Fallback: plain-text chunk rendering
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
