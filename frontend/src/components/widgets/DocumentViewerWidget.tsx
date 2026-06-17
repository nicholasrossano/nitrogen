'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import type { EvidenceChunkDetail } from '@/lib/api';
import { ZoomableContainer } from '@/components/viewers/ZoomableContainer';
import { WorkspaceTabLoader } from '@/components/ui';

const PdfViewer = dynamic(
  () => import('@/components/viewers/PdfViewer').then((m) => m.PdfViewer),
  { ssr: false, loading: () => <ViewerSkeleton /> },
);
const DocxViewer = dynamic(
  () => import('@/components/viewers/DocxViewer').then((m) => m.DocxViewer),
  { ssr: false, loading: () => <ViewerSkeleton /> },
);
const XlsxViewer = dynamic(
  () => import('@/components/viewers/XlsxViewer').then((m) => m.XlsxViewer),
  { ssr: false, loading: () => <ViewerSkeleton /> },
);

function ViewerSkeleton() {
  return <WorkspaceTabLoader />;
}

interface DocumentViewerWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
  onClose?: () => void;
}

type FileType = 'pdf' | 'docx' | 'xlsx' | 'xls' | 'text' | string;

export function DocumentViewerWidget({ data, isActive, onClose }: DocumentViewerWidgetProps) {
  const evidenceDocId = data.evidence_doc_id as string | undefined;
  const projectMaterialId = data.project_material_id as string | undefined;
  const declaredFileType = data.file_type as string | undefined;
  const chunkId = data.chunk_id as string | null | undefined;

  const [fileType, setFileType] = useState<FileType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Native viewer state
  const [fileData, setFileData] = useState<ArrayBuffer | null>(null);
  const [initialPage, setInitialPage] = useState<number | null>(null);

  // Fallback plain-text state
  const [chunks, setChunks] = useState<EvidenceChunkDetail[]>([]);
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!evidenceDocId && !projectMaterialId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFileData(null);
    setChunks([]);
    setFileType(null);
    setInitialPage(null);

    (async () => {
      try {
        if (projectMaterialId && !evidenceDocId) {
          const ft = declaredFileType || 'text';
          setFileType(ft);
          const bytes = await api.getMaterialFileBytes(projectMaterialId);
          if (cancelled) return;

          if (['pdf', 'docx', 'xlsx', 'xls'].includes(ft)) {
            setFileData(bytes);
            return;
          }

          const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
          setChunks([{ id: 'full', chunk_index: 0, content: text }]);
          return;
        }

        const chunkRes = await api.getEvidenceChunks(evidenceDocId!);
        if (cancelled) return;

        const ft = chunkRes.file_type || 'text';
        setFileType(ft);

        if (chunkId) {
          const match = chunkRes.chunks.find((c: EvidenceChunkDetail) => c.id === chunkId);
          if (match?.page_number) {
            setInitialPage(match.page_number);
          }
        }

        const isNative = ['pdf', 'docx', 'xlsx', 'xls'].includes(ft);

        if (isNative) {
          try {
            const bytes = await api.getEvidenceFileBytes(evidenceDocId!);
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
        if (evidenceDocId) {
          try {
            const res = await api.getEvidenceContent(evidenceDocId);
            if (cancelled) return;
            setFileType(res.file_type || 'text');
            setChunks([{ id: 'full', chunk_index: 0, content: res.content }]);
          } catch {
            if (!cancelled) setError('Could not load document');
          }
        } else if (!cancelled) {
          setError('Could not load document');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [evidenceDocId, projectMaterialId, declaredFileType, chunkId]);

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
    return <WorkspaceTabLoader />;
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
      <div className="h-full flex flex-col relative">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-2 right-2 z-10 w-7 h-7 flex items-center justify-center rounded bg-white/80 hover:bg-surface-subtle transition-colors text-text-tertiary hover:text-text-secondary"
            aria-label="Close document viewer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
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
    <div className="h-full flex flex-col relative">
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-2 right-2 z-10 w-7 h-7 flex items-center justify-center rounded bg-white/80 hover:bg-surface-subtle transition-colors text-text-tertiary hover:text-text-secondary"
          aria-label="Close document viewer"
        >
          <X className="w-4 h-4" />
        </button>
      )}
      <ZoomableContainer className="flex-1 px-5 py-4">
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
      </ZoomableContainer>
    </div>
  );
}
