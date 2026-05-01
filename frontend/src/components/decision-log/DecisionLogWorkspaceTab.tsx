'use client';

import { useCallback, useEffect, useState } from 'react';

import type {
  DecisionLogHistoryRow,
  AssessmentDecisionLogReport,
} from '@/lib/api';
import { api } from '@/lib/api';
import { ReadOnlyDataTable, type ReadOnlyDataTableColumn } from '@/components/ui/ReadOnlyDataTable';
import { ExportButton, WorkspaceTabLoader } from '@/components/ui';

interface DecisionLogWorkspaceTabProps {
  assessmentInstanceId: string;
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
      setError(e.message ?? 'Failed to load decision log');
    } finally {
      setLoading(false);
    }
  }, [assessmentInstanceId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const historyRows = report?.history_rows ?? [];
  const subtitle = 'Value-level history for this assessment, including provenance and confirmation metadata.';

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
      setError(e.message ?? 'Decision log export failed');
    } finally {
      setExporting(false);
    }
  }, [assessmentInstanceId]);

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
            <h1 className="text-lg font-semibold text-text-primary">Decision Log</h1>
            <p className="mt-1 text-sm text-text-tertiary">{subtitle}</p>
          </div>
          <ExportButton
            onClick={handleExport}
            loading={exporting}
          />
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
