'use client';

import { useCallback, useEffect, useState } from 'react';

import { AccessMemberRow } from '@/components/sharing/AccessMemberRow';
import { api, type AssumptionComment } from '@/lib/api';
import { useInitiativeStore } from '@/stores/initiativeStore';

interface AssumptionCommentsThreadProps {
  assumptionId: string;
}

function formatCommentTime(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function AssumptionCommentsThread({ assumptionId }: AssumptionCommentsThreadProps) {
  const isViewer = useInitiativeStore((state) => state.initiative?.shared_role === 'viewer');
  const [comments, setComments] = useState<AssumptionComment[]>([]);
  const [draftComment, setDraftComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadComments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.listAssumptionComments(assumptionId);
      setComments(next);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load comments');
    } finally {
      setLoading(false);
    }
  }, [assumptionId]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  const handleAddComment = useCallback(async () => {
    const body = draftComment.trim();
    if (!body || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api.createAssumptionComment(assumptionId, body);
      setComments((prev) => [...prev, created]);
      setDraftComment('');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to add comment');
    } finally {
      setSaving(false);
    }
  }, [assumptionId, draftComment, saving]);

  return (
    <section className="space-y-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary">Comments</p>
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div> : null}

      <div className="space-y-2">
        {loading ? (
          <p className="text-xs text-text-tertiary">Loading comments...</p>
        ) : comments.length === 0 ? (
          <p className="rounded-lg border border-dashed border-stroke-subtle bg-white/60 px-3 py-3 text-xs text-text-tertiary">
            No comments yet.
          </p>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="rounded-lg border border-stroke-subtle bg-white py-2">
              <AccessMemberRow
                emailOrId={comment.created_by_email || 'system'}
                roleLabel={formatCommentTime(comment.created_at)}
              />
              <p className="mt-1 whitespace-pre-wrap px-3 text-sm leading-5 text-text-primary">{comment.body}</p>
            </div>
          ))
        )}
      </div>

      {isViewer ? (
        <p className="rounded-lg border border-stroke-subtle bg-white/60 px-3 py-2 text-xs text-text-tertiary">
          Viewers can read comments but cannot add them.
        </p>
      ) : (
        <div className="space-y-2">
          <textarea
            className="min-h-[80px] w-full resize-none rounded-lg border border-stroke-subtle px-3 py-2 text-sm"
            value={draftComment}
            onChange={(event) => setDraftComment(event.target.value)}
            placeholder="Add a comment..."
          />
          <div className="flex justify-end">
            <button
              type="button"
              className="btn-primary !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 inline-flex items-center shrink-0"
              onClick={() => void handleAddComment()}
              disabled={saving || !draftComment.trim()}
            >
              {saving ? 'Adding...' : 'Add Comment'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
