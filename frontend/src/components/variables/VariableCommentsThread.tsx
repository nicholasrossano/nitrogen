'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { AccessMemberRow } from '@/components/sharing/AccessMemberRow';
import { api, type VariableComment } from '@/lib/api';
import { useProjectStore } from '@/stores/projectStore';

const COMMENT_MAX_LENGTH = 4000;
const COMMENTS_LOAD_TIMEOUT_MS = 15_000;

interface VariableCommentsThreadProps {
  variableId: string;
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

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function VariableCommentsThread({ variableId }: VariableCommentsThreadProps) {
  const isViewer = useProjectStore((state) => state.project?.shared_role === 'viewer');
  const [comments, setComments] = useState<VariableComment[]>([]);
  const [draftComment, setDraftComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const requestIdRef = useRef(0);

  const loadComments = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await api.listVariableComments(variableId, COMMENTS_LOAD_TIMEOUT_MS);
      if (requestId !== requestIdRef.current) return;
      setComments(next);
      setHasLoaded(true);
    } catch (e: unknown) {
      if (requestId !== requestIdRef.current) return;
      setError(errorMessage(e, 'Failed to load comments'));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [variableId]);

  useEffect(() => {
    setComments([]);
    setDraftComment('');
    setHasLoaded(false);
    void loadComments();
    return () => {
      // Invalidate in-flight responses when the variable changes or the thread unmounts.
      requestIdRef.current += 1;
    };
  }, [loadComments]);

  const handleAddComment = useCallback(async () => {
    const body = draftComment.trim();
    if (!body || saving || body.length > COMMENT_MAX_LENGTH) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api.createVariableComment(variableId, body);
      setComments((prev) => [...prev, created]);
      setDraftComment('');
      setHasLoaded(true);
    } catch (e: unknown) {
      setError(errorMessage(e, 'Failed to add comment'));
    } finally {
      setSaving(false);
    }
  }, [variableId, draftComment, saving]);

  const draftLength = draftComment.trim().length;
  const canSubmit = !saving && draftLength > 0 && draftLength <= COMMENT_MAX_LENGTH;
  const showEmpty = hasLoaded && !loading && !error && comments.length === 0;

  return (
    <section className="space-y-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary">Comments</p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          <div className="flex items-start justify-between gap-3">
            <p>{error}</p>
            <button
              type="button"
              className="shrink-0 font-medium text-red-700 underline-offset-2 hover:underline"
              onClick={() => void loadComments()}
              disabled={loading}
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {loading && comments.length === 0 ? (
          <p className="text-xs text-text-tertiary">Loading comments...</p>
        ) : showEmpty ? (
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

      {!isViewer ? (
        <div className="space-y-2">
          <textarea
            className="min-h-[80px] w-full resize-none rounded-lg border border-stroke-subtle px-3 py-2 text-sm"
            value={draftComment}
            onChange={(event) => setDraftComment(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canSubmit) {
                event.preventDefault();
                void handleAddComment();
              }
            }}
            placeholder="Add a comment..."
            maxLength={COMMENT_MAX_LENGTH}
            disabled={saving}
          />
          <div className="flex items-center justify-end gap-3">
            {draftLength > COMMENT_MAX_LENGTH - 200 ? (
              <p className="text-[11px] text-text-tertiary">
                {draftLength}/{COMMENT_MAX_LENGTH}
              </p>
            ) : null}
            <button
              type="button"
              className="btn-primary !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 inline-flex items-center shrink-0"
              onClick={() => void handleAddComment()}
              disabled={!canSubmit}
            >
              {saving ? 'Adding...' : 'Add Comment'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
