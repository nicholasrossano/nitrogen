'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  CheckCircle2,
  Circle,
  Download,
  Loader2,
  Search,
  Pencil,
  X,
  Check,
} from 'lucide-react';
import { api } from '@/lib/api';

interface FieldDef {
  field_id: string;
  label: string;
  field_type: string;
  section: string;
  required: boolean;
  placeholder_text: string;
  help_text?: string;
}

interface CoverLetterEditorProps {
  fieldSchema: FieldDef[];
  sectionContext?: Record<string, string>;
  fieldValues: Record<string, any>;
  workspaceId: string | null;
  documentTitle?: string;
  onFieldsUpdated: (fields: Record<string, any>, completion: any) => void;
}

export function CoverLetterEditor({
  fieldSchema,
  sectionContext = {},
  fieldValues: initialFieldValues,
  workspaceId,
  documentTitle = 'Cover Letter',
  onFieldsUpdated,
}: CoverLetterEditorProps) {
  const [fieldValues, setFieldValues] = useState<Record<string, any>>(initialFieldValues || {});
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFieldValues(initialFieldValues || {});
  }, [initialFieldValues]);

  const completion = useMemo(() => {
    const total = fieldSchema.length;
    const requiredFields = fieldSchema.filter((f) => f.required);
    let filled = 0;
    let requiredFilled = 0;
    for (const f of fieldSchema) {
      const entry = fieldValues[f.field_id];
      if (entry?.value) {
        filled++;
        if (f.required) requiredFilled++;
      }
    }
    const status =
      filled === 0 ? 'not_started' :
      requiredFilled >= requiredFields.length ? 'complete' :
      'in_progress';
    return { total_fields: total, filled_fields: filled, required_fields: requiredFields.length, required_filled: requiredFilled, status };
  }, [fieldSchema, fieldValues]);

  const handleFieldSave = useCallback(async (fieldId: string, value: string) => {
    if (!workspaceId) return;
    setSaving(true);
    try {
      const result = await api.updateGSFieldValues(workspaceId, { [fieldId]: value });
      setFieldValues(result.field_values || {});
      onFieldsUpdated(result.field_values || {}, result.completion);
    } catch (err) {
      console.error('Failed to save field', err);
    } finally {
      setSaving(false);
      setEditingField(null);
    }
  }, [workspaceId, onFieldsUpdated]);

  // Listen for cover letter field confirmations from chat
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.field_id && detail?.value) {
        handleFieldSave(detail.field_id, detail.value);
      }
    };
    window.addEventListener('nitrogen:cover-letter-field-confirmed', handler);
    return () => window.removeEventListener('nitrogen:cover-letter-field-confirmed', handler);
  }, [handleFieldSave]);

  const handleInvestigate = useCallback((field: FieldDef) => {
    const text = `Help me determine the value for "${field.label}" in the GS ${documentTitle}`;
    window.dispatchEvent(new CustomEvent('nitrogen:draft', { detail: { text } }));
  }, [documentTitle]);

  const handleExport = useCallback(async () => {
    if (!workspaceId) return;
    setExporting(true);
    try {
      const blob = await api.exportGSCoverLetter(workspaceId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `GS_Cover_Letter.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed', err);
    } finally {
      setExporting(false);
    }
  }, [workspaceId]);

  const startEdit = useCallback((field: FieldDef) => {
    const entry = fieldValues[field.field_id];
    setEditingField(field.field_id);
    setEditValue(entry?.value || '');
  }, [fieldValues]);

  const confirmEdit = useCallback(() => {
    if (editingField) {
      handleFieldSave(editingField, editValue);
    }
  }, [editingField, editValue, handleFieldSave]);

  const cancelEdit = useCallback(() => {
    setEditingField(null);
    setEditValue('');
  }, []);

  // Group fields by section
  const sections = useMemo(() => {
    const map = new Map<string, FieldDef[]>();
    for (const f of fieldSchema) {
      const list = map.get(f.section) || [];
      list.push(f);
      map.set(f.section, list);
    }
    return Array.from(map.entries());
  }, [fieldSchema]);

  const [activeSection, setActiveSection] = useState<string>('all');
  const visibleSections = activeSection === 'all'
    ? sections
    : sections.filter(([name]) => name === activeSection);

  return (
    <div className="h-full flex flex-col">
      {/* Completion bar */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-divider bg-white">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-text-primary">
            {completion.filled_fields} of {completion.total_fields} fields complete
          </span>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${
            completion.status === 'complete'
              ? 'bg-indicator-green/10 text-indicator-green'
              : completion.status === 'in_progress'
                ? 'bg-indicator-yellow/10 text-indicator-yellow'
                : 'bg-surface-subtle text-text-tertiary'
          }`}>
            {completion.status === 'complete' ? 'Complete' :
             completion.status === 'in_progress' ? 'In Progress' : 'Not Started'}
          </span>
        </div>
        <div className="h-1.5 bg-surface-subtle rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${completion.total_fields > 0 ? (completion.filled_fields / completion.total_fields) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Section tabs */}
      {sections.length > 1 && (
        <div className="flex border-b border-divider bg-white overflow-x-auto shrink-0">
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setActiveSection('all')}
            className={`shrink-0 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
              activeSection === 'all'
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            All
          </button>
          {sections.map(([sectionName]) => (
            <button
              key={sectionName}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setActiveSection(sectionName)}
              className={`shrink-0 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                activeSection === sectionName
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {sectionName}
            </button>
          ))}
        </div>
      )}

      {/* Questionnaire: sections with context + field tiles */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4" ref={editorRef}>
        {visibleSections.map(([sectionName, fields]) => (
          <div key={sectionName} className="mb-6">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">
              {sectionName}
            </h3>
            {sectionContext[sectionName] && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-surface-subtle border border-stroke-subtle">
                <p className="text-xs text-text-secondary leading-relaxed">
                  {sectionContext[sectionName]}
                </p>
              </div>
            )}
            <div className="space-y-2">
              {fields.map((field) => (
                <GSFieldTile
                  key={field.field_id}
                  field={field}
                  fieldValues={fieldValues}
                  editingField={editingField}
                  editValue={editValue}
                  saving={saving}
                  onStartEdit={startEdit}
                  onInvestigate={handleInvestigate}
                  onEditChange={setEditValue}
                  onConfirmEdit={confirmEdit}
                  onCancelEdit={cancelEdit}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Export footer */}
      <div className="flex-shrink-0 p-4 border-t border-divider bg-surface-header flex justify-center">
        <button
          onClick={handleExport}
          disabled={exporting || !workspaceId}
          className="btn-primary !text-xs !px-4 !py-1.5"
          style={{ width: '40%' }}
        >
          {exporting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              Export DOCX
            </>
          )}
        </button>
      </div>
    </div>
  );
}


/** Single field tile in questionnaire style */
function GSFieldTile({
  field,
  fieldValues,
  editingField,
  editValue,
  saving,
  onStartEdit,
  onInvestigate,
  onEditChange,
  onConfirmEdit,
  onCancelEdit,
}: {
  field: FieldDef;
  fieldValues: Record<string, any>;
  editingField: string | null;
  editValue: string;
  saving: boolean;
  onStartEdit: (f: FieldDef) => void;
  onInvestigate: (f: FieldDef) => void;
  onEditChange: (v: string) => void;
  onConfirmEdit: () => void;
  onCancelEdit: () => void;
}) {
  const entry = fieldValues[field.field_id];
  const value = entry?.value || '';
  const isFilled = !!value;
  const isEditing = editingField === field.field_id;
  const isSignature = field.field_type === 'signature';

  return (
    <div
      className={`rounded-lg border overflow-hidden transition-colors ${
        isEditing
          ? 'border-accent'
          : isFilled
            ? 'border-indicator-green/30'
            : 'border-stroke-subtle'
      }`}
    >
      <div className="px-4 py-2.5 flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          {isFilled ? (
            <CheckCircle2 className="w-4 h-4 text-indicator-green" />
          ) : (
            <Circle className="w-4 h-4 text-divider" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-xs font-medium text-text-primary">
              {field.label}
            </span>
            {field.required && (
              <span className="text-[9px] text-indicator-orange">*</span>
            )}
          </div>

          {isEditing ? (
            <div className="space-y-2">
              {field.field_type === 'multiline' ? (
                <textarea
                  value={editValue}
                  onChange={(e) => onEditChange(e.target.value)}
                  className="w-full text-sm text-text-primary bg-surface-subtle border border-stroke-subtle rounded px-3 py-2 focus:outline-none focus:border-accent min-h-[80px] resize-y"
                  autoFocus
                />
              ) : (
                <input
                  type={field.field_type === 'date' ? 'date' : 'text'}
                  value={editValue}
                  onChange={(e) => onEditChange(e.target.value)}
                  className="w-full text-sm text-text-primary bg-surface-subtle border border-stroke-subtle rounded px-3 py-2 focus:outline-none focus:border-accent"
                  autoFocus
                />
              )}
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={onCancelEdit}
                  className="p-1.5 text-text-tertiary hover:text-text-secondary rounded transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={onConfirmEdit}
                  disabled={saving}
                  className="p-1.5 text-accent hover:text-accent-anchor rounded transition-colors"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {isSignature ? (
                <span className="text-xs text-text-tertiary italic">
                  Sign after export
                </span>
              ) : isFilled ? (
                <span className="text-sm text-text-primary truncate">
                  {value}
                </span>
              ) : (
                <span className="text-xs text-text-tertiary italic">
                  {field.help_text || `Enter ${field.label.toLowerCase()}`}
                </span>
              )}
            </div>
          )}
        </div>

        {!isEditing && !isSignature && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => onInvestigate(field)}
              className="p-1.5 text-text-tertiary hover:text-accent rounded transition-colors"
              title="Investigate with chat"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onStartEdit(field)}
              className="p-1.5 text-text-tertiary hover:text-accent rounded transition-colors"
              title="Edit"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

