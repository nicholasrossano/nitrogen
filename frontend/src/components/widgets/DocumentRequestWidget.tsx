'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { FileUp, FolderOpen, HardDriveDownload, Loader2 } from 'lucide-react';
import { UploadToast, UploadItem } from '@/components/ui/UploadToast';
import { DuplicateFileDialog, DuplicateEntry } from '@/components/ui/DuplicateFileDialog';
import { extractFilesFromDrop, filterSupportedFiles, checkDuplicates, SUPPORTED_EXTENSIONS } from '@/lib/fileUtils';
import { useGoogleDriveStore } from '@/stores/googleDriveStore';
import { warmGooglePicker } from '@/lib/googlePicker';
import { importFromDriveViaPicker } from '@/lib/driveImport';

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

  const { uploadEvidence, sendMessage: sendLegacyMessage, projectMaterials, importFromDrive } = useInitiativeStore();
  const driveConnected = useGoogleDriveStore((s) => s.connected);
  const connectDrive = useGoogleDriveStore((s) => s.connect);
  const getDriveAccessToken = useGoogleDriveStore((s) => s.getAccessToken);
  const [driveImporting, setDriveImporting] = useState(false);
  const [driveConnecting, setDriveConnecting] = useState(false);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) return;

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const idleCallbackId = window.requestIdleCallback(() => warmGooglePicker(), { timeout: 2000 });
      return () => window.cancelIdleCallback(idleCallbackId);
    }

    const timer = window.setTimeout(() => warmGooglePicker(), 250);
    return () => window.clearTimeout(timer);
  }, []);

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
    await sendLegacyMessage(initiativeId, content);
  }, [initiativeId, onSendMessage, sendLegacyMessage]);

  const doUpload = useCallback(async (filesToUpload: File[]) => {
    const initial: UploadItem[] = filesToUpload.map((f) => ({
      id: `${f.name}-${Date.now()}-${Math.random()}`,
      filename: f.name,
      status: 'uploading',
    }));
    setToastItems(initial);
    setShowToast(true);

    let successCount = 0;
    for (let i = 0; i < filesToUpload.length; i++) {
      const file = filesToUpload[i];
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
      await sendProgressMessage("I've uploaded my documents.");
    }
  }, [uploadEvidence, initiativeId, sendProgressMessage]);

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

  const uploading = toastItems.some((i) => i.status === 'uploading');

  const handleFolderSelect = useCallback(() => {
    if (uploading) return;
    folderInputRef.current?.click();
  }, [uploading]);

  const handleDriveImport = useCallback(async () => {
    if (!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || uploading || driveImporting) return;
    try {
      setDriveConnecting(!driveConnected);
      setDriveImporting(driveConnected);
      const { importedCount } = await importFromDriveViaPicker({
        initiativeId,
        driveConnected,
        connectDrive,
        getDriveAccessToken,
        importFromDrive,
      });
      if (importedCount > 0) {
        await sendProgressMessage("I've uploaded my documents.");
      }
    } catch (err) {
      console.error('Could not open Drive picker:', err);
    } finally {
      setDriveConnecting(false);
      setDriveImporting(false);
    }
  }, [
    connectDrive,
    driveConnected,
    driveImporting,
    getDriveAccessToken,
    importFromDrive,
    initiativeId,
    sendProgressMessage,
    uploading,
  ]);

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
        <input
          ref={folderInputRef}
          type="file"
          multiple
          onChange={handleInputChange}
          className="hidden"
          {...{ webkitdirectory: '' }}
        />

        {!uploading && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleFolderSelect}
              className="btn-secondary !px-3 !py-1.5 text-xs"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Upload folder
            </button>
            {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
              <button
                type="button"
                onClick={() => void handleDriveImport()}
                disabled={driveConnecting || driveImporting}
                className="btn-secondary !px-3 !py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {driveConnecting || driveImporting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <HardDriveDownload className="w-3.5 h-3.5" />
                )}
                Import from Drive
              </button>
            )}
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
