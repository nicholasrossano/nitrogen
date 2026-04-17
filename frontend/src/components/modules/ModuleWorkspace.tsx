'use client';

import {
  useState, useEffect, useCallback, useRef, Suspense, lazy, type ComponentType,
} from 'react';
import {
  Loader2, AlertCircle, CheckCircle2, Download, Pencil, ChevronDown, FileSpreadsheet,
} from 'lucide-react';
import type {
  StagedModuleWorkflowState, StageDef, StageState, StagedWorkflowState,
} from '@/lib/api';
import { api } from '@/lib/api';
import { EditableTableStage } from './stages/EditableTableStage';
import { CategorizedListStage } from './stages/CategorizedListStage';
import { CategorizedWorkspaceStage } from './stages/CategorizedWorkspaceStage';
import {
  WIDGET_REGISTRY,
  type WorkspaceWidgetProps,
  type WorkspaceWidgetFooterAction,
  type WorkspaceWidgetFooterState,
} from '@/lib/widgetRegistry';

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `"${key}":${stableStringify(nested)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulValue(item));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => hasMeaningfulValue(item));
  }
  return true;
}

// ── Stage Stepper ─────────────────────────────────────────────────────────

function StageStepper({
  stageDefs,
  stages,
  currentStageId,
  onSelect,
}: {
  stageDefs: StageDef[];
  stages: Record<string, StageState>;
  currentStageId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex justify-center">
      <div className="flex items-center gap-1 p-1 bg-surface-subtle rounded-lg">
        {stageDefs.map((def, idx) => {
          const stageState = stages[def.id];
          const status = stageState?.status ?? 'pending';
          const isActive = def.id === currentStageId;
          const isConfirmed = status === 'confirmed';
          const isPending = status === 'pending';

          // Can navigate to a stage if it's confirmed or is the current stage,
          // or if the prior stage is confirmed
          const priorConfirmed = idx === 0 || stages[stageDefs[idx - 1]?.id]?.status === 'confirmed';
          const isAccessible = isConfirmed || isActive || priorConfirmed;

          return (
            <button
              key={def.id}
              onClick={() => isAccessible && onSelect(def.id)}
              disabled={!isAccessible}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                isActive
                  ? 'bg-surface text-text-primary shadow-sm'
                  : isConfirmed
                  ? 'text-emerald-600 hover:bg-surface/50'
                  : isAccessible
                  ? 'text-text-secondary hover:text-text-primary'
                  : 'text-text-tertiary cursor-not-allowed opacity-50'
              }`}
            >
              {isConfirmed && <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />}
              {status === 'populating' && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
              <span>{def.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Confirmation Bar ──────────────────────────────────────────────────────

function ConfirmationBar({
  stageDef,
  stageState,
  onPopulate,
  onConfirm,
  onCancelEditConfirmedStage,
  isPopulating,
  isConfirming,
  isEditingConfirmedStage,
  hasPendingChanges,
  onStartEditConfirmedStage,
  suppressConfirmAction,
}: {
  stageDef: StageDef;
  stageState: StageState;
  onPopulate: () => void;
  onConfirm: () => void;
  onCancelEditConfirmedStage: () => void;
  isPopulating: boolean;
  isConfirming: boolean;
  isEditingConfirmedStage: boolean;
  hasPendingChanges: boolean;
  onStartEditConfirmedStage: () => void;
  suppressConfirmAction?: boolean;
}) {
  const status = stageState.status;
  const hasData = !!(stageState.data?.items?.length || stageState.data?.widget_data || stageState.data?.records);
  const ConfirmCtaButton = ({
    onClick,
    disabled,
    loading,
  }: {
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="btn-primary !py-1.5 !px-3 text-xs flex items-center gap-1.5 shrink-0"
    >
      {loading ? (
        <><Loader2 className="w-3 h-3 animate-spin" /> Confirming...</>
      ) : (
        <>Confirm</>
      )}
    </button>
  );

  if (status === 'confirmed') {
    const isComputedResultsStage = stageDef.component === 'computed_results';
    const confirmedAt = stageState.confirmed_at
      ? new Date(stageState.confirmed_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : null;
    const confirmedBy = stageState.confirmed_by_email || stageState.confirmed_by || null;
    const confirmedMeta = confirmedAt
      ? `${confirmedAt}${confirmedBy ? ` by ${confirmedBy}` : ''}`
      : null;
    return (
      <div className="flex items-center justify-between py-3 px-4 border-t border-divider bg-emerald-50/60">
        <div className="flex items-center gap-2 text-xs text-emerald-700">
          <CheckCircle2 className="w-4 h-4" />
          <span>
            {isEditingConfirmedStage
              ? 'Editing confirmed stage'
              : `Confirmed${confirmedMeta ? ` • ${confirmedMeta}` : ''}`}
          </span>
        </div>
        {isEditingConfirmedStage ? (
          <div className="flex items-center gap-2">
            <button
              onClick={onCancelEditConfirmedStage}
              className="btn-secondary !py-1.5 !px-3 text-xs"
            >
              Cancel
            </button>
            {!suppressConfirmAction && (
              <ConfirmCtaButton onClick={onConfirm} loading={isConfirming} disabled={!hasPendingChanges} />
            )}
          </div>
        ) : isComputedResultsStage || suppressConfirmAction ? (
          <span className="text-xs text-emerald-700/80">Go back to earlier stages to edit values</span>
        ) : (
          <button
            onClick={onStartEditConfirmedStage}
            className="btn-secondary !py-1.5 !px-3 text-xs flex items-center gap-1.5 shrink-0"
          >
            <Pencil className="w-3 h-3" />
            Edit
          </button>
        )}
      </div>
    );
  }

  if (status === 'pending' && !hasData) {
    return (
      <div className="flex items-center justify-between py-3 px-4 border-t border-divider">
        <p className="text-xs text-text-tertiary">Populate this stage to get started</p>
        <ConfirmCtaButton onClick={onPopulate} loading={isPopulating} />
      </div>
    );
  }

  if (status === 'draft' || (status === 'pending' && hasData)) {
    if (suppressConfirmAction) {
      return null;
    }
    return (
      <div className="flex items-center justify-between py-3 px-4 border-t border-divider">
        <p className="text-xs text-text-tertiary">Review and confirm when ready</p>
        <ConfirmCtaButton onClick={onConfirm} disabled={!hasData} loading={isConfirming} />
      </div>
    );
  }

  if (status === 'populating') {
    return (
      <div className="flex items-center gap-2 py-3 px-4 border-t border-divider">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
        <span className="text-xs text-text-secondary">Generating {stageDef.title.toLowerCase()}...</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex items-center justify-between py-3 px-4 border-t border-divider bg-red-50/50">
        <div className="flex items-center gap-2 text-xs text-red-600">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>Generation failed</span>
        </div>
        <ConfirmCtaButton onClick={onPopulate} loading={isPopulating} />
      </div>
    );
  }

  return null;
}

// ── Main ModuleWorkspace ──────────────────────────────────────────────────

interface ModuleWorkspaceProps {
  instanceId: string;
  moduleId: string;
  initiativeId?: string;
  onAddToChat?: (text: string) => void;
  onOpenDecisionLog?: (context: { instanceId: string; moduleId: string; title: string }) => void;
  onExportDecisionLog?: (context: { instanceId: string; moduleId: string; title: string }) => void | Promise<void>;
}

export function ModuleWorkspace({
  instanceId,
  moduleId,
  initiativeId,
  onAddToChat,
  onOpenDecisionLog,
  onExportDecisionLog,
}: ModuleWorkspaceProps) {
  const [state, setState] = useState<StagedModuleWorkflowState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeStageId, setActiveStageId] = useState<string | null>(null);
  const [isPopulating, setIsPopulating] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isApprovingFinal, setIsApprovingFinal] = useState(false);
  const [decisionMenuOpen, setDecisionMenuOpen] = useState(false);
  const [editingConfirmedStageIds, setEditingConfirmedStageIds] = useState<Record<string, boolean>>({});
  const [editBaselineByStageId, setEditBaselineByStageId] = useState<Record<string, string>>({});
  const decisionMenuRef = useRef<HTMLDivElement>(null);

  // Refresh callback for child components (onChanged / onWorkflowUpdated).
  const fetchState = useCallback(async () => {
    try {
      const data = await api.getStagedModuleWorkflowState(instanceId);
      setState(data);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load module state');
    }
  }, [instanceId]);

  // One-time init: fetch state, auto-populate if the module is brand-new.
  // Uses a cancelled flag so React Strict Mode double-invoke doesn't cause
  // a stale GET response to overwrite the populated state.
  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const data = await api.getStagedModuleWorkflowState(instanceId);
        if (cancelled) return;
        setState(data);
        setActiveStageId(data.workflow_state.current_stage_id);
        setLoading(false);

        // Auto-populate the first stage when the module is brand-new (all stages pending).
        // Covers calculator modules (start_from_predefined_rows) and assessment
        // modules (seed_from_template + adapt_with_ai_from_project_materials).
        const defs = data.module_definition.stage_defs ?? [];
        const stages = data.workflow_state.stages ?? {};
        const allPending = defs.length > 0 && defs.every((d) => stages[d.id]?.status === 'pending');
        const firstDef = defs[0];

        if (allPending && firstDef) {
          const hasPopulationSteps = firstDef.population?.some((p) =>
            p.type !== 'await_user_confirmation'
          );
          if (hasPopulationSteps) {
            setIsPopulating(true);
            try {
              const result = await api.populateStage(instanceId, firstDef.id, data.workflow_version);
              if (cancelled) return;
              setState((prev) => prev ? {
                ...prev,
                workflow_state: result.workflow_state,
                workflow_version: result.workflow_version,
              } : prev);
            } catch {
              // Silently ignore — user can click Retry in the ConfirmationBar
              if (!cancelled) await fetchState();
            } finally {
              if (!cancelled) setIsPopulating(false);
            }
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message ?? 'Failed to load module state');
          setLoading(false);
        }
      }
    }

    initialize();
    return () => { cancelled = true; };
  }, [instanceId, fetchState]);

  useEffect(() => {
    if (!decisionMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!decisionMenuRef.current?.contains(event.target as Node)) {
        setDecisionMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [decisionMenuOpen]);

  // Lazy widget rendering for computed_results stages
  const widgetCache = useRef<Record<string, ComponentType<WorkspaceWidgetProps>>>({});
  const renderComputedWidget = useCallback(
    (
      widgetType: string,
      widgetData: Record<string, any> | null | undefined,
      outputFooterAction?: WorkspaceWidgetFooterAction,
      outputFooterState?: WorkspaceWidgetFooterState
    ) => {
      if (!widgetData) {
        return (
          <div className="card p-8 text-center text-sm text-text-secondary">
            Results will appear here after computation.
          </div>
        );
      }

      const loader = WIDGET_REGISTRY[widgetType];
      if (!loader) {
        return (
          <div className="card p-6 text-sm text-text-secondary">
            Unsupported widget: <code>{widgetType}</code>
          </div>
        );
      }

      if (!widgetCache.current[widgetType]) {
        widgetCache.current[widgetType] = lazy(() => loader());
      }
      const Widget = widgetCache.current[widgetType];

      return (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-text-tertiary" /></div>}>
          <Widget
            data={widgetData}
            initiativeId={initiativeId ?? ''}
            instanceId={instanceId}
            workflowVersion={state?.workflow_version}
            onWorkflowUpdated={fetchState}
            workspaceView="output"
            isActive
            outputFooterAction={outputFooterAction}
            outputFooterState={outputFooterState}
          />
        </Suspense>
      );
    },
    [fetchState, initiativeId, instanceId, state?.workflow_version]
  );

  const handlePopulate = useCallback(async (stageId: string) => {
    setIsPopulating(true);
    try {
      const result = await api.populateStage(instanceId, stageId, state?.workflow_version);
      setState((prev) => prev ? {
        ...prev,
        workflow_state: result.workflow_state,
        workflow_version: result.workflow_version,
      } : prev);
    } catch (e: any) {
      setError(e.message ?? 'Failed to populate stage');
      fetchState();
    } finally {
      setIsPopulating(false);
    }
  }, [instanceId, state?.workflow_version, fetchState]);

  const handleConfirm = useCallback(async (stageId: string) => {
    setIsConfirming(true);
    try {
      const result = await api.confirmStage(instanceId, stageId, state?.workflow_version);
      setState((prev) => prev ? {
        ...prev,
        workflow_state: result.workflow_state,
        workflow_version: result.workflow_version,
      } : prev);
      // Auto-advance to next stage
      const ws = result.workflow_state as StagedWorkflowState;
      if (ws.current_stage_id && ws.current_stage_id !== stageId) {
        setActiveStageId(ws.current_stage_id);
      }
      setEditingConfirmedStageIds((prev) => ({ ...prev, [stageId]: false }));
    } catch (e: any) {
      setError(e.message ?? 'Failed to confirm stage');
      fetchState();
    } finally {
      setIsConfirming(false);
    }
  }, [instanceId, state?.workflow_version, fetchState]);

  const handleApproveFinal = useCallback(async () => {
    setIsApprovingFinal(true);
    try {
      const result = await api.approveFinalModuleOutput(instanceId, state?.workflow_version);
      setState((prev) => prev ? {
        ...prev,
        workflow_state: result.workflow_state,
        workflow_version: result.workflow_version,
      } : prev);
    } catch (e: any) {
      setError(e.message ?? 'Failed to approve final report');
      fetchState();
    } finally {
      setIsApprovingFinal(false);
    }
  }, [instanceId, state?.workflow_version, fetchState]);

  const handleExport = useCallback(async () => {
    try {
      const { blob, filename } = await api.exportStagedModule(instanceId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message ?? 'Export failed');
    }
  }, [instanceId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (error || !state) {
    return (
      <div className="flex items-start gap-2 p-4 text-sm text-red-400">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{error ?? 'Module not found'}</span>
      </div>
    );
  }

  const { workflow_state: ws, module_definition: mod } = state;
  const stageDefs = mod.stage_defs ?? [];
  const stages = ws.stages ?? {};

  const currentStageDef = stageDefs.find((s) => s.id === activeStageId) ?? stageDefs[0];
  if (!currentStageDef) {
    return <div className="p-4 text-sm text-text-secondary">No stages configured for this module.</div>;
  }

  const currentStageState = stages[currentStageDef.id] ?? { status: 'pending', confirmed_at: null, confirmed_by: null, data: null };
  const isEditingConfirmedStage = !!editingConfirmedStageIds[currentStageDef.id];
  const currentStageDataSignature = stableStringify(currentStageState.data ?? null);
  const baselineSignature = editBaselineByStageId[currentStageDef.id];
  const hasPendingConfirmedStageChanges =
    isEditingConfirmedStage
    && baselineSignature !== undefined
    && baselineSignature !== currentStageDataSignature;
  const isEditableInputTableStage =
    currentStageDef.component === 'table' && currentStageDef.widget === 'editable_table';

  // Current stage index (used for deriving prior stages in workspace stages)
  const currentIdx = stageDefs.findIndex((s) => s.id === currentStageDef.id);

  // All stages confirmed → show export button for modules that support it
  const allConfirmed = stageDefs.length > 0 && stageDefs.every((s) => stages[s.id]?.status === 'confirmed');
  const hasExport = !!mod.export_format;
  const finalApproval = ws.final_approval ?? {
    status: 'pending',
    approved_at: null,
    approved_by: null,
    approved_by_email: null,
  };
  const requiresFinalApproval = !!mod.requires_final_approval;
  const finalApproved = finalApproval.status === 'approved';
  const terminalStageDef = stageDefs[stageDefs.length - 1];
  const terminalStageId = terminalStageDef?.id ?? null;
  const terminalStageState = terminalStageId ? stages[terminalStageId] : null;
  const terminalStageReady = !!terminalStageState && (
    terminalStageState.status === 'confirmed'
    || (terminalStageState.status === 'draft' && hasMeaningfulValue(terminalStageState.data))
  );
  const stagesBeforeTerminalConfirmed = stageDefs.slice(0, -1).every((s) => stages[s.id]?.status === 'confirmed');
  const canApproveFinal = hasExport
    && requiresFinalApproval
    && !finalApproved
    && stageDefs.length > 0
    && stagesBeforeTerminalConfirmed
    && terminalStageReady;
  const canExportModule = hasExport && (
    requiresFinalApproval
      ? finalApproved
      : allConfirmed
  );
  const moduleTitle = mod.name ?? moduleId.replace(/_/g, ' ');
  const decisionLogContext = {
    instanceId,
    moduleId,
    title: moduleTitle,
  };

  const handleDecisionLogOpen = async () => {
    setDecisionMenuOpen(false);
    onOpenDecisionLog?.(decisionLogContext);
  };

  const handleDecisionLogExport = async () => {
    setDecisionMenuOpen(false);
    try {
      if (onExportDecisionLog) {
        await onExportDecisionLog(decisionLogContext);
        return;
      }
      const { blob, filename } = await api.exportModuleDecisionLogXlsx(instanceId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message ?? 'Decision log export failed');
    }
  };

  const renderStageContent = () => {
    const { component, widget, fields, id: stageId } = currentStageDef;
    const stageData = currentStageState.data;
    const isConfirmed = currentStageState.status === 'confirmed';
    const readOnly = isConfirmed && !isEditingConfirmedStage;

    if (component === 'computed_results') {
      return renderComputedWidget(widget, stageData?.widget_data);
    }

    if (component === 'table' && widget === 'editable_table') {
      return (
        <EditableTableStage
          instanceId={instanceId}
          moduleId={moduleId}
          stageId={stageId}
          workflowVersion={state.workflow_version}
          fields={fields}
          items={stageData?.items ?? []}
          readOnly={readOnly}
          flush
          allowAddRows={currentStageDef.allow_add_rows}
          onChanged={fetchState}
        />
      );
    }

    if (component === 'list' && widget === 'categorized_list') {
      return (
        <CategorizedListStage
          instanceId={instanceId}
          stageId={stageId}
          workflowVersion={state.workflow_version}
          fields={fields}
          items={stageData?.items ?? []}
          readOnly={readOnly}
          onChanged={fetchState}
        />
      );
    }

    if ((component === 'list' || component === 'record') && widget === 'categorized_workspace') {
      // Find the prior confirmed list stage to get categories from
      const priorListStage = stageDefs.slice(0, currentIdx).reverse().find((s) => s.component === 'list');
      const categoryItems = priorListStage
        ? (stages[priorListStage.id]?.data?.items ?? [])
        : [];

      return (
        <CategorizedWorkspaceStage
          instanceId={instanceId}
          stageId={stageId}
          workflowVersion={state.workflow_version}
          stageDef={currentStageDef}
          stageData={currentStageState.data}
          categoryItems={categoryItems}
          readOnly={readOnly}
          onChanged={fetchState}
          onAddToChat={onAddToChat}
        />
      );
    }

    // Fallback for unknown widgets — try the widget registry
    return renderComputedWidget(widget, stageData?.widget_data ?? stageData as any);
  };

  const isComputedStage = currentStageDef.component === 'computed_results';
  const isCalculationComputedWidget = isComputedStage && [
    'lcoe_results',
    'carbon_results',
    'solar_yield_results',
    'lcoe_output',
    'carbon_output',
    'solar_output',
  ].includes(currentStageDef.widget);
  const hasComputedWidgetData = !!currentStageState.data?.widget_data;
  const shouldShowMergedConfirmAction =
    isCalculationComputedWidget
    && !(requiresFinalApproval && currentStageDef.id === terminalStageId)
    && (currentStageState.status === 'draft'
      || (currentStageState.status === 'pending'
        && hasComputedWidgetData)
      || (currentStageState.status === 'confirmed' && isEditingConfirmedStage));
  const requiresPendingChangesForConfirm =
    currentStageState.status === 'confirmed' && isEditingConfirmedStage;
  const canConfirmCurrentStage = requiresPendingChangesForConfirm
    ? hasPendingConfirmedStageChanges
    : true;
  const shouldShowMergedConfirmedState =
    isCalculationComputedWidget
    && currentStageState.status === 'confirmed'
    && !isEditingConfirmedStage;
  const computedFooterAction: WorkspaceWidgetFooterAction | undefined = shouldShowMergedConfirmAction
    ? {
        label: 'Confirm',
        onClick: () => {
          if (!canConfirmCurrentStage) {
            setEditingConfirmedStageIds((prev) => ({ ...prev, [currentStageDef.id]: false }));
            setEditBaselineByStageId((prev) => {
              const next = { ...prev };
              delete next[currentStageDef.id];
              return next;
            });
            return;
          }
          handleConfirm(currentStageDef.id);
        },
        loading: isConfirming,
        disabled: !canConfirmCurrentStage,
      }
    : undefined;
  const computedFooterState: WorkspaceWidgetFooterState | undefined =
    shouldShowMergedConfirmAction
      ? { mode: 'confirm' }
      : shouldShowMergedConfirmedState
      ? {
          mode: 'confirmed',
          confirmedAt: currentStageState.confirmed_at
            ? new Date(currentStageState.confirmed_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
            : null,
        }
      : undefined;
  const shouldShowSeparateConfirmationBar = !(
    isCalculationComputedWidget
    && (shouldShowMergedConfirmAction || shouldShowMergedConfirmedState)
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full px-4 py-5 flex flex-col gap-4">
          {/* Stage stepper */}
          <div className="flex items-center justify-between gap-4">
            <StageStepper
              stageDefs={stageDefs}
              stages={stages}
              currentStageId={activeStageId}
              onSelect={setActiveStageId}
            />
            <div className="flex items-center gap-2 shrink-0">
              {initiativeId && (
                <div ref={decisionMenuRef} className="relative">
                  <button
                    onClick={() => setDecisionMenuOpen((prev) => !prev)}
                    className="btn-secondary !py-1.5 !px-3 text-xs flex items-center gap-1.5 shrink-0"
                  >
                    <FileSpreadsheet className="w-3 h-3" />
                    Decision Log
                    <ChevronDown className="w-3 h-3 opacity-60" />
                  </button>
                  {decisionMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 z-20 min-w-[132px] rounded-lg border border-divider bg-white py-1 shadow-lg">
                      <button
                        onClick={handleDecisionLogOpen}
                        className="flex w-full items-center px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-black/[0.04] hover:text-text-primary"
                      >
                        Open
                      </button>
                      <button
                        onClick={handleDecisionLogExport}
                        className="flex w-full items-center px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-black/[0.04] hover:text-text-primary"
                      >
                        Export
                      </button>
                    </div>
                  )}
                </div>
              )}
              {canApproveFinal && (
                <button
                  onClick={handleApproveFinal}
                  disabled={isApprovingFinal}
                  className="btn-primary !py-1.5 !px-3 text-xs flex items-center gap-1.5 shrink-0"
                >
                  {isApprovingFinal ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  Approve
                </button>
              )}
              {allConfirmed && canExportModule && (
                <button
                  onClick={handleExport}
                  className="btn-secondary !py-1.5 !px-3 text-xs flex items-center gap-1.5 shrink-0"
                >
                  <Download className="w-3 h-3" />
                  Export
                </button>
              )}
            </div>
          </div>

          {/* Active stage content */}
          {isComputedStage ? (
            // Computed-results stages: no card wrapper, widget renders directly
            // into the same container so width + stepper position are identical
            // to editable stages.
            <div className="flex flex-col gap-0">
              {renderComputedWidget(
                currentStageDef.widget,
                currentStageState.data?.widget_data,
                computedFooterAction,
                computedFooterState
              )}
              {shouldShowSeparateConfirmationBar && (
                <ConfirmationBar
                  stageDef={currentStageDef}
                  stageState={currentStageState}
                  onPopulate={() => handlePopulate(currentStageDef.id)}
                  onConfirm={() => {
                    if (!canConfirmCurrentStage) {
                      setEditingConfirmedStageIds((prev) => ({ ...prev, [currentStageDef.id]: false }));
                      setEditBaselineByStageId((prev) => {
                        const next = { ...prev };
                        delete next[currentStageDef.id];
                        return next;
                      });
                      return;
                    }
                    handleConfirm(currentStageDef.id);
                  }}
                  onCancelEditConfirmedStage={() => {
                    setEditingConfirmedStageIds((prev) => ({ ...prev, [currentStageDef.id]: false }));
                    setEditBaselineByStageId((prev) => {
                      const next = { ...prev };
                      delete next[currentStageDef.id];
                      return next;
                    });
                  }}
                  isPopulating={isPopulating}
                  isConfirming={isConfirming}
                  isEditingConfirmedStage={isEditingConfirmedStage}
                  hasPendingChanges={hasPendingConfirmedStageChanges}
                  suppressConfirmAction={requiresFinalApproval && currentStageDef.id === terminalStageId}
                  onStartEditConfirmedStage={() =>
                    {
                      setEditBaselineByStageId((prev) => ({
                        ...prev,
                        [currentStageDef.id]: currentStageDataSignature,
                      }));
                      setEditingConfirmedStageIds((prev) => ({ ...prev, [currentStageDef.id]: true }));
                    }
                  }
                />
              )}
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-divider">
                <h3 className="text-sm font-semibold text-text-primary">{currentStageDef.title}</h3>
                <p className="text-xs text-text-tertiary mt-0.5">
                  {currentStageState.status === 'pending' && 'Not started'}
                  {currentStageState.status === 'populating' && 'Generating…'}
                  {currentStageState.status === 'draft' && 'Ready for your review'}
                  {currentStageState.status === 'confirmed' && 'Confirmed'}
                  {currentStageState.status === 'error' && 'Generation failed'}
                </p>
              </div>

              <div className={isEditableInputTableStage ? '' : 'p-4'}>
                {renderStageContent()}
              </div>

              <ConfirmationBar
                stageDef={currentStageDef}
                stageState={currentStageState}
                onPopulate={() => handlePopulate(currentStageDef.id)}
                onConfirm={() => {
                  if (!canConfirmCurrentStage) {
                    setEditingConfirmedStageIds((prev) => ({ ...prev, [currentStageDef.id]: false }));
                    setEditBaselineByStageId((prev) => {
                      const next = { ...prev };
                      delete next[currentStageDef.id];
                      return next;
                    });
                    return;
                  }
                  handleConfirm(currentStageDef.id);
                }}
                onCancelEditConfirmedStage={() => {
                  setEditingConfirmedStageIds((prev) => ({ ...prev, [currentStageDef.id]: false }));
                  setEditBaselineByStageId((prev) => {
                    const next = { ...prev };
                    delete next[currentStageDef.id];
                    return next;
                  });
                }}
                isPopulating={isPopulating}
                isConfirming={isConfirming}
                isEditingConfirmedStage={isEditingConfirmedStage}
                hasPendingChanges={hasPendingConfirmedStageChanges}
                suppressConfirmAction={requiresFinalApproval && currentStageDef.id === terminalStageId}
                onStartEditConfirmedStage={() =>
                  {
                    setEditBaselineByStageId((prev) => ({
                      ...prev,
                      [currentStageDef.id]: currentStageDataSignature,
                    }));
                    setEditingConfirmedStageIds((prev) => ({ ...prev, [currentStageDef.id]: true }));
                  }
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
