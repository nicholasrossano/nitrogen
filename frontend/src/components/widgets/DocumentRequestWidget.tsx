'use client';

import { useRef } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { Upload, Loader2, CheckCircle, FolderOpen } from 'lucide-react';
import { filterSupportedFiles, SUPPORTED_EXTENSIONS } from '@/lib/fileUtils';

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
  const folderInputRef = useRef<HTMLInputElement>(null);
  
  const { evidenceDocs, uploadEvidence, loading, sendMessage } = useInitiativeStore();

  const handleFiles = async (files: File[]) => {
    const { accepted, rejected } = filterSupportedFiles(files);
    if (rejected.length > 0) {
      alert(`Skipped unsupported files:\n${rejected.join('\n')}`);
    }

    let successCount = 0;
    const failedFiles: string[] = [];

    for (const file of accepted) {
      try {
        await uploadEvidence(initiativeId, file);
        successCount++;
      } catch (error) {
        console.error(`Failed to upload ${file.name}:`, error);
        failedFiles.push(file.name);
      }
    }

    if (failedFiles.length > 0) {
      alert(`Failed to upload: ${failedFiles.join(', ')}`);
    }

    if (successCount > 0) {
      setTimeout(() => {
        sendMessage(initiativeId, "I've uploaded my documents.");
      }, 500);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  };

  const handleNoDocuments = () => {
    sendMessage(initiativeId, "I don't have any documents to upload.");
  };

  if (!isActive) {
    return null;
  }

  return (
    <div className="border-t border-divider bg-white px-4 py-3">
      <div className="flex flex-col items-center gap-3">
        {/* Show uploaded files if any */}
        {evidenceDocs.length > 0 && (
          <div className="flex items-center gap-2">
            {evidenceDocs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-2 px-3 py-2 bg-surface-grey border border-stroke-subtle rounded text-sm"
              >
                <CheckCircle className="w-4 h-4 text-indicator-green flex-shrink-0" />
                <span className="text-text-primary truncate max-w-[150px]">
                  {doc.filename}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Buttons - centered */}
        <div className="flex items-center gap-3 flex-wrap justify-center">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="upload-btn"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Upload files
              </>
            )}
          </button>

          <button
            onClick={() => folderInputRef.current?.click()}
            disabled={loading}
            className="upload-btn"
          >
            <FolderOpen className="w-4 h-4" />
            Upload folder
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept={SUPPORTED_EXTENSIONS}
            multiple={data?.allow_multiple !== false}
            onChange={handleInputChange}
            className="hidden"
          />
          {/* webkitdirectory lets the user pick an entire folder */}
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error webkitdirectory is non-standard
            webkitdirectory=""
            multiple
            onChange={handleInputChange}
            className="hidden"
          />

          {/* No documents button */}
          {evidenceDocs.length === 0 && !loading && (
            <>
              <span className="text-sm text-text-tertiary">or</span>
              <button
                onClick={handleNoDocuments}
                className="upload-btn border-solid"
              >
                I don&apos;t have any documents
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
