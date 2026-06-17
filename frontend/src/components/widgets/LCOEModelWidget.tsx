'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Calculator,
  Download,
  AlertTriangle,
  CheckCircle2,
  Pencil,
  AlertCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { buildModelInputsContext } from '@/lib/modelInputsContext';
import type { WorkspaceWidgetFooterState } from '@/lib/widgetRegistry';
import { ConfirmButton } from '@/components/ui';
import { Tooltip } from '@/components/ui/Tooltip';
import { WidgetGeneratingProgress, MODEL_INPUTS_STEPS } from './WidgetGeneratingProgress';
import { projectVariableLower } from '@/lib/projectVariablesCopy';
import { ModelInputsTable } from './shared/ModelInputsTable';

/**
 * Persist widget data: write to DB first (source of truth), then notify the active chat surface.
 * Returns true if the DB write succeeded.
 */
async function persistWidgetToDb(
  initiativeId: string,
  messageId: string,
  instanceId: string | undefined,
  widgetData: Record<string, any>,
  workflowVersion?: number,
): Promise<boolean> {
  try {
    if (instanceId) {
      await api.persistAssessmentWorkflowWidget(instanceId, widgetData, workflowVersion);
      return true;
    }
    await api.updateMessageWidget(initiativeId, messageId, widgetData);
    window.dispatchEvent(new CustomEvent('nitrogen:chat-widget-updated', {
      detail: { messageId, widgetData },
    }));
    return true;
  } catch (err) {
    console.error('[LCOEModelWidget] persist failed:', err);
    return false;
  }
}

interface LCOEModelWidgetProps {
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

const QUALITY_STYLES: Record<string, { bg: string; text: string; icon: typeof CheckCircle2 }> = {
  high: { bg: 'bg-green-50', text: 'text-green-700', icon: CheckCircle2 },
  moderate: { bg: 'bg-yellow-50', text: 'text-yellow-700', icon: AlertTriangle },
  low: { bg: 'bg-red-50', text: 'text-red-700', icon: AlertTriangle },
};

const CATEGORY_ORDER = ['project', 'energy', 'costs', 'finance', 'timing', 'general'];
const CATEGORY_LABELS: Record<string, string> = {
  project: 'Project Definition',
  energy: 'Energy Production',
  costs: 'Costs',
  finance: 'Finance / Discounting',
  timing: 'Timing',
  general: 'General',
};

export function LCOEModelWidget({
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
}: LCOEModelWidgetProps) {
  const [data, setDataRaw] = useState(initialData);
  const setData = useCallback((newData: any) => {
    setDataRaw((prev: any) =>
      typeof newData === 'function' ? newData(prev) : newData
    );
  }, []);
  const [activeTab, setActiveTab] = useState<'overview' | 'inputs' | 'sensitivity' | 'cashflow'>('overview');
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
  useEffect(() => { setMounted(true); }, []);

  const result = data?.result;
  const forceInputsView = workspaceView === 'build';
  const inputs = useMemo(() => data?.inputs || {}, [data]);
  const missingEssentials: string[] = data?.missing_essentials || [];
  const sensitivity: any[] = data?.sensitivity || [];
  const isUnruly = data?.is_unruly ?? false;

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.model_type !== 'lcoe') return;
      const fieldName = detail.field_name;
      const value = detail.value;
      (async () => {
        setIsRecalculating(true);
        try {
          const newData = await api.updateLCOEInput(inputs, fieldName, value, 'validated');
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
      const blob = await api.exportLCOEExcel(inputs);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'lcoe_model.xlsx';
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
      const newData = await api.updateLCOEInput(inputs, editingField, parsed);
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
      model_type: 'lcoe' as const,
      status: status || null,
    } : null;

    window.dispatchEvent(new CustomEvent('nitrogen:draft', {
      detail: {
        text,
        label,
        fieldName,
        fieldContext,
        modelInputsContext: buildModelInputsContext('LCOE Model', inputs, fieldContext),
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
      const newData = await api.updateLCOEInput(inputs, fieldName, currentValue, newStatus);
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

  // readOnly=true: shown in the results tab (no editing, no confirm checkboxes).
  // readOnly=false: shown in the standalone inputs view (full interactivity).
  const renderInputsTable = (readOnly = false) => (
    <ModelInputsTable
      groups={groupedInputs as any}
      hoveredFieldName={hoveredRowInp?.field_name ?? null}
      editingField={editingField}
      isActive={isActive}
      confirmingFields={confirmingFields}
      showConfirmCheckbox={!readOnly}
      onToggleConfirm={readOnly ? undefined : (row: any) => toggleConfirm(row.field_name, row.status, row.value)}
      onRowMouseEnter={readOnly ? undefined : (event, row: any) => {
        const isInteractive = !!(event.target as HTMLElement).closest('button, input, a');
        setOverInteractive(isInteractive);
        setMousePos({ x: event.clientX, y: event.clientY });
        setHoveredRowInp(row);
      }}
      onRowMouseLeave={readOnly ? undefined : () => { setHoveredRowInp(null); setOverInteractive(false); }}
      onRowClick={readOnly ? undefined : (event, row: any) => {
        if ((event.target as HTMLElement).closest('button, input, a')) return;
        investigate(row.label, row.status, row.field_name);
      }}
      renderValueCell={(row: any, isEditing) => (
        isEditing ? (
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
            {row.status === 'missing' ? (
              <span className="text-red-500 italic">—</span>
            ) : (
              typeof row.value === 'number'
                ? row.value.toLocaleString(undefined, { maximumFractionDigits: 6 })
                : row.value
            )}
          </span>
        ) : (
          <button
            onClick={() => isActive && startEdit(row.field_name, row.value)}
            disabled={!isActive}
            className="group inline-flex items-center gap-1 text-xs font-mono tabular-nums text-text-primary enabled:hover:text-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {row.status === 'missing' ? (
              <span className="text-red-500 italic">—</span>
            ) : (
              <span>
                {typeof row.value === 'number'
                  ? row.value.toLocaleString(undefined, { maximumFractionDigits: 6 })
                  : row.value}
              </span>
            )}
            {isActive && (
              <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
            )}
          </button>
        )
      )}
    />
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
            <WidgetGeneratingProgress steps={MODEL_INPUTS_STEPS} subtitle="Populating your LCOE model…" />
          ) : (
          <>
          <div className="px-5 py-4 bg-surface-header border-b border-divider">
            <div className="flex items-center gap-2 mb-1">
              <Calculator className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-semibold text-text-primary">LCOE Model Inputs</h3>
            </div>
            <p className="text-xs text-text-secondary mt-0.5">
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
                Missing to compute LCOE:{' '}
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

  const currency = result.currency || 'USD';
  const qualityStyle = QUALITY_STYLES[result.quality_label] || QUALITY_STYLES.moderate;
  const QualityIcon = qualityStyle.icon;

  const cashFlows = result.cash_flows || [];
  const displayCashFlows = cashFlows.slice(0, isUnruly ? 10 : cashFlows.length);

  const sensitivityByParam = sensitivity.reduce((acc: Record<string, any[]>, p: any) => {
    if (!acc[p.param_name]) acc[p.param_name] = [];
    acc[p.param_name].push(p);
    return acc;
  }, {});

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    ...(sensitivity.length > 0 ? [{ id: 'sensitivity' as const, label: 'Sensitivity' }] : []),
    { id: 'cashflow' as const, label: 'Cash Flow' },
    { id: 'inputs' as const, label: 'Inputs' },
  ];

  return (
    <>
    <div className="card-elevated overflow-hidden !rounded-none">
      <div className="px-5 py-5 bg-surface-header border-b border-divider">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Calculator className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-semibold text-text-primary">LCOE Result</h3>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-text-primary tabular-nums">
                {currency} {result.lcoe.toFixed(4)}
              </span>
              <span className="text-sm text-text-secondary">/kWh</span>
            </div>
          </div>
          <Tooltip
            content="Reflects data quality. High = mostly validated inputs. Moderate = mix of extracted and assumed values. Low = many assumed values or missing data."
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
          {result.assumption_count} {projectVariableLower(result.assumption_count)} used
          &middot; {result.lifetime_energy_kwh.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh total production
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
            Cost Breakdown (NPV)
          </h4>
          <div className="space-y-2">
            {[
              { label: 'CAPEX', share: result.capex_share, color: 'bg-blue-500' },
              { label: 'O&M', share: result.opex_share, color: 'bg-emerald-500' },
              { label: 'Fuel', share: result.fuel_share, color: 'bg-amber-500' },
              { label: 'Replacements', share: result.replacement_share, color: 'bg-purple-500' },
            ]
              .filter((c) => c.share > 0)
              .map((c) => (
                <div key={c.label} className="flex items-center gap-3">
                  <span className="text-xs text-text-secondary w-24">{c.label}</span>
                  <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${c.color}`}
                      style={{ width: `${(c.share * 100).toFixed(1)}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono tabular-nums text-text-primary w-12 text-right">
                    {(c.share * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
          </div>
          <div className="mt-3 pt-3 border-t border-stroke-subtle grid grid-cols-2 gap-4">
            <div>
              <Tooltip content="All project costs (CAPEX, O&M, fuel, replacements) discounted back to today's value using the discount rate. This is the numerator in the LCOE formula.">
                <span className="text-[10px] text-text-tertiary cursor-help border-b border-dotted border-text-tertiary">
                  Discounted Costs (NPV)
                </span>
              </Tooltip>
              <p className="text-xs font-medium text-text-primary">
                {currency} {result.npv_total_costs.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
            <div>
              <Tooltip content="Energy production discounted to today's value as future kWh are worth less in present terms. This is the denominator in the LCOE formula.">
                <span className="text-[10px] text-text-tertiary cursor-help border-b border-dotted border-text-tertiary">
                  Discounted Energy (NPV)
                </span>
              </Tooltip>
              <p className="text-xs font-medium text-text-primary">
                {result.npv_total_energy.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh
              </p>
            </div>
          </div>
          <p className="text-[10px] text-text-tertiary mt-2">
            LCOE = Discounted Costs ÷ Discounted Energy &middot; Total production (undiscounted):{' '}
            {result.lifetime_energy_kwh.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh
          </p>
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
            const baseLCOE = result.lcoe;

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
                        <th className="text-right py-1 pr-4 font-semibold text-text-secondary">LCOE</th>
                        <th className="text-right py-1 pr-5 font-semibold text-text-secondary">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((pt, i) => {
                        const isBase = Math.abs(pt.test_value - baseVal) < baseVal * 0.001;
                        const delta = ((pt.lcoe - baseLCOE) / baseLCOE) * 100;
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
                              {currency} {pt.lcoe.toFixed(4)}
                            </td>
                            <td
                              className={`py-1 pr-5 text-right tabular-nums ${
                                delta > 0 ? 'text-red-600' : delta < 0 ? 'text-green-600' : ''
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

      {activeTab === 'cashflow' && (
        <div className="py-4 overflow-x-auto bg-white">
          <p className="text-[10px] text-text-tertiary mb-3 px-5">{cashFlows.length} years</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-stroke-subtle">
                <th className="text-left py-1 pl-5 pr-3 font-semibold text-text-secondary">Year</th>
                <th className="text-right py-1 pr-3 font-semibold text-text-secondary">
                  <Tooltip content="Capital expenditure — one-time upfront or milestone-based costs.">
                    <span className="cursor-help border-b border-dotted border-text-secondary">CAPEX</span>
                  </Tooltip>
                </th>
                <th className="text-right py-1 pr-3 font-semibold text-text-secondary">
                  <Tooltip content="Operations & Maintenance — recurring annual costs to run the project.">
                    <span className="cursor-help border-b border-dotted border-text-secondary">O&amp;M</span>
                  </Tooltip>
                </th>
                <th className="text-right py-1 pr-3 font-semibold text-text-secondary">Energy (kWh)</th>
                <th className="text-right py-1 pr-3 font-semibold text-text-secondary">
                  <Tooltip content="Total cost in this year discounted back to year 0 using the project discount rate.">
                    <span className="cursor-help border-b border-dotted border-text-secondary">Disc. Cost</span>
                  </Tooltip>
                </th>
                <th className="text-right py-1 pr-5 font-semibold text-text-secondary">
                  <Tooltip content="Energy produced in this year discounted back to year 0 — reflects the time value of energy.">
                    <span className="cursor-help border-b border-dotted border-text-secondary">Disc. Energy</span>
                  </Tooltip>
                </th>
              </tr>
            </thead>
            <tbody>
              {displayCashFlows.map((cf: any) => (
                <tr key={cf.year} className="border-b border-stroke-subtle/50 bg-white">
                  <td className="py-1 pl-5 pr-3 tabular-nums">{cf.year}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {cf.capex > 0 ? cf.capex.toLocaleString() : '—'}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {cf.opex > 0 ? cf.opex.toLocaleString() : '—'}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {cf.energy_kwh > 0
                      ? cf.energy_kwh.toLocaleString(undefined, { maximumFractionDigits: 0 })
                      : '—'}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {cf.discounted_cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                  <td className="py-1 pr-5 text-right tabular-nums">
                    {cf.discounted_energy.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isUnruly && cashFlows.length > displayCashFlows.length && (
            <p className="text-[10px] text-text-tertiary mt-2 text-center px-5">
              Showing first {displayCashFlows.length} of {cashFlows.length} years — export for full model
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
