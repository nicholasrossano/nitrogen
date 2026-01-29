'use client';

import { useState, useRef } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { Upload, FileText, Loader2, X, ClipboardPaste } from 'lucide-react';

interface EvidenceInputWidgetProps {
  initiativeId: string;
}

export function EvidenceInputWidget({ initiativeId }: EvidenceInputWidgetProps) {
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
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-blue-50 to-blue-100 border-b border-blue-200">
        <h3 className="font-semibold text-blue-900">Add Evidence</h3>
        <p className="text-sm text-blue-700">Upload a document or paste text</p>
      </div>

      {/* Mode tabs */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setMode('upload')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'upload' 
              ? 'text-primary-600 border-b-2 border-primary-600' 
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Upload className="w-4 h-4 inline mr-2" />
          Upload File
        </button>
        <button
          onClick={() => setMode('paste')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'paste' 
              ? 'text-primary-600 border-b-2 border-primary-600' 
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <ClipboardPaste className="w-4 h-4 inline mr-2" />
          Paste Text
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        {mode === 'upload' ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
              ${dragActive 
                ? 'border-primary-400 bg-primary-50' 
                : 'border-gray-300 hover:border-gray-400'
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
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
                <p className="text-sm text-gray-600">Processing document...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                  <FileText className="w-6 h-6 text-gray-400" />
                </div>
                <p className="text-sm font-medium text-gray-700">
                  Drop your file here or click to browse
                </p>
                <p className="text-xs text-gray-500">
                  PDF or DOCX, max 10MB
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <input
              type="text"
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              placeholder="Document title (optional)"
              disabled={loading}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            />
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste your evidence text here..."
              disabled={loading}
              rows={6}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 resize-none"
            />
            <button
              onClick={handlePasteSubmit}
              disabled={loading || !pasteText.trim()}
              className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
    </div>
  );
}
