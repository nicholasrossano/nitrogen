'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface PdfViewerProps {
  fileData: ArrayBuffer;
  initialPage?: number | null;
}

export function PdfViewer({ fileData, initialPage }: PdfViewerProps) {
  const [error, setError] = useState(false);

  const blobUrl = useMemo(() => {
    try {
      const blob = new Blob([fileData], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const page = initialPage && initialPage > 1 ? `page=${initialPage}&` : '';
      // Keep the built-in PDF UI cleaner by default:
      // - hide left navigation panes/thumbnails
      // - open at 90% zoom
      return `${url}#${page}navpanes=0&pagemode=none&zoom=90`;
    } catch {
      setError(true);
      return null;
    }
  }, [fileData, initialPage]);

  useEffect(() => {
    return () => {
      if (blobUrl) {
        const base = blobUrl.split('#')[0];
        URL.revokeObjectURL(base);
      }
    };
  }, [blobUrl]);

  if (error || !blobUrl) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <p className="text-sm text-text-tertiary">Failed to load PDF</p>
      </div>
    );
  }

  return (
    <iframe
      src={blobUrl}
      className="w-full h-full border-0"
      title="PDF document"
    />
  );
}
