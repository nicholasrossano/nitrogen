'use client';

import { useCallback, useRef, useState } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { FileUp, Loader2 } from 'lucide-react';
import { UploadToast, UploadItem } from '@/components/ui/UploadToast';
import { extractFilesFromDrop, filterSupportedFiles, SUPPORTED_EXTENSIONS } from '@/lib/fileUtils';

interface DocumentRequestWidgetProps {
  initiativeId: string;
  isActive?: boolean;
  data?: {
    allow_multiple?: boolean;
  };
}

export function DocumentRequestWidget({ 
  initiativeId, 
  isActive = true,
  data 
}: DocumentRequestWidgetProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const [toastItems, setToastItems] = useState<UploadItem[]>([]);
  const [showToast, setShowToast] = useState(false);

  const { uploadEvidence, sendMessage } = useInitiativeStore();

  const handleUpload = useCallback(async (files: File[]) => {
    const initial: UploadItem[] = files.map((f) => ({
      id: `${f.name}-${Date.now()}-${Math.random()}`,
      filename: f.name,
      status: 'uploading',
    }));
    setToastItems(initial);
    setShowToast(true);

    let successCount = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const item = initial[i];
      try {
        await uploadEvidence(initiativeId, file);
        successCount++;
        setToastItems((prev) =>
          prev.map((t) => (t.id === item.id ? { ...t, status: 'done' } : t))
        );
      } catch (err) {
        setToastItems((prev) =>
          prev.map((t) =>
            t.id === item.id
              ? { ...t, status: 'error', errorMessage: err instanceof Error ? err.message : 'Upload failed' }
              : t
          )
        );
      }
    }

    if (successCount > 0) {
      setTimeout(() => {
        sendMessage(initiativeId, "I've uploaded my documents.");
      }, 500);
    }
  }, [initiativeId, uploadEvidence, sendMessage]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const { accepted, rejected } = filterSupportedFiles(Array.from(e.target.files));
      if (rejected.length > 0) console.warn('Skipped unsupported files:', rejected.join(', '));
      if (accepted.length > 0) handleUpload(accepted);
      e.target.value = '';
    }
  }, [handleUpload]);

  const handleNoDocuments = useCallback(() => {
    sendMessage(initiativeId, "I don't have any documents to upload.");
  }, [initiativeId, sendMessage]);

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

  const uploading = toastItems.some((i) => i.status === 'uploading');

  if (!isActive) return null;

  return (
    <div className="border-t border-divider bg-white px-4 py-4">
      <div className="flex flex-col items-center gap-3">
        {/* Drop zone */}
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={`
            flex flex-col items-center justify-center gap-2 w-64 min-h-[120px] rounded-lg cursor-pointer
            border border-dashed transition-colors duration-150
            ${isDragging
              ? 'border-accent/60 bg-accent-wash/60'
              : 'border-[#c8c4be] bg-black/[0.04] hover:border-[#aaa69f] hover:bg-black/[0.07]'
            }
            ${uploading ? 'pointer-events-none opacity-60' : ''}
          `}
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 text-text-secondary animate-spin" />
              <span className="text-[11px] text-text-secondary">Uploading…</span>
            </>
          ) : (
            <>
              <FileUp className={`w-4 h-4 ${isDragging ? 'text-accent' : 'text-text-secondary'}`} />
              <div className="text-center">
                <span className={`text-[11px] ${isDragging ? 'text-accent' : 'text-text-secondary'}`}>
                  {isDragging ? 'Drop files here' : 'Upload files'}
                </span>
                {!isDragging && (
                  <p className="text-[10px] text-text-tertiary mt-0.5">or drag and drop</p>
                )}
              </div>
            </>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={SUPPORTED_EXTENSIONS}
          multiple={data?.allow_multiple !== false}
          onChange={handleInputChange}
          className="hidden"
        />

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
    </div>
  );
}
