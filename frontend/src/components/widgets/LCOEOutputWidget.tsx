'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  Calculator,
  TrendingUp,
  Download,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Pencil,
  AlertCircle,
  MessageSquare,
} from 'lucide-react';
import { api } from '@/lib/api';

interface LCOEOutputWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
}


const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  confirmed: { bg: 'bg-green-50', text: 'text-green-700', label: 'Confirmed' },
  inferred: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Inferred' },
  assumed: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'Assumed' },
  missing: { bg: 'bg-red-50', text: 'text-red-700', label: 'Missing' },
};

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

export function LCOEOutputWidget({
  data: initialData,
  initiativeId,
  isActive = true,
}: LCOEOutputWidgetProps) {
  const [data, setData] = useState(initialData);
  const [activeTab, setActiveTab] = useState<'overview' | 'inputs' | 'sensitivity' | 'cashflow'>('overview');
  const [isExporting, setIsExporting] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [confirmingFields, setConfirmingFields] = useState<Set<string>>(new Set());
  const [preConfirmStatuses, setPreConfirmStatuses] = useState<Record<string, string>>({});

  const result = data?.result;
  const inputs = useMemo(() => data?.inputs || {}, [data]);
  const sensitivity: any[] = data?.sensitivity || [];
  const isUnruly = data?.is_unruly ?? false;

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
    } catch {
      // keep old values
    } finally {
      setEditingField(null);
      setEditValue('');
      setIsRecalculating(false);
    }
  }, [editingField, editValue, inputs]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') commitEdit();
      if (e.key === 'Escape') cancelEdit();
    },
    [commitEdit, cancelEdit]
  );

  const toggleConfirm = useCallback(async (fieldName: string, currentStatus: string, currentValue: any) => {
    const isConfirmed = currentStatus === 'confirmed';
    const newStatus = isConfirmed ? (preConfirmStatuses[fieldName] || 'inferred') : 'confirmed';

    if (!isConfirmed) {
      setPreConfirmStatuses(prev => ({ ...prev, [fieldName]: currentStatus }));
    }

    setData(prev => ({
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
    } catch {
      setData(prev => ({
        ...prev,
        inputs: {
          ...prev?.inputs,
          [fieldName]: { ...prev?.inputs?.[fieldName], status: currentStatus },
        },
      }));
    } finally {
      setConfirmingFields(prev => { const s = new Set(prev); s.delete(fieldName); return s; });
    }
  }, [inputs, preConfirmStatuses]);

  if (!result) return null;

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

  const groupedInputs = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat] || cat,
    inputs: Object.values(inputs).filter(
      (i: any) => (i.category || 'general') === cat
    ),
  })).filter((g) => g.inputs.length > 0);

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'inputs' as const, label: 'Inputs' },
    ...(sensitivity.length > 0 ? [{ id: 'sensitivity' as const, label: 'Sensitivity' }] : []),
    { id: 'cashflow' as const, label: `Cash Flow` },
  ];

  return (
    <div className="card-elevated overflow-hidden">
      {/* Header */}
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
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${qualityStyle.bg}`}>
            <QualityIcon className={`w-3 h-3 ${qualityStyle.text}`} />
            <span className={`text-[10px] font-medium uppercase tracking-wider ${qualityStyle.text}`}>
              {result.quality_label} confidence
            </span>
          </div>
        </div>
        <p className="text-xs text-text-tertiary mt-2">
          {result.assumption_count} assumption{result.assumption_count !== 1 ? 's' : ''} used
          &middot; {result.lifetime_energy_kwh.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh total production
        </p>
        {isRecalculating && (
          <p className="text-xs text-accent mt-1">Recalculating…</p>
        )}
      </div>

      {/* Tab bar */}
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

      {/* Tab content */}
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
              <span className="text-[10px] text-text-tertiary">Discounted Costs (NPV)</span>
              <p className="text-xs font-medium text-text-primary">
                {currency} {result.npv_total_costs.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
            <div>
              <span
                className="text-[10px] text-text-tertiary cursor-help border-b border-dotted border-text-tertiary"
                title="Energy discounted to year 0 — the denominator in the LCOE formula. Lower than total production because future kWh are worth less in today's terms."
              >
                Discounted Energy (NPV)
              </span>
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
        <div className="divide-y divide-divider">
          {groupedInputs.map((group) => (
            <div key={group.category}>
              <div className="px-5 py-2 bg-surface-subtle">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {group.label}
                </span>
              </div>
              <div className="divide-y divide-stroke-subtle">
                {group.inputs.map((inp: any) => {
                  const isMissing = inp.status === 'missing';
                  const isEditing = editingField === inp.field_name;
                  const statusStyle = STATUS_STYLES[inp.status] || STATUS_STYLES.missing;

                  return (
                    <div
                      key={inp.field_name}
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
                        {inp.rationale && inp.status === 'assumed' && (
                          <p className="text-[10px] text-yellow-600 mt-0.5 truncate">
                            {inp.rationale}
                          </p>
                        )}
                      </div>

                      <div className="w-28 text-right">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onBlur={commitEdit}
                            autoFocus
                            className="w-full text-xs text-right px-2 py-1 border border-accent rounded bg-white outline-none"
                          />
                        ) : (
                          <button
                            onClick={() => isActive && startEdit(inp.field_name, inp.value)}
                            disabled={!isActive}
                            className="group inline-flex items-center gap-1 text-xs font-mono tabular-nums text-text-primary hover:text-accent transition-colors disabled:opacity-50"
                          >
                            {isMissing ? (
                              <span className="text-red-500 italic">—</span>
                            ) : (
                              <span>
                                {typeof inp.value === 'number'
                                  ? inp.value.toLocaleString(undefined, { maximumFractionDigits: 6 })
                                  : inp.value}
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
                          {inp.status === 'confirmed' && <CheckCircle2 className="w-2.5 h-2.5" />}
                          {inp.status === 'inferred' && <MessageSquare className="w-2.5 h-2.5" />}
                          {inp.status === 'assumed' && <Sparkles className="w-2.5 h-2.5" />}
                          {inp.status === 'missing' && <AlertCircle className="w-2.5 h-2.5" />}
                          {statusStyle.label}
                        </span>
                      </div>

                      <div className="w-5 flex justify-center">
                        {isActive && (
                          <input
                            type="checkbox"
                            checked={inp.status === 'confirmed'}
                            disabled={isMissing || confirmingFields.has(inp.field_name)}
                            onChange={() => toggleConfirm(inp.field_name, inp.status, inp.value)}
                            title={inp.status === 'confirmed' ? 'Mark as unconfirmed' : 'Confirm this value'}
                            className="w-3 h-3 rounded accent-green-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'sensitivity' && sensitivity.length > 0 && (
        <div className="px-5 py-4 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-accent" />
            <span className="text-xs font-medium text-text-primary">Sensitivity Analysis</span>
          </div>
          {Object.entries(sensitivityByParam).map(([param, points]: [string, any[]]) => {
            const sorted = [...points].sort((a, b) => a.test_value - b.test_value);
            const baseVal = points[0]?.base_value;
            const baseLCOE = result.lcoe;

            return (
              <div key={param}>
                <h5 className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">
                  {points[0]?.param_label || param}
                </h5>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-stroke-subtle">
                        <th className="text-left py-1 pr-4 font-medium text-text-secondary">Value</th>
                        <th className="text-right py-1 pr-4 font-medium text-text-secondary">LCOE</th>
                        <th className="text-right py-1 font-medium text-text-secondary">Δ</th>
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
                            <td className="py-1 pr-4 tabular-nums">
                              {pt.test_value < 1
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
                              className={`py-1 text-right tabular-nums ${
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
        <div className="px-5 py-4 overflow-x-auto">
          <p className="text-[10px] text-text-tertiary mb-3">{cashFlows.length} years</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-stroke-subtle">
                <th className="text-left py-1 pr-3 font-medium text-text-secondary">Year</th>
                <th className="text-right py-1 pr-3 font-medium text-text-secondary">CAPEX</th>
                <th className="text-right py-1 pr-3 font-medium text-text-secondary">O&M</th>
                <th className="text-right py-1 pr-3 font-medium text-text-secondary">Energy (kWh)</th>
                <th className="text-right py-1 pr-3 font-medium text-text-secondary">Disc. Cost</th>
                <th className="text-right py-1 font-medium text-text-secondary">Disc. Energy</th>
              </tr>
            </thead>
            <tbody>
              {displayCashFlows.map((cf: any) => (
                <tr key={cf.year} className="border-b border-stroke-subtle/50 bg-white">
                  <td className="py-1 pr-3 tabular-nums">{cf.year}</td>
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
                  <td className="py-1 text-right tabular-nums">
                    {cf.discounted_energy.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isUnruly && cashFlows.length > displayCashFlows.length && (
            <p className="text-[10px] text-text-tertiary mt-2 text-center">
              Showing first {displayCashFlows.length} of {cashFlows.length} years — export for full model
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="px-5 py-3 bg-surface-header border-t border-divider flex items-center justify-between">
        <p className="text-[10px] text-text-tertiary">
          {activeTab === 'inputs' ? 'Edit any input to recalculate instantly' : 'Switch to Inputs to edit values'}
        </p>
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="btn-primary !text-xs !px-4 !py-1.5"
        >
          <Download className="w-3 h-3" />
          {isExporting ? 'Exporting…' : 'Export to Excel'}
        </button>
      </div>
    </div>
  );
}
