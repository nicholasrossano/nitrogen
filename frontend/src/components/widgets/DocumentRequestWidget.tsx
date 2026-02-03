'use client';

import { useRef } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { Upload, Loader2, CheckCircle } from 'lucide-react';

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
  
  const { evidenceDocs, uploadEvidence, loading, sendMessage } = useInitiativeStore();

  const handleFileSelect = async (files: FileList) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    let successCount = 0;
    let failedFiles: string[] = [];
    
    // Upload files
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!allowedTypes.includes(file.type)) {
        alert(`${file.name} is not a PDF or DOCX file. Skipping.`);
        continue;
      }
      
      try {
        await uploadEvidence(initiativeId, file);
        successCount++;
      } catch (error) {
        console.error(`Failed to upload ${file.name}:`, error);
        failedFiles.push(file.name);
      }
    }
    
    // Show results and auto-continue if at least one file succeeded
    if (failedFiles.length > 0) {
      alert(`Failed to upload: ${failedFiles.join(', ')}`);
    }
    
    if (successCount > 0) {
      // Auto-continue after upload completes
      setTimeout(() => {
        sendMessage(initiativeId, "I've uploaded my documents.");
      }, 500);
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
        <div className="flex items-center gap-3">
          {/* Upload button (styled like Inputs bar) */}
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
                Upload documents
              </>
            )}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx"
            multiple={data?.allow_multiple !== false}
            onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
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
                I don't have any documents
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
