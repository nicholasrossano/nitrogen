'use client';

import { useState, useCallback, useRef } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  MessageSquare,
  Sparkles,
  Pencil,
  SlidersHorizontal,
} from 'lucide-react';
import { PanelHeader } from '@/components/ui';
import { api } from '@/lib/api';
import type { FieldContext } from '@/lib/api';
import { buildModelInputsContext } from '@/lib/modelInputsContext';

interface LCOEInput {
  field_name: string;
  label: string;
  value: number | string | null;
  unit: string;
  source: 'chat' | 'doc' | 'user' | 'assumption';
  status: 'validated' | 'extracted' | 'assumed' | 'missing';
  notes: string;
  rationale: string;
  category: string;
}

interface LCOEInputsWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
  hasOutputWidget?: boolean;
  messageId?: string;
  onRecalculated?: (newData: Record<string, any>) => void;
  onSendMessage?: (content: string) => void;
}


const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  validated: { bg: 'bg-green-50', text: 'text-green-700', label: 'Validated' },
  extracted: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Extracted' },
  assumed: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'Assumed' },
  missing: { bg: 'bg-red-50', text: 'text-red-700', label: 'Missing' },
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

export function LCOEInputsWidget({
  data,
  initiativeId,
  isActive = true,
  hasOutputWidget = false,
  messageId,
  onRecalculated,
  onSendMessage,
}: LCOEInputsWidgetProps) {
  const inputsMap: Record<string, LCOEInput> = data?.inputs || {};
  const missingEssentials: string[] = data?.missing_essentials || [];
  const persistWidget = useCallback((widgetData: Record<string, any>) => {
    if (messageId && initiativeId) {
      api.updateMessageWidget(initiativeId, messageId, widgetData).catch(() => {});
    }
  }, [messageId, initiativeId]);

  const [localInputs, setLocalInputs] = useState<Record<string, any>>(
    data?.inputs || {}
  );
  const [hoveredRow, setHoveredRow] = useState<{ field_name: string; label: string; status: string; top: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [confirmingFields, setConfirmingFields] = useState<Set<string>>(new Set());
  const [preConfirmStatuses, setPreConfirmStatuses] = useState<Record<string, string>>({});

  const investigate = useCallback(async (label: string, status: string, fieldName?: string) => {
    const text =
      status === 'extracted' ? `Can you investigate the value for ${label} and propose a specific alternative with supporting evidence?` :
      status === 'assumed'  ? `Can you research and propose a better value for ${label} based on available data for this project?` :
      status === 'validated'? `Can you validate the value for ${label} and propose alternatives if there are better estimates?` :
      `Can you investigate and propose a value for ${label}?`;
    const input = fieldName ? localInputs[fieldName] : undefined;
    const fieldContext: FieldContext | null = fieldName ? {
      field_name: fieldName,
      label,
      current_value: typeof input?.value === 'number' ? input.value : null,
      unit: input?.unit || null,
      model_type: 'lcoe' as const,
      module_id: 'lcoe_model',
      status: status || null,
    } : null;
    if (fieldName && fieldContext) {
      const localAssumptionId =
        typeof input?.assumption_id === 'string' && input.assumption_id.trim().length > 0
          ? input.assumption_id
          : null;
      try {
        let assumptionId = localAssumptionId;
        if (!assumptionId) {
          const resolved = await api.resolveAssumption(initiativeId, 'lcoe_model', fieldName);
          assumptionId = resolved.found ? resolved.assumption?.id ?? null : null;
        }
        if (!assumptionId) {
          const created = await api.createAssumption(initiativeId, {
            key: fieldName,
            label,
            value: input?.value ?? null,
            unit: input?.unit ?? null,
            source_type: 'module',
            source_reference: {
              module_id: 'lcoe_model',
              stage_id: 'widget_state',
              field_name: fieldName,
            },
            status: input?.value === null || input?.value === undefined || input?.value === '' ? 'missing' : 'assumed',
            used_in_modules: ['lcoe_model'],
          });
          assumptionId = created.id;
        }
        if (assumptionId) {
          fieldContext.assumption_id = assumptionId;
          window.dispatchEvent(new CustomEvent('nitrogen:open-assumption-chat', {
            detail: {
              assumptionId,
              title: label,
              text,
              toolHint: 'lcoe_model',
              fieldContext,
              modelInputsContext: buildModelInputsContext('LCOE Model', localInputs, fieldContext),
            },
          }));
          return;
        }
      } catch {
        // Fall through to draft-only behavior.
      }
    }

    window.dispatchEvent(new CustomEvent('nitrogen:draft', {
      detail: {
        text,
        label,
        fieldName,
        fieldContext,
        modelInputsContext: buildModelInputsContext('LCOE Model', localInputs, fieldContext),
      },
    }));
  }, [initiativeId, localInputs]);

  const groupedInputs = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat] || cat,
    inputs: Object.values(localInputs).filter(
      (i: any) => (i.category || 'general') === cat
    ) as LCOEInput[],
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
      const result = await api.updateLCOEInput(localInputs, editingField, parsed);
      setLocalInputs(result.inputs || localInputs);
      persistWidget(result);
      onRecalculated?.(result);
    } catch {
      // keep old values on failure
    } finally {
      setEditingField(null);
      setEditValue('');
      setIsRecalculating(false);
    }
  }, [editingField, editValue, localInputs, persistWidget, onRecalculated]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') commitEdit();
      if (e.key === 'Escape') cancelEdit();
    },
    [commitEdit, cancelEdit]
  );

  const toggleConfirm = useCallback(async (fieldName: string, currentStatus: string, currentValue: any) => {
    const isConfirmed = currentStatus === 'validated';
    const newStatus = isConfirmed ? (preConfirmStatuses[fieldName] || 'extracted') : 'validated';

    if (!isConfirmed) {
      setPreConfirmStatuses(prev => ({ ...prev, [fieldName]: currentStatus }));
    }

    setLocalInputs(prev => ({
      ...prev,
      [fieldName]: { ...prev[fieldName], status: newStatus },
    }));
    setConfirmingFields(prev => new Set(prev).add(fieldName));

    try {
      const result = await api.updateLCOEInput(localInputs, fieldName, currentValue, newStatus);
      setLocalInputs(result.inputs || localInputs);
      persistWidget(result);
      onRecalculated?.(result);
    } catch {
      setLocalInputs(prev => ({
        ...prev,
        [fieldName]: { ...prev[fieldName], status: currentStatus },
      }));
    } finally {
      setConfirmingFields(prev => { const s = new Set(prev); s.delete(fieldName); return s; });
    }
  }, [localInputs, preConfirmStatuses, persistWidget, onRecalculated]);

  const handleRowHover = useCallback((e: React.MouseEvent, inp: LCOEInput) => {
    if (!cardRef.current) return;
    const rowRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cardRect = cardRef.current.getBoundingClientRect();
    setHoveredRow({
      field_name: inp.field_name,
      label: inp.label,
      status: inp.status,
      top: rowRect.top - cardRect.top + rowRect.height / 2,
    });
  }, []);

  return (
    <div
      ref={cardRef}
      className="relative flex items-start gap-0"
      onMouseLeave={() => setHoveredRow(null)}
    >
      <div className="flex-1 min-w-0 card-elevated overflow-hidden">
        <PanelHeader
          icon={SlidersHorizontal}
          title="LCOE Model Inputs"
          subtitle={<>{Object.keys(localInputs).length} fields{missingEssentials.length > 0 && <span className="text-red-600 ml-2">&middot; {missingEssentials.length} critical input{missingEssentials.length !== 1 ? 's' : ''} missing</span>}</>}
        />

        {/* Missing essentials banner */}
        {missingEssentials.length > 0 && (
          <div className="px-5 py-2.5 bg-red-50 border-b border-red-100 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
            <span className="text-xs text-red-700">
              Missing to compute LCOE:{' '}
              {missingEssentials
                .map((f) => {
                  const inp = localInputs[f] as LCOEInput | undefined;
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

                  return (
                    <div
                      key={inp.field_name}
                      onMouseEnter={(e) => handleRowHover(e, inp)}
                      className={`px-5 py-2.5 flex items-center gap-3 ${
                        isMissing ? 'bg-red-50/40' : 'bg-white'
                      } ${hoveredRow?.field_name === inp.field_name ? 'bg-gray-50/60' : ''}`}
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
                            className="group inline-flex items-center gap-1 text-xs font-mono tabular-nums text-text-primary enabled:hover:text-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                          {inp.status === 'validated' && <CheckCircle2 className="w-2.5 h-2.5" />}
                          {inp.status === 'extracted' && <MessageSquare className="w-2.5 h-2.5" />}
                          {inp.status === 'assumed' && <Sparkles className="w-2.5 h-2.5" />}
                          {inp.status === 'missing' && <AlertCircle className="w-2.5 h-2.5" />}
                          {statusStyle.label}
                        </span>
                      </div>

                      {/* Confirm checkbox */}
                      <div className="w-5 flex justify-center">
                        {isActive && !hasOutputWidget && (
                          <input
                            type="checkbox"
                            checked={inp.status === 'validated'}
                            disabled={isMissing || confirmingFields.has(inp.field_name)}
                            onChange={() => toggleConfirm(inp.field_name, inp.status, inp.value)}
                            title={inp.status === 'validated' ? 'Mark as extracted' : 'Mark as validated'}
                            className="w-3 h-3 rounded-full accent-green-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
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

      {/* Right gutter — holds Investigate button aligned with hovered row */}
      <div className="relative w-[90px] flex-shrink-0 self-stretch">
        {hoveredRow && (
          <button
            onClick={() => {
              const { label, status, field_name } = hoveredRow;
              setHoveredRow(null);
              investigate(label, status, field_name);
            }}
            className="absolute left-2 -translate-y-1/2 text-[11px] font-medium text-accent hover:text-accent-anchor px-2.5 py-1 rounded-md border border-accent/20 bg-white hover:bg-accent-wash shadow-sm transition-all whitespace-nowrap cursor-pointer"
            style={{ top: hoveredRow.top }}
          >
            Investigate
          </button>
        )}
      </div>
    </div>
  );
}
