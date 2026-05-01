'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Leaf,
  Download,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Pencil,
  AlertCircle,
  MessageSquare,
  ChevronDown,
} from 'lucide-react';
import { api } from '@/lib/api';
import { buildModelInputsContext } from '@/lib/modelInputsContext';
import type { WorkspaceWidgetFooterState } from '@/lib/widgetRegistry';
import { ConfirmButton } from '@/components/ui';
import { Tooltip } from '@/components/ui/Tooltip';
import { WidgetGeneratingProgress, MODEL_INPUTS_STEPS } from './WidgetGeneratingProgress';

async function persistWidgetToDb(
  initiativeId: string,
  messageId: string,
  instanceId: string | undefined,
  widgetData: Record<string, any>,
  workflowVersion?: number,
): Promise<boolean> {
  try {
    if (instanceId) {
      await api.persistModuleWorkflowWidget(instanceId, widgetData, workflowVersion);
      return true;
    }
    await api.updateMessageWidget(initiativeId, messageId, widgetData);
    window.dispatchEvent(new CustomEvent('nitrogen:chat-widget-updated', {
      detail: { messageId, widgetData },
    }));
    return true;
  } catch (err) {
    console.error('[CarbonModelWidget] persist failed:', err);
    return false;
  }
}

interface CarbonModelWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  messageId?: string;
  instanceId?: string;
  workflowVersion?: number;
  onWorkflowUpdated?: () => void;
  workspaceView?: 'build' | 'output';
  isActive?: boolean;
  outputFooterAction?: {
    label: string;
    onClick: () => void;
    loading?: boolean;
    disabled?: boolean;
  };
  outputFooterState?: WorkspaceWidgetFooterState;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  validated: { bg: 'bg-green-50', text: 'text-green-700', label: 'Validated' },
  extracted: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Extracted' },
  assumed: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'Assumed' },
  missing: { bg: 'bg-red-50', text: 'text-red-700', label: 'Missing' },
};

const QUALITY_STYLES: Record<string, { bg: string; text: string; icon: typeof CheckCircle2 }> = {
  high: { bg: 'bg-green-50', text: 'text-green-700', icon: CheckCircle2 },
  moderate: { bg: 'bg-yellow-50', text: 'text-yellow-700', icon: AlertTriangle },
  low: { bg: 'bg-red-50', text: 'text-red-700', icon: AlertTriangle },
};

const CATEGORY_ORDER = ['activity', 'baseline', 'project', 'emissions', 'adjustments', 'leakage', 'general'];
const CATEGORY_LABELS: Record<string, string> = {
  activity: 'Activity',
  baseline: 'Baseline Scenario',
  project: 'Project Scenario',
  emissions: 'Emission Factors',
  adjustments: 'Behaviour Adjustments',
  leakage: 'Leakage',
  general: 'General',
};

const INVESTIGATE_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='%231a1a1a' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='6.5' cy='6.5' r='4.5'/%3E%3Cline x1='10' y1='10' x2='14.5' y2='14.5'/%3E%3C/svg%3E") 6 6, auto`;

const PROJECT_TYPE_OPTIONS = [
  { value: 'cookstoves', label: 'Improved Cookstoves' },
  { value: 'fuel_switch', label: 'Fuel Switch (LPG / Biogas / Ethanol)' },
  { value: 'safe_water', label: 'Safe Water Supply' },
  { value: 'grid_renewable', label: 'Grid Renewable Energy' },
  { value: 'solar_home', label: 'Solar Home Systems (Off-Grid)' },
  { value: 'biodigester', label: 'Biodigesters (Manure Mgmt + Biogas)' },
  { value: 'efficient_lighting', label: 'Efficient Lighting' },
];

export function CarbonModelWidget({
  data: initialData,
  initiativeId,
  messageId,
  instanceId,
  workflowVersion,
  onWorkflowUpdated,
  workspaceView = 'output',
  isActive = true,
  outputFooterAction,
  outputFooterState,
}: CarbonModelWidgetProps) {
  const [data, setDataRaw] = useState(initialData);
  const setData = useCallback((newData: any) => {
    setDataRaw((prev: any) =>
      typeof newData === 'function' ? newData(prev) : newData
    );
  }, []);
  const [activeTab, setActiveTab] = useState<'overview' | 'inputs' | 'sensitivity' | 'schedule'>('overview');
  const [isExporting, setIsExporting] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [confirmingFields, setConfirmingFields] = useState<Set<string>>(new Set());
  const [preConfirmStatuses, setPreConfirmStatuses] = useState<Record<string, string>>({});

  const [hoveredRowInp, setHoveredRowInp] = useState<any>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [overInteractive, setOverInteractive] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isSwitchingPack, setIsSwitchingPack] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const result = data?.result;
  const forceInputsView = workspaceView === 'build';
  const inputs = useMemo(() => data?.inputs || {}, [data]);
  const missingEssentials: string[] = data?.missing_essentials || [];
  const sensitivity: any[] = data?.sensitivity || [];
  const isUnruly = data?.is_unruly ?? false;
  const currentMethodPack = data?.method_pack || (inputs.method_pack as any)?.value || 'cookstoves';

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.model_type !== 'carbon') return;
      const fieldName = detail.field_name;
      const value = detail.value;
      (async () => {
        setIsRecalculating(true);
        try {
          const newData = await api.updateCarbonInput(inputs, fieldName, value, 'validated');
          setData(newData);
          if ((messageId && initiativeId) || instanceId) {
            const persisted = await persistWidgetToDb(initiativeId, messageId ?? '', instanceId, newData, workflowVersion);
            if (persisted && instanceId) onWorkflowUpdated?.();
          }
        } catch { /* keep old */ }
        finally { setIsRecalculating(false); }
      })();
    };
    window.addEventListener('nitrogen:input-confirmed', handler);
    return () => window.removeEventListener('nitrogen:input-confirmed', handler);
  }, [inputs, setData, messageId, initiativeId, instanceId, onWorkflowUpdated, workflowVersion]);

  /* ------------------------------------------------------------------ */
  /*  Shared callbacks                                                   */
  /* ------------------------------------------------------------------ */

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const blob = await api.exportCarbonExcel(inputs);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'carbon_er_model.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently fail
    } finally {
      setIsExporting(false);
    }
  }, [inputs]);

  const startEdit = useCallback((fieldName: string, currentValue: any) => {
    setEditingField(fieldName);
    setEditValue(currentValue?.toString() ?? '');
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingField(null);
    setEditValue('');
  }, []);

  const commitEdit = useCallback(async () => {
    if (!editingField) return;
    const parsed = editValue === '' ? null : isNaN(Number(editValue)) ? editValue : Number(editValue);
    setIsRecalculating(true);
    try {
      const newData = await api.updateCarbonInput(inputs, editingField, parsed);
      setData(newData);
      if ((messageId && initiativeId) || instanceId) {
        const persisted = await persistWidgetToDb(initiativeId, messageId ?? '', instanceId, newData, workflowVersion);
        if (persisted && instanceId) onWorkflowUpdated?.();
      }
    } catch {
      // keep old values
    } finally {
      setEditingField(null);
      setEditValue('');
      setIsRecalculating(false);
    }
  }, [editingField, editValue, inputs, setData, messageId, initiativeId, instanceId, onWorkflowUpdated, workflowVersion]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') commitEdit();
      if (e.key === 'Escape') cancelEdit();
    },
    [commitEdit, cancelEdit]
  );

  const investigate = useCallback((label: string, status: string, fieldName?: string) => {
    const text =
      status === 'extracted' ? `Can you investigate the value for ${label} and propose a specific alternative with supporting evidence?` :
      status === 'assumed'  ? `Can you research and propose a better value for ${label} based on available data for this project?` :
      status === 'validated'? `Can you validate the value for ${label} and propose alternatives if there are better estimates?` :
      `Can you investigate and propose a value for ${label}?`;
    const input = fieldName ? inputs[fieldName] : undefined;
    const fieldContext = fieldName ? {
      field_name: fieldName,
      label,
      current_value: typeof input?.value === 'number' ? input.value : null,
      unit: input?.unit || null,
      model_type: 'carbon' as const,
      status: status || null,
    } : null;

    window.dispatchEvent(new CustomEvent('nitrogen:draft', {
      detail: {
        text,
        label,
        fieldName,
        fieldContext,
        modelInputsContext: buildModelInputsContext('Carbon Model', inputs, fieldContext),
      },
    }));
  }, [inputs]);

  const toggleConfirm = useCallback(async (fieldName: string, currentStatus: string, currentValue: any) => {
    const isConfirmed = currentStatus === 'validated';
    const newStatus = isConfirmed ? (preConfirmStatuses[fieldName] || 'extracted') : 'validated';

    if (!isConfirmed) {
      setPreConfirmStatuses(prev => ({ ...prev, [fieldName]: currentStatus }));
    }

    setData((prev: any) => ({
      ...prev,
      inputs: {
        ...prev?.inputs,
        [fieldName]: { ...prev?.inputs?.[fieldName], status: newStatus },
      },
    }));
    setConfirmingFields(prev => new Set(prev).add(fieldName));

    try {
      const newData = await api.updateCarbonInput(inputs, fieldName, currentValue, newStatus);
      setData(newData);
      if ((messageId && initiativeId) || instanceId) {
        const persisted = await persistWidgetToDb(initiativeId, messageId ?? '', instanceId, newData, workflowVersion);
        if (persisted && instanceId) onWorkflowUpdated?.();
      }
    } catch {
      setData((prev: any) => ({
        ...prev,
        inputs: {
          ...prev?.inputs,
          [fieldName]: { ...prev?.inputs?.[fieldName], status: currentStatus },
        },
      }));
    } finally {
      setConfirmingFields(prev => { const s = new Set(prev); s.delete(fieldName); return s; });
    }
  }, [inputs, preConfirmStatuses, setData, messageId, initiativeId, instanceId, onWorkflowUpdated, workflowVersion]);

  const switchMethodPack = useCallback(async (newPack: string) => {
    if (newPack === currentMethodPack) return;
    setIsSwitchingPack(true);
    try {
      const newData = await api.switchCarbonMethodPack(newPack, inputs);
      setData(newData);
      if ((messageId && initiativeId) || instanceId) {
        const persisted = await persistWidgetToDb(initiativeId, messageId ?? '', instanceId, newData, workflowVersion);
        if (persisted && instanceId) onWorkflowUpdated?.();
      }
    } catch {
      // keep old data
    } finally {
      setIsSwitchingPack(false);
    }
  }, [currentMethodPack, inputs, setData, messageId, initiativeId, instanceId, onWorkflowUpdated, workflowVersion]);

  /* ------------------------------------------------------------------ */
  /*  Shared derived data                                                */
  /* ------------------------------------------------------------------ */

  const groupedInputs = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat] || cat,
    inputs: Object.values(inputs).filter(
      (i: any) => (i.category || 'general') === cat
    ),
  })).filter((g) => g.inputs.length > 0);

  /* ------------------------------------------------------------------ */
  /*  Shared sub-renders                                                 */
  /* ------------------------------------------------------------------ */

  const renderInputsTable = (readOnly = false) => (
    <div className="divide-y divide-divider">
      {groupedInputs.map((group) => {
        const visibleInputs = group.inputs.filter((inp: any) => inp.field_name !== 'method_pack');
        if (visibleInputs.length === 0) return null;
        return (
          <div key={group.category}>
            <div className="px-5 py-2 bg-surface-subtle">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                {group.label}
              </span>
            </div>
            <div className="divide-y divide-stroke-subtle">
              {visibleInputs.map((inp: any) => {
                const isMissing = inp.status === 'missing';
                const isEditing = !readOnly && editingField === inp.field_name;
                const statusStyle = STATUS_STYLES[inp.status] || STATUS_STYLES.missing;
                const isSelect = !readOnly && inp.field_type === 'select' && inp.options?.length > 0;

                return (
                  <div
                    key={inp.field_name}
                    onMouseMove={readOnly ? undefined : (e) => {
                      const isInteractive = !!(e.target as HTMLElement).closest('button, input, select, a');
                      setOverInteractive(isInteractive);
                      setMousePos({ x: e.clientX, y: e.clientY });
                      setHoveredRowInp(inp);
                    }}
                    onMouseLeave={readOnly ? undefined : () => { setHoveredRowInp(null); setOverInteractive(false); }}
                    onClick={readOnly ? undefined : (e) => {
                      if ((e.target as HTMLElement).closest('button, input, select, a')) return;
                      investigate(inp.label, inp.status, inp.field_name);
                    }}
                    style={readOnly ? undefined : { cursor: hoveredRowInp?.field_name === inp.field_name && !overInteractive ? INVESTIGATE_CURSOR : undefined }}
                    className={`px-5 py-2.5 flex items-center gap-3 ${
                      isMissing ? 'bg-red-50/40' : 'bg-white'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-text-primary truncate">
                          {inp.label}
                        </span>
                        {inp.unit && (
                          <span className="text-[10px] text-text-tertiary">({inp.unit})</span>
                        )}
                      </div>
                      {!readOnly && inp.rationale && inp.status === 'assumed' && (
                        <p className="text-[10px] text-yellow-600 mt-0.5 truncate">
                          {inp.rationale}
                        </p>
                      )}
                    </div>

                    <div className="w-32 text-right">
                      {isSelect ? (
                        <div className="relative inline-flex">
                          <select
                            value={inp.value || ''}
                            disabled={!isActive}
                            onChange={async (e) => {
                              const newVal = e.target.value;
                              setIsRecalculating(true);
                              try {
                                const newData = await api.updateCarbonInput(inputs, inp.field_name, newVal, 'validated');
                                setData(newData);
                                if ((messageId && initiativeId) || instanceId) {
                                  const persisted = await persistWidgetToDb(initiativeId, messageId ?? '', instanceId, newData, workflowVersion);
                                  if (persisted && instanceId) onWorkflowUpdated?.();
                                }
                              } catch { /* keep old */ }
                              finally { setIsRecalculating(false); }
                            }}
                            className="appearance-none text-xs font-medium text-text-primary bg-surface border border-stroke-subtle rounded pl-2 pr-6 py-1 hover:border-text-tertiary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 cursor-pointer disabled:opacity-50 transition-colors duration-150"
                          >
                            {(inp.options as string[]).map((opt: string) => (
                              <option key={opt} value={opt}>
                                {opt.replace(/_/g, ' ')}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-tertiary pointer-events-none" />
                        </div>
                      ) : isEditing ? (
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={handleKeyDown}
                          onBlur={commitEdit}
                          autoFocus
                          className="w-full text-xs text-right px-2 py-1 border border-accent rounded bg-white outline-none"
                        />
                      ) : readOnly ? (
                        <span className="text-xs font-mono tabular-nums text-text-primary">
                          {isMissing ? (
                            <span className="text-red-500 italic">—</span>
                          ) : (
                            typeof inp.value === 'number'
                              ? inp.value.toLocaleString(undefined, { maximumFractionDigits: 6 })
                              : typeof inp.value === 'boolean' ? (inp.value ? 'Yes' : 'No') : inp.value
                          )}
                        </span>
                      ) : (
                        <button
                          onClick={() => isActive && startEdit(inp.field_name, inp.value)}
                          disabled={!isActive}
                          className="group inline-flex items-center gap-1 text-xs font-mono tabular-nums text-text-primary enabled:hover:text-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isMissing ? (
                            <span className="text-red-500 italic">—</span>
                          ) : (
                            <span>
                              {typeof inp.value === 'number'
                                ? inp.value.toLocaleString(undefined, { maximumFractionDigits: 6 })
                                : typeof inp.value === 'boolean' ? (inp.value ? 'Yes' : 'No') : inp.value}
                            </span>
                          )}
                          {isActive && (
                            <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                          )}
                        </button>
                      )}
                    </div>

                    <div className="w-16 flex justify-end">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${statusStyle.bg} ${statusStyle.text}`}
                      >
                        {inp.status === 'validated' && <CheckCircle2 className="w-2.5 h-2.5" />}
                        {inp.status === 'extracted' && <MessageSquare className="w-2.5 h-2.5" />}
                        {inp.status === 'assumed' && <Sparkles className="w-2.5 h-2.5" />}
                        {inp.status === 'missing' && <AlertCircle className="w-2.5 h-2.5" />}
                        {statusStyle.label}
                      </span>
                    </div>

                    {!readOnly && (
                      <div className="w-5 flex justify-center">
                        {isActive && (
                          <input
                            type="checkbox"
                            checked={inp.status === 'validated'}
                            disabled={isMissing || confirmingFields.has(inp.field_name)}
                            onChange={() => toggleConfirm(inp.field_name, inp.status, inp.value)}
                            title={inp.status === 'validated' ? 'Mark as extracted' : 'Mark as validated'}
                            className="w-3 h-3 rounded accent-green-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderInvestigateTooltip = () =>
    mounted && hoveredRowInp && !overInteractive && mousePos
      ? createPortal(
          <div
            className="pointer-events-none fixed z-[9999] px-2 py-0.5 rounded bg-gray-700 text-white text-[11px] font-medium shadow-md whitespace-nowrap"
            style={{ left: mousePos.x + 16, top: mousePos.y - 32 }}
          >
            Investigate
          </div>,
          document.body
        )
      : null;

  /* ================================================================== */
  /*  Inputs-only mode (no result yet)                                   */
  /* ================================================================== */

  const isLoadingInputs = isActive && Object.keys(inputs).length === 0;

  if (!result || forceInputsView) {
    return (
      <>
        <div className="card-elevated overflow-hidden !rounded-none">
          {isLoadingInputs ? (
            <WidgetGeneratingProgress steps={MODEL_INPUTS_STEPS} subtitle="Populating your carbon model…" />
          ) : (
          <>
          <div className="px-5 py-4 bg-surface-header border-b border-divider">
            <div className="flex items-center gap-2 mb-1">
              <Leaf className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-semibold text-text-primary">Carbon Emissions Model Inputs</h3>
            </div>

            {/* Project type selector */}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                Project Type
              </span>
              <div className="relative">
                <select
                  value={currentMethodPack}
                  disabled={!isActive || isSwitchingPack}
                  onChange={(e) => switchMethodPack(e.target.value)}
                  className="appearance-none text-xs font-medium text-text-primary bg-surface border border-stroke-subtle rounded-md pl-2.5 pr-7 py-1.5 hover:border-text-tertiary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 cursor-pointer disabled:opacity-50 transition-colors duration-150"
                >
                  {PROJECT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary pointer-events-none" />
              </div>
              {isSwitchingPack && (
                <span className="text-[10px] text-accent">Switching…</span>
              )}
            </div>

            <p className="text-xs text-text-secondary mt-2">
              {Object.keys(inputs).length} fields
              {missingEssentials.length > 0 && (
                <span className="text-red-600 ml-2">
                  &middot; {missingEssentials.length} critical input{missingEssentials.length !== 1 ? 's' : ''} missing
                </span>
              )}
            </p>
            {isRecalculating && (
              <p className="text-xs text-accent mt-1">Recalculating…</p>
            )}
          </div>

          {missingEssentials.length > 0 && (
            <div className="px-5 py-2.5 bg-red-50 border-b border-red-100 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
              <span className="text-xs text-red-700">
                Missing to compute ERs:{' '}
                {missingEssentials.map(f => (inputs[f] as any)?.label || f).join(', ')}
              </span>
            </div>
          )}

          {renderInputsTable()}

          <div className="px-5 py-3 bg-surface-header border-t border-divider">
            <p className="text-[10px] text-text-tertiary text-center">
              Click any value to edit &middot; Yellow = assumed value &middot; Red = missing
            </p>
          </div>
          </>
          )}
        </div>

        {!isLoadingInputs && renderInvestigateTooltip()}
      </>
    );
  }

  /* ================================================================== */
  /*  Full output mode                                                   */
  /* ================================================================== */

  const qualityStyle = QUALITY_STYLES[result.quality_label] || QUALITY_STYLES.moderate;
  const QualityIcon = qualityStyle.icon;

  const erSchedule = result.er_schedule || [];
  const displaySchedule = erSchedule.slice(0, isUnruly ? 10 : erSchedule.length);

  const sensitivityByParam = sensitivity.reduce((acc: Record<string, any[]>, p: any) => {
    if (!acc[p.param_name]) acc[p.param_name] = [];
    acc[p.param_name].push(p);
    return acc;
  }, {});

  const baselineEmissions = result.baseline_emissions_tco2e;
  const projectEmissions = result.project_emissions_tco2e;
  const leakageEmissions = result.leakage_tco2e;
  const netER = result.net_er_tco2e;

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    ...(sensitivity.length > 0 ? [{ id: 'sensitivity' as const, label: 'Sensitivity' }] : []),
    { id: 'schedule' as const, label: 'ER Schedule' },
    { id: 'inputs' as const, label: 'Inputs' },
  ];

  return (
    <>
    <div className="card-elevated overflow-hidden !rounded-none">
      <div className="px-5 py-5 bg-surface-header border-b border-divider">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Leaf className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-semibold text-text-primary">
                Net Emission Reductions
              </h3>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-text-primary tabular-nums">
                {netER.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
              <span className="text-sm text-text-secondary">tCO₂e / year</span>
            </div>
            <p className="text-[10px] text-text-tertiary mt-1">
              Baseline – Project – Leakage = Net
            </p>
          </div>
          <Tooltip
            content="Reflects data quality. High = mostly validated inputs. Moderate = mix of extracted and assumed values. Low = significant assumptions or missing data."
          >
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full cursor-help ${qualityStyle.bg}`}>
              <QualityIcon className={`w-3 h-3 ${qualityStyle.text}`} />
              <span className={`text-[10px] font-medium uppercase tracking-wider ${qualityStyle.text}`}>
                {result.quality_label} confidence
              </span>
            </div>
          </Tooltip>
        </div>
        <p className="text-xs text-text-tertiary mt-2">
          {PROJECT_TYPE_OPTIONS.find(o => o.value === currentMethodPack)?.label || currentMethodPack}
          {' '}&middot;{' '}
          {result.assumption_count} assumption{result.assumption_count !== 1 ? 's' : ''} used
          &middot; {result.period_years}-year crediting period
        </p>
        {isRecalculating && (
          <p className="text-xs text-accent mt-1">Recalculating…</p>
        )}
      </div>

      <div className="flex border-b border-divider bg-white">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="px-5 py-4 bg-white">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-3">
            Emissions Breakdown (Annual)
          </h4>
          <div className="space-y-2">
            {[
              {
                label: 'Baseline',
                tooltip: 'Emissions that would occur without this project — the counterfactual scenario used as the reference point.',
                value: baselineEmissions, share: result.baseline_share, color: 'bg-orange-400',
              },
              {
                label: 'Project',
                tooltip: 'Emissions actually produced by running this project (e.g. fuel use, electricity consumed).',
                value: projectEmissions, share: result.project_share, color: 'bg-emerald-500',
              },
              {
                label: 'Leakage',
                tooltip: 'Emissions that shift outside the project boundary because of this project (e.g. displaced activity). Deducted from the credit claim.',
                value: leakageEmissions, share: result.leakage_share, color: 'bg-purple-400',
              },
            ].map((c) => (
              <div key={c.label} className="flex items-center gap-3">
                <Tooltip content={c.tooltip}>
                  <span className="text-xs text-text-secondary w-16 cursor-help border-b border-dotted border-text-secondary/50">{c.label}</span>
                </Tooltip>
                <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${c.color}`}
                    style={{ width: `${(c.share * 100).toFixed(1)}%` }}
                  />
                </div>
                <span className="text-xs font-mono tabular-nums text-text-primary w-24 text-right">
                  {c.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} t
                </span>
              </div>
            ))}
            <div className="flex items-center gap-3 pt-2 border-t border-stroke-subtle">
              <Tooltip content="Net Emission Reductions = Baseline − Project − Leakage. The verified carbon credits generated by this project, in tCO₂e per year.">
                <span className="text-xs font-semibold text-text-primary w-16 cursor-help border-b border-dotted border-text-primary/40">Net ERs</span>
              </Tooltip>
              <div className="flex-1" />
              <span className="text-xs font-bold font-mono tabular-nums text-emerald-700 w-24 text-right">
                {netER.toLocaleString(undefined, { maximumFractionDigits: 2 })} t
              </span>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'inputs' && (
        <>
          {renderInputsTable(true)}
          <div className="px-5 py-2.5 bg-surface-subtle border-t border-divider">
            <p className="text-[10px] text-text-tertiary">
              To edit values, go back to the <span className="font-medium">Inputs</span> stage.
            </p>
          </div>
        </>
      )}

      {activeTab === 'sensitivity' && sensitivity.length > 0 && (
        <div className="bg-white">
          {Object.entries(sensitivityByParam).map(([param, points]: [string, any[]]) => {
            const sorted = [...points].sort((a, b) => a.test_value - b.test_value);
            const baseVal = points[0]?.base_value;
            const baseNetER = netER;

            return (
              <div key={param}>
                <div className="px-5 py-2 bg-surface-subtle border-b border-divider">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                    {points[0]?.param_label || param}
                  </span>
                </div>
                <div className="py-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-stroke-subtle">
                        <th className="text-left py-1 pl-5 pr-4 font-semibold text-text-secondary">Value</th>
                        <th className="text-right py-1 pr-4 font-semibold text-text-secondary">Net ERs (tCO₂e)</th>
                        <th className="text-right py-1 pr-5 font-semibold text-text-secondary">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((pt, i) => {
                        const isBase = Math.abs(pt.test_value - baseVal) < baseVal * 0.001;
                        const delta = baseNetER !== 0 ? ((pt.net_er - baseNetER) / baseNetER) * 100 : 0;
                        return (
                          <tr
                            key={i}
                            className={`border-b border-stroke-subtle/50 ${
                              isBase ? 'bg-accent-wash font-medium' : 'bg-white'
                            }`}
                          >
                            <td className="py-1 pl-5 pr-4 tabular-nums">
                              {baseVal <= 1
                                ? (pt.test_value * 100).toFixed(1) + '%'
                                : pt.test_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              {isBase && (
                                <span className="ml-1 text-[10px] text-accent">(base)</span>
                              )}
                            </td>
                            <td className="py-1 pr-4 text-right tabular-nums">
                              {pt.net_er.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </td>
                            <td
                              className={`py-1 pr-5 text-right tabular-nums ${
                                delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : ''
                              }`}
                            >
                              {isBase ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'schedule' && (
        <div className="py-4 overflow-x-auto bg-white">
          <p className="text-[10px] text-text-tertiary mb-3 px-5">{erSchedule.length} years</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-stroke-subtle">
                <th className="text-left py-1 pl-5 pr-3 font-semibold text-text-secondary">Year</th>
                <th className="text-right py-1 pr-3 font-semibold text-text-secondary">Devices</th>
                <th className="text-right py-1 pr-3 font-semibold text-text-secondary">Baseline (tCO₂e)</th>
                <th className="text-right py-1 pr-3 font-semibold text-text-secondary">Project (tCO₂e)</th>
                <th className="text-right py-1 pr-3 font-semibold text-text-secondary">Leakage (tCO₂e)</th>
                <th className="text-right py-1 pr-5 font-semibold text-text-secondary">
                  <Tooltip content="Net Emission Reductions = Baseline − Project − Leakage for this year.">
                    <span className="cursor-help border-b border-dotted border-text-secondary">Net ERs (tCO₂e)</span>
                  </Tooltip>
                </th>
              </tr>
            </thead>
            <tbody>
              {displaySchedule.map((row: any) => (
                <tr key={row.year} className="border-b border-stroke-subtle/50 bg-white">
                  <td className="py-1 pl-5 pr-3 tabular-nums">{row.year}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {row.devices_active.toLocaleString()}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {row.baseline_emissions.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {row.project_emissions.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {row.leakage.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-1 pr-5 text-right tabular-nums font-medium text-emerald-700">
                    {row.net_er.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isUnruly && erSchedule.length > displaySchedule.length && (
            <p className="text-[10px] text-text-tertiary mt-2 text-center px-5">
              Showing first {displaySchedule.length} of {erSchedule.length} years — export for full schedule
            </p>
          )}
        </div>
      )}

      <div className="px-5 py-3 bg-surface-header border-t border-divider flex items-center justify-between">
        <p className="text-[10px] text-text-tertiary">
          Edit values in the Inputs stage to recalculate
        </p>
        {outputFooterAction ? (
          <ConfirmButton
            onClick={outputFooterAction.onClick}
            disabled={outputFooterAction.disabled}
            loading={outputFooterAction.loading}
            label={outputFooterAction.label}
            loadingLabel="Confirming…"
          />
        ) : !instanceId && (
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="btn-primary !text-xs !px-4 !py-1.5"
          >
            <Download className="w-3 h-3" />
            {isExporting ? 'Exporting…' : 'Export to Excel'}
          </button>
        )}
      </div>
    </div>

    {activeTab === 'inputs' && renderInvestigateTooltip()}
    </>
  );
}
