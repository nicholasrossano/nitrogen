'use client';

import { AlertCircle, CheckCircle2, MessageSquare, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

export type ModelInputStatus = 'validated' | 'extracted' | 'assumed' | 'missing' | string;

export interface ModelInputRow {
  field_name: string;
  label: string;
  value: number | string | null;
  unit?: string | null;
  status: ModelInputStatus;
  rationale?: string | null;
}

export interface ModelInputGroup<T extends ModelInputRow> {
  category: string;
  label: string;
  inputs: T[];
}

export const MODEL_INPUT_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  validated: { bg: 'bg-green-50', text: 'text-green-700', label: 'Validated' },
  extracted: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Extracted' },
  assumed: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'Assumed' },
  missing: { bg: 'bg-red-50', text: 'text-red-700', label: 'Missing' },
};

interface Props<T extends ModelInputRow> {
  groups: Array<ModelInputGroup<T>>;
  hoveredFieldName?: string | null;
  editingField?: string | null;
  isActive?: boolean;
  confirmingFields?: Set<string>;
  showConfirmCheckbox?: boolean;
  onToggleConfirm?: (row: T) => void;
  renderTrailingCell?: (row: T) => ReactNode;
  trailingCellClassName?: string;
  valueCellClassName?: string;
  onRowMouseEnter?: (event: React.MouseEvent, row: T) => void;
  onRowMouseLeave?: () => void;
  onRowClick?: (event: React.MouseEvent, row: T) => void;
  renderValueCell: (row: T, isEditing: boolean) => ReactNode;
}

export function ModelInputsTable<T extends ModelInputRow>({
  groups,
  hoveredFieldName = null,
  editingField = null,
  isActive = true,
  confirmingFields = new Set<string>(),
  showConfirmCheckbox = false,
  onToggleConfirm,
  renderTrailingCell,
  trailingCellClassName = 'w-6 flex justify-center shrink-0',
  valueCellClassName = 'w-36 text-right shrink-0 text-xs font-mono tabular-nums text-text-primary',
  onRowMouseEnter,
  onRowMouseLeave,
  onRowClick,
  renderValueCell,
}: Props<T>) {
  return (
    <div className="divide-y divide-divider">
      {groups.map((group) => (
        <div key={group.category}>
          <div className="px-5 py-2 bg-surface-subtle">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              {group.label}
            </span>
          </div>

          <div className="divide-y divide-stroke-subtle">
            {group.inputs.map((row) => {
              const isMissing = row.status === 'missing';
              const isEditing = editingField === row.field_name;
              const statusStyle = MODEL_INPUT_STATUS_STYLES[row.status] || MODEL_INPUT_STATUS_STYLES.missing;
              const hasTrailingCell = showConfirmCheckbox || !!renderTrailingCell;

              return (
                <div
                  key={row.field_name}
                  onMouseEnter={(event) => onRowMouseEnter?.(event, row)}
                  onMouseLeave={() => onRowMouseLeave?.()}
                  onClick={(event) => onRowClick?.(event, row)}
                  className={`px-5 py-2.5 flex items-center gap-4 ${
                    isMissing ? 'bg-red-50/40' : 'bg-white'
                  } ${hoveredFieldName === row.field_name ? 'bg-gray-50/60' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-text-primary truncate">
                        {row.label}
                      </span>
                      {row.unit ? (
                        <span className="text-[10px] text-text-tertiary">({row.unit})</span>
                      ) : null}
                    </div>
                    {row.rationale && row.status === 'assumed' ? (
                      <p className="text-[10px] text-yellow-600 mt-0.5 truncate">
                        {row.rationale}
                      </p>
                    ) : null}
                  </div>

                  <div className="w-24 flex justify-end shrink-0">
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${statusStyle.bg} ${statusStyle.text}`}
                    >
                      {row.status === 'validated' && <CheckCircle2 className="w-2.5 h-2.5" />}
                      {row.status === 'extracted' && <MessageSquare className="w-2.5 h-2.5" />}
                      {row.status === 'assumed' && <Sparkles className="w-2.5 h-2.5" />}
                      {row.status === 'missing' && <AlertCircle className="w-2.5 h-2.5" />}
                      {statusStyle.label}
                    </span>
                  </div>

                  <div className={valueCellClassName}>
                    {renderValueCell(row, isEditing)}
                  </div>

                  {hasTrailingCell ? (
                    <div className={trailingCellClassName}>
                      {showConfirmCheckbox ? (
                        <input
                          type="checkbox"
                          checked={row.status === 'validated'}
                          disabled={!isActive || isMissing || confirmingFields.has(row.field_name)}
                          onChange={() => onToggleConfirm?.(row)}
                          title={row.status === 'validated' ? 'Mark as extracted' : 'Mark as validated'}
                          className="w-3 h-3 rounded accent-green-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                        />
                      ) : (
                        renderTrailingCell?.(row)
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
