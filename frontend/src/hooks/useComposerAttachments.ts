'use client';

import { useCallback, useState } from 'react';
import type { UploadItem } from '@/components/ui/UploadToast';
import type { MessageAttachment } from '@/lib/api';

/**
 * Shared file-attachment state for chat composers (LandingInput, ConversationView).
 * Filters unsupported files up front (surfacing a visible error via UploadToast
 * instead of silently dropping them), uploads accepted files on send, and hands
 * back only the attachments that actually succeeded so the caller can attach
 * them to the outgoing message.
 */
export function useComposerAttachments() {
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [toastItems, setToastItems] = useState<UploadItem[]>([]);
  const [showToast, setShowToast] = useState(false);
  const [uploading, setUploading] = useState(false);

  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    // Lazy import: fileUtils is tiny, but keeps this hook usable without pulling
    // it into every bundle that only needs the state shape.
    void import('@/lib/fileUtils').then(({ filterSupportedFiles, SUPPORTED_FILE_LABEL }) => {
      const { accepted, rejected } = filterSupportedFiles(files);
      if (accepted.length > 0) setAttachedFiles((prev) => [...prev, ...accepted]);
      if (rejected.length > 0) {
        setToastItems((prev) => [
          ...prev,
          ...rejected.map((name) => ({
            id: `${name}-${Date.now()}-${Math.random()}`,
            filename: name,
            status: 'error' as const,
            errorMessage: `Unsupported file type. Supported: ${SUPPORTED_FILE_LABEL}`,
          })),
        ]);
        setShowToast(true);
      }
    });
  }, []);

  const removeFile = useCallback((index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const dismissToast = useCallback(() => {
    setShowToast(false);
    setToastItems([]);
  }, []);

  /**
   * Upload every pending attached file and return metadata only for the ones
   * that succeeded (failures are surfaced via the toast and simply omitted —
   * the message still sends with whatever attachments did make it through).
   */
  const uploadAndCollect = useCallback(
    async (
      onUploadFile: (file: File) => Promise<MessageAttachment | null>,
    ): Promise<MessageAttachment[]> => {
      const files = attachedFiles;
      if (files.length === 0) return [];

      const { runWithConcurrency, DEFAULT_UPLOAD_CONCURRENCY } = await import('@/lib/fileUtils');

      setUploading(true);
      const initial: UploadItem[] = files.map((f) => ({
        id: `${f.name}-${Date.now()}-${Math.random()}`,
        filename: f.name,
        status: 'uploading',
      }));
      setToastItems((prev) => [...prev, ...initial]);
      setShowToast(true);

      const results: (MessageAttachment | null)[] = new Array(files.length).fill(null);
      await runWithConcurrency(files, DEFAULT_UPLOAD_CONCURRENCY, async (file, i) => {
        const item = initial[i];
        try {
          const attachment = await onUploadFile(file);
          results[i] = attachment;
          setToastItems((prev) =>
            prev.map((t) => (t.id === item.id ? { ...t, status: 'done' as const } : t)),
          );
        } catch (err) {
          setToastItems((prev) =>
            prev.map((t) =>
              t.id === item.id
                ? {
                    ...t,
                    status: 'error' as const,
                    errorMessage: err instanceof Error ? err.message : 'Upload failed',
                  }
                : t,
            ),
          );
        }
      });

      setUploading(false);
      setAttachedFiles([]);
      return results.filter((r): r is MessageAttachment => r !== null);
    },
    [attachedFiles],
  );

  const reset = useCallback(() => {
    setAttachedFiles([]);
  }, []);

  return {
    attachedFiles,
    addFiles,
    removeFile,
    reset,
    uploading,
    uploadAndCollect,
    toastItems,
    showToast,
    dismissToast,
  };
}
