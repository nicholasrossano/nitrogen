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
  htmlPreview: string;
  fieldValues: Record<string, any>;
  workspaceId: string | null;
  onFieldsUpdated: (fields: Record<string, any>, completion: any) => void;
}

export function CoverLetterEditor({
  fieldSchema,
  htmlPreview,
  fieldValues: initialFieldValues,
  workspaceId,
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
    const text = `Help me determine the value for "${field.label}" in the GS Cover Letter`;
    window.dispatchEvent(new CustomEvent('nitrogen:draft', { detail: { text } }));
  }, []);

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

  const hasHtmlPreview = htmlPreview && htmlPreview.length > 100;

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

      {/* Document / field editor */}
      <div className="flex-1 min-h-0 overflow-y-auto" ref={editorRef}>
        {hasHtmlPreview ? (
          <DocumentPreview
            html={htmlPreview}
            fieldSchema={fieldSchema}
            fieldValues={fieldValues}
            editingField={editingField}
            editValue={editValue}
            onStartEdit={startEdit}
            onInvestigate={handleInvestigate}
            onEditChange={setEditValue}
            onConfirmEdit={confirmEdit}
            onCancelEdit={cancelEdit}
          />
        ) : (
          <StructuredFieldEditor
            sections={sections}
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
        )}
      </div>

      {/* Export footer */}
      <div className="flex-shrink-0 p-4 border-t border-divider bg-surface-header">
        <button
          onClick={handleExport}
          disabled={exporting || !workspaceId}
          className="btn-primary w-full !py-3"
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


/** Renders the mammoth HTML with interactive field overlays */
function DocumentPreview({
  html,
  fieldSchema,
  fieldValues,
  editingField,
  editValue,
  onStartEdit,
  onInvestigate,
  onEditChange,
  onConfirmEdit,
  onCancelEdit,
}: {
  html: string;
  fieldSchema: FieldDef[];
  fieldValues: Record<string, any>;
  editingField: string | null;
  editValue: string;
  onStartEdit: (f: FieldDef) => void;
  onInvestigate: (f: FieldDef) => void;
  onEditChange: (v: string) => void;
  onConfirmEdit: () => void;
  onCancelEdit: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // After render, hydrate field placeholders with interactive behavior
  useEffect(() => {
    if (!containerRef.current) return;
    const spans = containerRef.current.querySelectorAll<HTMLElement>('[data-field-id]');
    spans.forEach((span) => {
      const fieldId = span.getAttribute('data-field-id') || '';
      const entry = fieldValues[fieldId];
      if (entry?.value) {
        span.textContent = entry.value;
        span.classList.add('gs-field-filled');
        span.classList.remove('gs-field-empty');
      } else {
        span.classList.add('gs-field-empty');
        span.classList.remove('gs-field-filled');
      }
    });
  }, [html, fieldValues]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-field-id]');
    if (!target) return;
    const fieldId = target.getAttribute('data-field-id') || '';
    const field = fieldSchema.find((f) => f.field_id === fieldId);
    if (field) onStartEdit(field);
  }, [fieldSchema, onStartEdit]);

  // Build processed HTML: replace field values in the preview
  const processedHtml = useMemo(() => {
    let result = html;
    for (const f of fieldSchema) {
      const entry = fieldValues[f.field_id];
      if (entry?.value) {
        const regex = new RegExp(`(data-field-id="${f.field_id}"[^>]*>)[^<]*(<)`, 'g');
        result = result.replace(regex, `$1${entry.value}$2`);
      }
    }
    return result;
  }, [html, fieldSchema, fieldValues]);

  return (
    <div className="relative">
      {editingField && (
        <FieldEditOverlay
          field={fieldSchema.find((f) => f.field_id === editingField)!}
          value={editValue}
          onChange={onEditChange}
          onConfirm={onConfirmEdit}
          onCancel={onCancelEdit}
          onInvestigate={() => {
            const f = fieldSchema.find((f) => f.field_id === editingField);
            if (f) onInvestigate(f);
          }}
        />
      )}
      <div
        ref={containerRef}
        className="gs-document-preview px-8 py-6"
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: processedHtml }}
      />
    </div>
  );
}


/** Fallback: structured field editor when no HTML preview is available */
function StructuredFieldEditor({
  sections,
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
  sections: [string, FieldDef[]][];
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
  return (
    <div className="p-5 space-y-6">
      {sections.map(([sectionName, fields]) => (
        <div key={sectionName}>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-3">
            {sectionName}
          </h3>
          <div className="space-y-2">
            {fields.map((field) => {
              const entry = fieldValues[field.field_id];
              const value = entry?.value || '';
              const isFilled = !!value;
              const isEditing = editingField === field.field_id;
              const isSignature = field.field_type === 'signature';

              return (
                <div
                  key={field.field_id}
                  className={`rounded border overflow-hidden transition-colors ${
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
            })}
          </div>
        </div>
      ))}
    </div>
  );
}


function FieldEditOverlay({
  field,
  value,
  onChange,
  onConfirm,
  onCancel,
  onInvestigate,
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onInvestigate: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 bg-white border-b border-accent shadow-sm px-5 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-accent">
          Editing: {field.label}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={onInvestigate} className="text-xs text-text-secondary hover:text-accent px-2 py-1 rounded transition-colors">
            <Search className="w-3 h-3 inline mr-1" />
            Investigate
          </button>
          <button onClick={onCancel} className="p-1 text-text-tertiary hover:text-text-secondary rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      {field.field_type === 'multiline' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full text-sm bg-surface-subtle border border-stroke-subtle rounded px-3 py-2 focus:outline-none focus:border-accent min-h-[60px] resize-y"
          autoFocus
        />
      ) : (
        <input
          type={field.field_type === 'date' ? 'date' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full text-sm bg-surface-subtle border border-stroke-subtle rounded px-3 py-2 focus:outline-none focus:border-accent"
          autoFocus
        />
      )}
      <div className="flex justify-end mt-2">
        <button
          onClick={onConfirm}
          className="px-4 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-anchor rounded transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  );
}
