'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';

import type {
  DecisionLogHistoryRow,
  AssessmentDecisionLogReport,
} from '@/lib/api';
import { api } from '@/lib/api';
import { ReadOnlyDataTable, type ReadOnlyDataTableColumn } from '@/components/ui/ReadOnlyDataTable';
import { ExportButton, WorkspaceTabLoader } from '@/components/ui';
import { EditorPanelHeaderIconButton } from '@/components/editor/EditorPanelHeader';
import {
  useHasEditorPanelChromeHost,
  useRegisterEditorPanelChrome,
} from '@/components/editor/EditorPanelChromeContext';

interface DecisionLogWorkspaceTabProps {
  assessmentInstanceId: string;
  title?: string;
}

const historyColumns: ReadOnlyDataTableColumn<DecisionLogHistoryRow>[] = [
  { key: 'stage', header: 'Stage', className: 'whitespace-nowrap min-w-[130px]' },
  { key: 'item', header: 'Item', className: 'min-w-[180px] text-text-primary' },
  { key: 'current_value', header: 'Value', className: 'min-w-[200px] text-text-primary' },
  { key: 'source_type', header: 'Source', className: 'whitespace-nowrap min-w-[130px]' },
  { key: 'source_detail', header: 'Citations', className: 'min-w-[220px]' },
  { key: 'confirmed_by', header: 'Confirmed By', className: 'whitespace-nowrap min-w-[140px]' },
  { key: 'confirmed_at', header: 'Confirmed At', className: 'whitespace-nowrap min-w-[130px]' },
];

export function DecisionLogWorkspaceTab({
  assessmentInstanceId,
  title = 'History',
}: DecisionLogWorkspaceTabProps) {
  const [report, setReport] = useState<AssessmentDecisionLogReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getAssessmentDecisionLog(assessmentInstanceId);
      setReport(next);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [assessmentInstanceId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const { blob, filename } = await api.exportAssessmentDecisionLogXlsx(assessmentInstanceId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message ?? 'History export failed');
    } finally {
      setExporting(false);
    }
  }, [assessmentInstanceId]);

  const handleExportRef = useRef(handleExport);
  handleExportRef.current = handleExport;

  const hasPanelChromeHost = useHasEditorPanelChromeHost();

  const headerActions = useMemo(
    () => (
      <EditorPanelHeaderIconButton
        label="Export"
        onClick={() => handleExportRef.current()}
        disabled={exporting}
      >
        {exporting
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <Download className="h-3.5 w-3.5" />}
      </EditorPanelHeaderIconButton>
    ),
    [exporting],
  );

  useRegisterEditorPanelChrome({
    title,
    actions: headerActions,
  });

  const historyRows = report?.history_rows ?? [];
  const subtitle = 'Value-level history for this assessment, including provenance and confirmation metadata.';

  if (loading) {
    return <WorkspaceTabLoader />;
  }

  if (error) {
    return <div className="p-6 text-sm text-red-400">{error}</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">History</h1>
            <p className="mt-1 text-sm text-text-tertiary">{subtitle}</p>
          </div>
          {!hasPanelChromeHost ? (
            <ExportButton
              onClick={handleExport}
              loading={exporting}
            />
          ) : null}
        </div>

        <ReadOnlyDataTable
          columns={historyColumns}
          rows={historyRows}
          pageSize={25}
          emptyState={
            <div className="py-20 text-center">
              <p className="text-sm font-medium text-text-secondary">No history yet</p>
              <p className="mt-1 text-xs text-text-tertiary">
                Value-level entries will appear as this assessment is generated, edited, and confirmed.
              </p>
            </div>
          }
        />
      </div>
    </div>
  );
}
