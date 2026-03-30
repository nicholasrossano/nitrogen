'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import type { WorkflowSetup, SetupFieldDef } from '@/lib/api';
import { api } from '@/lib/api';

interface SetupStageProps {
  instanceId: string;
  setup: WorkflowSetup;
  setupFields: SetupFieldDef[];
  onConfirmed: () => void;
}


export function SetupStage({ instanceId, setup, setupFields, onConfirmed }: SetupStageProps) {
  const [fields, setFields] = useState<Record<string, string>>(setup.fields ?? {});
  const [drafting, setDrafting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const didAutoGenerate = useRef(false);

  // Auto-draft on first mount if fields are empty
  useEffect(() => {
    if (didAutoGenerate.current) return;
    const hasValues = setupFields.some((f) => !!fields[f.name]?.trim());
    if (!hasValues) {
      didAutoGenerate.current = true;
      handleGenerateDefaults();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerateDefaults = async () => {
    setDrafting(true);
    setError(null);
    try {
      const result = await api.generateSetupDefaults(instanceId);
      setFields((prev) => ({ ...prev, ...result.fields }));
    } catch (e: any) {
      setError(e.message ?? 'Failed to generate defaults');
    } finally {
      setDrafting(false);
    }
  };

  const startEdit = (name: string) => {
    setEditingField(name);
    setEditValue(fields[name] ?? '');
  };

  const commitEdit = (name: string) => {
    const trimmed = editValue.trim();
    setFields((prev) => ({ ...prev, [name]: trimmed }));
    setEditingField(null);
    setEditValue('');
  };

  const handleConfirm = async () => {
    setConfirming(true);
    setError(null);
    try {
      await api.confirmWorkflowSetup(instanceId, fields);
      onConfirmed();
    } catch (e: any) {
      setError(e.message ?? 'Failed to confirm setup');
    } finally {
      setConfirming(false);
    }
  };

  const allRequired = setupFields
    .filter((f) => f.required !== false)
    .every((f) => !!fields[f.name]?.trim());

  return (
    <div className="p-3">
      <div className="card-elevated overflow-hidden">

        {/* Card header */}
        <div className="px-4 py-2.5 border-b border-divider bg-surface-subtle">
          <p className="text-sm font-medium text-text-primary">Setup</p>
        </div>

        {/* Drafting overlay banner */}
        {drafting && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-accent/5 border-b border-accent/10 text-xs text-accent">
            <Loader2 className="w-3 h-3 animate-spin" />
            Drafting from project context…
          </div>
        )}

        {error && (
          <div className="text-xs text-red-400 bg-red-500/10 border-b border-red-500/20 px-4 py-2.5">
            {error}
          </div>
        )}

        {/* Input table — matches solar estimate style */}
        <table className="w-full border-collapse bg-white">
        <tbody>
          {setupFields.map((fieldDef) => {
            const value = fields[fieldDef.name] ?? '';
            const isEditing = editingField === fieldDef.name;

            return (
              <tr
                key={fieldDef.name}
                className="border-b border-stroke-subtle/50 last:border-b-0"
              >
                {/* Label */}
                <td className="py-2 px-4 text-[11px] text-text-secondary w-[120px] align-top pt-2.5">
                  {fieldDef.label}
                  {fieldDef.required !== false && (
                    <span className="text-red-400 ml-0.5">*</span>
                  )}
                </td>

                {/* Value */}
                <td className="py-1.5 px-2 text-[11px] text-text-primary">
                  {isEditing ? (
                    fieldDef.field_type === 'select' ? (
                      <select
                        autoFocus
                        className="w-full px-1.5 py-1 text-[11px] border border-accent rounded bg-white outline-none"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => commitEdit(fieldDef.name)}
                      >
                        <option value="">Select…</option>
                        {fieldDef.options?.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : fieldDef.field_type === 'textarea' ? (
                      <textarea
                        autoFocus
                        rows={3}
                        className="w-full px-1.5 py-1 text-[11px] border border-accent rounded bg-white outline-none resize-none"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => commitEdit(fieldDef.name)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') { setEditingField(null); setEditValue(''); }
                        }}
                      />
                    ) : (
                      <input
                        autoFocus
                        type="text"
                        className="w-full px-1.5 py-0.5 text-[11px] border border-accent rounded bg-white outline-none"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => commitEdit(fieldDef.name)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit(fieldDef.name);
                          if (e.key === 'Escape') { setEditingField(null); setEditValue(''); }
                        }}
                      />
                    )
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEdit(fieldDef.name)}
                      className="text-left w-full hover:text-accent transition-colors group/val"
                      title="Click to edit"
                    >
                      {value ? (
                        <span className="flex items-center gap-1">
                          {value}
                          <Pencil className="w-2.5 h-2.5 opacity-0 group-hover/val:opacity-40 transition-opacity" />
                        </span>
                      ) : (
                        <span className="text-text-tertiary italic">
                          {fieldDef.placeholder ?? '—'}
                        </span>
                      )}
                    </button>
                  )}
                </td>

              </tr>
            );
          })}
        </tbody>
        </table>

        {/* Footer actions */}
        <div className="flex-shrink-0 px-5 py-3 border-t border-divider bg-surface-subtle flex justify-center">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!allRequired || confirming || drafting}
            className="btn-primary !text-xs !px-4 !py-1.5"
            style={{ width: '40%' }}
          >
            {confirming ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Confirming…
              </>
            ) : (
              'Next'
            )}
          </button>
        </div>

      </div>{/* end card-elevated */}
    </div>
  );
}
