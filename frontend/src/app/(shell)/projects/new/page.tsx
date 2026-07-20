'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, Loader2 } from 'lucide-react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { EditorPanelHeader } from '@/components/editor/EditorPanelHeader';
import { ProjectOnboardingHeader } from '@/components/core-chat/ProjectOnboardingHeader';
import { api } from '@/lib/api';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { isDemoActive } from '@/lib/demo/demoSession';

/**
 * Client-only "New Project" landing. Nothing is created in the backend here —
 * the real project only comes into existence once the user sends their first
 * description below. That keeps Back conventional (plain history navigation,
 * no drafts to discard or orphans to clean up) and lets the existing backend
 * onboarding script (upload files -> propose assessments) kick off from that
 * first message.
 *
 * Layout mirrors a normal chat thread: scrollable content up top, composer
 * pinned to the bottom (so the input sits exactly where it does everywhere
 * else — not floated into the middle like the tiled landing composer).
 */
function NewProjectPageContent() {
  const router = useRouter();
  const { activeWorkspace, loadWorkspaces } = useWorkspaceStore();
  const [input, setInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isDemoActive()) {
      router.replace('/chat');
      return;
    }
    if (!activeWorkspace) void loadWorkspaces();
  }, [activeWorkspace, loadWorkspaces, router]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 150)}px`;
  }, [input]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const submit = useCallback(async () => {
    const content = input.trim();
    if (!content || creating) return;
    const workspaceId = activeWorkspace?.id;
    if (!workspaceId) {
      setError('Still loading your workspace — one moment, then try again.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const project = await api.createProject('New Project', workspaceId);
      // Replace (not push) so /projects/new never sits in history behind the
      // real project — Back from the new project still lands on whatever was
      // open before New Project was clicked. The ?seed= is auto-sent once by
      // the workbench, then stripped from the URL.
      router.replace(`/projects/${project.id}?seed=${encodeURIComponent(content)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setCreating(false);
    }
  }, [activeWorkspace?.id, creating, input, router]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorPanelHeader title="Untitled" suffix="New Project" onBack={handleBack} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 pt-10">
            <ProjectOnboardingHeader />
            {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
          </div>
        </div>
        <div className="mx-auto w-full max-w-3xl px-4 pb-4">
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="relative">
            <div className="chat-composer-shell">
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Briefly describe the project — what you are building, where, and any goals or constraints"
                  disabled={creating}
                  rows={1}
                  className="no-global-focus-style w-full resize-none bg-transparent px-5 py-3.5 pb-11 pr-5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:text-text-tertiary overflow-hidden"
                  style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                />
                <div className="absolute right-3 bottom-2.5 flex items-center gap-1.5">
                  <button
                    type="submit"
                    disabled={creating || !input.trim()}
                    className="w-5 h-5 flex items-center justify-center rounded-full transition-colors duration-150 disabled:cursor-default disabled:bg-stroke-subtle enabled:bg-accent"
                    aria-label="Start project"
                  >
                    {creating ? (
                      <Loader2 className="w-[11px] h-[11px] text-white animate-spin" />
                    ) : (
                      <ArrowUp className="w-[11px] h-[11px] text-white" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function NewProjectPage() {
  return (
    <ProtectedRoute>
      <Suspense
        fallback={(
          <div className="flex flex-1 items-center justify-center min-h-0 bg-surface">
            <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
          </div>
        )}
      >
        <NewProjectPageContent />
      </Suspense>
    </ProtectedRoute>
  );
}
