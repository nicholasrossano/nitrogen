'use client';

import {
  useState, useEffect, useCallback, useRef, Suspense, lazy, type ComponentType,
} from 'react';
import {
  Loader2, AlertCircle, CheckCircle2, ChevronRight, Download, Sparkles,
} from 'lucide-react';
import type {
  StagedModuleWorkflowState, StageDef, StageState, StagedWorkflowState,
} from '@/lib/api';
import { api } from '@/lib/api';
import { EditableTableStage } from './stages/EditableTableStage';
import { CategorizedListStage } from './stages/CategorizedListStage';
import { CategorizedWorkspaceStage } from './stages/CategorizedWorkspaceStage';
import { WIDGET_REGISTRY, type WorkspaceWidgetProps } from '@/lib/widgetRegistry';

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
  isPopulating,
  isConfirming,
  hasDownstreamData,
}: {
  stageDef: StageDef;
  stageState: StageState;
  onPopulate: () => void;
  onConfirm: () => void;
  isPopulating: boolean;
  isConfirming: boolean;
  hasDownstreamData: boolean;
}) {
  const status = stageState.status;
  const hasData = !!(stageState.data?.items?.length || stageState.data?.widget_data || stageState.data?.records);

  if (status === 'confirmed') {
    const confirmedAt = stageState.confirmed_at
      ? new Date(stageState.confirmed_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : null;
    return (
      <div className="flex items-center justify-between py-3 px-4 border-t border-divider bg-emerald-50/60">
        <div className="flex items-center gap-2 text-xs text-emerald-700">
          <CheckCircle2 className="w-4 h-4" />
          <span>Confirmed{confirmedAt ? ` · ${confirmedAt}` : ''}</span>
        </div>
        <button
          onClick={onConfirm}
          className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
        >
          Edit & Re-confirm
          {hasDownstreamData && <span className="text-amber-600 ml-1">(resets next stages)</span>}
        </button>
      </div>
    );
  }

  if (status === 'pending' && !hasData) {
    return (
      <div className="flex items-center justify-between py-3 px-4 border-t border-divider">
        <p className="text-xs text-text-tertiary">Populate this stage to get started</p>
        <button
          onClick={onPopulate}
          disabled={isPopulating}
          className="btn-primary !py-1.5 !px-3 text-xs flex items-center gap-1.5"
        >
          {isPopulating ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Generating...</>
          ) : (
            <><Sparkles className="w-3 h-3" /> Generate</>
          )}
        </button>
      </div>
    );
  }

  if (status === 'draft' || (status === 'pending' && hasData)) {
    return (
      <div className="flex items-center justify-between py-3 px-4 border-t border-divider">
        <p className="text-xs text-text-tertiary">Review and confirm when ready</p>
        <button
          onClick={onConfirm}
          disabled={isConfirming || !hasData}
          className="btn-primary !py-1.5 !px-3 text-xs flex items-center gap-1.5"
        >
          {isConfirming ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Confirming...</>
          ) : (
            <>Confirm {stageDef.title}</>
          )}
        </button>
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
        <button onClick={onPopulate} disabled={isPopulating} className="btn-secondary !py-1.5 !px-3 text-xs">
          {isPopulating ? 'Retrying...' : 'Retry'}
        </button>
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
}

export function ModuleWorkspace({ instanceId, moduleId, initiativeId, onAddToChat }: ModuleWorkspaceProps) {
  const [state, setState] = useState<StagedModuleWorkflowState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeStageId, setActiveStageId] = useState<string | null>(null);
  const [isPopulating, setIsPopulating] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const hasInitialized = useRef(false);

  const fetchState = useCallback(async () => {
    try {
      const data = await api.getStagedModuleWorkflowState(instanceId);
      setState(data);
      if (!hasInitialized.current) {
        hasInitialized.current = true;
        setActiveStageId(data.workflow_state.current_stage_id);

        // Auto-populate the first stage when the module is brand-new (all stages pending)
        // This matches the old behavior where opening a module would kick off AI generation.
        const defs = data.module_definition.stage_defs ?? [];
        const stages = data.workflow_state.stages ?? {};
        const allPending = defs.length > 0 && defs.every((d) => stages[d.id]?.status === 'pending');
        const firstDef = defs[0];
        if (allPending && firstDef) {
          const hasAiSteps = firstDef.population?.some((p) =>
            ['propose_with_ai', 'adapt_with_ai_from_project_materials'].includes(p.type)
          );
          if (hasAiSteps) {
            // Trigger population without awaiting — state will update via the returned workflow_state
            setIsPopulating(true);
            api.populateStage(instanceId, firstDef.id)
              .then((result) => {
                setState((prev) => prev ? { ...prev, workflow_state: result.workflow_state } : prev);
              })
              .catch(() => {
                // Silently ignore — user can click Retry in the ConfirmationBar
              })
              .finally(() => setIsPopulating(false));
          }
        }
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to load module state');
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => { fetchState(); }, [fetchState]);

  // Lazy widget rendering for computed_results stages
  const widgetCache = useRef<Record<string, ComponentType<WorkspaceWidgetProps>>>({});
  const renderComputedWidget = useCallback(
    (widgetType: string, widgetData: Record<string, any> | null | undefined) => {
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
            onWorkflowUpdated={fetchState}
            workspaceView="output"
            isActive
          />
        </Suspense>
      );
    },
    [fetchState, initiativeId, instanceId]
  );

  const handlePopulate = useCallback(async (stageId: string) => {
    setIsPopulating(true);
    try {
      const result = await api.populateStage(instanceId, stageId);
      setState((prev) => prev ? {
        ...prev,
        workflow_state: result.workflow_state,
      } : prev);
    } catch (e: any) {
      setError(e.message ?? 'Failed to populate stage');
    } finally {
      setIsPopulating(false);
    }
  }, [instanceId]);

  const handleConfirm = useCallback(async (stageId: string) => {
    setIsConfirming(true);
    try {
      const result = await api.confirmStage(instanceId, stageId);
      setState((prev) => prev ? {
        ...prev,
        workflow_state: result.workflow_state,
      } : prev);
      // Auto-advance to next stage
      const ws = result.workflow_state as StagedWorkflowState;
      if (ws.current_stage_id && ws.current_stage_id !== stageId) {
        setActiveStageId(ws.current_stage_id);
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to confirm stage');
    } finally {
      setIsConfirming(false);
    }
  }, [instanceId]);

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

  // Downstream stages after the current one that have data
  const currentIdx = stageDefs.findIndex((s) => s.id === currentStageDef.id);
  const hasDownstreamData = stageDefs
    .slice(currentIdx + 1)
    .some((s) => {
      const ss = stages[s.id];
      return ss?.status !== 'pending' && ss?.data != null;
    });

  // All stages confirmed → show export button for modules that support it
  const allConfirmed = stageDefs.length > 0 && stageDefs.every((s) => stages[s.id]?.status === 'confirmed');
  const hasExport = !!mod.export_format;

  const renderStageContent = () => {
    const { component, widget, fields, id: stageId } = currentStageDef;
    const stageData = currentStageState.data;
    const isConfirmed = currentStageState.status === 'confirmed';

    if (component === 'computed_results') {
      return renderComputedWidget(widget, stageData?.widget_data);
    }

    if (component === 'table' && widget === 'editable_table') {
      return (
        <EditableTableStage
          instanceId={instanceId}
          stageId={stageId}
          fields={fields}
          items={stageData?.items ?? []}
          readOnly={isConfirmed}
          onChanged={fetchState}
        />
      );
    }

    if (component === 'list' && widget === 'categorized_list') {
      return (
        <CategorizedListStage
          instanceId={instanceId}
          stageId={stageId}
          fields={fields}
          items={stageData?.items ?? []}
          readOnly={isConfirmed}
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
          stageDef={currentStageDef}
          stageData={currentStageState.data}
          categoryItems={categoryItems}
          readOnly={isConfirmed}
          onChanged={fetchState}
          onAddToChat={onAddToChat}
        />
      );
    }

    // Fallback for unknown widgets — try the widget registry
    return renderComputedWidget(widget, stageData?.widget_data ?? stageData as any);
  };

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
            {allConfirmed && hasExport && (
              <button
                onClick={handleExport}
                className="btn-secondary !py-1.5 !px-3 text-xs flex items-center gap-1.5 shrink-0"
              >
                <Download className="w-3 h-3" />
                Export
              </button>
            )}
          </div>

          {/* Active stage content */}
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

            <div className="p-4">
              {renderStageContent()}
            </div>

            <ConfirmationBar
              stageDef={currentStageDef}
              stageState={currentStageState}
              onPopulate={() => handlePopulate(currentStageDef.id)}
              onConfirm={() => handleConfirm(currentStageDef.id)}
              isPopulating={isPopulating}
              isConfirming={isConfirming}
              hasDownstreamData={hasDownstreamData}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
