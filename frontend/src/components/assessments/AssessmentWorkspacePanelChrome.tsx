'use client';

import { useMemo, type RefObject } from 'react';
import {
  CheckCircle2, Download, FileSpreadsheet, Loader2, RotateCcw,
} from 'lucide-react';
import { EditorPanelHeaderIconButton } from '@/components/editor/EditorPanelHeader';
import { useRegisterEditorPanelChrome } from '@/components/editor/EditorPanelChromeContext';

interface AssessmentWorkspacePanelChromeProps {
  title: string;
  exportFormat?: string | null;
  initiativeId?: string;
  decisionMenuRef: RefObject<HTMLDivElement>;
  decisionMenuOpen: boolean;
  onDecisionMenuToggle: () => void;
  onDecisionLogOpen: () => void;
  onDecisionLogExport: () => void;
  showExportAction: boolean;
  onExport: () => void;
  canApproveFinal: boolean;
  onApproveFinal: () => void;
  finalApproved: boolean;
  onRevokeApproval: () => void;
  isApprovingFinal: boolean;
}

export function AssessmentWorkspacePanelChrome({
  title,
  exportFormat,
  initiativeId,
  decisionMenuRef,
  decisionMenuOpen,
  onDecisionMenuToggle,
  onDecisionLogOpen,
  onDecisionLogExport,
  showExportAction,
  onExport,
  canApproveFinal,
  onApproveFinal,
  finalApproved,
  onRevokeApproval,
  isApprovingFinal,
}: AssessmentWorkspacePanelChromeProps) {
  const actions = useMemo(() => {
    if (!initiativeId) return null;

    return (
      <>
        <div ref={decisionMenuRef} className="relative">
          <EditorPanelHeaderIconButton
            label="Decision log"
            onClick={onDecisionMenuToggle}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
          </EditorPanelHeaderIconButton>
          {decisionMenuOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 min-w-[132px] rounded-lg border border-divider bg-white py-1 shadow-lg">
              <button
                type="button"
                onClick={onDecisionLogOpen}
                className="flex w-full items-center px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-black/[0.04] hover:text-text-primary"
              >
                Open
              </button>
              <button
                type="button"
                onClick={onDecisionLogExport}
                className="flex w-full items-center px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-black/[0.04] hover:text-text-primary"
              >
                Export
              </button>
            </div>
          )}
        </div>
        {showExportAction && (
          <EditorPanelHeaderIconButton label="Export assessment" onClick={onExport}>
            <Download className="h-3.5 w-3.5" />
          </EditorPanelHeaderIconButton>
        )}
        {canApproveFinal && (
          <EditorPanelHeaderIconButton
            label="Approve assessment"
            onClick={onApproveFinal}
            disabled={isApprovingFinal}
          >
            {isApprovingFinal
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <CheckCircle2 className="h-3.5 w-3.5" />}
          </EditorPanelHeaderIconButton>
        )}
        {finalApproved && (
          <button
            type="button"
            onClick={onRevokeApproval}
            disabled={isApprovingFinal}
            title="Approved — click to revoke"
            aria-label="Approved — click to revoke"
            className="group flex h-8 items-center gap-1.5 rounded-md border border-accent bg-accent px-2.5 text-white transition-colors hover:bg-accent/90 disabled:opacity-100"
          >
            {isApprovingFinal ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
            ) : (
              <span className="relative h-3.5 w-3.5">
                <CheckCircle2 className="absolute inset-0 h-3.5 w-3.5 text-white opacity-100 transition-opacity duration-150 ease-out group-hover:opacity-0" />
                <RotateCcw className="absolute inset-0 h-3.5 w-3.5 text-white opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100" />
              </span>
            )}
            <span className="text-[11px] font-medium">Approved</span>
          </button>
        )}
      </>
    );
  }, [
    initiativeId,
    decisionMenuRef,
    decisionMenuOpen,
    onDecisionMenuToggle,
    onDecisionLogOpen,
    onDecisionLogExport,
    showExportAction,
    onExport,
    canApproveFinal,
    onApproveFinal,
    finalApproved,
    onRevokeApproval,
    isApprovingFinal,
  ]);

  useRegisterEditorPanelChrome(
    {
      title,
      suffix: exportFormat?.toUpperCase() ?? null,
      actions,
    },
    [title, exportFormat, actions],
  );

  return null;
}
