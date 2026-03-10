'use client';

import { useState } from 'react';
import {
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileText,
  FileSpreadsheet,
  ArrowLeft,
} from 'lucide-react';
import { api } from '@/lib/api';

interface TemplateRequirement {
  id: string;
  label: string;
  category: string;
  status: string;
  value: string | null;
  is_calculated: boolean;
}

interface TemplateViewerWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
  onRefine?: () => void;
}

export function TemplateViewerWidget({
  data,
  initiativeId,
  isActive = true,
  onRefine,
}: TemplateViewerWidgetProps) {
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  const filename: string = data?.filename || 'document';
  const fileType: string = data?.file_type || 'docx';
  const templateId: string = data?.template_id || '';
  const requirements: TemplateRequirement[] = data?.requirements || [];
  const outputPath: string = data?.output_path || '';

  const categories = Array.from(new Set(requirements.map((r) => r.category)));

  const supported = requirements.filter((r) => r.status === 'supported').length;
  const total = requirements.length;
  const unfilled = requirements.filter((r) => r.status === 'missing').length;

  const isXlsx = fileType === 'xlsx';
  const FileIcon = isXlsx ? FileSpreadsheet : FileText;

  const handleExport = async () => {
    if (!templateId) return;
    setExporting(true);
    try {
      const token = await (async () => {
        if (typeof window === 'undefined') return null;
        try {
          const { getAuth } = await import('firebase/auth');
          const { app } = await import('@/lib/firebase');
          const auth = getAuth(app);
          return auth.currentUser ? await auth.currentUser.getIdToken() : null;
        } catch { return null; }
      })();

      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

      const resp = await fetch(`${API_URL}/api/v1/template/${templateId}/export`, { headers });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      api.triggerBlobDownload(blob, filename);
      setExported(true);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="card-elevated overflow-hidden h-full rounded-none flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 bg-surface-header border-b border-divider">
        <div className="flex items-center gap-2 mb-1">
          <FileIcon className={`w-4 h-4 ${isXlsx ? 'text-green-600' : 'text-accent'}`} />
          <h3 className="text-sm font-semibold text-text-primary truncate">{filename}</h3>
        </div>
        <p className="text-[11px] text-text-tertiary">
          {supported} of {total} fields populated
          {unfilled > 0 && <span className="text-amber-600"> &middot; {unfilled} left blank</span>}
        </p>
      </div>

      {/* Content preview */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {categories.map((cat) => {
          const catReqs = requirements.filter((r) => r.category === cat);
          return (
            <div key={cat} className="mb-4">
              <h4 className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
                {cat}
              </h4>
              <div className="space-y-1">
                {catReqs.map((req) => (
                  <div key={req.id} className="flex items-start gap-2 py-1">
                    {req.value ? (
                      <CheckCircle2 className="w-3 h-3 mt-0.5 text-green-500 shrink-0" />
                    ) : (
                      <AlertCircle className="w-3 h-3 mt-0.5 text-red-400 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="text-xs text-text-secondary">{req.label}</span>
                      {req.value && (
                        <p className="text-xs font-medium text-text-primary mt-0.5">{req.value}</p>
                      )}
                      {!req.value && !req.is_calculated && (
                        <p className="text-[11px] text-text-tertiary italic mt-0.5">Not provided</p>
                      )}
                      {req.is_calculated && (
                        <p className="text-[11px] text-purple-600 mt-0.5">Calculated field</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 p-4 border-t border-divider bg-surface-header flex flex-col items-center gap-2">
        {onRefine && (
          <button
            type="button"
            onClick={onRefine}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-secondary rounded-lg border border-stroke-subtle hover:bg-surface-subtle transition-colors"
          >
            <ArrowLeft className="w-3 h-3" /> Refine
          </button>
        )}
        <button
          type="button"
          onClick={handleExport}
          disabled={!isActive || exporting}
          className="btn-primary !text-xs !px-4 !py-1.5"
          style={{ width: '40%' }}
        >
          {exporting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Exporting...
            </>
          ) : exported ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Downloaded
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              Export {fileType.toUpperCase()}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
