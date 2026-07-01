'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import { api, type ProjectStatusCategoryConfig, type ProjectStatusCriteria, type ProjectStatusCriterion } from '@/lib/api';

interface StatusCategoryEditorModalProps {
  initiativeId: string;
  category?: ProjectStatusCategoryConfig | null;
  onClose: () => void;
  onSaved: () => void;
}

function emptyCriteria(): ProjectStatusCriteria {
  return { summary: '', criteria: [], retrieval_focus: [], parse_warnings: [] };
}

export function StatusCategoryEditorModal({
  initiativeId,
  category,
  onClose,
  onSaved,
}: StatusCategoryEditorModalProps) {
  const isEdit = Boolean(category);
  const [visible, setVisible] = useState(false);
  const [label, setLabel] = useState(category?.label ?? '');
  const [definitionText, setDefinitionText] = useState(category?.definition_text ?? '');
  const [criteria, setCriteria] = useState<ProjectStatusCriteria>(category?.criteria ?? emptyCriteria());
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 150);
  }, [onClose]);

  const onGenerateCriteria = async () => {
    if (!definitionText.trim()) {
      setError('Add a definition of success before generating criteria.');
      return;
    }
    if (!isEdit || !category) {
      setError('Save the category first, then generate criteria.');
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      const generated = await api.generateStatusCategoryCriteria(initiativeId, category.category_key, true);
      setCriteria(generated);
    } catch {
      setError('Unable to generate criteria right now.');
    } finally {
      setIsGenerating(false);
    }
  };

  const updateCriterion = (index: number, text: string) => {
    setCriteria((prev) => ({
      ...prev,
      criteria: prev.criteria.map((item, idx) => (idx === index ? { ...item, text } : item)),
    }));
  };

  const addCriterion = () => {
    setCriteria((prev) => ({
      ...prev,
      criteria: [...prev.criteria, { id: `c${prev.criteria.length + 1}`, text: '', type: 'qualitative' }],
    }));
  };

  const removeCriterion = (index: number) => {
    setCriteria((prev) => ({
      ...prev,
      criteria: prev.criteria.filter((_, idx) => idx !== index),
    }));
  };

  const onSave = async () => {
    if (!label.trim()) {
      setError('Category title is required.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      if (isEdit && category) {
        await api.updateStatusCategory(initiativeId, category.category_key, {
          label: label.trim(),
          definition_text: definitionText.trim(),
          criteria,
        });
      } else {
        const created = await api.createStatusCategory(initiativeId, {
          label: label.trim(),
          definition_text: definitionText.trim(),
        });
        if (criteria.criteria.length > 0) {
          await api.updateStatusCategory(initiativeId, created.category_key, { criteria });
        } else if (definitionText.trim()) {
          await api.generateStatusCategoryCriteria(initiativeId, created.category_key, true);
        }
      }
      onSaved();
      handleClose();
    } catch {
      setError('Unable to save category.');
    } finally {
      setIsSaving(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[120] flex items-center justify-center p-4 transition-opacity ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <button type="button" className="absolute inset-0 bg-black/30" aria-label="Close" onClick={handleClose} />
      <div className="relative w-full max-w-2xl rounded-2xl border border-stroke-subtle bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-divider px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-text-primary">
              {isEdit ? 'Edit status category' : 'Add status category'}
            </h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              Define what success means, generate a criteria lens, then refresh to assess.
            </p>
          </div>
          <button type="button" onClick={handleClose} className="rounded-lg p-1.5 text-text-tertiary hover:bg-surface-subtle">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">Title</span>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className="w-full rounded-xl border border-stroke-subtle px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              placeholder="Deployment readiness"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              How do you define success here?
            </span>
            <textarea
              value={definitionText}
              onChange={(event) => setDefinitionText(event.target.value)}
              rows={5}
              className="w-full resize-y rounded-xl border border-stroke-subtle px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              placeholder="Describe what maturity or readiness means for this category..."
            />
          </label>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-text-secondary">Criteria lens (editable reasoning scaffold)</p>
            <button
              type="button"
              onClick={() => void onGenerateCriteria()}
              disabled={isGenerating || !definitionText.trim() || !isEdit}
              className="btn-compact-neutral"
              title={!isEdit ? 'Save the category first to generate criteria' : undefined}
            >
              {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Generate criteria
            </button>
          </div>

          {criteria.parse_warnings.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {criteria.parse_warnings.join(' ')}
            </div>
          ) : null}

          {criteria.summary ? (
            <p className="text-sm text-text-secondary">{criteria.summary}</p>
          ) : null}

          <div className="space-y-2">
            {criteria.criteria.map((item: ProjectStatusCriterion, index) => (
              <div key={`${item.id}-${index}`} className="flex items-start gap-2">
                <input
                  value={item.text}
                  onChange={(event) => updateCriterion(index, event.target.value)}
                  className="flex-1 rounded-xl border border-stroke-subtle px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeCriterion(index)}
                  className="rounded-lg p-2 text-text-tertiary hover:bg-surface-subtle hover:text-red-600"
                  aria-label="Remove criterion"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button type="button" onClick={addCriterion} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              <Plus className="h-3.5 w-3.5" />
              Add criterion
            </button>
          </div>

          {error ? <p className="text-sm text-red-500">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-divider px-5 py-4">
          <button type="button" onClick={handleClose} className="btn-compact-neutral">
            Cancel
          </button>
          <button type="button" onClick={() => void onSave()} disabled={isSaving} className="btn-compact-primary">
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
