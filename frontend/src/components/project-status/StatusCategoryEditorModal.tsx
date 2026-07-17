'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { MODAL_BACKDROP_CLASS, MODAL_PANEL_CHROME } from '@/components/ui/ModalShell';
import { api, type ProjectStatusCategoryConfig } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface StatusCategoryEditorModalProps {
  initiativeId: string;
  category?: ProjectStatusCategoryConfig | null;
  onClose: () => void;
  onSaved: () => void;
}

export function StatusCategoryEditorModal({
  initiativeId,
  category,
  onClose,
  onSaved,
}: StatusCategoryEditorModalProps) {
  const { user } = useAuth();
  const isEdit = Boolean(category);
  const [visible, setVisible] = useState(false);
  const [label, setLabel] = useState(category?.label ?? '');
  const [definitionText, setDefinitionText] = useState(category?.definition_text ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 150);
  }, [onClose]);

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
        });
      } else {
        await api.createStatusCategory(initiativeId, {
          label: label.trim(),
          definition_text: definitionText.trim(),
        });
      }
      onSaved();
      handleClose();
    } catch {
      setError('Unable to save category.');
    } finally {
      setIsSaving(false);
    }
  };

  const definedByLabel = (() => {
    if (!isEdit) {
      const email = user?.email?.trim();
      return email ? `Defined by ${email}` : 'Defined by you';
    }
    const email = category?.defined_by_email?.trim();
    if (email) return `Defined by ${email}`;
    return 'System default';
  })();

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[120] flex items-center justify-center p-4 transition-opacity ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <button type="button" className={`absolute inset-0 ${MODAL_BACKDROP_CLASS}`} aria-label="Close" onClick={handleClose} />
      <div className={`relative w-full max-w-lg ${MODAL_PANEL_CHROME}`}>
        <div className="flex items-center justify-between border-b border-divider px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-text-primary">
              {isEdit ? 'Edit status category' : 'Add status category'}
            </h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              Define what success means for this category.
            </p>
          </div>
          <button type="button" onClick={handleClose} className="rounded-lg p-1.5 text-text-tertiary hover:bg-surface-subtle">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">Title</span>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className="w-full rounded-xl border border-stroke-subtle px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              placeholder="Deployment readiness"
            />
          </label>

          <div className="space-y-1.5">
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
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
              {definedByLabel}
            </p>
          </div>

          {error ? <p className="text-sm text-red-500">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-divider px-5 py-4">
          <button type="button" onClick={handleClose} className="btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={isSaving}
            className="btn-primary"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
