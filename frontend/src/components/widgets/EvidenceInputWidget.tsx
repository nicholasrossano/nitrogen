'use client';

import { useState, useRef } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { Upload, FileText, Loader2, ClipboardPaste } from 'lucide-react';

interface EvidenceInputWidgetProps {
  initiativeId: string;
  isActive?: boolean;
}

export function EvidenceInputWidget({ initiativeId, isActive = true }: EvidenceInputWidgetProps) {
  const [mode, setMode] = useState<'upload' | 'paste'>('upload');
  const [pasteText, setPasteText] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { uploadEvidence, pasteEvidence, loading } = useInitiativeStore();

  const handleFileSelect = async (file: File) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (!allowedTypes.includes(file.type)) {
      alert('Please upload a PDF or DOCX file');
      return;
    }

    await uploadEvidence(initiativeId, file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handlePasteSubmit = async () => {
    if (!pasteText.trim()) return;
    await pasteEvidence(initiativeId, pasteText, pasteTitle || undefined);
  };

  return (
    <div className="card-elevated overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 bg-surface-subtle border-b border-divider">
        <h3 className="font-semibold text-text-primary">Add Evidence</h3>
        <p className="text-sm text-text-secondary">Upload a document or paste text</p>
      </div>

      {/* Mode tabs */}
      <div className="flex border-b border-divider bg-white">
        <button
          onClick={() => setMode('upload')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors duration-150 ${
            mode === 'upload' 
              ? 'text-accent border-b-2 border-accent bg-accent-wash/30' 
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-subtle'
          }`}
        >
          <Upload className="w-4 h-4 inline mr-2" />
          Upload File
        </button>
        <button
          onClick={() => setMode('paste')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors duration-150 ${
            mode === 'paste' 
              ? 'text-accent border-b-2 border-accent bg-accent-wash/30' 
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-subtle'
          }`}
        >
          <ClipboardPaste className="w-4 h-4 inline mr-2" />
          Paste Text
        </button>
      </div>

      {/* Content - only show interactive parts when active */}
      {isActive && (
        <div className="p-5 bg-white">
          {mode === 'upload' ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`
              border-2 border-dashed rounded p-10 text-center cursor-pointer transition-colors duration-150
              ${dragActive 
                ? 'border-accent bg-accent-wash/30' 
                : 'border-stroke-subtle hover:border-accent hover:bg-surface-subtle'
              }
              ${loading ? 'pointer-events-none opacity-50' : ''}
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              className="hidden"
            />
            
            {loading ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-10 h-10 text-accent animate-spin" />
                <p className="text-sm text-text-secondary font-medium">Processing document...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded bg-accent-wash flex items-center justify-center">
                  <FileText className="w-6 h-6 text-accent" />
                </div>
                <p className="text-sm font-medium text-text-primary">
                  Drop your file here or click to browse
                </p>
                <p className="text-xs text-text-tertiary">
                  PDF or DOCX, max 10MB
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <input
              type="text"
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              placeholder="Document title (optional)"
              disabled={loading}
              className="input-field"
            />
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste your evidence text here..."
              disabled={loading}
              rows={6}
              className="input-field resize-none"
            />
            <button
              onClick={handlePasteSubmit}
              disabled={loading || !pasteText.trim()}
              className="btn-primary w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4" />
                  Add Text as Evidence
                </>
              )}
            </button>
          </div>
          )}
        </div>
      )}
      
      {/* Show completed state when not active */}
      {!isActive && (
        <div className="p-5 bg-white text-center">
          <p className="text-sm text-text-secondary">Evidence uploaded</p>
        </div>
      )}
    </div>
  );
}
