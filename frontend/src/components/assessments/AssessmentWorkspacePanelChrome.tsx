'use client';

import { useMemo, useRef, type RefObject } from 'react';
import {
  CheckCircle2, Download, FileText, History, Loader2, RotateCcw,
} from 'lucide-react';
import { EditorPanelHeaderIconButton } from '@/components/editor/EditorPanelHeader';
import { useRegisterEditorPanelChrome } from '@/components/editor/EditorPanelChromeContext';

interface AssessmentWorkspacePanelChromeProps {
  title: string;
  titleEditable?: boolean;
  onSaveTitle?: (title: string) => void | Promise<void>;
  titleSaving?: boolean;
  exportFormat?: string | null;
  projectId?: string;
  decisionMenuRef: RefObject<HTMLDivElement>;
  decisionMenuOpen: boolean;
  onDecisionMenuToggle: () => void;
  onDecisionLogOpen: () => void;
  onDecisionLogExport: () => void;
  showExportAction: boolean;
  /** Document-generating assessments use Report → open in viewer; calculators use Export → download. */
  exportActionKind?: 'export' | 'report';
  onExport: () => void;
  isExporting?: boolean;
  canApproveFinal: boolean;
  onApproveFinal: () => void;
  finalApproved: boolean;
  onRevokeApproval: () => void;
  isApprovingFinal: boolean;
}

export function AssessmentWorkspacePanelChrome({
  title,
  titleEditable = false,
  onSaveTitle,
  titleSaving = false,
  exportFormat,
  projectId,
  decisionMenuRef,
  decisionMenuOpen,
  onDecisionMenuToggle,
  onDecisionLogOpen,
  onDecisionLogExport,
  showExportAction,
  exportActionKind = 'export',
  onExport,
  isExporting = false,
  canApproveFinal,
  onApproveFinal,
  finalApproved,
  onRevokeApproval,
  isApprovingFinal,
}: AssessmentWorkspacePanelChromeProps) {
  // Keep handlers fresh without putting their identities in memo/chrome deps
  // (unstable parent callbacks previously caused an infinite chrome update loop).
  const onDecisionMenuToggleRef = useRef(onDecisionMenuToggle);
  const onDecisionLogOpenRef = useRef(onDecisionLogOpen);
  const onDecisionLogExportRef = useRef(onDecisionLogExport);
  const onExportRef = useRef(onExport);
  const onApproveFinalRef = useRef(onApproveFinal);
  const onRevokeApprovalRef = useRef(onRevokeApproval);
  const onSaveTitleRef = useRef(onSaveTitle);
  onDecisionMenuToggleRef.current = onDecisionMenuToggle;
  onDecisionLogOpenRef.current = onDecisionLogOpen;
  onDecisionLogExportRef.current = onDecisionLogExport;
  onExportRef.current = onExport;
  onApproveFinalRef.current = onApproveFinal;
  onRevokeApprovalRef.current = onRevokeApproval;
  onSaveTitleRef.current = onSaveTitle;

  const actions = useMemo(() => {
    if (!projectId) return null;

    return (
      <>
        <div ref={decisionMenuRef} className="relative">
          <button
            type="button"
            onClick={() => onDecisionMenuToggleRef.current()}
            aria-label="History"
            title="History"
            className="flex h-8 items-center gap-1.5 rounded-md border border-stroke-subtle bg-white px-2.5 text-[11px] font-medium leading-none text-text-secondary transition-colors hover:bg-black/[0.04] hover:text-text-primary"
          >
            <History className="h-3.5 w-3.5" />
            History
          </button>
          {decisionMenuOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 min-w-[132px] rounded-lg border border-divider bg-white py-1 shadow-lg">
              <button
                type="button"
                onClick={() => onDecisionLogOpenRef.current()}
                className="flex w-full items-center px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-black/[0.04] hover:text-text-primary"
              >
                Open
              </button>
              <button
                type="button"
                onClick={() => onDecisionLogExportRef.current()}
                className="flex w-full items-center px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-black/[0.04] hover:text-text-primary"
              >
                Export
              </button>
            </div>
          )}
        </div>
        {showExportAction && exportActionKind === 'report' && (
          <button
            type="button"
            onClick={() => onExportRef.current()}
            disabled={isExporting || isApprovingFinal}
            aria-label="Report"
            title="Report"
            className="flex h-8 items-center gap-1.5 rounded-md border border-stroke-subtle bg-white px-2.5 text-[11px] font-medium leading-none text-text-secondary transition-colors hover:bg-black/[0.04] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isExporting
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <FileText className="h-3.5 w-3.5" />}
            Report
          </button>
        )}
        {showExportAction && exportActionKind !== 'report' && (
          <EditorPanelHeaderIconButton
            label="Export assessment"
            onClick={() => onExportRef.current()}
            disabled={isExporting || isApprovingFinal}
          >
            {isExporting
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Download className="h-3.5 w-3.5" />}
          </EditorPanelHeaderIconButton>
        )}
        {canApproveFinal && (
          <button
            type="button"
            onClick={() => onApproveFinalRef.current()}
            disabled={isApprovingFinal}
            aria-label="Confirm assessment"
            title="Confirm assessment"
            className="btn-primary !h-8 !gap-1.5 !rounded-md !px-2.5 !py-0 !text-[11px] !font-medium !leading-none disabled:cursor-not-allowed"
          >
            {isApprovingFinal
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <CheckCircle2 className="h-3.5 w-3.5" />}
            Confirm
          </button>
        )}
        {finalApproved && (
          <button
            type="button"
            onClick={() => onRevokeApprovalRef.current()}
            disabled={isApprovingFinal}
            title="Confirmed — click to revoke"
            aria-label="Confirmed — click to revoke"
            className="group flex h-8 items-center gap-1.5 rounded-md border border-accent bg-accent px-2.5 text-white leading-none transition-colors hover:bg-accent/90 disabled:opacity-100"
          >
            {isApprovingFinal ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
            ) : (
              <span className="relative h-3.5 w-3.5">
                <CheckCircle2 className="absolute inset-0 h-3.5 w-3.5 text-white opacity-100 transition-opacity duration-150 ease-out group-hover:opacity-0" />
                <RotateCcw className="absolute inset-0 h-3.5 w-3.5 text-white opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100" />
              </span>
            )}
            <span className="text-[11px] font-medium leading-none">Confirmed</span>
          </button>
        )}
      </>
    );
  }, [
    projectId,
    decisionMenuRef,
    decisionMenuOpen,
    showExportAction,
    exportActionKind,
    isExporting,
    canApproveFinal,
    finalApproved,
    isApprovingFinal,
  ]);

  useRegisterEditorPanelChrome({
    title,
    titleEditable,
    onSaveTitle: onSaveTitle
      ? (next) => onSaveTitleRef.current?.(next)
      : undefined,
    titleSaving,
    suffix: exportFormat?.toUpperCase() ?? null,
    actions,
  });

  return null;
}
