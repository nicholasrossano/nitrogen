'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { api } from '@/lib/api';

interface PromoteFindingDialogProps {
  open: boolean;
  projectId: string;
  projectName?: string;
  messageId: string;
  initialBody: string;
  onClose: () => void;
  onPromoted?: () => void;
}

export function PromoteFindingDialog({
  open,
  projectId,
  projectName,
  messageId,
  initialBody,
  onClose,
  onPromoted,
}: PromoteFindingDialogProps) {
  const [body, setBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setBody(initialBody);
      setError(null);
    }
  }, [open, initialBody]);

  const handlePromote = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed) {
      setError('Finding body cannot be empty.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.promoteFinding({
        chat_message_id: messageId,
        project_id: projectId,
        body: trimmed,
      });
      onPromoted?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to promote finding');
    } finally {
      setSaving(false);
    }
  }, [body, messageId, onClose, onPromoted, projectId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/30">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="promote-finding-title"
        className="w-full max-w-lg rounded-lg bg-white shadow-workspace border border-stroke-subtle"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
          <div>
            <h2 id="promote-finding-title" className="text-sm font-semibold text-text-primary">
              Promote to project finding
            </h2>
            {projectName && (
              <p className="text-xs text-text-secondary mt-0.5">{projectName}</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded text-text-tertiary hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-xs text-text-secondary">
            Shared findings appear in the team feed and can trigger assumption extraction.
          </p>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            className="w-full text-sm rounded-md border border-stroke-subtle px-3 py-2 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 resize-y min-h-[120px]"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-divider">
          <button type="button" onClick={onClose} className="btn-secondary !text-xs">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handlePromote()}
            disabled={saving}
            className="btn-primary !text-xs flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Promote finding
          </button>
        </div>
      </div>
    </div>
  );
}
