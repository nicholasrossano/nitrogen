'use client';

import { useState, useCallback } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  MessageSquare,
  FileText,
  User,
  Sparkles,
  Pencil,
} from 'lucide-react';
import { api } from '@/lib/api';

interface CarbonInput {
  field_name: string;
  label: string;
  value: number | string | null;
  unit: string;
  source: 'chat' | 'doc' | 'user' | 'assumption';
  status: 'confirmed' | 'inferred' | 'assumed' | 'missing';
  applies_to: 'baseline' | 'project' | 'leakage' | 'general';
  notes: string;
  rationale: string;
  category: string;
}

interface CarbonInputsWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
  onRecalculated?: (newData: Record<string, any>) => void;
}

const SOURCE_ICONS: Record<string, typeof MessageSquare> = {
  chat: MessageSquare,
  doc: FileText,
  user: User,
  assumption: Sparkles,
};

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  confirmed: { bg: 'bg-green-50', text: 'text-green-700', label: 'Confirmed' },
  inferred: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Inferred' },
  assumed: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'Assumed' },
  missing: { bg: 'bg-red-50', text: 'text-red-700', label: 'Missing' },
};

const APPLIES_TO_STYLES: Record<string, { bg: string; text: string }> = {
  baseline: { bg: 'bg-orange-50', text: 'text-orange-700' },
  project: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  leakage: { bg: 'bg-purple-50', text: 'text-purple-700' },
  general: { bg: 'bg-gray-50', text: 'text-gray-600' },
};

const CATEGORY_ORDER = ['activity', 'baseline', 'project', 'emissions', 'leakage', 'general'];
const CATEGORY_LABELS: Record<string, string> = {
  activity: 'Activity',
  baseline: 'Baseline Scenario',
  project: 'Project Scenario',
  emissions: 'Emission Factors',
  leakage: 'Leakage',
  general: 'General',
};

export function CarbonInputsWidget({
  data,
  initiativeId,
  isActive = true,
  onRecalculated,
}: CarbonInputsWidgetProps) {
  const missingEssentials: string[] = data?.missing_essentials || [];

  const [localInputs, setLocalInputs] = useState<Record<string, any>>(
    data?.inputs || {}
  );
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [isRecalculating, setIsRecalculating] = useState(false);

  const groupedInputs = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat] || cat,
    inputs: Object.values(localInputs).filter(
      (i: any) => (i.category || 'general') === cat
    ) as CarbonInput[],
  })).filter((g) => g.inputs.length > 0);

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
      const result = await api.updateCarbonInput(localInputs, editingField, parsed);
      setLocalInputs(result.inputs || localInputs);
      onRecalculated?.(result);
    } catch {
      // keep old values on failure
    } finally {
      setEditingField(null);
      setEditValue('');
      setIsRecalculating(false);
    }
  }, [editingField, editValue, localInputs, onRecalculated]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') commitEdit();
      if (e.key === 'Escape') cancelEdit();
    },
    [commitEdit, cancelEdit]
  );

  return (
    <div className="card-elevated overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 bg-surface-header border-b border-divider">
        <h3 className="text-sm font-semibold text-text-primary">Carbon Emissions Model Inputs</h3>
        <p className="text-xs text-text-secondary mt-0.5">
          {Object.keys(localInputs).length} fields
          {missingEssentials.length > 0 && (
            <span className="text-red-600 ml-2">
              &middot; {missingEssentials.length} critical input{missingEssentials.length !== 1 ? 's' : ''} missing
            </span>
          )}
        </p>
      </div>

      {/* Missing essentials banner */}
      {missingEssentials.length > 0 && (
        <div className="px-5 py-2.5 bg-red-50 border-b border-red-100 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
          <span className="text-xs text-red-700">
            Missing to compute ERs:{' '}
            {missingEssentials
              .map((f) => {
                const inp = localInputs[f] as CarbonInput | undefined;
                return inp?.label || f;
              })
              .join(', ')}
          </span>
        </div>
      )}

      {/* Input table grouped by category */}
      <div className="divide-y divide-divider">
        {groupedInputs.map((group) => (
          <div key={group.category}>
            <div className="px-5 py-2 bg-surface-subtle">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                {group.label}
              </span>
            </div>

            <div className="divide-y divide-stroke-subtle">
              {group.inputs.map((inp) => {
                const isMissing = inp.status === 'missing';
                const isEditing = editingField === inp.field_name;
                const statusStyle = STATUS_STYLES[inp.status] || STATUS_STYLES.missing;
                const appliesToStyle = APPLIES_TO_STYLES[inp.applies_to] || APPLIES_TO_STYLES.general;
                const SourceIcon = SOURCE_ICONS[inp.source] || HelpCircle;

                return (
                  <div
                    key={inp.field_name}
                    className={`px-5 py-2.5 flex items-center gap-3 ${
                      isMissing ? 'bg-red-50/40' : 'bg-white'
                    }`}
                  >
                    {/* Label */}
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

                    {/* Applies-to badge */}
                    <div className="w-16 flex justify-end">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium capitalize ${appliesToStyle.bg} ${appliesToStyle.text}`}
                      >
                        {inp.applies_to}
                      </span>
                    </div>

                    {/* Value (editable) */}
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
                                ? inp.value.toLocaleString(undefined, {
                                    maximumFractionDigits: 6,
                                  })
                                : inp.value}
                            </span>
                          )}
                          {isActive && (
                            <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                          )}
                        </button>
                      )}
                    </div>

                    {/* Status badge */}
                    <div className="w-16 flex justify-end">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${statusStyle.bg} ${statusStyle.text}`}
                      >
                        {inp.status === 'confirmed' && <CheckCircle2 className="w-2.5 h-2.5" />}
                        {inp.status === 'assumed' && <Sparkles className="w-2.5 h-2.5" />}
                        {inp.status === 'missing' && <AlertCircle className="w-2.5 h-2.5" />}
                        {statusStyle.label}
                      </span>
                    </div>

                    {/* Source icon */}
                    <div className="w-5 flex justify-center" title={`Source: ${inp.source}`}>
                      <SourceIcon className="w-3 h-3 text-text-tertiary" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      {isRecalculating && (
        <div className="px-5 py-2.5 bg-accent-wash border-t border-divider text-center">
          <span className="text-xs text-accent">Recalculating…</span>
        </div>
      )}

      <div className="px-5 py-3 bg-surface-header border-t border-divider">
        <p className="text-[10px] text-text-tertiary text-center">
          Click any value to edit &middot; Yellow = assumed value &middot; Red = missing
        </p>
      </div>
    </div>
  );
}
