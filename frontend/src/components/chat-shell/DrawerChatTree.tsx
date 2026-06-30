'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, FolderOpen, Home, ListChecks, Plus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, type Project } from '@/lib/api';
import { useChatShell } from '@/components/chat-shell/ChatShellContext';
import type { ChatContextExpandedWidget } from '@/components/chat-shell/chatContextStackMotion';
import { PROJECT_VARIABLES } from '@/lib/projectVariablesCopy';
import { useWorkspaceStore } from '@/stores/workspaceStore';

export interface ChatListItem {
  id: string;
  title: string | null;
  updated_at: string | null;
  project_id: string | null;
}

interface DrawerChatTreeProps {
  activeChatId: string | null;
  onSelectChat: (chatId: string, projectId?: string | null) => void;
  onNewChat: (projectId?: string | null) => void;
  refreshKey?: number;
}

const PAGE_SIZE = 5;
const TREE_LEADING_SLOT = 'flex h-5 w-5 shrink-0 items-center justify-center';

const PROJECT_CONTEXT_CAPSULES: Array<{ id: ChatContextExpandedWidget; label: string; Icon: LucideIcon }> = [
  { id: 'overview', label: 'Overview', Icon: Home },
  { id: 'variables', label: PROJECT_VARIABLES.title, Icon: ListChecks },
  { id: 'files', label: 'Files', Icon: FolderOpen },
];

function contextCapsuleClass(isActive: boolean): string {
  return [
    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
    isActive
      ? 'border-accent bg-accent/10 text-accent-anchor'
      : 'border-stroke-subtle text-text-tertiary hover:border-black/10 hover:text-text-secondary',
  ].join(' ');
}

export function DrawerChatTree({
  activeChatId,
  onSelectChat,
  onNewChat,
  refreshKey = 0,
}: DrawerChatTreeProps) {
  const chatShell = useChatShell();
  const { activeWorkspace, loadWorkspaces } = useWorkspaceStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [visibleCount, setVisibleCount] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);

  const activeProjectId = chatShell?.activeProjectId ?? null;
  const prevActiveProjectIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeWorkspace) void loadWorkspaces();
  }, [activeWorkspace, loadWorkspaces]);

  const load = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    if (!hasLoadedOnceRef.current) {
      setLoading(true);
    }
    setLoadError(null);
    try {
      const [projectRows, chatResponse] = await Promise.all([
        api.listProjects(100, 0, false, activeWorkspace.id),
        api.getChats(),
      ]);
      setProjects(projectRows);
      setChats(chatResponse.chats);
      setExpanded((prev) => {
        const next = { ...prev };
        for (const p of projectRows) {
          if (next[p.id] == null) {
            next[p.id] = p.id === activeProjectId;
          }
        }
        return next;
      });
      setVisibleCount((prev) => {
        const next = { ...prev };
        for (const p of projectRows) {
          if (next[p.id] == null) next[p.id] = PAGE_SIZE;
        }
        return next;
      });
      hasLoadedOnceRef.current = true;
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, activeWorkspace?.id]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!activeProjectId || activeProjectId === prevActiveProjectIdRef.current) {
      prevActiveProjectIdRef.current = activeProjectId;
      return;
    }

    prevActiveProjectIdRef.current = activeProjectId;

    setExpanded((prev) => {
      const next = { ...prev };
      for (const project of projects) {
        next[project.id] = project.id === activeProjectId;
      }
      return next;
    });
    setVisibleCount((counts) => {
      const next = { ...counts };
      for (const project of projects) {
        if (project.id !== activeProjectId) {
          next[project.id] = PAGE_SIZE;
        }
      }
      return next;
    });
  }, [activeProjectId, projects]);

  const chatsByKey = useMemo(() => {
    const buckets = new Map<string, ChatListItem[]>();
    for (const p of projects) buckets.set(p.id, []);
    for (const chat of chats) {
      const key = chat.project_id || chat.project_id;
      if (!key || !buckets.has(key)) continue;
      buckets.get(key)!.push(chat);
    }
    for (const [, list] of buckets) {
      list.sort((a, b) => Date.parse(b.updated_at || '') - Date.parse(a.updated_at || ''));
    }
    return buckets;
  }, [chats, projects]);

  const sections = useMemo(
    () =>
      projects.map((p) => ({
        key: p.id,
        name: p.name,
      })),
    [projects],
  );

  const toggleChatHistoryExpanded = useCallback((projectKey: string, isOpen: boolean) => {
    if (isOpen) {
      setVisibleCount((counts) => ({
        ...counts,
        [projectKey]: PAGE_SIZE,
      }));
    }
    setExpanded((prev) => ({ ...prev, [projectKey]: !isOpen }));
  }, []);

  const renderChatRow = (chat: ChatListItem, projectId: string | null) => {
    const label = chat.title?.trim() || 'Untitled chat';
    const active = chat.id === activeChatId;
    return (
      <button
        key={chat.id}
        type="button"
        onClick={() => onSelectChat(chat.id, projectId)}
        className={`w-full flex items-center gap-2 px-0.5 py-1.5 rounded-md text-xs text-left transition-colors ${
          active ? 'bg-surface-subtle text-text-primary' : 'text-text-secondary hover:bg-black/[0.04] hover:text-text-primary'
        }`}
        title={label}
      >
        <span className={TREE_LEADING_SLOT}>
          <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-accent' : 'bg-text-tertiary/50'}`} />
        </span>
        <span className="truncate flex-1 min-w-0">{label}</span>
      </button>
    );
  };

  const renderSection = ({
    key,
    name,
  }: {
    key: string;
    name: string;
  }) => {
    const list = chatsByKey.get(key) ?? [];
    const open = expanded[key] ?? key === activeProjectId;
    const limit = visibleCount[key] ?? PAGE_SIZE;
    const visible = list.slice(0, limit);
    const remaining = list.length - visible.length;

    return (
      <div key={key} className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={() => onNewChat(key)}
          className="w-full flex items-center px-1.5 py-1 rounded-md text-left hover:bg-black/[0.03] transition-colors"
          title={`Open ${name}`}
        >
          <span className="truncate flex-1 text-xs font-semibold text-text-primary">{name}</span>
        </button>

        <div className="flex flex-wrap items-center gap-1 px-1.5 mb-1.5">
          {PROJECT_CONTEXT_CAPSULES.map((capsule) => {
            const isActive =
              chatShell?.activeProjectId === key &&
              !chatShell?.activeChatId &&
              chatShell?.activeContextWidget === capsule.id;

            return (
              <button
                key={capsule.id}
                type="button"
                onClick={() => chatShell?.openProjectContextPanel(key, capsule.id)}
                className={contextCapsuleClass(isActive)}
                title={`Open ${capsule.label}`}
              >
                <capsule.Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
                {capsule.label}
              </button>
            );
          })}
        </div>

        <div className="relative w-full group">
          <button
            type="button"
            onClick={() => toggleChatHistoryExpanded(key, open)}
            className="w-full flex items-center gap-1 px-1.5 py-1 pr-8 rounded-lg text-left hover:bg-black/[0.03] transition-colors"
            aria-expanded={open}
            aria-label={open ? `Collapse ${name} Chat History` : `Expand ${name} Chat History`}
            title={open ? 'Collapse Chat History' : 'Expand Chat History'}
          >
            <ChevronRight
              className={`w-3.5 h-3.5 shrink-0 text-text-tertiary transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
            />
            <span className="flex-1 min-w-0 text-xs font-medium text-text-secondary">Chat History</span>
          </button>
          <button
            type="button"
            onClick={() => onNewChat(key)}
            className="absolute right-0.5 top-1/2 -translate-y-1/2 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-black/[0.06] text-text-tertiary hover:text-text-primary transition-all"
            title={`New chat in ${name}`}
            aria-label={`New chat in ${name}`}
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
        {open && (
          <div className="flex flex-col gap-0.5">
            {visible.length === 0 ? (
              <p className="flex items-center gap-2 px-0.5 py-1 text-[10px] text-text-tertiary">
                <span className={TREE_LEADING_SLOT} aria-hidden="true" />
                No chats yet
              </p>
            ) : (
              visible.map((chat) => renderChatRow(chat, key))
            )}
            {remaining > 0 && (
              <button
                type="button"
                onClick={() =>
                  setVisibleCount((c) => ({
                    ...c,
                    [key]: (c[key] ?? PAGE_SIZE) + PAGE_SIZE,
                  }))
                }
                className="flex items-center gap-2 px-0.5 py-1 text-[10px] text-text-tertiary hover:text-text-primary text-left"
              >
                <span className={TREE_LEADING_SLOT} aria-hidden="true" />
                See more ({remaining})
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col min-h-0 h-full px-1.5 pb-3">
      {loading ? (
        <p className="px-2 pt-2 text-[11px] text-text-tertiary">Loading…</p>
      ) : loadError ? (
        <p className="px-2 pt-2 text-[11px] text-red-500">{loadError}</p>
      ) : projects.length === 0 ? (
        <div className="px-2 pt-2">
          <p className="text-[11px] text-text-tertiary">
            No projects in {activeWorkspace?.name ?? 'this workspace'}.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-y-auto min-h-0 flex-1 pt-1">
          {sections.map(renderSection)}
        </div>
      )}
    </div>
  );
}
