'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Pencil,
  SlidersHorizontal,
} from 'lucide-react';
import { PanelHeader } from '@/components/ui';
import { api } from '@/lib/api';
import type { FieldContext } from '@/lib/api';
import { buildModelInputsContext } from '@/lib/modelInputsContext';
import { ModelInputsTable } from './shared/ModelInputsTable';

interface CarbonInput {
  field_name: string;
  label: string;
  value: number | string | null;
  unit: string;
  source: 'chat' | 'doc' | 'user' | 'assumption';
  status: 'validated' | 'extracted' | 'assumed' | 'missing';
  applies_to: 'baseline' | 'project' | 'leakage' | 'general';
  notes: string;
  rationale: string;
  category: string;
}

interface CarbonInputsWidgetProps {
  data: Record<string, any>;
  projectId: string;
  isActive?: boolean;
  hasOutputWidget?: boolean;
  messageId?: string;
  onRecalculated?: (newData: Record<string, any>) => void;
  onSendMessage?: (content: string) => void;
}


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

export function CarbonInputsWidget({
  data,
  projectId,
  isActive = true,
  hasOutputWidget = false,
  messageId,
  onRecalculated,
  onSendMessage,
}: CarbonInputsWidgetProps) {
  const missingEssentials: string[] = data?.missing_essentials || [];

  const persistWidget = useCallback((widgetData: Record<string, any>) => {
    if (messageId && projectId) {
      api.updateMessageWidget(projectId, messageId, widgetData).catch(() => {});
    }
  }, [messageId, projectId]);

  const [localInputs, setLocalInputs] = useState<Record<string, any>>(
    data?.inputs || {}
  );
  const [hoveredRow, setHoveredRow] = useState<{ field_name: string; label: string; status: string } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [overInteractive, setOverInteractive] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
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
      model_type: 'carbon' as const,
      assessment_id: 'carbon_model',
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
          const resolved = await api.resolveAssumption(projectId, 'carbon_model', fieldName);
          assumptionId = resolved.found ? resolved.assumption?.id ?? null : null;
        }
        if (!assumptionId) {
          const created = await api.createAssumption(projectId, {
            key: fieldName,
            label,
            value: input?.value ?? null,
            unit: input?.unit ?? null,
            source_type: 'assessment',
            source_reference: {
              assessment_id: 'carbon_model',
              stage_id: 'widget_state',
              field_name: fieldName,
            },
            status: input?.value === null || input?.value === undefined || input?.value === '' ? 'missing' : 'assumed',
            used_in_assessments: ['carbon_model'],
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
              toolHint: 'carbon_model',
              fieldContext,
              modelInputsContext: buildModelInputsContext('Carbon Model', localInputs, fieldContext),
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
        modelInputsContext: buildModelInputsContext('Carbon Model', localInputs, fieldContext),
      },
    }));
  }, [projectId, localInputs]);

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
      const result = await api.updateCarbonInput(localInputs, fieldName, currentValue, newStatus);
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

  const handleRowEnter = useCallback((e: React.MouseEvent, inp: CarbonInput) => {
    setHoveredRow({ field_name: inp.field_name, label: inp.label, status: inp.status });
    const isInteractive = !!(e.target as HTMLElement).closest('button, input, select, a');
    setOverInteractive(isInteractive);
    setMousePos({ x: e.clientX, y: e.clientY });
  }, []);

  const handleRowMove = useCallback((e: React.MouseEvent, _inp: CarbonInput) => {
    const isInteractive = !!(e.target as HTMLElement).closest('button, input, select, a');
    setOverInteractive(isInteractive);
    setMousePos({ x: e.clientX, y: e.clientY });
  }, []);

  const handleRowLeave = useCallback(() => {
    setHoveredRow(null);
    setOverInteractive(false);
  }, []);

  return (
    <div ref={cardRef} className="card-elevated overflow-hidden">
      <PanelHeader
        icon={SlidersHorizontal}
        title="Carbon Emissions Model Inputs"
        subtitle={<>{Object.keys(localInputs).length} fields{missingEssentials.length > 0 && <span className="text-red-600 ml-2">&middot; {missingEssentials.length} critical input{missingEssentials.length !== 1 ? 's' : ''} missing</span>}</>}
      />

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

      <ModelInputsTable
        groups={groupedInputs}
        hoveredFieldName={hoveredRow?.field_name ?? null}
        editingField={editingField}
        isActive={isActive}
        investigateCursor={isActive}
        confirmingFields={confirmingFields}
        showConfirmCheckbox={!hasOutputWidget}
        onToggleConfirm={(row) => toggleConfirm(row.field_name, row.status, row.value)}
        onRowMouseEnter={handleRowEnter}
        onRowMouseMove={handleRowMove}
        onRowMouseLeave={handleRowLeave}
        onRowClick={(event, row) => {
          if ((event.target as HTMLElement).closest('button, input, select, a')) return;
          investigate(row.label, row.status, row.field_name);
        }}
        renderValueCell={(row, isEditing) => (
          isEditing ? (
            <input
              type="text"
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={commitEdit}
              autoFocus
              className="w-full text-xs text-right px-2 py-1 border border-accent rounded bg-white outline-none"
            />
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

      {mounted && hoveredRow && mousePos && !overInteractive &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[9999] px-2 py-0.5 rounded bg-gray-700 text-white text-[11px] font-medium shadow-md whitespace-nowrap"
            style={{ left: mousePos.x + 16, top: mousePos.y - 32 }}
          >
            Investigate
          </div>,
          document.body
        )}
    </div>
  );
}
