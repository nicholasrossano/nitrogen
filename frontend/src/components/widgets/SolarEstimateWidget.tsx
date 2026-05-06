'use client';

import { useState, useCallback, useMemo, useEffect, lazy, Suspense, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Sun,
  AlertTriangle,
  CheckCircle2,
  Pencil,
  AlertCircle,
  Zap,
  Download,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { api } from '@/lib/api';
import { buildModelInputsContext } from '@/lib/modelInputsContext';
import type { WorkspaceWidgetFooterState } from '@/lib/widgetRegistry';
import { ConfirmButton } from '@/components/ui';
import { PanelHeader } from '@/components/ui/PanelHeader';
import { CustomDropdown } from '@/components/ui/CustomDropdown';
import { ModelInputsTable } from './shared/ModelInputsTable';

const SolarLocationMap = lazy(() => import('./solar/SolarLocationMap'));

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
    console.error('[SolarEstimateWidget] persist failed:', err);
    return false;
  }
}

interface SolarEstimateWidgetProps {
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

const CATEGORY_ORDER = ['location', 'system', 'orientation', 'performance'];
const CATEGORY_LABELS: Record<string, string> = {
  location: 'Location',
  system: 'System',
  orientation: 'Orientation',
  performance: 'Performance',
};

const MODULE_TYPE_LABELS: Record<number, string> = { 0: 'Standard', 1: 'Premium', 2: 'Thin Film' };
const ARRAY_TYPE_LABELS: Record<number, string> = {
  0: 'Fixed - Open Rack',
  1: 'Fixed - Roof Mounted',
  2: '1-Axis Tracking',
  3: '1-Axis Backtracking',
  4: '2-Axis Tracking',
};

const DROPDOWN_OPTIONS: Record<string, Array<{ value: number; label: string }>> = {
  assessment_type: [
    { value: 0, label: 'Standard' },
    { value: 1, label: 'Premium' },
    { value: 2, label: 'Thin Film' },
  ],
  array_type: [
    { value: 0, label: 'Fixed - Open Rack' },
    { value: 1, label: 'Fixed - Roof Mounted' },
    { value: 2, label: '1-Axis Tracking' },
    { value: 3, label: '1-Axis Backtracking' },
    { value: 4, label: '2-Axis Tracking' },
  ],
};

const NUMERIC_CONSTRAINTS: Record<string, { min?: number; max?: number; step?: number }> = {
  tilt: { min: 0, max: 90, step: 0.1 },
  azimuth: { min: 0, max: 360, step: 0.1 },
  losses: { min: 0, max: 100, step: 0.1 },
  dc_ac_ratio: { min: 0.1, max: 5, step: 0.01 },
  inv_eff: { min: 0, max: 100, step: 0.1 },
  gcr: { min: 0.01, max: 1, step: 0.01 },
  system_capacity: { min: 0.01, step: 0.1 },
  lat: { min: -90, max: 90, step: 0.0001 },
  lon: { min: -180, max: 180, step: 0.0001 },
};

function formatValue(fieldName: string, value: any): string {
  if (value === null || value === undefined) return '—';
  if (fieldName === 'assessment_type') return MODULE_TYPE_LABELS[Number(value)] ?? String(value);
  if (fieldName === 'array_type') return ARRAY_TYPE_LABELS[Number(value)] ?? String(value);
  if (typeof value === 'number') {
    if (fieldName === 'lat' || fieldName === 'lon') return value.toFixed(4);
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return String(value);
}

export function SolarEstimateWidget({
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
}: SolarEstimateWidgetProps) {
  const [data, setDataRaw] = useState(initialData);
  const setData = useCallback((newData: any) => {
    setDataRaw(newData);
    if (messageId || instanceId) {
      persistWidgetToDb(initiativeId, messageId ?? '', instanceId, newData, workflowVersion).then((persisted) => {
        if (persisted && instanceId) onWorkflowUpdated?.();
      });
    }
  }, [initiativeId, messageId, instanceId, onWorkflowUpdated, workflowVersion]);

  useEffect(() => { setDataRaw(initialData); }, [initialData]);

  const [activeTab, setActiveTab] = useState<'overview' | 'inputs' | 'monthly'>('overview');
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [hoveredRowInp, setHoveredRowInp] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [overInteractive, setOverInteractive] = useState(false);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const [chartReady, setChartReady] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const node = chartContainerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') {
      setChartReady(true);
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setChartReady(width > 0 && height > 0);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [activeTab, isActive]);

  // Listen for proposed value confirmations from chat
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.model_type !== 'solar') return;
      const fieldName = detail.field_name;
      const value = detail.value;
      if (!fieldName || value === undefined) return;
      handleFieldUpdate(fieldName, value, 'validated');
    };
    window.addEventListener('nitrogen:input-confirmed', handler);
    return () => window.removeEventListener('nitrogen:input-confirmed', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const inputs = useMemo<Record<string, any>>(() => data.inputs ?? {}, [data.inputs]);
  const result = data.result;
  const missingEssentials: string[] = data.missing_essentials || [];
  const hasResult = !!result;
  const forceInputsView = workspaceView === 'build';
  const error = data.error;

  const groupedInputs = useMemo(
    () =>
      CATEGORY_ORDER.map((cat) => ({
        category: cat,
        label: CATEGORY_LABELS[cat] || cat,
        inputs: Object.entries(inputs)
          .filter(([, inp]: any) => (inp.category || 'performance') === cat)
          .map(([field_name, inp]: any) => ({ ...inp, field_name })),
      })).filter((group) => group.inputs.length > 0),
    [inputs],
  );

  const assumptionCount = useMemo(
    () => Object.values(inputs).filter((i: any) => i.status === 'assumed').length,
    [inputs],
  );

  const handleFieldUpdate = useCallback(
    async (fieldName: string, value: any, status: string = 'validated') => {
      setIsRecalculating(true);
      try {
        const result = await api.updateSolarInput(inputs, fieldName, value, status);
        setData(result);
      } catch (err) {
        console.error('Solar update-input failed:', err);
      } finally {
        setIsRecalculating(false);
      }
    },
    [inputs, setData],
  );

  const startEdit = useCallback((fieldName: string, currentValue: any) => {
    setEditingField(fieldName);
    setEditValue(currentValue === null || currentValue === undefined ? '' : String(currentValue));
  }, []);

  const commitEdit = useCallback(() => {
    if (!editingField) return;
    const parsed = editValue === '' ? null : isNaN(Number(editValue)) ? editValue : Number(editValue);
    handleFieldUpdate(editingField, parsed);
    setEditingField(null);
    setEditValue('');
  }, [editingField, editValue, handleFieldUpdate]);

  const [recalcError, setRecalcError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const handleRunEstimate = useCallback(async () => {
    setIsRecalculating(true);
    setRecalcError(null);
    try {
      const result = await api.recalculateSolar(inputs);
      setData(result);
    } catch (err: any) {
      const msg = err?.message || 'Solar estimate failed. Please check your inputs and try again.';
      setRecalcError(msg);
      console.error('Solar recalculate failed:', err);
    } finally {
      setIsRecalculating(false);
    }
  }, [inputs, setData]);

  const handleExport = useCallback(async () => {
    if (!result) return;
    setIsExporting(true);
    try {
      const blob = await api.exportSolarExcel(inputs, result);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'solar_estimate.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently fail
    } finally {
      setIsExporting(false);
    }
  }, [inputs, result]);

  const handleLocationChange = useCallback(
    async (lat: number, lon: number, address?: string) => {
      const updatedInputs = { ...inputs };
      if (updatedInputs.lat) { updatedInputs.lat = { ...updatedInputs.lat, value: lat, source: 'user', status: 'validated' }; }
      if (updatedInputs.lon) { updatedInputs.lon = { ...updatedInputs.lon, value: lon, source: 'user', status: 'validated' }; }
      if (address && updatedInputs.address) {
        updatedInputs.address = { ...updatedInputs.address, value: address, source: 'user', status: 'validated' };
      }
      setDataRaw((prev: any) => ({ ...prev, inputs: updatedInputs }));
      setIsRecalculating(true);
      try {
        const result = await api.recalculateSolar(updatedInputs);
        setData(result);
      } catch (err) {
        console.error('Solar location update failed:', err);
      } finally {
        setIsRecalculating(false);
      }
    },
    [inputs, setData],
  );

  const handleInvestigate = useCallback((fieldName: string, label: string, status: string) => {
    const text =
      status === 'extracted'  ? `Can you investigate the value for ${label} and propose a specific alternative with supporting evidence?` :
      status === 'assumed'   ? `Can you research and propose a better value for ${label} based on available data for this project?` :
      status === 'validated' ? `Can you validate the value for ${label} and propose alternatives if there are better estimates?` :
      `Can you investigate and propose a value for ${label}?`;
    const input = inputs[fieldName];
    const fieldContext = {
      field_name: fieldName,
      label,
      current_value: typeof input?.value === 'number' ? input.value : null,
      unit: input?.unit || null,
      model_type: 'solar' as const,
      status: status || null,
    };

    window.dispatchEvent(new CustomEvent('nitrogen:draft', {
      detail: {
        text,
        label,
        fieldName,
        fieldContext,
        modelInputsContext: buildModelInputsContext('Solar Model', inputs, fieldContext),
      },
    }));
  }, [inputs]);

  // Monthly chart data
  const chartData = useMemo(() => {
    if (!result?.ac_monthly) return [];
    return result.ac_monthly.map((val: number, i: number) => ({
      month: MONTH_LABELS[i],
      kWh: Math.round(val),
    }));
  }, [result]);

  const maxKwh = useMemo(() => Math.max(...chartData.map((d: any) => d.kWh), 1), [chartData]);

  const renderInputsTable = () => (
    <ModelInputsTable
      groups={groupedInputs}
      hoveredFieldName={hoveredRowInp}
      editingField={editingField}
      isActive={isActive}
      onRowMouseEnter={(event, row) => {
        const isInteractive = !!(event.target as HTMLElement).closest('button, input, select, a');
        setOverInteractive(isInteractive);
        setMousePos({ x: event.clientX, y: event.clientY });
        setHoveredRowInp(row.field_name);
      }}
      onRowMouseLeave={() => {
        setHoveredRowInp(null);
        setOverInteractive(false);
      }}
      onRowClick={(event, row) => {
        if ((event.target as HTMLElement).closest('button, input, select, a')) return;
        if (!editingField && !overInteractive) {
          handleInvestigate(row.field_name, row.label, row.status);
        }
      }}
      renderValueCell={(row, isEditing) => {
        const fieldName = row.field_name;
        const dropdownOpts = DROPDOWN_OPTIONS[fieldName];
        const numericConstraints = NUMERIC_CONSTRAINTS[fieldName];
        const isLocationField = fieldName === 'lat' || fieldName === 'lon' || fieldName === 'address';

        if (dropdownOpts) {
          return (
            <div className="flex justify-end" onMouseEnter={() => setOverInteractive(true)} onMouseLeave={() => setOverInteractive(false)}>
              <CustomDropdown
                value={String(row.value ?? 0)}
                onChange={(value) => handleFieldUpdate(fieldName, Number(value))}
                options={dropdownOpts.map((opt) => ({ value: String(opt.value), label: opt.label }))}
                ariaLabel={`Select ${row.label}`}
                className="h-7 w-36 inline-flex items-center justify-between gap-2 rounded border border-stroke-subtle bg-white px-2 text-xs text-text-primary hover:border-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
                menuClassName="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-stroke-subtle bg-white p-1 shadow-lg"
                itemClassName="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-xs transition-colors"
              />
            </div>
          );
        }

        if (isEditing) {
          return (
            <input
              autoFocus
              type={numericConstraints ? 'number' : 'text'}
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              onBlur={commitEdit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitEdit();
                if (event.key === 'Escape') {
                  setEditingField(null);
                  setEditValue('');
                }
              }}
              min={numericConstraints?.min}
              max={numericConstraints?.max}
              step={numericConstraints?.step}
              className="w-full px-1 py-0.5 text-[11px] font-mono border border-accent rounded bg-white outline-none"
              onMouseEnter={() => setOverInteractive(true)}
              onMouseLeave={() => setOverInteractive(false)}
            />
          );
        }

        return (
          <button
            type="button"
            onClick={() => !isLocationField && startEdit(fieldName, row.value)}
            className="group inline-flex items-center justify-end gap-1 text-right hover:text-accent transition-colors"
            onMouseEnter={() => setOverInteractive(true)}
            onMouseLeave={() => setOverInteractive(false)}
            title={isLocationField ? 'Edit via map' : 'Click to edit'}
          >
            <span>{formatValue(fieldName, row.value)}</span>
            {!isLocationField && (
              <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
            )}
          </button>
        );
      }}
    />
  );

  // Investigate tooltip (pointer-events-none dark pill — same pattern as LCOE widget)
  const investigateTooltip = mounted && hoveredRowInp && !editingField && !overInteractive
    ? createPortal(
        <div
          className="pointer-events-none fixed z-[9999] px-2 py-0.5 rounded bg-gray-700 text-white text-[11px] font-medium shadow-md whitespace-nowrap"
          style={{ left: mousePos.x + 16, top: mousePos.y - 32 }}
        >
          Investigate
        </div>,
        document.body,
      )
    : null;

  // ======================= INPUTS-ONLY MODE =======================
  if (!hasResult || forceInputsView) {
    const displayError = recalcError || error;
    return (
      <div className="flex flex-col h-full bg-surface-primary">
        <PanelHeader
          icon={Sun}
          title="Solar Production Estimate"
        />

        <div className="flex-1 overflow-y-auto py-3 space-y-3">
          {/* Missing essentials banner */}
          {missingEssentials.length > 0 && (
            <div className="mx-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
              <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-[11px] text-amber-800">
                <span className="font-medium">Missing required inputs: </span>
                {missingEssentials.map((f) => inputs[f]?.label || f).join(', ')}
              </div>
            </div>
          )}

          {displayError && (
            <div className="mx-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
              <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
              <div className="text-[11px] text-red-800">{displayError}</div>
            </div>
          )}

          {/* Map */}
          <div className="px-3">
            <Suspense fallback={<div className="h-[180px] bg-surface-subtle rounded-lg animate-pulse" />}>
              <SolarLocationMap
                lat={inputs.lat?.value ?? null}
                lon={inputs.lon?.value ?? null}
                address={inputs.address?.value}
                onLocationChange={handleLocationChange}
                disabled={isRecalculating}
              />
            </Suspense>
          </div>

          {/* Inputs table */}
          {renderInputsTable()}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-stroke-subtle px-3 py-2.5 flex items-center justify-between gap-3">
          <span className="text-[10px] text-text-tertiary truncate">
            Powered by PVWatts V8 (NREL)
          </span>
          {!forceInputsView && (
            <button
              type="button"
              onClick={handleRunEstimate}
              disabled={missingEssentials.length > 0 || isRecalculating}
              className="shrink-0 btn-primary !text-xs !px-4 !py-1.5"
            >
              {isRecalculating ? 'Running...' : 'Run Estimate'}
            </button>
          )}
        </div>

        {investigateTooltip}
      </div>
    );
  }

  // ======================= RESULTS MODE =======================
  const qualityStyle = QUALITY_STYLES[result.quality_label] || QUALITY_STYLES.moderate;
  const QualityIcon = qualityStyle.icon;

  const stationInfo = result.station_info || {};
  const weatherCitation = stationInfo.state
    ? `Weather data: ${stationInfo.city ? `${stationInfo.city}, ` : ''}${stationInfo.state}${stationInfo.weather_data_source ? ` (${stationInfo.weather_data_source})` : ''}${stationInfo.distance != null ? ` — ${(stationInfo.distance / 1000).toFixed(0)} km from site` : ''}`
    : null;

  return (
    <div className="card-elevated overflow-hidden flex flex-col h-full bg-surface-primary">
      {/* Header with headline metrics */}
      <div className="shrink-0 border-b border-stroke-subtle">
        <PanelHeader
          icon={Sun}
          title="Solar Production Estimate"
        />
        <div className="px-4 py-3 flex items-end gap-6">
          <div>
            <div className="text-[10px] text-text-tertiary uppercase tracking-wide mb-0.5">Year 1 AC Energy</div>
            <div className="text-2xl font-semibold text-text-primary leading-none">
              {Math.round(result.ac_annual).toLocaleString()}
              <span className="text-sm font-normal text-text-tertiary ml-1">kWh</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] text-text-tertiary uppercase tracking-wide mb-0.5">Capacity Factor</div>
            <div className="text-2xl font-semibold text-text-primary leading-none">
              {result.capacity_factor.toFixed(1)}
              <span className="text-sm font-normal text-text-tertiary ml-0.5">%</span>
            </div>
          </div>
          <div className="ml-auto self-center">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium uppercase tracking-wider ${qualityStyle.bg} ${qualityStyle.text}`}>
              <QualityIcon className="w-3 h-3" />
              {result.quality_label} confidence
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="shrink-0 flex border-b border-stroke-subtle">
        {(['overview', 'monthly', 'inputs'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
              activeTab === tab
                ? 'border-accent text-accent'
                : 'border-transparent text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {tab === 'overview' ? 'Overview' : tab === 'inputs' ? 'Inputs' : 'Monthly Data'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'overview' && (
          <div className="px-3 py-3 space-y-4">
            {/* Monthly bar chart */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-2 px-1">
                Monthly AC Energy (kWh)
              </div>
              <div ref={chartContainerRef} className="h-[200px] min-w-0">
                {isActive && chartReady ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                    <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-stroke-subtle, #e5e7eb)" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary, #9ca3af)' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-tertiary, #9ca3af)' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                      <RechartsTooltip
                        contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e5e7eb' }}
                        cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                        formatter={(value) => [`${Number(value).toLocaleString()} kWh`, 'AC Energy']}
                      />
                      <Bar dataKey="kWh" radius={[3, 3, 0, 0]} maxBarSize={32}>
                        {chartData.map((_: any, i: number) => (
                          <Cell key={i} fill={`hsl(38, 92%, ${55 + (chartData[i].kWh / maxKwh) * 15}%)`} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full" />
                )}
              </div>
            </div>

            {/* Solar radiation summary */}
            <div className="flex items-center gap-4 px-2 py-2 rounded-lg bg-surface-subtle">
              <Zap className="w-4 h-4 text-amber-500 shrink-0" />
              <div className="text-[11px] text-text-secondary">
                Annual Solar Radiation: <span className="font-medium text-text-primary">{result.solrad_annual?.toFixed(2)} kWh/m²/day</span>
              </div>
            </div>

          </div>
        )}

        {activeTab === 'inputs' && (
          <div className="py-3 space-y-3">
            <div className="px-3">
              <Suspense fallback={<div className="h-[180px] bg-surface-subtle rounded-lg animate-pulse" />}>
                <SolarLocationMap
                  lat={inputs.lat?.value ?? null}
                  lon={inputs.lon?.value ?? null}
                  address={inputs.address?.value}
                  onLocationChange={handleLocationChange}
                  disabled={isRecalculating}
                />
              </Suspense>
            </div>
            {renderInputsTable()}
          </div>
        )}

        {activeTab === 'monthly' && (
          <div className="px-3 py-3">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-stroke-subtle">
                  <th className="text-left py-1.5 px-2 text-text-tertiary font-medium">Month</th>
                  <th className="text-right py-1.5 px-2 text-text-tertiary font-medium">AC Energy (kWh)</th>
                  <th className="text-right py-1.5 px-2 text-text-tertiary font-medium">DC Energy (kWh)</th>
                  <th className="text-right py-1.5 px-2 text-text-tertiary font-medium">Solar Rad. (kWh/m²/day)</th>
                  <th className="text-right py-1.5 px-2 text-text-tertiary font-medium">POA (kWh/m²)</th>
                </tr>
              </thead>
              <tbody>
                {MONTH_LABELS.map((month, i) => (
                  <tr key={month} className="border-b border-stroke-subtle/50 hover:bg-surface-subtle/50">
                    <td className="py-1.5 px-2 font-medium text-text-secondary">{month}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-text-primary">{Math.round(result.ac_monthly[i]).toLocaleString()}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-text-primary">{Math.round(result.dc_monthly[i]).toLocaleString()}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-text-secondary">{result.solrad_monthly[i].toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-text-secondary">{result.poa_monthly[i].toFixed(1)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-stroke-subtle font-medium">
                  <td className="py-1.5 px-2 text-text-primary">Annual</td>
                  <td className="py-1.5 px-2 text-right font-mono text-text-primary">{Math.round(result.ac_annual).toLocaleString()}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-text-primary">
                    {result.dc_monthly ? Math.round(result.dc_monthly.reduce((a: number, b: number) => a + b, 0)).toLocaleString() : '—'}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-text-secondary">{result.solrad_annual?.toFixed(2)}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-text-secondary">
                    {result.poa_monthly ? result.poa_monthly.reduce((a: number, b: number) => a + b, 0).toFixed(1) : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-stroke-subtle px-3 py-2.5 flex items-center justify-between gap-3">
        <span className="text-[10px] text-text-tertiary truncate">
          Powered by PVWatts V8 (NREL)
          {weatherCitation && <><span className="mx-1.5">·</span>{weatherCitation}</>}
        </span>
        {outputFooterAction ? (
          <ConfirmButton
            onClick={outputFooterAction.onClick}
            disabled={outputFooterAction.disabled}
            loading={outputFooterAction.loading}
            label={outputFooterAction.label}
            loadingLabel="Confirming…"
            className="shrink-0"
          />
        ) : !instanceId && (
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className="shrink-0 btn-primary !text-xs !px-4 !py-1.5"
          >
            <Download className="w-3 h-3" />
            {isExporting ? 'Exporting…' : 'Export to Excel'}
          </button>
        )}
      </div>

      {investigateTooltip}
    </div>
  );
}
