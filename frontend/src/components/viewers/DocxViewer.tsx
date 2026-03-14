'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ZoomableContainer } from './ZoomableContainer';

interface DocxViewerProps {
  fileData: ArrayBuffer;
}

export function DocxViewer({ fileData }: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !fileData) return;

    let cancelled = false;
    const container = containerRef.current;

    (async () => {
      try {
        const { renderAsync } = await import('docx-preview');
        if (cancelled) return;
        container.innerHTML = '';
        await renderAsync(fileData, container, undefined, {
          className: 'docx-preview-wrapper',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
        });
      } catch (e) {
        if (!cancelled) {
          setError('Failed to render DOCX document');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileData]);

  return (
    <div className="flex flex-col h-full">
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
            <span className="text-xs text-text-tertiary">Rendering document…</span>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-text-tertiary">{error}</p>
        </div>
      )}

      <ZoomableContainer className="flex-1 bg-[#e8e5e0] docx-viewer-host">
        <div ref={containerRef} />
      </ZoomableContainer>

      <style jsx global>{`
        .docx-viewer-host .docx-preview-wrapper {
          padding: 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .docx-viewer-host .docx-preview-wrapper > section.docx {
          background: white;
          box-shadow: 0 1px 4px rgba(0,0,0,0.12);
          margin: 0 auto;
        }
      `}</style>
    </div>
  );
}
