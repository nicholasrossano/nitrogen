'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { FolderOpen } from 'lucide-react';
import { UploadToast, UploadItem } from '@/components/ui/UploadToast';
import { DuplicateFileDialog, DuplicateEntry } from '@/components/ui/DuplicateFileDialog';
import {
  extractFilesFromDrop,
  filterSupportedFiles,
  checkDuplicates,
  SUPPORTED_EXTENSIONS,
  runWithConcurrency,
  DEFAULT_UPLOAD_CONCURRENCY,
} from '@/lib/fileUtils';
import { UploadActionButton, UploadDropzone } from '@/components/upload/UploadControls';

interface DocumentRequestWidgetProps {
  initiativeId: string;
  isActive?: boolean;
  onSendMessage?: (content: string) => void | Promise<void>;
  data?: {
    allow_multiple?: boolean;
  };
}

export function DocumentRequestWidget({ 
  initiativeId, 
  isActive = true,
  onSendMessage,
  data 
}: DocumentRequestWidgetProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const [toastItems, setToastItems] = useState<UploadItem[]>([]);
  const [showToast, setShowToast] = useState(false);

  const { uploadEvidence, projectMaterials, evidenceDocs } = useInitiativeStore();

  const [pendingDuplicates, setPendingDuplicates] = useState<{
    entries: DuplicateEntry[];
    filesToUpload: File[];
    cleanCount: number;
  } | null>(null);

  const sendProgressMessage = useCallback(async (content: string) => {
    if (onSendMessage) {
      await onSendMessage(content);
      return;
    }
    window.dispatchEvent(new CustomEvent('nitrogen:draft', {
      detail: {
        text: content,
        label: null,
      },
    }));
  }, [onSendMessage]);

  const doUpload = useCallback(async (filesToUpload: File[]) => {
    const initial: UploadItem[] = filesToUpload.map((f) => ({
      id: `${f.name}-${Date.now()}-${Math.random()}`,
      filename: f.name,
      status: 'uploading',
    }));
    // Merge with any in-flight items so concurrent calls (e.g. clean + renamed
    // duplicates) share one toast.
    setToastItems((prev) => [...prev, ...initial]);
    setShowToast(true);

    let successCount = 0;
    await runWithConcurrency(
      filesToUpload,
      DEFAULT_UPLOAD_CONCURRENCY,
      async (file, i) => {
        const item = initial[i];
        try {
          await uploadEvidence(initiativeId, file);
          successCount++;
          // Upload finished → backend is now processing in the background.
          // The effect below will flip this to 'done' once processing_status
          // reaches 'indexed'/'lightweight_ready', or to 'error' on failure.
          setToastItems((prev) =>
            prev.map((t) =>
              t.id === item.id ? { ...t, status: 'processing' } : t,
            ),
          );
        } catch (err) {
          setToastItems((prev) =>
            prev.map((t) =>
              t.id === item.id
                ? {
                    ...t,
                    status: 'error',
                    errorMessage: err instanceof Error ? err.message : 'Upload failed',
                  }
                : t
            )
          );
        }
      },
    );

    if (successCount > 0) {
      await sendProgressMessage("I've uploaded my documents.");
    }
  }, [uploadEvidence, initiativeId, sendProgressMessage]);

  // Advance toast items from 'processing' to 'done'/'error' based on the
  // backend's per-doc lifecycle. We match by filename since the upload call
  // doesn't hand back the server-side doc id to the toast item directly.
  useEffect(() => {
    setToastItems((prev) => {
      if (prev.length === 0) return prev;
      let changed = false;
      const next = prev.map((t) => {
        if (t.status !== 'processing') return t;
        const match = evidenceDocs.find((d) => d.filename === t.filename);
        if (!match?.processing_status) return t;
        if (
          match.processing_status === 'indexed' ||
          match.processing_status === 'lightweight_ready'
        ) {
          changed = true;
          return { ...t, status: 'done' as const };
        }
        if (match.processing_status === 'failed') {
          changed = true;
          return {
            ...t,
            status: 'error' as const,
            errorMessage: match.processing_error || 'Processing failed',
          };
        }
        return t;
      });
      return changed ? next : prev;
    });
  }, [evidenceDocs]);

  const handleUpload = useCallback(async (files: File[]) => {
    const existingNames = projectMaterials.map((m) => m.filename);
    const results = checkDuplicates(files, existingNames);
    const duplicates = results.filter((r) => r.isDuplicate);
    const clean = results.filter((r) => !r.isDuplicate).map((r) => r.file);

    if (duplicates.length > 0) {
      const renamedDuplicates = duplicates.map(
        (r) => new File([r.file], r.newName, { type: r.file.type }),
      );
      setPendingDuplicates({
        entries: duplicates.map((d) => ({ original: d.file.name, renamed: d.newName })),
        filesToUpload: renamedDuplicates,
        cleanCount: clean.length,
      });
      if (clean.length > 0) doUpload(clean);
    } else {
      doUpload(files);
    }
  }, [projectMaterials, doUpload]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const { accepted, rejected } = filterSupportedFiles(Array.from(e.target.files));
      if (rejected.length > 0) console.warn('Skipped unsupported files:', rejected.join(', '));
      if (accepted.length > 0) handleUpload(accepted);
      e.target.value = '';
    }
  }, [handleUpload]);

  // Only disable the dropzone / CTA while bytes are still in flight — once a
  // file's bytes are uploaded, the user can continue onboarding even though
  // the backend is still processing.
  const uploading = toastItems.some((i) => i.status === 'uploading');

  const handleFolderSelect = useCallback(() => {
    if (uploading) return;
    folderInputRef.current?.click();
  }, [uploading]);

  const handleNoDocuments = useCallback(() => {
    void sendProgressMessage("I don't have any documents to upload.");
  }, [sendProgressMessage]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    const all = await extractFilesFromDrop(e.dataTransfer);
    const { accepted, rejected } = filterSupportedFiles(all);
    if (rejected.length > 0) console.warn('Skipped unsupported files:', rejected.join(', '));
    if (accepted.length > 0) handleUpload(accepted);
  }, [handleUpload]);

  if (!isActive) return null;

  return (
    <div className="border-t border-divider bg-white px-4 py-4">
      <div className="flex flex-col items-center gap-3">
        {/* Drop zone */}
        <UploadDropzone
          isDragging={isDragging}
          uploading={uploading}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
          dragLabel="Drop files or folder"
          idleLabel="Upload files"
          className="w-64 min-h-[140px] px-2"
        />

        <input
          ref={fileInputRef}
          type="file"
          accept={SUPPORTED_EXTENSIONS}
          multiple={data?.allow_multiple !== false}
          onChange={handleInputChange}
          className="hidden"
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          onChange={handleInputChange}
          className="hidden"
          {...{ webkitdirectory: '' }}
        />

        {!uploading && (
          <div className="flex items-center">
            <UploadActionButton
              onClick={handleFolderSelect}
              icon={<FolderOpen className="w-4 h-4" />}
              label="Select folder"
            />
          </div>
        )}

        {/* No documents option */}
        {!uploading && (
          <>
            <span className="text-sm text-text-tertiary">or</span>
            <button onClick={handleNoDocuments} className="upload-btn border-solid">
              I don&apos;t have any documents
            </button>
          </>
        )}
      </div>

      {showToast && (
        <UploadToast
          items={toastItems}
          onDismiss={() => {
            setShowToast(false);
            setToastItems([]);
          }}
        />
      )}

      {pendingDuplicates && (
        <DuplicateFileDialog
          duplicates={pendingDuplicates.entries}
          cleanCount={pendingDuplicates.cleanCount}
          onConfirm={(selectedOriginals) => {
            const selected = new Set(selectedOriginals);
            const files = pendingDuplicates.filesToUpload.filter((_, i) =>
              selected.has(pendingDuplicates.entries[i].original),
            );
            setPendingDuplicates(null);
            if (files.length > 0) doUpload(files);
          }}
          onCancel={() => setPendingDuplicates(null)}
        />
      )}
    </div>
  );
}
