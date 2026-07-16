'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ZoomableContainer } from './ZoomableContainer';

interface DocxViewerProps {
  fileData: ArrayBuffer;
}

export function DocxViewer({ fileData }: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const styleContainerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const body = containerRef.current;
    const styles = styleContainerRef.current;
    if (!body || !styles || !fileData) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { renderAsync } = await import('docx-preview');
        if (cancelled) return;
        // Keep styles in a separate host — rewriting body.innerHTML after render
        // (e.g. via DOMPurify) strips the stylesheet nodes docx-preview injects.
        await renderAsync(fileData, body, styles, {
          className: 'docx',
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
      } catch {
        if (!cancelled) {
          setError('Failed to render DOCX document');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      body.innerHTML = '';
      styles.innerHTML = '';
    };
  }, [fileData]);

  return (
    <div className="flex h-full flex-col">
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            <span className="text-xs text-text-tertiary">Rendering document…</span>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-text-tertiary">{error}</p>
        </div>
      )}

      {/* Stylesheet host for docx-preview (style tags only — not visually rendered). */}
      <div ref={styleContainerRef} className="docx-viewer-styles" />

      <ZoomableContainer className="docx-viewer-host flex-1 bg-surface">
        <div ref={containerRef} />
      </ZoomableContainer>
    </div>
  );
}
