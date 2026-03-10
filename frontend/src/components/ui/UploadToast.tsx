'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, X } from 'lucide-react';

export interface UploadItem {
  id: string;
  filename: string;
  status: 'uploading' | 'done' | 'error';
  errorMessage?: string;
}

interface UploadToastProps {
  items: UploadItem[];
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 4000;
const TICK_MS = 80;

export function UploadToast({ items, onDismiss }: UploadToastProps) {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(1);
  const remainingRef = useRef(AUTO_DISMISS_MS);
  const lastTickRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const allSettled = items.every((i) => i.status !== 'uploading');

  // Slide-up on mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Auto-dismiss countdown — only starts once all uploads are settled
  useEffect(() => {
    if (!allSettled) return;

    remainingRef.current = AUTO_DISMISS_MS;
    lastTickRef.current = Date.now();
    setProgress(1);

    timerRef.current = setInterval(() => {
      const now = Date.now();
      remainingRef.current -= now - lastTickRef.current;
      lastTickRef.current = now;

      const next = Math.max(0, remainingRef.current / AUTO_DISMISS_MS);
      setProgress(next);

      if (remainingRef.current <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        setVisible(false);
        setTimeout(onDismiss, 200);
      }
    }, TICK_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [allSettled, onDismiss]);

  const handleDismiss = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setVisible(false);
    setTimeout(onDismiss, 200);
  };

  const doneCount = items.filter((i) => i.status === 'done').length;
  const errorCount = items.filter((i) => i.status === 'error').length;
  const uploadingCount = items.filter((i) => i.status === 'uploading').length;

  const headerLabel = uploadingCount > 0
    ? `Uploading ${items.length === 1 ? 'file' : `${uploadingCount} of ${items.length} files`}…`
    : errorCount > 0 && doneCount === 0
    ? 'Upload failed'
    : errorCount > 0
    ? `${doneCount} uploaded, ${errorCount} failed`
    : items.length === 1
    ? 'Upload complete'
    : `${doneCount} files uploaded`;

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 w-[300px] bg-white border border-divider shadow-xl flex flex-col transition-all duration-200 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      }`}
      role="status"
      aria-live="polite"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-divider">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {uploadingCount > 0 ? (
            <Loader2 className="w-3.5 h-3.5 text-accent animate-spin flex-shrink-0" />
          ) : errorCount > 0 && doneCount === 0 ? (
            <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
          )}
          <p className="text-sm font-medium text-text-primary truncate">{headerLabel}</p>
        </div>
        <button
          onClick={handleDismiss}
          className="w-5 h-5 flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors flex-shrink-0 ml-2"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* File rows */}
      <div className="px-4 py-3 space-y-2 max-h-48 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2">
            {item.status === 'uploading' && (
              <Loader2 className="w-3 h-3 text-accent animate-spin flex-shrink-0" />
            )}
            {item.status === 'done' && (
              <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />
            )}
            {item.status === 'error' && (
              <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-text-primary truncate" title={item.filename}>
                {item.filename}
              </p>
              {item.status === 'error' && item.errorMessage && (
                <p className="text-[10px] text-red-400 truncate">{item.errorMessage}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Countdown bar — drains left to right after all settled */}
      <div className="h-[3px] bg-surface-subtle overflow-hidden">
        <div
          className="h-full bg-accent origin-left"
          style={{
            transform: `scaleX(${allSettled ? progress : 1})`,
            transition: allSettled ? `transform ${TICK_MS}ms linear` : 'none',
          }}
        />
      </div>
    </div>
  );
}
